/**
 * Marka Rapor — Google Ads MCC Script
 * ------------------------------------------------------------
 * Nereye: Google Ads > (MCC hesabı) > Araçlar > Toplu işlemler > Script'ler > + Yeni script
 * Ne yapar: Config'teki "Google Ads" hesaplarının kampanya ve ad (PMax için asset group) seviyesinde
 *   günlük verisini çeker ve rapor veri dosyalarına yazar.
 *   - İlk çalıştırmalarda START_DATE'ten bugüne ay ay backfill (en yeni ay önce)
 *   - Backfill bitince her çalıştırmada son GADS_LOOKBACK_DAYS günü yeniler
 * Zamanlama: "Saatlik". Günlük yenileme her gün DAILY_REFRESH_HOUR'dan sonraki ilk çalıştırmada bir kez yapılır
 *   (dün + son GADS_LOOKBACK_DAYS gün). Backfill bitince diğer saatlik çalıştırmalar hemen biter.
 *   Veri bugünü içermez.
 * İki MCC: MCC1 ve MCC2 için ayrı dosyalar üretilir (STATE_PREFIX / DATASET_SUFFIX farklı).
 *   Her script sadece kendi MCC'sinde erişebildiği hesapları kendi veri dosyalarına yazar;
 *   aynı anda çalışsalar bile birbirinin dosyasına dokunmazlar. Rapor ikisini birlikte okur.
 */

var CONFIG_URL = '__CONFIG_URL__';   // Web uygulaması > Durum sekmesindeki Config linki
var STATE_PREFIX = '__STATE_PREFIX__';
var DATASET_SUFFIX = '__DATASET_SUFFIX__';
var MIN_SECONDS_FOR_MONTH = 600;      // yeni bir ayı başlatmak için gereken min. kalan süre
var MIN_SECONDS_PER_ACCOUNT = 150;

var GADS_CAMP_HEADER = ['date', 'account_id', 'account_name', 'currency', 'campaign_id', 'campaign_name', 'channel_type',
  'impressions', 'clicks', 'cost', 'conversions', 'conv_value', 'all_conversions', 'all_conv_value'];
var GADS_AD_HEADER = ['date', 'account_id', 'account_name', 'currency', 'campaign_id', 'campaign_name', 'channel_type',
  'adgroup_id', 'adgroup_name', 'ad_id', 'ad_name', 'ad_type',
  'impressions', 'clicks', 'cost', 'conversions', 'conv_value', 'all_conversions', 'all_conv_value'];
var GADS_TEXT = ['account_name', 'currency', 'campaign_id', 'campaign_name', 'channel_type', 'adgroup_id', 'adgroup_name', 'ad_id', 'ad_name', 'ad_type'];

var METRIC_FIELDS = 'metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value, metrics.all_conversions, metrics.all_conversions_value';

function remaining_() { return AdsApp.getExecutionInfo().getRemainingTime(); }

function main() {
  var ss = SpreadsheetApp.openByUrl(CONFIG_URL);
  var s = sh_settings_(ss);
  var start = s.START_DATE || '2025-01-01';
  var today = sh_yesterday_(); // veri bugünü içermez, en fazla dün
  sh_setState_(ss, STATE_PREFIX + 'LAST_RUN', sh_now_());

  var cfgAccts = sh_accounts_(ss, 'Google Ads').filter(function (a) { return a.active; });
  var ids = cfgAccts.map(function (a) { return a.id; });
  var accessible = [];
  var it = AdsManagerApp.accounts().withIds(ids).get();
  while (it.hasNext()) accessible.push(it.next());
  var accIds = accessible.map(function (a) { return a.getCustomerId(); });
  var missing = ids.filter(function (id) { return accIds.indexOf(id) < 0; });
  sh_setState_(ss, STATE_PREFIX + 'ACCESSIBLE', accIds.length + '/' + ids.length + (missing.length ? ' (erişilemeyen: ' + missing.join(', ') + ')' : ''));
  if (missing.length) sh_log_(ss, 'gads', 'WARN', 'Bu MCC altında bulunamayan hesaplar: ' + missing.join(', '));
  if (!accessible.length) { sh_log_(ss, 'gads', 'ERROR', 'Erişilebilir hesap yok.'); return; }

  // 1) Günlük yenileme — her gün 03:00'ten sonra bir kez
  var last = sh_getState_(ss, STATE_PREFIX + 'LAST_REFRESH');
  var due = sh_dailyDue_(last, +s.DAILY_REFRESH_HOUR || 3);
  if (due) {
    var from = sh_addDays_(today, -(+s.GADS_LOOKBACK_DAYS || 14));
    if (from < start) from = start;
    if (processRange_(ss, accessible, from, today)) sh_setState_(ss, STATE_PREFIX + 'LAST_REFRESH', sh_now_());
  }

  // 2) Backfill — ay ay geriye doğru
  if (sh_getState_(ss, STATE_PREFIX + 'BACKFILL_DONE') !== 'yes') {
    var cursor = sh_getState_(ss, STATE_PREFIX + 'BACKFILL_CURSOR') || today.slice(0, 7);
    while (cursor >= start.slice(0, 7)) {
      if (remaining_() < MIN_SECONDS_FOR_MONTH) break;
      var mFrom = cursor + '-01';
      var mTo = sh_monthEnd_(mFrom);
      if (mTo > today) mTo = today;
      if (mFrom < start) mFrom = start;
      if (!processRange_(ss, accessible, mFrom, mTo)) break;
      cursor = sh_addDays_(cursor + '-01', -1).slice(0, 7);
      sh_setState_(ss, STATE_PREFIX + 'BACKFILL_CURSOR', cursor);
    }
    if (cursor < start.slice(0, 7)) {
      sh_setState_(ss, STATE_PREFIX + 'BACKFILL_DONE', 'yes');
      sh_log_(ss, 'gads', 'INFO', 'Backfill tamamlandı.');
    }
  }
}

function parseTs_(s) {
  var m = /(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/.exec(s);
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime() : 0;
}

/** Tüm erişilebilir hesaplar için [from,to] çek + yaz. Tamamı bitti ise true. */
function processRange_(ss, accounts, from, to) {
  var camp = [], ads = [], done = [], cur = {}, cut = false;
  for (var i = 0; i < accounts.length; i++) {
    if (remaining_() < MIN_SECONDS_PER_ACCOUNT) { cut = true; break; }
    var acc = accounts[i];
    AdsManagerApp.select(acc);
    var id = acc.getCustomerId();
    try {
      var c = queryCampaigns_(id, from, to);
      var a = queryAds_(id, from, to);
      for (var j = 0; j < c.length; j++) camp.push(c[j]);
      for (var k = 0; k < a.length; k++) ads.push(a[k]);
      cur[id] = { currency: acc.getCurrencyCode() };
      done.push(id);
    } catch (e) {
      // hatalı hesap atlanır; replace listesine girmediği için eski verisi korunur
      sh_log_(ss, 'gads', 'ERROR', id + ' ' + from + '→' + to + ': ' + e);
    }
  }
  if (!done.length) return !cut;
  var rep = { accounts: done, from: from, to: to };
  st_upsert_(ss, 'gads_campaign' + DATASET_SUFFIX, GADS_CAMP_HEADER, camp, rep, GADS_TEXT);
  st_upsert_(ss, 'gads_ad' + DATASET_SUFFIX, GADS_AD_HEADER, ads, rep, GADS_TEXT);
  sh_updateAccounts_(ss, 'Google Ads', cur);
  sh_log_(ss, 'gads', 'INFO', from + '→' + to + ': ' + done.length + ' hesap, ' + camp.length + ' kampanya satırı, ' + ads.length + ' ad satırı');
  return !cut;
}

function n_(v) { return v == null ? 0 : +v || 0; }

function base_(r, id) {
  return [r.segments.date, id, r.customer.descriptiveName || '', r.customer.currencyCode || '',
    String(r.campaign.id), r.campaign.name || '', r.campaign.advertisingChannelType || ''];
}

function mets_(r) {
  var m = r.metrics || {};
  return [n_(m.impressions), n_(m.clicks), n_(m.costMicros) / 1e6, n_(m.conversions), n_(m.conversionsValue), n_(m.allConversions), n_(m.allConversionsValue)];
}

function queryCampaigns_(id, from, to) {
  var q = 'SELECT segments.date, customer.descriptive_name, customer.currency_code, campaign.id, campaign.name, campaign.advertising_channel_type, ' +
    METRIC_FIELDS + ' FROM campaign WHERE segments.date BETWEEN "' + from + '" AND "' + to + '"';
  var out = [], rows = AdsApp.search(q);
  while (rows.hasNext()) { var r = rows.next(); out.push(base_(r, id).concat(mets_(r))); }
  return out;
}

function queryAds_(id, from, to) {
  var out = [];
  var q = 'SELECT segments.date, customer.descriptive_name, customer.currency_code, campaign.id, campaign.name, campaign.advertising_channel_type, ' +
    'ad_group.id, ad_group.name, ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.ad.type, ad_group_ad.ad.final_urls, ' +
    'ad_group_ad.ad.responsive_search_ad.headlines, ' + METRIC_FIELDS +
    ' FROM ad_group_ad WHERE segments.date BETWEEN "' + from + '" AND "' + to + '"';
  var rows = AdsApp.search(q);
  while (rows.hasNext()) {
    var r = rows.next();
    var ad = (r.adGroupAd && r.adGroupAd.ad) || {};
    var name = ad.name || '';
    if (!name && ad.responsiveSearchAd && ad.responsiveSearchAd.headlines && ad.responsiveSearchAd.headlines.length) {
      name = ad.responsiveSearchAd.headlines.slice(0, 2).map(function (h) { return h.text; }).join(' | ');
    }
    if (!name) name = (ad.type || 'AD') + (ad.finalUrls && ad.finalUrls.length ? ' · ' + ad.finalUrls[0] : '') + ' #' + ad.id;
    out.push(base_(r, id).concat([String(r.adGroup.id), r.adGroup.name || '', String(ad.id), name, ad.type || ''], mets_(r)));
  }
  // Performance Max: ad_group_ad yok → asset group seviyesi
  try {
    var q2 = 'SELECT segments.date, customer.descriptive_name, customer.currency_code, campaign.id, campaign.name, campaign.advertising_channel_type, ' +
      'asset_group.id, asset_group.name, ' + METRIC_FIELDS +
      ' FROM asset_group WHERE segments.date BETWEEN "' + from + '" AND "' + to + '"';
    var rows2 = AdsApp.search(q2);
    while (rows2.hasNext()) {
      var r2 = rows2.next();
      var ag = r2.assetGroup || {};
      out.push(base_(r2, id).concat([String(ag.id), ag.name || '', String(ag.id), ag.name || '', 'ASSET_GROUP'], mets_(r2)));
    }
  } catch (e) { Logger.log('asset_group sorgusu atlandı: ' + e); }
  return out;
}
