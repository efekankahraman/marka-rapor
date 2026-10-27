/**
 * Ext.js — Google Ads / Meta dışındaki reklam platformları (kampanya × gün seviyesi).
 *
 * Kuyruk + Manuel Veri → ext_campaign, Microsoft Ads script'i → ext_push (yıllık shard'lar, aynı kolonlar).
 * account_id platformlar arasında benzersizdir.
 *   TikTok         → kuyruk (source 'tiktok'),   token: Durum > TikTok access token (Script Properties: TIKTOK_TOKEN)
 *   Yandex Direct  → kuyruk (source 'yandex'),   token: Durum > Yandex OAuth token (YANDEX_TOKEN), hesap ID = Client-Login
 *   RTB House      → kuyruk (source 'rtbhouse'), token: Durum > RTB House API token (RTBHOUSE_TOKEN), hesap ID = advertiser hash
 *   Microsoft Ads  → Microsoft Ads script'i veriyi misafir web uygulamasına POST eder (doPost, BRAND.BING_PUSH_KEY ile)
 *   Criteo         → kuyruk (source 'criteo'),   kimlik: Durum > Criteo client_id:client_secret (CRITEO_CREDENTIALS)
 *   Yango Ads ve API'si olmayan diğerleri → Config > "Manuel Veri" sekmesi (her senkronda okunur)
 *
 * Kampanya adı GA4 sessionCampaignName (utm_campaign) ile eşleşir; reklamlarda utm_campaign = kampanya adı olmalı.
 */

var EXT_HEADER = ['date', 'account_id', 'platform', 'account_name', 'currency', 'campaign_id', 'campaign_name',
  'impressions', 'clicks', 'spend', 'conversions', 'conv_value', 'installs'];
var EXT_TEXT = ['platform', 'account_name', 'currency', 'campaign_id', 'campaign_name'];

// kuyruk kaynağı → Accounts sekmesindeki platform adı
var EXT_SOURCES = { tiktok: 'TikTok', yandex: 'Yandex Direct', rtbhouse: 'RTB House', criteo: 'Criteo', yango: 'Yango Ads' };
var EXT_TOKEN_PROP = { tiktok: 'TIKTOK_TOKEN', yandex: 'YANDEX_TOKEN', rtbhouse: 'RTBHOUSE_TOKEN', criteo: 'CRITEO_CREDENTIALS', yango: 'YANGO_TOKEN' };
// Raporda Google Ads / Meta yanında görünen ek platformlar
var EXT_PLATFORMS = ['TikTok', 'Microsoft Ads', 'Yandex Direct', 'RTB House', 'Yango Ads', 'Criteo'];
var MANUAL_SHEET = 'Manuel Veri';
var MANUAL_HEADER = ['Tarih (YYYY-MM-DD)', 'Platform', 'Hesap ID', 'Kampanya adı', 'Harcama', 'Para birimi', 'Gösterim', 'Tıklama', 'Dönüşüm', 'Dönüşüm değeri'];

function ext_isSource_(src) { return !!EXT_SOURCES[src]; }

function ext_token_(src) {
  var t = PropertiesService.getScriptProperties().getProperty(EXT_TOKEN_PROP[src]);
  if (!t) throw new Error(EXT_SOURCES[src] + ' token tanımlı değil (Durum > API erişimleri)');
  return t;
}

function ext_account_(ss, platform, id) {
  return sh_accounts_(ss, platform).filter(function (a) { return a.id === String(id); })[0] || { name: '', currency: '' };
}

/** Kuyruk işi: kaynak + hesap + tarih aralığı → ext_campaign upsert. */
function ext_sync_(ss, it) {
  var platform = EXT_SOURCES[it.source];
  var acct = ext_account_(ss, platform, it.account);
  var rows;
  if (it.source === 'tiktok') rows = tiktok_fetch_(ss, it.account, it.from, it.to, acct);
  else if (it.source === 'yandex') rows = yandex_fetch_(ss, it.account, it.from, it.to, acct);
  else if (it.source === 'rtbhouse') rows = rtbhouse_fetch_(ss, it.account, it.from, it.to, acct);
  else if (it.source === 'criteo') rows = criteo_fetch_(ss, it.account, it.from, it.to, acct);
  else if (it.source === 'yango') rows = yango_fetch_(ss, it.account, it.from, it.to, acct);
  else throw new Error('Bilinmeyen kaynak ' + it.source);
  ext_write_(ss, platform, it.account, it.from, it.to, rows);
  return rows.length;
}

/** rows: [{date, campaign_id, campaign_name, impressions, clicks, spend, conversions, conv_value, installs, currency}] */
function ext_write_(ss, platform, accountId, from, to, rows, dataset) {
  var acct = ext_account_(ss, platform, accountId);
  var cur = '';
  var out = rows.filter(function (r) { return r.date >= from && r.date <= to; }).map(function (r) {
    cur = r.currency || cur;
    return [r.date, String(accountId), platform, acct.name || '', r.currency || acct.currency || '', String(r.campaign_id || r.campaign_name || ''),
      String(r.campaign_name || ''), +r.impressions || 0, +r.clicks || 0, +r.spend || 0, +r.conversions || 0, +r.conv_value || 0, +r.installs || 0];
  });
  st_upsert_(ss, dataset || 'ext_campaign', EXT_HEADER, out, { accounts: [String(accountId)], from: from, to: to }, EXT_TEXT);
  var upd = {}; upd[String(accountId)] = { currency: cur || acct.currency };
  sh_updateAccounts_(ss, platform, upd);
  return out.length;
}

/** Tarih aralığını en fazla n günlük parçalara böler. */
function ext_chunks_(from, to, n) {
  var out = [], a = from;
  while (a <= to) {
    var b = sh_addDays_(a, n - 1);
    if (b > to) b = to;
    out.push({ from: a, to: b });
    a = sh_addDays_(b, 1);
  }
  return out;
}

/* ======================= TikTok (Marketing API v1.3) ======================= */

var TIKTOK_BASE = 'https://business-api.tiktok.com/open_api/v1.3/';

function tiktok_get_(path, params, token) {
  var q = Object.keys(params).map(function (k) {
    var v = params[k];
    return k + '=' + encodeURIComponent(typeof v === 'string' ? v : JSON.stringify(v));
  }).join('&');
  var body = fetchJson_(TIKTOK_BASE + path + '?' + q, { headers: { 'Access-Token': token } });
  if (body.code !== 0) throw new Error('TikTok ' + body.code + ': ' + (body.message || '') + (/limit|frequen/i.test(body.message || '') ? ' (rate limit)' : ''));
  return body.data || {};
}

function tiktok_currency_(advId, token) {
  var d = tiktok_get_('advertiser/info/', { advertiser_ids: [String(advId)], fields: ['currency', 'name'] }, token);
  var a = (d.list || [])[0] || {};
  return { currency: a.currency || '', name: a.name || '' };
}

function tiktok_fetch_(ss, advId, from, to, acct) {
  var token = ext_token_('tiktok');
  var cur = acct.currency;
  if (!cur) cur = tiktok_currency_(advId, token).currency;
  var rows = [];
  // stat_time_day ile tek istekte en fazla 30 gün
  ext_chunks_(from, to, 30).forEach(function (c) {
    var page = 1, total = 1;
    while (page <= total) {
      var d = tiktok_get_('report/integrated/get/', {
        advertiser_id: String(advId), report_type: 'BASIC', data_level: 'AUCTION_CAMPAIGN',
        dimensions: ['campaign_id', 'stat_time_day'],
        metrics: ['campaign_name', 'spend', 'impressions', 'clicks', 'complete_payment', 'total_complete_payment_rate'],
        start_date: c.from, end_date: c.to, page: String(page), page_size: '1000'
      }, token);
      (d.list || []).forEach(function (x) {
        var dm = x.dimensions || {}, m = x.metrics || {};
        rows.push({ date: String(dm.stat_time_day || '').slice(0, 10), campaign_id: dm.campaign_id, campaign_name: m.campaign_name,
          impressions: +m.impressions || 0, clicks: +m.clicks || 0, spend: +m.spend || 0,
          conversions: +m.complete_payment || 0, conv_value: +m.total_complete_payment_rate || 0, currency: cur });
      });
      total = (d.page_info && d.page_info.total_page) || 1;
      page++;
    }
  });
  return rows.filter(function (r) { return r.spend || r.impressions || r.clicks; });
}

/* ======================= Yandex Direct (Reports API v5) ======================= */

function yandex_headers_(token, login) {
  var h = { 'Authorization': 'Bearer ' + token, 'Accept-Language': 'en' };
  if (login) h['Client-Login'] = login;
  return h;
}

function yandex_currency_(login, token) {
  var res = UrlFetchApp.fetch('https://api.direct.yandex.com/json/v5/clients', {
    method: 'post', contentType: 'application/json; charset=utf-8', muteHttpExceptions: true,
    headers: yandex_headers_(token, login),
    payload: JSON.stringify({ method: 'get', params: { FieldNames: ['Currency', 'Login'] } })
  });
  var b = JSON.parse(res.getContentText());
  if (b.error) throw new Error('Yandex ' + b.error.error_code + ': ' + b.error.error_string + ' ' + (b.error.error_detail || ''));
  var c = ((b.result && b.result.Clients) || [])[0] || {};
  return c.Currency || '';
}

function yandex_fetch_(ss, login, from, to, acct) {
  var token = ext_token_('yandex');
  var s = sh_settings_(ss);
  var cur = acct.currency || yandex_currency_(login, token);
  var vat = String(s.YANDEX_INCLUDE_VAT || 'NO').toUpperCase() === 'YES' ? 'YES' : 'NO';
  var payload = JSON.stringify({ params: {
    SelectionCriteria: { DateFrom: from, DateTo: to },
    FieldNames: ['Date', 'CampaignId', 'CampaignName', 'Impressions', 'Clicks', 'Cost', 'Conversions', 'Revenue'],
    ReportName: 'rapor_' + login + '_' + from + '_' + to + '_' + vat,
    ReportType: 'CAMPAIGN_PERFORMANCE_REPORT', DateRangeType: 'CUSTOM_DATE',
    Format: 'TSV', IncludeVAT: vat, IncludeDiscount: 'NO'
  } });
  var h = yandex_headers_(token, login);
  h.processingMode = 'auto'; h.returnMoneyInMicros = 'false';
  h.skipReportHeader = 'true'; h.skipReportSummary = 'true';
  var t0 = Date.now(), res, code;
  while (true) {
    res = UrlFetchApp.fetch('https://api.direct.yandex.com/json/v5/reports', {
      method: 'post', contentType: 'application/json; charset=utf-8', headers: h, payload: payload, muteHttpExceptions: true });
    code = res.getResponseCode();
    if (code === 200) break;
    if (code === 201 || code === 202) {
      var wait = Math.min(+(res.getHeaders().retryIn || res.getHeaders().RetryIn || 10), 20);
      if (Date.now() - t0 > 100000) throw new Error('Yandex rapor hazırlanıyor (zaman aşımı, devam edecek)');
      Utilities.sleep(wait * 1000);
      continue;
    }
    var txt = res.getContentText(), msg = txt.slice(0, 300);
    try { var e = JSON.parse(txt).error; msg = e.error_code + ': ' + e.error_string + ' ' + (e.error_detail || ''); } catch (x) {}
    throw new Error('Yandex HTTP ' + code + ' ' + msg);
  }
  var lines = res.getContentText().split('\n').filter(String);
  if (lines.length < 2) return [];
  var head = lines[0].split('\t'), ix = {};
  head.forEach(function (k, i) { ix[k] = i; });
  function num(v) { return v == null || v === '--' ? 0 : +v || 0; }
  return lines.slice(1).map(function (l) {
    var c = l.split('\t');
    return { date: c[ix.Date], campaign_id: c[ix.CampaignId], campaign_name: c[ix.CampaignName],
      impressions: num(c[ix.Impressions]), clicks: num(c[ix.Clicks]), spend: num(c[ix.Cost]),
      conversions: num(c[ix.Conversions]), conv_value: num(c[ix.Revenue]), currency: cur };
  });
}

/* ======================= RTB House (Panel API v5) ======================= */

var RTBH_BASE = 'https://api.panel.rtbhouse.com/v5/';

function rtbhouse_get_(path, token) {
  var res = UrlFetchApp.fetch(RTBH_BASE + path, { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
  var b = null;
  try { b = JSON.parse(res.getContentText()); } catch (e) {}
  if (res.getResponseCode() >= 300 || !b || b.status !== 'ok') {
    throw new Error('RTB House HTTP ' + res.getResponseCode() + ': ' + (b ? (b.message || '') + ' ' + JSON.stringify(b.errors || '') : res.getContentText().slice(0, 200)));
  }
  return b.data;
}

function rtbhouse_fetch_(ss, hash, from, to, acct) {
  var token = ext_token_('rtbhouse');
  var s = sh_settings_(ss);
  var cur = acct.currency;
  if (!cur) {
    var adv = (rtbhouse_get_('advertisers?fields=hash,name,currency', token) || []).filter(function (a) { return a.hash === hash; })[0];
    if (!adv) throw new Error('RTB House token\'ı bu advertiser\'ı (' + hash + ') görmüyor');
    cur = adv.currency;
  }
  var data = rtbhouse_get_('advertisers/' + encodeURIComponent(hash) + '/rtb-stats?dayFrom=' + from + '&dayTo=' + to +
    '&groupBy=day-subcampaign&metrics=campaignCost-impsCount-clicksCount-conversionsCount-conversionsValue' +
    '&countConvention=' + encodeURIComponent(s.RTBHOUSE_COUNT_CONVENTION || 'ATTRIBUTED'), token) || [];
  return data.map(function (d) {
    return { date: d.day, campaign_id: d.subcampaignHash || d.subcampaign, campaign_name: d.subcampaign,
      impressions: +d.impsCount || 0, clicks: +d.clicksCount || 0, spend: +d.campaignCost || 0,
      conversions: +d.conversionsCount || 0, conv_value: +d.conversionsValue || 0, currency: cur };
  });
}

/* ======================= Criteo (Marketing Solutions API) ======================= */
// Kimlik: Durum'a "client_id:client_secret" (developers.criteo.com uygulaması, marka hesabı onaylı). Hesap ID: Criteo advertiser ID
// ya da advertiser adı (ör. "marka TR"; ilk çekimde ID'ye çevrilir).

function criteo_auth_(cred) {
  var c = String(cred).split(':');
  var res = UrlFetchApp.fetch('https://api.criteo.com/oauth2/token', { method: 'post', muteHttpExceptions: true,
    payload: { grant_type: 'client_credentials', client_id: c[0], client_secret: c.slice(1).join(':') } });
  var b = JSON.parse(res.getContentText() || '{}');
  if (!b.access_token) throw new Error('Criteo token alınamadı: ' + res.getContentText().slice(0, 200));
  return b.access_token;
}

function criteo_ver_() { try { return sh_settings_(cfg_()).CRITEO_API_VERSION || 'preview'; } catch (e) { return 'preview'; } }

function criteo_advertisers_(tk) {
  var b = fetchJson_('https://api.criteo.com/' + criteo_ver_() + '/advertisers/me', { headers: { Authorization: 'Bearer ' + tk } });
  return (b.data || []).map(function (a) { return { id: String(a.id), name: (a.attributes && (a.attributes.advertiserName || a.attributes.name)) || '' }; });
}

function criteo_fetch_(ss, acctId, from, to, acct) {
  var tk = criteo_auth_(ext_token_('criteo'));
  var s = sh_settings_(ss);
  var advId = String(acctId);
  if (!/^\d+$/.test(advId)) {
    var norm = function (x) { return String(x || '').toLowerCase().replace(/[^a-z0-9]/g, ''); };
    var list = criteo_advertisers_(tk), want = norm(advId);
    var hit = list.filter(function (a) { return norm(a.name) === want; })[0] ||
      list.filter(function (a) { return norm(a.name).indexOf(want) >= 0 || want.indexOf(norm(a.name)) >= 0; })[0] ||
      (list.length === 1 ? list[0] : null);
    if (!hit) throw new Error('Criteo advertiser bulunamadı: ' + advId + '. Erişilen advertiser\'lar: ' +
      (list.map(function (a) { return a.name + ' [' + a.id + ']'; }).join(', ') || 'YOK (Criteo onay linki bu advertiser için onaylanmamış olabilir)') + ' · Accounts > Hesap ID\'ye doğru ID\'yi yazın');
    advId = hit.id;
    sh_log_(ss, 'criteo', 'INFO', acctId + ' → advertiser ID ' + advId + ' (Accounts sekmesinde Hesap ID\'yi bununla değiştirebilirsiniz)');
  }
  var cur = acct.currency || 'TRY';
  var mCost = s.CRITEO_COST_METRIC || 'AdvertiserCost', mSales = s.CRITEO_SALES_METRIC || 'SalesAllClientAttribution',
    mRev = s.CRITEO_REVENUE_METRIC || 'RevenueGeneratedAllClientAttribution';
  var body = { advertiserIds: advId, dimensions: ['CampaignId', 'Campaign', 'Day'], metrics: [mCost, 'Displays', 'Clicks', mSales, mRev],
    currency: cur, format: 'json', timezone: SHARED_TZ, startDate: from + 'T00:00:00.000Z', endDate: to + 'T00:00:00.000Z' };
  var res = UrlFetchApp.fetch('https://api.criteo.com/' + (s.CRITEO_API_VERSION || 'preview') + '/statistics/report', {
    method: 'post', contentType: 'application/json', headers: { Authorization: 'Bearer ' + tk, Accept: 'application/json' },
    payload: JSON.stringify(body), muteHttpExceptions: true });
  if (res.getResponseCode() >= 300) throw new Error('Criteo HTTP ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300));
  var txt = res.getContentText().replace(/^\uFEFF/, '');
  var j = JSON.parse(txt);
  var rows = j.Rows || j.rows || j.data || [];
  return rows.map(function (r) {
    return { date: String(r.Day || r.day || '').slice(0, 10), campaign_id: r.CampaignId, campaign_name: r.Campaign,
      impressions: +r.Displays || 0, clicks: +r.Clicks || 0, spend: +r[mCost] || 0,
      conversions: +r[mSales] || 0, conv_value: +r[mRev] || 0, currency: cur };
  }).filter(function (r) { return r.date; });
}

/* ======================= token testleri (Durum > Kaydet) ======================= */

function ext_testToken_(ss, src, token) {
  var platform = EXT_SOURCES[src];
  var accts = sh_accounts_(ss, platform);
  if (src === 'tiktok') {
    var names = accts.map(function (a) {
      var info = tiktok_currency_(a.id, token);
      return (info.name || a.id) + ' (' + info.currency + ')';
    });
    return 'TikTok token geçerli: ' + (names.join(', ') || 'hesap yok');
  }
  if (src === 'yandex') {
    var cs = accts.map(function (a) { return a.id + ' (' + yandex_currency_(a.id, token) + ')'; });
    return 'Yandex token geçerli: ' + (cs.join(', ') || 'hesap yok');
  }
  if (src === 'yango') {
    PropertiesService.getScriptProperties().deleteProperty('YANGO_AUTH');
    var camps = yango_campaigns_(accts[0] ? accts[0].id : '', token);
    return 'Yango token geçerli (' + PropertiesService.getScriptProperties().getProperty('YANGO_AUTH') + ') · advertiser ' + (accts[0] ? accts[0].id : '?') + ': ' + camps.length + ' kampanya';
  }
  if (src === 'criteo') {
    var tk = criteo_auth_(token);
    var list = criteo_advertisers_(tk);
    return 'Criteo erişimi geçerli: ' + list.map(function (a) { return a.name + ' [' + a.id + ']'; }).join(', ');
  }
  if (src === 'rtbhouse') {
    var advs = rtbhouse_get_('advertisers?fields=hash,name,currency', token) || [];
    return 'RTB House token geçerli: ' + advs.map(function (a) { return a.name + ' [' + a.hash + ']'; }).join(', ');
  }
  return '';
}

/* ======================= Manuel Veri sekmesi (Yango Ads, Criteo, …) ======================= */

function manual_sheet_(ss) {
  var sh = ss.getSheetByName(MANUAL_SHEET);
  if (sh) return sh;
  sh = ss.insertSheet(MANUAL_SHEET);
  sh.getRange(1, 1, 1, MANUAL_HEADER.length).setValues([MANUAL_HEADER]).setFontWeight('bold');
  sh.getRange('A:D').setNumberFormat('@');
  sh.setFrozenRows(1);
  sh.getRange(1, MANUAL_HEADER.length + 2).setValue('API\'si olmayan platformların (Yango Ads, Criteo…) günlük kampanya verisini buraya yapıştırın. Hesap ID, Accounts sekmesindeki satırla aynı olmalı. Her senkronda (10 dk) rapora yazılır.').setFontStyle('italic');
  return sh;
}

/** Manuel Veri sekmesi değiştiyse ext_campaign'e yazar (hesap başına, sekmedeki tarih aralığı yenilenir). */
function manual_sync_(ss) {
  var sh = manual_sheet_(ss);
  var vals = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), MANUAL_HEADER.length).getValues().slice(1)
    .filter(function (r) { return r[0] && r[1] && r[2]; });
  var digest = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(vals)));
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('MANUAL_DIGEST') === digest) return 0;
  var groups = {};
  vals.forEach(function (r) {
    var k = String(r[1]).trim() + '|' + String(r[2]).trim();
    var g = groups[k] = groups[k] || { platform: String(r[1]).trim(), id: String(r[2]).trim(), rows: [], from: '9999', to: '0000' };
    var d = sh_dateStr_(r[0]);
    g.rows.push({ date: d, campaign_name: String(r[3] || '(manuel)'), campaign_id: String(r[3] || '(manuel)'),
      spend: +r[4] || 0, currency: String(r[5] || '').toUpperCase(), impressions: +r[6] || 0, clicks: +r[7] || 0,
      conversions: +r[8] || 0, conv_value: +r[9] || 0 });
    if (d < g.from) g.from = d;
    if (d > g.to) g.to = d;
  });
  var n = 0;
  Object.keys(groups).forEach(function (k) {
    var g = groups[k];
    if (!sh_accounts_(ss, g.platform).some(function (a) { return a.id === g.id; })) {
      sh_log_(ss, 'manuel', 'WARN', g.platform + ' / ' + g.id + ' Accounts sekmesinde yok; satırlar atlandı');
      return;
    }
    n += ext_write_(ss, g.platform, g.id, g.from, g.to, g.rows);
  });
  props.setProperty('MANUAL_DIGEST', digest);
  sh_log_(ss, 'manuel', 'INFO', 'Manuel Veri yazıldı: ' + n + ' satır');
  return n;
}

/* ======================= Microsoft Ads script'inden gelen veri (doPost) ======================= */

/**
 * Microsoft Ads script'i misafir web uygulaması linkine POST eder:
 *  { key, action: 'state' }                         → { ok, start, lookback, cursor }
 *  { key, action: 'push', account_id, account_name, currency, from, to, rows: [[date, campaign_id, campaign_name, impr, clicks, cost, conv, revenue]], cursor }
 */
function doPost(e) {
  var out;
  try {
    var b = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!BRAND.BING_PUSH_KEY || b.key !== BRAND.BING_PUSH_KEY) throw new Error('Geçersiz anahtar');
    // runSync'in kilidini beklemez: Microsoft Ads verisi ayrı veri setine (ext_push) yazılır, kuyruk işleriyle çakışmaz
    out = bing_handle_(cfg_(), b);
  } catch (err) {
    out = { ok: false, error: (err && err.message) || String(err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function bing_handle_(ss, b) {
  var s = sh_settings_(ss);
  var start = s.START_DATE || '2025-01-01';
  if (b.action === 'state') {
    return { ok: true, start: start, yesterday: sh_yesterday_(), lookback: +s.BING_LOOKBACK_DAYS || 14,
      cursor: sh_getState_(ss, 'BING_CURSOR_' + b.account_id) || '', accounts: sh_accounts_(ss, 'Microsoft Ads').filter(function (a) { return a.active; }).map(function (a) { return a.id; }) };
  }
  if (b.action === 'push') {
    var id = String(b.account_id || '');
    var acct = sh_accounts_(ss, 'Microsoft Ads').filter(function (a) { return a.id === id; })[0];
    if (!acct) throw new Error('Microsoft Ads hesabı Accounts sekmesinde yok: ' + id);
    var rows = (b.rows || []).map(function (r) {
      return { date: r[0], campaign_id: r[1], campaign_name: r[2], impressions: r[3], clicks: r[4], spend: r[5], conversions: r[6], conv_value: r[7], currency: b.currency || '' };
    });
    var n = ext_write_(ss, 'Microsoft Ads', id, b.from, b.to, rows, 'ext_push');
    if (b.cursor) sh_setState_(ss, 'BING_CURSOR_' + id, b.cursor);
    sh_setState_(ss, 'BING_LAST_PUSH', sh_now_() + ' · ' + id + ' ' + b.from + '→' + b.to + ' · ' + n + ' satır');
    sh_log_(ss, 'bing', 'INFO', id + ' ' + b.from + '→' + b.to + ': ' + n + ' satır');
    return { ok: true, rows: n };
  }
  throw new Error('Bilinmeyen işlem');
}

/** ext_campaign + ext_push satırlarını okur. cb(row, ix) */
function ext_readAll_(ss, from, to, cb) {
  return q_readShards_(ss, 'ext_campaign', from, to, cb) + q_readShards_(ss, 'ext_push', from, to, cb);
}

/* ======================= Yango Ads (space.yango.com, panelin kendi API'si) ======================= */
// Token: Yango Ads > Organizasyon > Agency > Access tokens (API token). Hesap ID = advertiser ID (ör. 2331).
// Yetki başlığı biçimi dokümante değil: ilk başarılı biçim Script Properties > YANGO_AUTH'ta saklanır.
var YANGO_BASE = 'https://space.yango.com';
var YANGO_AUTH_FORMATS = ['Bearer {t}', 'OAuth {t}', '{t}'];

var YANGO_PREFIXES = ['', '/fapi', '/public-api'];
function yango_req_(path, token, combo) {
  var c = String(combo).split('|'), pre = c.length > 1 ? c[0] : '', fmt = c.length > 1 ? c[1] : c[0];
  var h = { Accept: 'application/json' };
  if (fmt === 'X-Api-Key') h['X-Api-Key'] = token; else h.Authorization = fmt.replace('{t}', token);
  return UrlFetchApp.fetch(YANGO_BASE + pre + path, { headers: h, muteHttpExceptions: true, followRedirects: false });
}

function yango_get_(path, token) {
  var p = PropertiesService.getScriptProperties();
  var known = p.getProperty('YANGO_AUTH');
  var fmts = known ? [known] : [];
  if (!known) YANGO_PREFIXES.forEach(function (pre) { YANGO_AUTH_FORMATS.concat(['X-Api-Key']).forEach(function (f) { fmts.push(pre + '|' + f); }); });
  var last = '';
  for (var i = 0; i < fmts.length; i++) {
    var res = yango_req_(path, token, fmts[i]), code = res.getResponseCode(), txt = res.getContentText();
    if (code === 401 || code === 403 || code === 302 || (!known && (code === 404 || code === 405))) { last += (last ? ' · ' : '') + fmts[i].replace('{t}', '…') + ' → HTTP ' + code + ' ' + txt.slice(0, 80); if (known) break; continue; }
    if (code >= 300) throw new Error('Yango HTTP ' + code + ' ' + path + ': ' + txt.slice(0, 300) + (code === 429 ? ' (rate limit)' : ''));
    var body;
    try { body = JSON.parse(txt); } catch (e) { throw new Error('Yango yanıtı JSON değil (' + path + '): ' + txt.slice(0, 150)); }
    if (!known) p.setProperty('YANGO_AUTH', fmts[i]);
    return body;
  }
  if (known) p.deleteProperty('YANGO_AUTH');
  throw new Error('Yango token kabul edilmedi: ' + last);
}

function yango_campaigns_(advId, token) {
  var out = [], cursor = '', guard = 0;
  do {
    var b = yango_get_('/api/advertisers/v3/campaigns/search?advertiserId=' + encodeURIComponent(advId) + '&limit=100' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''), token);
    (b.data || b.elements || b.items || []).forEach(function (c) { out.push(c); });
    cursor = (b.meta && b.meta.nextCursor) || '';
  } while (cursor && ++guard < 50);
  return out;
}

/** Kampanya istatistiği. Kampanya tipine göre doğru uç (v2 / cpi / engagement) denenir ve kampanya başına saklanır.
 *  Yango'nun geçici 5xx hatalarında bekleyip tekrar dener; yine olmazsa aralığı günlere bölerek dener. */
function yango_stats_(campId, from, to, token) {
  var tz = encodeURIComponent(SHARED_TZ), pp = PropertiesService.getScriptProperties();
  var all = ['/api/statistics/v2/campaigns/', '/api/statistics/cpi/v1/campaigns/', '/api/statistics/engagement/v1/campaigns/'];
  var known = pp.getProperty('YANGO_PATH_' + campId);
  var paths = known ? [known].concat(all.filter(function (p) { return p !== known; })) : all;
  var groups = ['DAYS', 'DAY'], err = '', transient = false;
  function call(path, g, f, t) {
    var u = path + encodeURIComponent(campId) + '?fromDate=' + f + '&toDate=' + t + '&groupBy=' + g + '&timeZone=' + tz;
    for (var tries = 0; tries < 3; tries++) {
      try { return yango_get_(u, token); }
      catch (e) {
        if (/token kabul edilmedi/.test(e.message)) throw e;
        if (/HTTP (5\d\d|429)/.test(e.message) && tries < 2) { Utilities.sleep(3000 * (tries + 1)); continue; }
        throw e;
      }
    }
  }
  for (var i = 0; i < paths.length; i++) {
    for (var g = 0; g < groups.length; g++) {
      try {
        var b = call(paths[i], groups[g], from, to);
        if (known !== paths[i]) pp.setProperty('YANGO_PATH_' + campId, paths[i]);
        return b;
      } catch (e) {
        err = e.message;
        if (/token kabul edilmedi/.test(err)) throw e;
        if (/HTTP (5\d\d|429)/.test(err)) {
          transient = true;
          // geçici hata: aralığı günlere böl
          try {
            var els = [], d = from;
            while (d <= to) { var bb = call(paths[i], groups[g], d, d); els = els.concat(bb.elements || []); d = sh_addDays_(d, 1); }
            if (known !== paths[i]) pp.setProperty('YANGO_PATH_' + campId, paths[i]);
            return { elements: els };
          } catch (e2) { err = e2.message; if (/HTTP (5\d\d|429)/.test(err)) break; }
        } else if (!/HTTP 4\d\d/.test(err)) throw e;
      }
    }
  }
  var ex = new Error(err); ex.transient = transient; throw ex;
}

function yango_fetch_(ss, advId, from, to, acct) {
  var token = ext_token_('yango');
  var cur = acct.currency || String(sh_settings_(ss).YANGO_CURRENCY || 'TRY').toUpperCase();
  var rows = [], ok = 0, failed = [];
  var camps = yango_campaigns_(advId, token);
  camps.forEach(function (c) {
    var st;
    try { st = yango_stats_(c.id, from, to, token); ok++; }
    catch (e) { failed.push((c.name || c.id) + ': ' + String(e.message || e).slice(0, 120)); return; }
    (st.elements || []).forEach(function (el) {
      var d = el.data || {};
      var day = String(el.fromDate || el.date || '').slice(0, 10);
      if (!day) return;
      rows.push({ date: day, campaign_id: String(c.id), campaign_name: c.name || String(c.id),
        impressions: +d.impressions || 0, clicks: +d.clicks || 0, spend: +d.cost || 0,
        conversions: +d.conversions || 0, conv_value: +d.revenue || 0, installs: +d.installs || 0, currency: c.currency || cur });
    });
  });
  // hepsi başarısızsa iş tekrar denensin; bir kısmı başarısızsa diğerleri yazılır, başarısızlar loglanır (sonraki günlük yenilemede tekrar denenir)
  if (failed.length && !ok) throw new Error('Yango: hiçbir kampanyanın istatistiği alınamadı (Yango servisi geçici olarak yanıt vermiyor olabilir). ' + failed.slice(0, 3).join(' · '));
  if (failed.length) sh_log_(ss, 'yango', 'WARN', advId + ' ' + from + '→' + to + ': ' + failed.length + '/' + camps.length + ' kampanya alınamadı, sonra tekrar denenecek · ' + failed.slice(0, 3).join(' · '));
  return rows.filter(function (r) { return r.spend || r.impressions || r.clicks; });
}

/** Criteo teşhis: gelir / satış metrik adaylarını son 30 günde dener, sıfır olmayan ilkini Settings'e yazar, geçmişi yeniden çeker. */
function criteo_probe_(ss) {
  var tk = criteo_auth_(ext_token_('criteo')), s = sh_settings_(ss);
  var REV = ['RevenueGeneratedAllClientAttribution', 'RevenueGeneratedPc30d', 'RevenueGeneratedPc7d', 'RevenueGeneratedPc1d', 'RevenueGeneratedPv24h', 'RevenueGeneratedPv1d', 'RevenueGeneratedClientAttribution'];
  var SAL = ['SalesAllClientAttribution', 'SalesPc30d', 'SalesPc7d', 'SalesPc1d', 'SalesPv24h', 'SalesPv1d', 'SalesClientAttribution'];
  var to = sh_yesterday_(), from = sh_addDays_(to, -29), out = [], pick = {};
  sh_accounts_(ss, 'Criteo').filter(function (a) { return a.active; }).forEach(function (a) {
    REV.concat(SAL).forEach(function (m) {
      var body = { advertiserIds: String(a.id), dimensions: ['Day'], metrics: [m], currency: a.currency || 'TRY', format: 'json', timezone: SHARED_TZ,
        startDate: from + 'T00:00:00.000Z', endDate: to + 'T00:00:00.000Z' };
      var res = UrlFetchApp.fetch('https://api.criteo.com/' + (s.CRITEO_API_VERSION || 'preview') + '/statistics/report', { method: 'post', contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + tk, Accept: 'application/json' }, payload: JSON.stringify(body), muteHttpExceptions: true });
      if (res.getResponseCode() >= 300) { out.push(m + ': HTTP ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 80)); return; }
      var j = JSON.parse(res.getContentText().replace(/^﻿/, '')), rows = j.Rows || j.rows || j.data || [], sum = 0;
      rows.forEach(function (r) { sum += +String(r[m] == null ? 0 : r[m]).replace(',', '.') || 0; });
      out.push(m + '=' + Math.round(sum * 100) / 100);
      var kind = REV.indexOf(m) >= 0 ? 'rev' : 'sal';
      if (sum > 0 && !pick[kind]) pick[kind] = m;
    });
  });
  sh_log_(ss, 'criteo', 'INFO', 'Metrik teşhisi (son 30 gün): ' + out.join(' · '));
  var changed = false;
  if (pick.rev && pick.rev !== s.CRITEO_REVENUE_METRIC) { sh_setSetting_(ss, 'CRITEO_REVENUE_METRIC', pick.rev); changed = true; }
  if (pick.sal && pick.sal !== s.CRITEO_SALES_METRIC) { sh_setSetting_(ss, 'CRITEO_SALES_METRIC', pick.sal); changed = true; }
  if (changed) { enqueueBackfill_(ss, ['criteo']); sh_log_(ss, 'criteo', 'INFO', 'Gelir metriği ' + (pick.rev || s.CRITEO_REVENUE_METRIC) + ', satış metriği ' + (pick.sal || s.CRITEO_SALES_METRIC) + ' olarak ayarlandı; Criteo geçmişi yeniden çekiliyor.'); }
}
