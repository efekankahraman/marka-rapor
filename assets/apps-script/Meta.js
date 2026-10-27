/**
 * Meta.js — Meta Marketing API (Insights) → meta_ad (aylık) + meta_campaign (yıllık).
 * Ad seviyesi, günlük kırılım (time_increment=1), async report job ile.
 */

var META_AD_HEADER = ['date', 'account_id', 'account_name', 'currency', 'campaign_id', 'campaign_name', 'objective',
  'adset_id', 'adset_name', 'ad_id', 'ad_name',
  'impressions', 'reach', 'clicks', 'link_clicks', 'spend', 'purchases', 'purchase_value',
  'add_to_cart', 'initiate_checkout', 'installs', 'landing_page_views'];
var META_CAMP_HEADER = ['date', 'account_id', 'account_name', 'currency', 'campaign_id', 'campaign_name', 'objective',
  'impressions', 'clicks', 'link_clicks', 'spend', 'purchases', 'purchase_value',
  'add_to_cart', 'initiate_checkout', 'installs', 'landing_page_views'];
var META_TEXT_COLS = ['account_name', 'currency', 'campaign_id', 'campaign_name', 'objective', 'adset_id', 'adset_name', 'ad_id', 'ad_name'];
var META_SUM_COLS = ['impressions', 'clicks', 'link_clicks', 'spend', 'purchases', 'purchase_value', 'add_to_cart', 'initiate_checkout', 'installs', 'landing_page_views'];

var META_FIELDS = ['date_start', 'account_id', 'account_name', 'account_currency', 'campaign_id', 'campaign_name', 'objective',
  'adset_id', 'adset_name', 'ad_id', 'ad_name', 'impressions', 'reach', 'clicks', 'inline_link_clicks', 'spend', 'actions', 'action_values'];

// İlk bulunan action_type kullanılır (omni_* = web + app + offline toplamı)
var META_ACTIONS = {
  purchases: ['omni_purchase', 'purchase', 'offsite_conversion.fb_pixel_purchase', 'app_custom_event.fb_mobile_purchase'],
  add_to_cart: ['omni_add_to_cart', 'add_to_cart', 'offsite_conversion.fb_pixel_add_to_cart', 'app_custom_event.fb_mobile_add_to_cart'],
  initiate_checkout: ['omni_initiated_checkout', 'initiate_checkout', 'offsite_conversion.fb_pixel_initiate_checkout', 'app_custom_event.fb_mobile_initiated_checkout'],
  installs: ['omni_app_install', 'mobile_app_install', 'app_install'],
  landing_page_views: ['landing_page_view', 'omni_landing_page_view']
};

function meta_pick_(list, types) {
  if (!list) return 0;
  for (var i = 0; i < types.length; i++) {
    for (var j = 0; j < list.length; j++) if (list[j].action_type === types[i]) return +list[j].value || 0;
  }
  return 0;
}

function meta_sync_(ss, it, t0) {
  var token = PropertiesService.getScriptProperties().getProperty('META_TOKEN');
  if (!token) throw new Error('META_TOKEN tanımlı değil');
  var s = sh_settings_(ss);
  var base = 'https://graph.facebook.com/' + (s.META_API_VERSION || 'v23.0') + '/';
  var acct = it.account;

  // 1) async job başlat (ya da önceki denemeden kalan job'u kullan)
  if (!it.runId) {
    var payload = {
      level: 'ad',
      time_increment: '1',
      time_range: JSON.stringify({ since: it.from, until: it.to }),
      fields: meta_fields_(it.account),
      use_unified_attribution_setting: 'true',
      access_token: token
    };
    var start = fetchJson_(base + 'act_' + acct + '/insights', { method: 'post', payload: payload });
    it.runId = start.report_run_id;
    if (!it.runId) throw new Error('report_run_id alınamadı: ' + JSON.stringify(start).slice(0, 200));
  }

  // 2) job'u bekle (maks. ~150 sn; bitmezse kuyrukta 'run:ID' ile sonra devam eder)
  var waitStart = Date.now(), status;
  while (true) {
    try {
      status = fetchJson_(base + it.runId + '?fields=async_status,async_percent_completion&access_token=' + encodeURIComponent(token));
    } catch (e) { it.runId = null; throw e; } // süresi dolmuş / geçersiz job → sonraki denemede yeniden başlar
    if (status.async_status === 'Job Completed' && +status.async_percent_completion === 100) break;
    if (status.async_status === 'Job Failed' || status.async_status === 'Job Skipped') {
      it.runId = null;
      throw new Error('Meta job başarısız: ' + status.async_status);
    }
    if (Date.now() - waitStart > 150000 || Date.now() - t0 > 330000) throw new Error('Meta job zaman aşımı (devam edecek) ' + (status.async_percent_completion || 0) + '%');
    Utilities.sleep(4000);
  }

  // 3) sonuçları sayfa sayfa oku
  var url = base + it.runId + '/insights?limit=' + (s.META_PAGE_LIMIT || 1000) + '&access_token=' + encodeURIComponent(token);
  var adRows = [], currency = '';
  while (url) {
    var page = fetchJson_(url);
    (page.data || []).forEach(function (d) {
      currency = d.account_currency || currency;
      adRows.push([
        d.date_start, acct, d.account_name || '', d.account_currency || '',
        String(d.campaign_id || ''), d.campaign_name || '', d.objective || '',
        String(d.adset_id || ''), d.adset_name || '', String(d.ad_id || ''), d.ad_name || '',
        +d.impressions || 0, +d.reach || 0, +d.clicks || 0, +d.inline_link_clicks || 0, +d.spend || 0,
        meta_pick_(d.actions, META_ACTIONS.purchases) || meta_pick_(d.catalog_segment_actions, META_ACTIONS.purchases),
        meta_pick_(d.action_values, META_ACTIONS.purchases) || meta_pick_(d.catalog_segment_value, META_ACTIONS.purchases),
        meta_pick_(d.actions, META_ACTIONS.add_to_cart) || meta_pick_(d.catalog_segment_actions, META_ACTIONS.add_to_cart),
        meta_pick_(d.actions, META_ACTIONS.initiate_checkout) || meta_pick_(d.catalog_segment_actions, META_ACTIONS.initiate_checkout),
        meta_pick_(d.actions, META_ACTIONS.installs), meta_pick_(d.actions, META_ACTIONS.landing_page_views)
      ]);
    });
    url = page.paging && page.paging.next ? page.paging.next : null;
  }

  // 4) kampanya seviyesine topla
  var campRows = meta_rollupCampaign_(adRows);

  var rep = { accounts: [acct], from: it.from, to: it.to };
  st_upsert_(ss, 'meta_ad', META_AD_HEADER, adRows, rep, META_TEXT_COLS);
  st_upsert_(ss, 'meta_campaign', META_CAMP_HEADER, campRows, rep, META_TEXT_COLS);
  var upd = {}; upd[acct] = { currency: currency };
  sh_updateAccounts_(ss, 'Meta', upd);
  it.runId = null;
  return adRows.length;
}

function meta_rollupCampaign_(adRows) {
  var H = META_AD_HEADER, idx = {};
  H.forEach(function (h, i) { idx[h] = i; });
  var agg = {}, order = [];
  adRows.forEach(function (r) {
    var k = r[0] + '|' + r[idx.campaign_id];
    var a = agg[k];
    if (!a) {
      a = agg[k] = META_CAMP_HEADER.map(function (h) { return META_SUM_COLS.indexOf(h) >= 0 ? 0 : r[idx[h]]; });
      order.push(k);
    }
    META_SUM_COLS.forEach(function (h) { a[META_CAMP_HEADER.indexOf(h)] += +r[idx[h]] || 0; });
  });
  return order.map(function (k) { return agg[k]; });
}

/**
 * meta_campaign yıllık dosyasını meta_ad aylık dosyalarından yeniden kurar (API çağrısı yok).
 * meta_campaign 2026 dosyası Sheets servis hatası sırasında boşalmıştı; ad dosyaları sağlamdı.
 */
function meta_rebuildCampaignYear_(ss, year) {
  var reg = st_registry_(ss), all = [], accts = {};
  for (var m = 1; m <= 12; m++) {
    var p = year + '-' + (m < 10 ? '0' : '') + m;
    if (!reg['meta_ad|' + p]) continue;
    var file = st_getShard_(ss, 'meta_ad', p, false);
    if (!file) continue;
    var ex = st_retry_(function () { return st_readSheet_(file.getSheets()[0]); });
    var map = META_AD_HEADER.map(function (h) { return ex.header.indexOf(h); });
    ex.rows.forEach(function (r) {
      var o = map.map(function (j, k) { return j < 0 ? (META_SUM_COLS.indexOf(META_AD_HEADER[k]) >= 0 ? 0 : '') : r[j]; });
      o[1] = String(o[1]);
      accts[o[1]] = 1;
      all.push(o);
    });
  }
  if (!all.length) return 0;
  var camp = meta_rollupCampaign_(all);
  st_upsert_(ss, 'meta_campaign', META_CAMP_HEADER, camp, { accounts: Object.keys(accts), from: year + '-01-01', to: year + '-12-31' }, META_TEXT_COLS);
  return camp.length;
}

/** Birden fazla Meta işinin async raporunu tek seferde (paralel) başlatır; run ID'leri kuyruğa yazar. */
function meta_prestart_(ss, items) {
  if (!items.length) return;
  var token = PropertiesService.getScriptProperties().getProperty('META_TOKEN');
  if (!token) return;
  var s = sh_settings_(ss);
  var base = 'https://graph.facebook.com/' + (s.META_API_VERSION || 'v23.0') + '/';
  var reqs = items.map(function (it) {
    return { url: base + 'act_' + it.account + '/insights', method: 'post', muteHttpExceptions: true, payload: {
      level: 'ad', time_increment: '1', time_range: JSON.stringify({ since: it.from, until: it.to }),
      fields: meta_fields_(it.account), use_unified_attribution_setting: 'true', access_token: token } };
  });
  UrlFetchApp.fetchAll(reqs).forEach(function (res, i) {
    var body = null;
    try { body = JSON.parse(res.getContentText()); } catch (e) {}
    if (res.getResponseCode() < 300 && body && body.report_run_id) {
      items[i].message = 'run:' + body.report_run_id;
      queueSheet_(ss).getRange(items[i].row, 7).setValue(items[i].message);
    }
  });
}

/** CPAS (Collaborative Ads) hesaplarında satışlar catalog_segment_* alanlarında gelir. */
function meta_fields_(acct) {
  return (cpas_is_(acct) ? META_FIELDS.concat(['catalog_segment_actions', 'catalog_segment_value']) : META_FIELDS).join(',');
}
