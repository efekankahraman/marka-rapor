/**
 * Query.js — rapor motoru: shard dosyalarını okur, filtreler, dönem + kırılım bazında toplar,
 * USD çevirir ve türetilmiş metrikleri (CTR, CPC, CPM, CPA, ROAS, CVR) hesaplar.
 */

var ADS_LEVELS = {
  total: [],
  platform: ['platform'],
  country: ['country'],
  tip: ['tip'],
  account: ['platform', 'country', 'account_name', 'account_id'],
  campaign: ['platform', 'country', 'account_name', 'account_id', 'campaign_name', 'campaign_id'],
  adgroup: ['platform', 'country', 'account_name', 'account_id', 'campaign_name', 'campaign_id', 'adgroup_name', 'adgroup_id'],
  ad: ['platform', 'country', 'account_name', 'account_id', 'campaign_name', 'campaign_id', 'adgroup_name', 'adgroup_id', 'ad_name', 'ad_id', 'ad_type']
};

var FIELD_LABELS = {
  period: 'Dönem', platform: 'Mecra', country: 'Ülke', tip: 'Tip', account_name: 'Hesap', account_id: 'Hesap ID',
  currency: 'Para birimi', campaign_name: 'Kampanya', campaign_id: 'Kampanya ID', adgroup_name: 'Ad group / Ad set',
  adgroup_id: 'Ad group ID', ad_name: 'Ad', ad_id: 'Ad ID', ad_type: 'Ad tipi', channel: 'Kanal',
  app: 'App', os: 'OS', partner: 'Network', campaign: 'Kampanya', adgroup: 'Adgroup', property: 'GA4 property'
};

var ADS_METRICS = [
  { k: 'spend_usd', l: 'Spend', u: 'usd' },
  { k: 'spend', l: 'Spend (orig.)', u: 'money', orig: true },
  { k: 'impressions', l: 'Impressions', u: 'int' },
  { k: 'clicks', l: 'Clicks', u: 'int' },
  { k: 'all_clicks', l: 'All Clicks', u: 'int' },
  { k: 'conversions', l: 'Conversions', u: 'num' },
  { k: 'conv_value_usd', l: 'Conv. Value', u: 'usd' },
  { k: 'conv_value', l: 'Conv. Value (orig.)', u: 'money', orig: true },
  { k: 'all_conversions', l: 'All Conversions (Google)', u: 'num' },
  { k: 'add_to_cart', l: 'Add to Cart (Meta)', u: 'num' },
  { k: 'initiate_checkout', l: 'Initiate Checkout (Meta)', u: 'num' },
  { k: 'installs', l: 'App Installs (Meta)', u: 'num' },
  { k: 'landing_page_views', l: 'Landing Page Views (Meta)', u: 'num' },
  { k: 'ctr', l: 'CTR', u: 'pct', d: function (m) { return q_div_(m.clicks, m.impressions); } },
  { k: 'cpc', l: 'CPC', u: 'usd', d: function (m) { return q_div_(m.spend_usd, m.clicks); } },
  { k: 'cpm', l: 'CPM', u: 'usd', d: function (m) { return q_div_(m.spend_usd * 1000, m.impressions); } },
  { k: 'cpa', l: 'CPA', u: 'usd', d: function (m) { return q_div_(m.spend_usd, m.conversions); } },
  { k: 'roas', l: 'ROAS', u: 'x', d: function (m) { return q_div_(m.conv_value_usd, m.spend_usd); } },
  { k: 'margin', l: 'Marjin', u: 'pct', d: function (m) { return q_div_(m.spend_usd, m.conv_value_usd); } },
  { k: 'cvr', l: 'CVR', u: 'pct', d: function (m) { return q_div_(m.conversions, m.clicks); } }
];

function q_div_(a, b) { return b ? a / b : null; }

function q_period_(date, grain) {
  if (grain === 'day') return date;
  if (grain === 'month') return date.slice(0, 7);
  if (grain === 'week') {
    var p = date.split('-');
    var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
    var dow = (d.getUTCDay() + 6) % 7; // Pazartesi=0
    d.setUTCDate(d.getUTCDate() - dow);
    return d.toISOString().slice(0, 10);
  }
  return '';
}

function q_daysBetween_(a, b) {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000) + 1;
}

/** Shard dosyalarını tarih aralığında okur, her satır için cb(row, idx) çağırır. */
function q_readShards_(ss, dataset, from, to, cb) {
  var def = STORE_DATASETS[dataset];
  var reg = st_registry_(ss);
  var files = 0;
  st_periodsInRange_(def.shard, from, to).forEach(function (p) {
    var hit = reg[dataset + '|' + p];
    if (!hit || !hit.fileId) return;
    var d = st_readSheet_(SpreadsheetApp.openById(hit.fileId).getSheets()[0]);
    var ix = {};
    d.header.forEach(function (h, i) { ix[h] = i; });
    files++;
    for (var i = 0; i < d.rows.length; i++) {
      var r = d.rows[i];
      if (r[0] >= from && r[0] <= to) cb(r, ix);
    }
  });
  return files;
}

/** Kampanya grubu (Brand.js > CAMPAIGN_GROUP): adında KEYWORD geçen = 'ecom' (iç kod), geçmeyen = 'kurumsal'. f.kinds = ['ecom'] | ['kurumsal'] | ikisi/boş = hepsi. */
function q_kindFn_(f) {
  var k = (f && f.kinds) || [];
  var e = k.indexOf('ecom') >= 0, c = k.indexOf('kurumsal') >= 0;
  if (e === c || !BRAND.CAMPAIGN_GROUP || !BRAND.CAMPAIGN_GROUP.KEYWORD) return null;
  var re = q_regex_(BRAND.CAMPAIGN_GROUP.KEYWORD);
  return function (name) { return re.test(String(name || '')) === e; };
}

function q_regex_(s) {
  if (!s) return null;
  try { return new RegExp(s, 'i'); } catch (e) { return new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); }
}

/** Toplayıcı: dönem + grup alanlarına göre toplam. */
function q_agg_(groupFields, grain, sumKeys) {
  var map = {}, keys = [], total = sumKeys.map(function () { return 0; }), n = 0, curs = {};
  return {
    add: function (o) {
      var period = grain && grain !== 'none' ? q_period_(o.date, grain) : '';
      var gv = groupFields.map(function (f) { return o[f] == null ? '' : o[f]; });
      var k = period + '\u0001' + gv.join('\u0001');
      var a = map[k];
      if (!a) { a = map[k] = { period: period, gv: gv, s: sumKeys.map(function () { return 0; }), cur: o.currency || '' }; keys.push(k); }
      if (o.currency) curs[o.currency] = 1;
      for (var i = 0; i < sumKeys.length; i++) {
        var v = +o[sumKeys[i]] || 0;
        a.s[i] += v; total[i] += v;
      }
      n++;
    },
    groups: function () { return keys.map(function (k) { return map[k]; }); },
    total: function () { return total; },
    count: function () { return n; },
    currencies: function () { return Object.keys(curs); }
  };
}

/**
 * Ortak çıktı üretimi.
 * metrics: [{k,l,u,d?}] — d varsa türetilmiş.
 */
function q_build_(agg, groupFields, grain, metrics, sumKeys, sortKey) {
  var cols = [];
  if (grain && grain !== 'none') cols.push({ k: 'period', l: grain === 'week' ? 'Hafta (Pzt)' : FIELD_LABELS.period, t: 'text' });
  groupFields.forEach(function (f) { cols.push({ k: f, l: FIELD_LABELS[f] || f, t: 'text' }); });
  metrics.forEach(function (m) { cols.push({ k: m.k, l: m.l, t: m.u, orig: !!m.orig }); });
  var withCur = metrics.some(function (m) { return m.orig; });
  if (withCur) cols.push({ k: '_cur', l: 'currency', t: 'hidden' }); // orig. değerlerin para birimi (gösterilmez)

  function metricRow(s) {
    var o = {};
    sumKeys.forEach(function (k, i) { o[k] = s[i]; });
    return metrics.map(function (m) { return m.d ? m.d(o) : (o[m.k] == null ? null : o[m.k]); });
  }

  var groups = agg.groups();
  var si = sumKeys.indexOf(sortKey);
  groups.sort(function (a, b) {
    if (a.period !== b.period) return a.period < b.period ? -1 : 1;
    return si >= 0 ? b.s[si] - a.s[si] : 0;
  });
  var MAX = 60000;
  var rows = groups.slice(0, MAX).map(function (g) {
    var r = [];
    if (grain && grain !== 'none') r.push(g.period);
    r = r.concat(g.gv, metricRow(g.s));
    if (withCur) r.push(g.cur);
    return r;
  });
  var totals = metricRow(agg.total());
  var tc = agg.currencies();
  if (withCur) {
    // farklı para birimleri toplanamaz → orig. toplamı sadece tek para biriminde gösterilir
    metrics.forEach(function (m, i) { if (m.orig && tc.length !== 1) totals[i] = null; });
    totals.push(tc.length === 1 ? tc[0] : '');
  }
  return {
    columns: cols, rows: rows, totals: totals,
    truncated: groups.length > MAX ? groups.length : 0, scanned: agg.count()
  };
}

/* ======================= REKLAM (Google Ads + Meta) ======================= */

function q_ads_(ss, p) {
  var t0 = Date.now();
  var s = sh_settings_(ss);
  var level = ADS_LEVELS[p.level] ? p.level : 'account';
  var useAd = level === 'adgroup' || level === 'ad';
  var maxDays = +s.AD_LEVEL_MAX_DAYS || 186;
  if (useAd && q_daysBetween_(p.from, p.to) > maxDays) {
    throw new Error('Ad / ad group seviyesinde en fazla ' + maxDays + ' günlük aralık seçilebilir (şu an ' + q_daysBetween_(p.from, p.to) + ' gün). Tarih aralığını daraltın.');
  }
  var groupFields = ADS_LEVELS[level];
  var hasCur = groupFields.indexOf('account_id') >= 0; // hesap ve altı: tek para birimi
  var metrics = ADS_METRICS.filter(function (m) { return hasCur || !m.orig; });
  var sumKeys = ['spend_usd', 'spend', 'impressions', 'clicks', 'all_clicks', 'conversions', 'conv_value_usd', 'conv_value',
    'all_conversions', 'add_to_cart', 'initiate_checkout', 'installs', 'landing_page_views'];

  var acc = {};
  sh_accounts_(ss).forEach(function (a) { acc[a.platform + '|' + a.id] = a; });
  var perUsd = fx_loader_(ss);
  var f = p.filters || {};
  var plat = f.platforms && f.platforms.length ? f.platforms : ['Google Ads', 'Meta'].concat(EXT_PLATFORMS);
  var cset = f.countries && f.countries.length ? q_set_(f.countries) : null;
  var aset = f.accounts && f.accounts.length ? q_set_(f.accounts) : null;
  var tips = f.tips && f.tips.length ? f.tips : null;
  var inc = q_regex_(f.campInc), exc = q_regex_(f.campExc), kindFn = q_kindFn_(f);
  var eq = f.eq || {};
  var fxMissing = {};
  var agg = q_agg_(groupFields, p.grain, sumKeys);

  function accept(o) {
    var a = acc[o.platform + '|' + o.account_id];
    if (!a || !a.active) return;
    o.country = a.code; o.tip = a.tip; o.account_name = a.name;
    if (cset && !cset[a.code]) return;
    if (aset && !aset[o.platform + '|' + o.account_id]) return;
    if (tips && !tips.some(function (t) { return a.tip.indexOf(t) >= 0; })) return;
    if (inc && !inc.test(o.campaign_name)) return;
    if (exc && exc.test(o.campaign_name)) return;
    if (kindFn && !kindFn(o.campaign_name)) return;
    for (var k in eq) if (eq[k] !== '' && eq[k] != null && String(o[k]) !== String(eq[k])) return;
    var rate = perUsd(o.date, o.currency);
    if (!rate) { fxMissing[o.currency] = 1; rate = null; }
    o.spend_usd = rate ? o.spend / rate : 0;
    o.conv_value_usd = rate ? o.conv_value / rate : 0;
    agg.add(o);
  }

  var files = 0;
  if (plat.indexOf('Google Ads') >= 0) {
    var gReader = function (r, ix) {
      accept({
        date: r[0], platform: 'Google Ads', account_id: r[1], currency: r[ix.currency],
        campaign_id: r[ix.campaign_id], campaign_name: String(r[ix.campaign_name]), channel: r[ix.channel_type],
        adgroup_id: useAd ? r[ix.adgroup_id] : '', adgroup_name: useAd ? r[ix.adgroup_name] : '',
        ad_id: useAd ? r[ix.ad_id] : '', ad_name: useAd ? r[ix.ad_name] : '', ad_type: useAd ? r[ix.ad_type] : '',
        spend: +r[ix.cost] || 0, impressions: +r[ix.impressions] || 0, clicks: +r[ix.clicks] || 0, all_clicks: +r[ix.clicks] || 0,
        conversions: +r[ix.conversions] || 0, conv_value: +r[ix.conv_value] || 0, all_conversions: +r[ix.all_conversions] || 0
      });
    };
    // iki MCC'nin script'leri ayrı dosyalara yazar; ikisi birlikte okunur
    files += q_readShards_(ss, useAd ? 'gads_ad' : 'gads_campaign', p.from, p.to, gReader);
    files += q_readShards_(ss, useAd ? 'gads_ad_2' : 'gads_campaign_2', p.from, p.to, gReader);
  }
  if (plat.indexOf('Meta') >= 0) {
    files += q_readShards_(ss, useAd ? 'meta_ad' : 'meta_campaign', p.from, p.to, function (r, ix) { if (cpas_is_(r[1])) return;
      accept({
        date: r[0], platform: 'Meta', account_id: r[1], currency: r[ix.currency],
        campaign_id: r[ix.campaign_id], campaign_name: String(r[ix.campaign_name]), channel: r[ix.objective],
        adgroup_id: useAd ? r[ix.adset_id] : '', adgroup_name: useAd ? r[ix.adset_name] : '',
        ad_id: useAd ? r[ix.ad_id] : '', ad_name: useAd ? r[ix.ad_name] : '', ad_type: '',
        spend: +r[ix.spend] || 0, impressions: +r[ix.impressions] || 0,
        clicks: +r[ix.link_clicks] || 0, all_clicks: +r[ix.clicks] || 0,
        conversions: +r[ix.purchases] || 0, conv_value: +r[ix.purchase_value] || 0,
        add_to_cart: +r[ix.add_to_cart] || 0, initiate_checkout: +r[ix.initiate_checkout] || 0,
        installs: +r[ix.installs] || 0, landing_page_views: +r[ix.landing_page_views] || 0
      });
    });
  }
  if (!useAd && plat.some(function (x) { return EXT_PLATFORMS.indexOf(x) >= 0; })) {
    files += ext_readAll_(ss, p.from, p.to, function (r, ix) {
      var pf = String(r[ix.platform]);
      if (plat.indexOf(pf) < 0) return;
      accept({ date: r[0], platform: pf, account_id: r[1], currency: r[ix.currency],
        campaign_id: r[ix.campaign_id], campaign_name: String(r[ix.campaign_name]), channel: '',
        adgroup_id: '', adgroup_name: '', ad_id: '', ad_name: '', ad_type: '',
        spend: +r[ix.spend] || 0, impressions: +r[ix.impressions] || 0, clicks: +r[ix.clicks] || 0, all_clicks: +r[ix.clicks] || 0,
        conversions: +r[ix.conversions] || 0, conv_value: +r[ix.conv_value] || 0, installs: +r[ix.installs] || 0 });
    });
  }
  var out = q_build_(agg, groupFields, p.grain, metrics, sumKeys, 'spend_usd');
  out.warnings = [];
  var fm = Object.keys(fxMissing);
  if (fm.length) out.warnings.push('Kur bulunamadı (USD = 0 sayıldı): ' + fm.join(', ') + ' — Durum > "Kurları güncelle".');
  if (out.truncated) out.warnings.push(out.truncated + ' satırdan ilk 60.000 gösteriliyor. Filtre ekleyin.');
  if (!files) out.warnings.push('Seçilen aralıkta veri dosyası yok (senkron henüz tamamlanmamış olabilir).');
  out.ms = Date.now() - t0;
  return out;
}

function q_set_(arr) { var o = {}; arr.forEach(function (x) { o[x] = 1; }); return o; }

/* ======================= ADJUST / GA4 ======================= */

var ADJUST_GROUPABLE = ['country', 'os', 'partner', 'campaign', 'adgroup', 'app'];
var COUNTRY_BY_EN = (function () { var o = {}; Object.keys(COUNTRIES).forEach(function (c) { o[COUNTRIES[c].en.toLowerCase()] = c; }); if (o['bosnia & herzegovina']) o['bosnia and herzegovina'] = o['bosnia & herzegovina']; return o; })();

function q_genericMeta_(ss, source) {
  var s = sh_settings_(ss);
  if (source === 'adjust') {
    var am = String(s.ADJUST_METRICS || '').split(',').map(function (x) { return x.trim(); }).filter(String);
    [s.ADJUST_PURCHASE_METRIC || 'revenue_events', s.ADJUST_REVENUE_METRIC].forEach(function (m) { m = String(m || '').trim(); if (m && am.indexOf(m) < 0) am.push(m); });
    var metrics = am.map(function (m) { return { k: m, l: q_pretty_(m), u: /revenue|cost|spend/.test(m) ? 'money' : 'num' }; });
    if (am.indexOf('cost') >= 0 && am.indexOf('installs') >= 0) metrics.push({ k: 'cpi', l: 'CPI', u: 'money', d: function (m) { return q_div_(m.cost, m.installs); } });
    if (am.indexOf('cost') >= 0 && am.indexOf('revenue') >= 0) metrics.push({ k: 'adj_roas', l: 'ROAS', u: 'x', d: function (m) { return q_div_(m.revenue, m.cost); } });
    return { dims: ADJUST_GROUPABLE, sums: am, metrics: metrics, campaignField: 'campaign' };
  }
  var gd = String(s.GA4_DIMENSIONS || '').split(',').map(function (x) { return x.trim(); }).filter(function (d) { return d && d !== 'date'; });
  var gm = String(s.GA4_METRICS || '').split(',').map(function (x) { return x.trim(); }).filter(String);
  var gmet = gm.map(function (m) { return { k: m, l: q_pretty_(m), u: /revenue/i.test(m) ? 'money' : 'num' }; });
  if (gm.indexOf('ecommercePurchases') >= 0 && gm.indexOf('sessions') >= 0) gmet.push({ k: 'ga_cvr', l: 'E-com CVR', u: 'pct', d: function (m) { return q_div_(m.ecommercePurchases, m.sessions); } });
  if (gm.indexOf('purchaseRevenue') >= 0 && gm.indexOf('ecommercePurchases') >= 0) gmet.push({ k: 'aov', l: 'AOV', u: 'money', d: function (m) { return q_div_(m.purchaseRevenue, m.ecommercePurchases); } });
  if (gm.indexOf('engagedSessions') >= 0 && gm.indexOf('sessions') >= 0) gmet.push({ k: 'eng_rate', l: 'Engagement Rate', u: 'pct', d: function (m) { return q_div_(m.engagedSessions, m.sessions); } });
  var dims = ['property'].concat(gd.map(function (d) { return d === 'country' ? 'country' : d; }));
  return { dims: dims, sums: gm, metrics: gmet, rawDims: gd, campaignField: 'sessionCampaignName' };
}

function q_pretty_(k) {
  var map = { installs: 'Installs', clicks: 'Clicks', impressions: 'Impressions', sessions: 'Sessions', reattributions: 'Reattributions',
    revenue: 'Revenue', revenue_events: 'Purchases (revenue events)', cost: 'Cost', totalUsers: 'Users', newUsers: 'New Users',
    engagedSessions: 'Engaged Sessions', addToCarts: 'Add to Carts', checkouts: 'Checkouts', ecommercePurchases: 'Purchases',
    purchaseRevenue: 'Purchase Revenue', keyEvents: 'Key Events', transactions: 'Transactions',
    sessionDefaultChannelGroup: 'Kanal grubu', sessionSourceMedium: 'Kaynak / Araç',
    sessionCampaignName: 'Kampanya', country: 'Ülke', deviceCategory: 'Cihaz', kanal: 'Kanal (Web/App)' };
  return map[k] || k.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
}

function q_generic_(ss, source, p) {
  var t0 = Date.now();
  var meta = q_genericMeta_(ss, source);
  var groupFields = (p.dims || []).filter(function (d) { return meta.dims.indexOf(d) >= 0; });
  var f = p.filters || {};
  var cset = f.countries && f.countries.length ? q_set_(f.countries) : null;
  var inc = q_regex_(f.campInc), exc = q_regex_(f.campExc), kindFn = q_kindFn_(f);
  var props = {};
  sh_accounts_(ss, 'GA4').forEach(function (a) { props[a.id] = a; });
  var agg = q_agg_(groupFields, p.grain, meta.sums);
  var files = q_readShards_(ss, source, p.from, p.to, function (r, ix) {
    var o = { date: r[0] };
    Object.keys(ix).forEach(function (h) { o[h] = r[ix[h]]; });
    if (source === 'ga4') {
      var pa = props[String(r[1])];
      if (pa && !pa.active) return;
      o.property = pa ? pa.name : String(r[1]);
      var code = o.country != null ? COUNTRY_BY_EN[String(o.country).toLowerCase()] : null;
      o.country = code || (pa && pa.code) || (o.country || '');
    }
    if (cset && !cset[o.country]) return;
    var cn = String(o[meta.campaignField] || '');
    if (inc && !inc.test(cn)) return;
    if (exc && exc.test(cn)) return;
    if (kindFn && !kindFn(cn)) return;
    agg.add(o);
  });
  var out = q_build_(agg, groupFields, p.grain, meta.metrics, meta.sums, meta.sums[0]);
  out.warnings = files ? [] : ['Seçilen aralıkta ' + source + ' verisi yok.'];
  out.columns.forEach(function (c) { if (c.t === 'text' && !FIELD_LABELS[c.k]) c.l = q_pretty_(c.k); });
  out.ms = Date.now() - t0;
  return out;
}

/* ======================= WEB (GA4) + APP (Adjust) BİRLEŞİK ======================= */

var WEBAPP_METRICS = [
  { k: 'sessions', l: 'Sessions', u: 'int' },
  { k: 'users', l: 'Users (web)', u: 'int' },
  { k: 'installs', l: 'Installs (app)', u: 'int' },
  { k: 'add_to_cart', l: 'Add to Cart (web)', u: 'int' },
  { k: 'purchases', l: 'Purchases', u: 'num' },
  { k: 'revenue_usd', l: 'Revenue', u: 'usd' },
  { k: 'spend_usd', l: 'Ad Spend', u: 'usd', spend: true },
  { k: 'cvr', l: 'CVR (purchases / sessions)', u: 'pct', d: function (m) { return q_div_(m.purchases, m.sessions); } },
  { k: 'aov', l: 'AOV', u: 'usd', d: function (m) { return q_div_(m.revenue_usd, m.purchases); } },
  { k: 'blended_roas', l: 'Blended ROAS', u: 'x', spend: true, d: function (m) { return q_div_(m.revenue_usd, m.spend_usd); } },
  { k: 'margin', l: 'Marjin', u: 'pct', spend: true, d: function (m) { return q_div_(m.spend_usd, m.revenue_usd); } },
  { k: 'cost_per_purchase', l: 'Cost per Purchase', u: 'usd', spend: true, d: function (m) { return q_div_(m.spend_usd, m.purchases); } }
];
var WEBAPP_DIMS = ['kanal', 'country'];

function q_webapp_(ss, p) {
  var t0 = Date.now();
  var s = sh_settings_(ss);
  var groupFields = (p.dims || []).filter(function (d) { return WEBAPP_DIMS.indexOf(d) >= 0; });
  var byKanal = groupFields.indexOf('kanal') >= 0;
  // Reklam harcaması web/app'e bölünemediği için Kanal kırılımında harcama metrikleri gösterilmez
  var metrics = WEBAPP_METRICS.filter(function (m) { return !(byKanal && m.spend); });
  var sums = ['sessions', 'users', 'installs', 'add_to_cart', 'purchases', 'revenue_usd', 'spend_usd'];
  var f = p.filters || {};
  var cset = f.countries && f.countries.length ? q_set_(f.countries) : null;
  var perUsd = fx_loader_(ss);
  var warn = {};
  var agg = q_agg_(groupFields, p.grain, sums);
  var props = {};
  sh_accounts_(ss, 'GA4').forEach(function (a) { props[a.id] = a; });

  // WEB — GA4
  var gaFiles = q_readShards_(ss, 'ga4', p.from, p.to, function (r, ix) {
    var pa = props[String(r[1])];
    if (pa && !pa.active) return;
    var cname = ix.country != null ? String(r[ix.country]) : '';
    var code = COUNTRY_BY_EN[cname.toLowerCase()] || (pa && pa.code) || cname;
    if (cset && !cset[code]) return;
    var cur = pa && pa.currency ? pa.currency : 'USD';
    if (pa && !pa.currency) warn.gaCur = 1;
    var rate = perUsd(r[0], cur);
    var rev = ix.purchaseRevenue != null ? +r[ix.purchaseRevenue] || 0 : 0;
    agg.add({ date: r[0], kanal: 'Web', country: code,
      sessions: ix.sessions != null ? +r[ix.sessions] || 0 : 0,
      users: ix.totalUsers != null ? +r[ix.totalUsers] || 0 : 0,
      add_to_cart: ix.addToCarts != null ? +r[ix.addToCarts] || 0 : 0,
      purchases: ix.ecommercePurchases != null ? +r[ix.ecommercePurchases] || 0 : 0,
      revenue_usd: rate ? rev / rate : 0 });
  });

  // APP — Adjust
  var pm = String(s.ADJUST_PURCHASE_METRIC || 'revenue_events').trim();
  var rm = String(s.ADJUST_REVENUE_METRIC || 'revenue').trim();
  var acur = String(s.ADJUST_CURRENCY || 'USD').trim().toUpperCase();
  if (!pm) warn.adjPm = 1;
  var adjFiles = q_readShards_(ss, 'adjust', p.from, p.to, function (r, ix) {
    var code = String(r[ix.country] || '');
    if (cset && !cset[code]) return;
    var rate = perUsd(r[0], acur);
    var rev = ix[rm] != null ? +r[ix[rm]] || 0 : 0;
    agg.add({ date: r[0], kanal: 'App', country: code,
      sessions: ix.sessions != null ? +r[ix.sessions] || 0 : 0,
      installs: ix.installs != null ? +r[ix.installs] || 0 : 0,
      purchases: pm && ix[pm] != null ? +r[ix[pm]] || 0 : 0,
      revenue_usd: rate ? rev / rate : 0 });
  });

  // REKLAM HARCAMASI (Google Ads + Meta, kampanya dosyalarından)
  if (!byKanal) {
    var acc = {};
    sh_accounts_(ss).forEach(function (a) { acc[a.platform + '|' + a.id] = a; });
    [['gads_campaign', 'Google Ads', 'cost'], ['gads_campaign_2', 'Google Ads', 'cost'], ['meta_campaign', 'Meta', 'spend']].forEach(function (d) {
      q_readShards_(ss, d[0], p.from, p.to, function (r, ix) {
        var a = acc[d[1] + '|' + r[1]]; if (d[1] === 'Meta' && cpas_is_(r[1])) return;
        if (!a || !a.active) return;
        if (cset && !cset[a.code]) return;
        var rate = perUsd(r[0], r[ix.currency]);
        agg.add({ date: r[0], kanal: '', country: a.code, spend_usd: rate ? (+r[ix[d[2]]] || 0) / rate : 0 });
      });
    });
    ext_readAll_(ss, p.from, p.to, function (r, ix) {
      var a = acc[String(r[ix.platform]) + '|' + r[1]];
      if (!a || !a.active) return;
      if (cset && !cset[a.code]) return;
      var rate = perUsd(r[0], r[ix.currency]);
      agg.add({ date: r[0], kanal: '', country: a.code, spend_usd: rate ? (+r[ix.spend] || 0) / rate : 0 });
    });
  }

  var out = q_build_(agg, groupFields, p.grain, metrics, sums, 'revenue_usd');
  out.warnings = [];
  if (!gaFiles) out.warnings.push('GA4 (web) verisi yok.');
  if (!adjFiles) out.warnings.push('Adjust (app) verisi yok.');
  if (warn.adjPm && adjFiles) out.warnings.push('App satın almaları için Config > Settings > ADJUST_PURCHASE_METRIC (örn. purchase_events) tanımlı değil.');
  if (warn.gaCur) out.warnings.push('GA4 gelirinin para birimi Accounts > Para Birimi kolonunda boş; USD varsayıldı.');
  if (byKanal) out.warnings.push('Kanal kırılımında reklam harcaması / blended ROAS gösterilmez (harcama web/app olarak ayrılamıyor).');
  out.ms = Date.now() - t0;
  return out;
}
