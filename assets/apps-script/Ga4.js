/**
 * Ga4.js — GA4 Data API çekimi. Hem ana projede hem de GA4 köprü script'inde (farklı Google hesabı) kullanılır.
 */

/* ---------------- GA4 ---------------- */
// Advanced service: AnalyticsData (appsscript.json içinde etkin)

/** Brand.js > EXCLUDE_MARKET_CODES'taki pazarlar GA4 global property çekiminde hariç tutulur. */
function ga4Excluded_(code) {
  return ((typeof BRAND !== 'undefined' && BRAND.EXCLUDE_MARKET_CODES) || []).map(function (x) { return String(x).toUpperCase(); }).indexOf(String(code).toUpperCase()) >= 0;
}

var GA4_PAID_SM_RE = '.*(/ ?(cpc|ppc|cpm|cpv|paid.*|display|banner|retargeting|remarketing|video|ads?|social_paid)$|criteo|rtb ?house|yango).*';
function ga4_sync_(ss, propertyId, from, to) {
  var s = sh_settings_(ss);
  var dims = String(s.GA4_DIMENSIONS || '').split(',').map(function (x) { return x.trim(); }).filter(String).filter(function (d) { return d !== 'date'; });
  var mets = String(s.GA4_METRICS || 'sessions').split(',').map(function (x) { return x.trim(); }).filter(String);
  var excl = String(s.GA4_EXCLUDE_COUNTRIES || '').split(',').map(function (x) { return x.trim().toLowerCase(); }).filter(String);
  var ci = dims.indexOf('country');
  // Sadece web: GA4 'platform' boyutu (web / Android / iOS). App verisi Adjust'tan geliyor.
  var plat = s.GA4_PLATFORM === undefined ? 'web' : String(s.GA4_PLATFORM).trim();
  // Global property (tüm pazarlar tek property'de): ülke kırılımı (countryId = ISO kod) + sadece aktif pazarlar
  var isGlobal = String(propertyId) === String(s.GA4_GLOBAL_PROPERTY || '').trim();
  var codes = [];
  if (isGlobal) {
    var seen = {};
    sh_accounts_(ss).forEach(function (a) {
      var c = String(a.code || '').toUpperCase();
      if (a.active && c && !ga4Excluded_(c) && a.platform !== 'GA4' && !seen[c]) { seen[c] = 1; codes.push(c); }
    });
    sh_accounts_(ss, 'GA4').forEach(function (a) {
      var c = String(a.code || '').toUpperCase();
      if (a.active && c && !ga4Excluded_(c) && !seen[c]) { seen[c] = 1; codes.push(c); }
    });
    if (dims.indexOf('countryId') < 0) dims = dims.concat(['countryId']);
  }
  var rows = [], offset = 0, LIMIT = 100000;
  while (true) {
    var req = {
      dateRanges: [{ startDate: from, endDate: to }],
      dimensions: ['date'].concat(dims).map(function (n) { return { name: n }; }),
      metrics: mets.map(function (n) { return { name: n }; }),
      limit: LIMIT, offset: offset
    };
    // Filtre: sadece web + kampanyasız trafik (organic/direct/referral/not set) hariç → dosyalar küçük kalır
    var exprs = [];
    if (plat) exprs.push({ filter: { fieldName: 'platform', stringFilter: { value: plat, matchType: 'EXACT', caseSensitive: false } } });
    if (dims.indexOf('sessionCampaignName') >= 0) {
      var noCamp = { notExpression: { filter: { fieldName: 'sessionCampaignName',
        inListFilter: { values: ['(organic)', '(direct)', '(referral)', '(not set)', '(none)'], caseSensitive: false } } } };
      // kaynak / araç da çekiliyorsa: kampanya adı olmasa bile ücretli trafik (cpc, display, criteo, rtbhouse…) tutulur → mecra seviyesinde eşleşir
      if (dims.indexOf('sessionSourceMedium') >= 0) exprs.push({ orGroup: { expressions: [noCamp, { filter: { fieldName: 'sessionSourceMedium',
        stringFilter: { value: GA4_PAID_SM_RE, matchType: 'FULL_REGEXP', caseSensitive: false } } }] } });
      else exprs.push(noCamp);
    }
    if (isGlobal && codes.length) exprs.push({ filter: { fieldName: 'countryId', inListFilter: { values: codes } } });
    if (exprs.length === 1) req.dimensionFilter = exprs[0];
    else if (exprs.length > 1) req.dimensionFilter = { andGroup: { expressions: exprs } };
    var res = AnalyticsData.Properties.runReport(req, 'properties/' + propertyId);
    var got = res.rows || [];
    got.forEach(function (r) {
      var dv = r.dimensionValues.map(function (x) { return x.value; });
      if (ci >= 0 && excl.indexOf(String(dv[ci + 1]).toLowerCase()) >= 0) return;
      rows.push([sh_dateStr_(dv[0]), String(propertyId)].concat(dv.slice(1), r.metricValues.map(function (x) { return +x.value || 0; })));
    });
    offset += got.length;
    if (!got.length || offset >= (res.rowCount || 0)) break;
  }
  var hdrDims = dims.map(function (d) { return d === 'countryId' ? 'country' : d; });
  st_upsert_(ss, 'ga4', ['date', 'account_id'].concat(hdrDims, mets), rows, { accounts: [String(propertyId)], from: from, to: to }, hdrDims);
  sh_updateAccounts_(ss, 'GA4', (function () { var u = {}; u[String(propertyId)] = {}; return u; })());
  return rows.length;
}


/**
 * Ad group seviyesi GA4 (sadece global property, web). Ad group adını taşıyabilecek boyutlar ayrı kolonlarda tutulur:
 *   sessionGoogleAdsAdGroupName (Google Ads auto-tagging), sessionManualTerm (utm_term = Meta ad set), sessionManualAdContent (utm_content = Meta ad).
 *   sessionManualCampaignId (utm_id = Meta kampanya ID) kampanya eşleştirmesini güçlendirir.
 * Rapor her satırda bunları sırayla dener; reklam verisindeki ad group / ad set adıyla eşleşen ilk değer kullanılır.
 */
var GA4_AG_DIMS = ['sessionManualCampaignId', 'sessionGoogleAdsAdGroupName', 'sessionManualTerm', 'sessionManualAdContent'];
function ga4_agSync_(ss, from, to) {
  var s = sh_settings_(ss);
  var pid = String(s.GA4_GLOBAL_PROPERTY || '').trim();
  if (!pid) return 0;
  var start = String(s.AG_START_DATE || '2026-01-01');
  if (to < start) return 0;
  if (from < start) from = start;
  var mets = ['sessions', 'ecommercePurchases', 'purchaseRevenue'];
  var codes = [], seen = {};
  sh_accounts_(ss).concat(sh_accounts_(ss, 'GA4')).forEach(function (a) {
    var c = String(a.code || '').toUpperCase();
    if (a.active && c && !ga4Excluded_(c) && !seen[c]) { seen[c] = 1; codes.push(c); }
  });
  var NOTSET = /^(\(not set\)|\(none\)|\(not provided\)|\{.*\})$/i;
  var agg = {}, order = [], offset = 0, LIMIT = 20000; // büyük sayfalar UrlFetch 'response too large' (413) veriyordu
  while (true) {
    var exprs = [
      { notExpression: { filter: { fieldName: 'sessionCampaignName', inListFilter: { values: ['(organic)', '(direct)', '(referral)', '(not set)', '(none)'], caseSensitive: false } } } }
    ];
    var aplat = s.GA4_PLATFORM === undefined ? 'web' : String(s.GA4_PLATFORM).trim();
    if (aplat) exprs.push({ filter: { fieldName: 'platform', stringFilter: { value: aplat, matchType: 'EXACT', caseSensitive: false } } });
    if (codes.length) exprs.push({ filter: { fieldName: 'countryId', inListFilter: { values: codes } } });
    var res = AnalyticsData.Properties.runReport({
      dateRanges: [{ startDate: from, endDate: to }],
      dimensions: ['date', 'countryId', 'sessionCampaignName'].concat(GA4_AG_DIMS).map(function (n) { return { name: n }; }),
      metrics: mets.map(function (n) { return { name: n }; }),
      dimensionFilter: { andGroup: { expressions: exprs } },
      limit: LIMIT, offset: offset
    }, 'properties/' + pid);
    var got = res.rows || [];
    got.forEach(function (r) {
      var dv = r.dimensionValues.map(function (x) { var v = String(x.value || '').trim(); return NOTSET.test(v) ? '' : v; });
      var k = dv.join('|');
      var a = agg[k];
      if (!a) { a = agg[k] = [sh_dateStr_(dv[0]), pid].concat(dv.slice(1), [0, 0, 0]); order.push(k); }
      var mi = 2 + dv.length - 1; // date + account_id + (boyutlar - date)
      r.metricValues.forEach(function (m, j) { a[mi + j] += +m.value || 0; });
    });
    offset += got.length;
    if (!got.length || offset >= (res.rowCount || 0)) break;
  }
  var rows = order.map(function (k) { return agg[k]; });
  var hdr = ['date', 'account_id', 'country', 'campaign', 'campaign_id', 'gads_adgroup', 'utm_term', 'utm_content'];
  st_upsert_(ss, 'ga4_ag', hdr.concat(mets), rows, { accounts: [pid], from: from, to: to }, hdr.slice(2));
  return rows.length;
}


/**
 * Web sekmesi verisi (sadece web, global property): kanal, kaynak/araç, cihaz, yeni/geri dönen kırılımlı günlük metrikler.
 * Veri seti ga4_web (aylık). Köprü script'i (GA4 yetkili hesap) ya da ana proje çeker.
 */
var GA4_WEB_DIMS = ['date', 'sessionDefaultChannelGroup', 'sessionSourceMedium', 'deviceCategory', 'newVsReturning'];
var GA4_WEB_METS = ['sessions', 'totalUsers', 'newUsers', 'engagedSessions', 'screenPageViews', 'userEngagementDuration',
  'addToCarts', 'checkouts', 'ecommercePurchases', 'purchaseRevenue'];
function ga4_webSync_(ss, from, to) {
  var s = sh_settings_(ss);
  var pid = String(s.GA4_GLOBAL_PROPERTY || '').trim() || (sh_accounts_(ss, 'GA4').filter(function (a) { return a.active; })[0] || {}).id;
  if (!pid) return 0;
  var plat = s.GA4_PLATFORM === undefined ? 'web' : String(s.GA4_PLATFORM).trim();
  var agg = {}, order = [], offset = 0, LIMIT = 20000;
  while (true) {
    var req = { dateRanges: [{ startDate: from, endDate: to }], dimensions: GA4_WEB_DIMS.map(function (n) { return { name: n }; }),
      metrics: GA4_WEB_METS.map(function (n) { return { name: n }; }), limit: LIMIT, offset: offset };
    if (plat) req.dimensionFilter = { filter: { fieldName: 'platform', stringFilter: { value: plat, matchType: 'EXACT', caseSensitive: false } } };
    var res = AnalyticsData.Properties.runReport(req, 'properties/' + pid);
    var got = res.rows || [];
    got.forEach(function (r) {
      var dv = r.dimensionValues.map(function (x) { return String(x.value || ''); });
      var k = dv.join('|'), a = agg[k];
      if (!a) { a = agg[k] = [sh_dateStr_(dv[0]), String(pid)].concat(dv.slice(1), GA4_WEB_METS.map(function () { return 0; })); order.push(k); }
      r.metricValues.forEach(function (m, j) { a[2 + dv.length - 1 + j] += +m.value || 0; });
    });
    offset += got.length;
    if (!got.length || offset >= (res.rowCount || 0)) break;
  }
  var hdr = ['date', 'account_id', 'channel', 'source_medium', 'device', 'user_type'];
  st_upsert_(ss, 'ga4_web', hdr.concat(GA4_WEB_METS), order.map(function (k) { return agg[k]; }), { accounts: [String(pid)], from: from, to: to }, hdr.slice(2));
  return order.length;
}
