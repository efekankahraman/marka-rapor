/**
 * Report.js — ana rapor: Google Ads + Meta platform metrikleri, kampanya adı/ID'si ile eşleştirilmiş
 * GA4 (web) ve Adjust (app) metrikleri ve bunların toplamı (TOTAL).
 *
 * Kolon grupları:
 *   PLATFORM : Spend ($), ROAS, CPI, CPS, Spend (orig.), Clicks, Impressions, Avg. CPC, CTR, Installs (Platform), Cost / Install
 *   GA4 WEB  : GA4 Sessions, GA4 Purchase, GA4 Purchase Revenue
 *   ADJUST   : Adjust Sessions, Adjust Purchase, Adjust Purchase Revenue, Adjust Installs
 *   TOTAL    : Total Sessions, Total Purchase, Total Purchase Revenue, Total Installs
 *   Cohort ROAS = (GA4 Revenue + Adjust 0W cohort revenue) / Spend · Cohort Purchase/Revenue = GA4 + Adjust 0W
 *   ROAS = Total Purchase Revenue / Spend · CPI = Spend / Total Installs · CPS = Spend / Total Sessions
 */

var R_LEVELS = {
  total: [],
  country: ['country'],
  platform: ['country', 'platform'],
  account: ['country', 'platform', 'account_name', 'account_id'],
  campaign: ['country', 'platform', 'account_name', 'account_id', 'campaign_name', 'campaign_id'],
  adgroup: ['country', 'platform', 'account_name', 'account_id', 'campaign_name', 'campaign_id', 'adgroup_name', 'adgroup_id'],
  ad: ['country', 'platform', 'account_name', 'account_id', 'campaign_name', 'campaign_id', 'adgroup_name', 'adgroup_id', 'ad_name', 'ad_id', 'ad_type']
};

function r_sum_(a, b) { return (a || 0) + (b || 0); }

var R_METRICS = [
  { k: 'spend_usd', l: 'Spend ($)', u: 'usd', g: 'plat' },
  { k: 'spend', l: 'Spend (orig.)', u: 'money', g: 'plat', orig: 1 },
  { k: 'roas', l: 'ROAS', u: 'x', g: 'plat', web: 1, d: function (m) { return q_div_(r_sum_(m.ga_revenue_usd, m.adj_revenue_usd), m.spend_usd); } },
  { k: 'cohort_roas', l: 'Cohort ROAS', u: 'x', g: 'plat', web: 1, d: function (m) { return q_div_(r_sum_(m.ga_revenue_usd, m.adj_c_revenue_usd), m.spend_usd); } },
  { k: 'cpi', l: 'CPI', u: 'usd', g: 'plat', web: 1, d: function (m) { return q_div_(m.spend_usd, m.adj_installs); } },
  { k: 'cps', l: 'CPS', u: 'usd', g: 'plat', web: 1, d: function (m) { return q_div_(m.spend_usd, r_sum_(m.ga_sessions, m.adj_sessions)); } },
  { k: 'clicks', l: 'Clicks', u: 'int', g: 'plat' },
  { k: 'impressions', l: 'Impressions', u: 'int', g: 'plat' },
  { k: 'cpc', l: 'CPC', u: 'usd', g: 'plat', d: function (m) { return q_div_(m.spend_usd, m.clicks); } },
  { k: 'ctr', l: 'CTR', u: 'pct', g: 'plat', d: function (m) { return q_div_(m.clicks, m.impressions); } },
  { k: 'installs', l: 'Installs (Platform)', u: 'int', g: 'plat' },
  { k: 'cost_per_install', l: 'Cost / Install', u: 'usd', g: 'plat', d: function (m) { return q_div_(m.spend_usd, m.installs); } },
  { k: 'ga_sessions', l: 'GA4 Sessions', u: 'int', g: 'ga4', web: 1 },
  { k: 'ga_purchases', l: 'GA4 Purchase', u: 'int', g: 'ga4', web: 1 },
  { k: 'ga_revenue_usd', l: 'GA4 Purchase Revenue', u: 'usd', g: 'ga4', web: 1 },
  { k: 'adj_sessions', l: 'Adjust Sessions', u: 'int', g: 'adj', web: 1 },
  { k: 'adj_purchases', l: 'Adjust Purchase', u: 'int', g: 'adj', web: 1 },
  { k: 'adj_revenue_usd', l: 'Adjust Purchase Revenue', u: 'usd', g: 'adj', web: 1 },
  { k: 'adj_installs', l: 'Adjust Installs', u: 'int', g: 'adj', web: 1 },
  { k: 'adj_c_purchases', l: 'Adjust 0W Purchase', u: 'int', g: 'adj', web: 1 },
  { k: 'adj_c_revenue_usd', l: 'Adjust 0W Revenue', u: 'usd', g: 'adj', web: 1 },
  { k: 'tot_sessions', l: 'Total Sessions', u: 'int', g: 'tot', web: 1, d: function (m) { return r_sum_(m.ga_sessions, m.adj_sessions); } },
  { k: 'tot_purchases', l: 'Total Purchase', u: 'int', g: 'tot', web: 1, d: function (m) { return r_sum_(m.ga_purchases, m.adj_purchases); } },
  { k: 'tot_revenue_usd', l: 'Total Purchase Revenue', u: 'usd', g: 'tot', web: 1, d: function (m) { return r_sum_(m.ga_revenue_usd, m.adj_revenue_usd); } },
  { k: 'coh_purchases', l: 'Cohort Purchase', u: 'int', g: 'tot', web: 1, d: function (m) { return r_sum_(m.ga_purchases, m.adj_c_purchases); } },
  { k: 'coh_revenue_usd', l: 'Cohort Revenue', u: 'usd', g: 'tot', web: 1, d: function (m) { return r_sum_(m.ga_revenue_usd, m.adj_c_revenue_usd); } },
  { k: 'tot_installs', l: 'Total Installs', u: 'int', g: 'tot', web: 1, d: function (m) { return m.adj_installs || 0; } }
];
var R_SUMS = ['spend_usd', 'spend', 'clicks', 'impressions', 'installs',
  'ga_sessions', 'ga_purchases', 'ga_revenue_usd', 'adj_sessions', 'adj_purchases', 'adj_revenue_usd', 'adj_installs',
  'adj_c_purchases', 'adj_c_revenue_usd'];

/**
 * Kampanya adı eşleştirme anahtarı: URL-decode, sondaki "(123456)" ID'si atılır, sadece harf+rakam kalır.
 * Böylece "ECOM_RS_SEM_FB_Sales_2407 girlslowproducts_dpa" = "ecom_rs_sem_fb_sales_2407+girlslowproducts_dpa".
 */
function r_ckey_(name) {
  var s = String(name || '');
  try { s = decodeURIComponent(s.replace(/\+/g, ' ')); } catch (e) {}
  return s.toLowerCase().replace(/\s*\(\d+\)\s*$/, '').replace(/[^a-z0-9]/g, '');
}
/** Kampanya anahtarı ile arama; bulunamazsa sondaki yıl ekini ("…_All _2026") atıp tekrar dener. */
function r_ckLookup_(map, name) {
  var k = r_ckey_(name);
  if (map[k] != null) return map[k];
  var k2 = k.replace(/20\d\d$/, '');
  return k2 !== k && k2 && map[k2] != null ? map[k2] : undefined;
}
/** "Ad (ID)" ya da sadece ID ise kampanya ID'si */
function r_cid_(name) {
  var s = String(name || '').trim();
  if (/^\d{6,}$/.test(s)) return s;
  var m = /\((\d+)\)\s*$/.exec(s);
  return m ? m[1] : '';
}

function q_report_(ss, p) {
  var t0 = Date.now();
  var s = sh_settings_(ss);
  var level = R_LEVELS[p.level] ? p.level : 'campaign';
  var useAd = level === 'adgroup' || level === 'ad';
  var maxDays = +s.AD_LEVEL_MAX_DAYS || 186;
  if (useAd && q_daysBetween_(p.from, p.to) > maxDays) {
    throw new Error('Ad / ad group seviyesinde en fazla ' + maxDays + ' günlük aralık seçilebilir (şu an ' + q_daysBetween_(p.from, p.to) + ' gün). Tarih aralığını daraltın.');
  }
  var groupFields = R_LEVELS[level];
  // GA4/Adjust: kampanya seviyesine kadar kampanya adıyla; ad group seviyesinde kampanya + ad group adıyla eşleşir (ad seviyesinde yok)
  var isAg = level === 'adgroup';
  var withWeb = !useAd || isAg;
  var hasAcct = groupFields.indexOf('account_id') >= 0;
  var metrics = R_METRICS.filter(function (m) { return (withWeb || !m.web) && (hasAcct || !m.orig); });

  var acc = {};
  sh_accounts_(ss).forEach(function (a) { acc[a.platform + '|' + a.id] = a; });
  var perUsd = fx_loader_(ss);
  var f = p.filters || {};
  var plat = f.platforms && f.platforms.length ? f.platforms : ['Google Ads', 'Meta'];
  var cset = f.countries && f.countries.length ? q_set_(f.countries) : null;
  var aset = f.accounts && f.accounts.length ? q_set_(f.accounts) : null;
  var tips = f.tips && f.tips.length ? f.tips : null;
  var inc = q_regex_(f.campInc), exc = q_regex_(f.campExc), kindFn = q_kindFn_(f);
  var eq = f.eq || {};
  var pickFn = r_pickFn_(f);
  var fxMissing = {};
  var agg = q_agg_(groupFields, p.grain, R_SUMS);
  var byKey = {}, byId = {}, byAg = {}, agNoMatch = {};

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
    if (pickFn && !pickFn(o)) return;
    var rate = perUsd(o.date, o.currency);
    if (!rate) fxMissing[o.currency] = 1;
    o.spend_usd = rate ? o.spend / rate : 0;
    agg.add(o);
    var ck = r_ckey_(o.campaign_name);
    if (!byKey[ck]) {
      var dims = { platform: o.platform, country: o.country, tip: o.tip, account_name: o.account_name, account_id: o.account_id,
        campaign_name: o.campaign_name, campaign_id: o.campaign_id, currency: o.currency };
      byKey[ck] = dims;
      byId[String(o.campaign_id)] = dims;
    }
    if (isAg) {
      var gk = ck + '|' + r_ckey_(o.adgroup_name);
      if (!byAg[gk]) {
        var gd = {}; for (var q in byKey[ck]) gd[q] = byKey[ck][q];
        gd.campaign_name = o.campaign_name; gd.campaign_id = o.campaign_id; gd.adgroup_name = o.adgroup_name; gd.adgroup_id = o.adgroup_id;
        byAg[gk] = gd;
      }
    }
  }

  var files = 0;
  if (plat.indexOf('Google Ads') >= 0) {
    var gReader = function (r, ix) {
      var name = String(r[ix.campaign_name]);
      var ch = String(r[ix.channel_type] || '');
      var conv = +r[ix.conversions] || 0;
      accept({
        date: r[0], platform: 'Google Ads', account_id: r[1], currency: r[ix.currency],
        campaign_id: String(r[ix.campaign_id]), campaign_name: name,
        adgroup_id: useAd ? r[ix.adgroup_id] : '', adgroup_name: useAd ? r[ix.adgroup_name] : '',
        ad_id: useAd ? r[ix.ad_id] : '', ad_name: useAd ? r[ix.ad_name] : '', ad_type: useAd ? r[ix.ad_type] : '',
        spend: +r[ix.cost] || 0, impressions: +r[ix.impressions] || 0, clicks: +r[ix.clicks] || 0,
        // Google'da install metriği yok: App (MULTI_CHANNEL) install kampanyalarında dönüşüm = install
        installs: ch === 'MULTI_CHANNEL' && !/engagement/i.test(name) ? conv : 0
      });
    };
    files += q_readShards_(ss, useAd ? 'gads_ad' : 'gads_campaign', p.from, p.to, gReader);
    files += q_readShards_(ss, useAd ? 'gads_ad_2' : 'gads_campaign_2', p.from, p.to, gReader);
  }
  if (plat.indexOf('Meta') >= 0) {
    files += q_readShards_(ss, useAd ? 'meta_ad' : 'meta_campaign', p.from, p.to, function (r, ix) {
      accept({
        date: r[0], platform: 'Meta', account_id: r[1], currency: r[ix.currency],
        campaign_id: String(r[ix.campaign_id]), campaign_name: String(r[ix.campaign_name]),
        adgroup_id: useAd ? r[ix.adset_id] : '', adgroup_name: useAd ? r[ix.adset_name] : '',
        ad_id: useAd ? r[ix.ad_id] : '', ad_name: useAd ? r[ix.ad_name] : '', ad_type: '',
        spend: +r[ix.spend] || 0, impressions: +r[ix.impressions] || 0,
        clicks: +r[ix.link_clicks] || 0, // Meta: link clicks
        installs: +r[ix.installs] || 0
      });
    });
  }

  var unmatched = {};
  function miss(src, name, country, sessions, purchases) {
    if (kindFn && !kindFn(name)) return; // seçili kampanya grubuna uymayanlar listelenmez
    if (cset && country && !cset[country]) return;
    var k = src + '|' + name;
    var u = unmatched[k] = unmatched[k] || { src: src, name: name, sessions: 0, purchases: 0 };
    u.sessions += sessions; u.purchases += purchases;
  }

  /** Ad group seviyesinde kaynak satırını rapor satırına bağlar: önce kampanya + ad group, yoksa kampanyanın "(eşleşmeyen ad group)" satırı */
  function agDims(campDims, campName, agName, strict) {
    var g = agName ? (byAg[r_ckey_(campDims.campaign_name) + '|' + r_ckey_(agName)] || byAg[r_ckey_(campName) + '|' + r_ckey_(agName)]) : null;
    if (g || strict) return g || null;
    var key = campDims.campaign_id + '|' + campDims.account_id;
    if (!agNoMatch[key]) {
      var d = {}; for (var q in campDims) d[q] = campDims[q];
      d.adgroup_name = '(eşleşmeyen ad group)'; d.adgroup_id = '';
      agNoMatch[key] = d;
    }
    return agNoMatch[key];
  }
  var agStart = String(s.AG_START_DATE || '2026-01-01');
  var gaProps = {};
  if (isAg) sh_accounts_(ss, 'GA4').forEach(function (a) { gaProps[String(a.id)] = a; });

  if (withWeb && isAg) {
    // GA4 (web) — ga4_ag: kampanya + ad group (köprü script'i yazar)
    q_readShards_(ss, 'ga4_ag', p.from, p.to, function (r, ix) {
      var name = String(r[ix.campaign] || '');
      var code = String(r[ix.country] || '').toUpperCase();
      var cands = ['gads_adgroup', 'utm_term', 'utm_content'].map(function (h) { return ix[h] != null ? String(r[ix[h]] || '') : ''; }).filter(String);
      var sess = +r[ix.sessions] || 0, pur = +r[ix.ecommercePurchases] || 0;
      var gid = r_cid_(name), mid = ix.campaign_id != null ? String(r[ix.campaign_id] || '') : '';
      var cd = (mid && byId[mid]) || (gid && byId[gid]) || r_ckLookup_(byKey, name);
      if (!cd) { miss('GA4', name, code, sess, pur); return; }
      var dims = null;
      for (var ci = 0; ci < cands.length && !dims; ci++) dims = agDims(cd, name, cands[ci], true);
      if (!dims) dims = agDims(cd, name, '');
      var pa = gaProps[String(r[1])];
      if (pa && !pa.active) return;
      var rate = perUsd(r[0], (pa && pa.currency) || 'USD');
      var o = { date: r[0], ga_sessions: sess, ga_purchases: pur, ga_revenue_usd: rate ? (+r[ix.purchaseRevenue] || 0) / rate : 0 };
      for (var k in dims) o[k] = dims[k];
      agg.add(o);
    });
    // Adjust (app) — adjust_ag: campaign_network + adgroup_network
    var pmA = String(s.ADJUST_PURCHASE_METRIC || 'revenue_events').trim();
    var rmA = String(s.ADJUST_REVENUE_METRIC || 'revenue').trim();
    var acurA = String(s.ADJUST_CURRENCY || 'USD').trim().toUpperCase();
    q_readShards_(ss, 'adjust_ag', p.from, p.to, function (r, ix) {
      var name = String(r[ix.campaign] || ''), agn = String(r[ix.adgroup] || '');
      var sess = +r[ix.sessions] || 0, pur = ix[pmA] != null ? +r[ix[pmA]] || 0 : 0;
      var id = r_cid_(name);
      var cd = (id && byId[id]) || r_ckLookup_(byKey, name);
      if (!cd) { miss('Adjust', name, '', sess, pur); return; }
      var dims = agDims(cd, name, agn.replace(/\s*\(\d+\)\s*$/, ''));
      var rate = perUsd(r[0], acurA);
      var o = { date: r[0], adj_sessions: sess, adj_purchases: pur, adj_revenue_usd: rate ? (ix[rmA] != null ? +r[ix[rmA]] || 0 : 0) / rate : 0,
        adj_installs: +r[ix.installs] || 0,
        adj_c_purchases: ix.cohort_purchases != null ? +r[ix.cohort_purchases] || 0 : 0,
        adj_c_revenue_usd: ix.cohort_revenue != null && rate ? (+r[ix.cohort_revenue] || 0) / rate : 0 };
      for (var k in dims) o[k] = dims[k];
      agg.add(o);
    });
  }

  if (withWeb && !isAg) {
    // GA4 (web) — sessionCampaignName ile eşleşir
    ga4_rows_(ss, p.from, p.to, function (r, ix, pa, gcode) {
      var name = ix.sessionCampaignName != null ? String(r[ix.sessionCampaignName]) : '';
      var sess = ix.sessions != null ? +r[ix.sessions] || 0 : 0;
      var pur = ix.ecommercePurchases != null ? +r[ix.ecommercePurchases] || 0 : 0;
      var gid = r_cid_(name);
      var dims = (gid && byId[gid]) || r_ckLookup_(byKey, name);
      if (!dims) { miss('GA4', name, gcode, sess, pur); return; }
      var cur = pa && pa.currency ? pa.currency : 'USD';
      var rate = perUsd(r[0], cur);
      var rev = ix.purchaseRevenue != null ? +r[ix.purchaseRevenue] || 0 : 0;
      var o = { date: r[0], ga_sessions: sess, ga_purchases: pur, ga_revenue_usd: rate ? rev / rate : 0 };
      for (var k in dims) o[k] = dims[k];
      agg.add(o);
    });
    // Adjust (app) — campaign_network: "Kampanya Adı (ID)" → önce ID, sonra ad ile eşleşir
    var pm = String(s.ADJUST_PURCHASE_METRIC || 'revenue_events').trim();
    var rm = String(s.ADJUST_REVENUE_METRIC || 'revenue').trim();
    var acur = String(s.ADJUST_CURRENCY || 'USD').trim().toUpperCase();
    q_readShards_(ss, 'adjust', p.from, p.to, function (r, ix) {
      var name = String(r[ix.campaign] || '');
      var sess = ix.sessions != null ? +r[ix.sessions] || 0 : 0;
      var pur = ix[pm] != null ? +r[ix[pm]] || 0 : 0;
      var id = r_cid_(name);
      var dims = (id && byId[id]) || r_ckLookup_(byKey, name);
      if (!dims) { miss('Adjust', name, String(r[ix.country] || ''), sess, pur); return; }
      var rate = perUsd(r[0], acur);
      var rev = ix[rm] != null ? +r[ix[rm]] || 0 : 0;
      var o = { date: r[0], adj_sessions: sess, adj_purchases: pur, adj_revenue_usd: rate ? rev / rate : 0,
        adj_installs: ix.installs != null ? +r[ix.installs] || 0 : 0,
        adj_c_purchases: ix.cohort_purchases != null ? +r[ix.cohort_purchases] || 0 : 0,
        adj_c_revenue_usd: ix.cohort_revenue != null && rate ? (+r[ix.cohort_revenue] || 0) / rate : 0 };
      for (var k in dims) o[k] = dims[k];
      agg.add(o);
    });
  }

  var out = r_build_(agg, groupFields, p.grain, metrics);
  out.warnings = [];
  var fm = Object.keys(fxMissing);
  if (fm.length) out.warnings.push('Kur bulunamadı (USD = 0 sayıldı): ' + fm.join(', ') + ' — Durum > "Kurları güncelle".');
  if (out.truncated) out.warnings.push(out.truncated + ' satırdan ilk 60.000 gösteriliyor. Filtre ekleyin.');
  if (!files) out.warnings.push('Seçilen aralıkta veri dosyası yok (senkron henüz tamamlanmamış olabilir).');
  if (!withWeb) out.warnings.push('GA4 / Adjust metrikleri ad seviyesinde gösterilmez (ad group seviyesine kadar eşleşir).');
  if (isAg && p.from < agStart) out.warnings.push('Ad group seviyesinde GA4 / Adjust verisi ' + agStart + ' tarihinden itibaren var.');
  if (isAg && Object.keys(agNoMatch).length) out.warnings.push('Ad group adı eşleşmeyen GA4 / Adjust verisi kampanyanın "(eşleşmeyen ad group)" satırında gösteriliyor.');
  out.unmatched = Object.keys(unmatched).map(function (k) { return unmatched[k]; })
    .sort(function (a, b) { return b.sessions - a.sessions; }).slice(0, 30);
  out.ms = Date.now() - t0;
  return out;
}

/** Kolonlar: {k, l, t, g, orig, d} + gizli _cur; toplamlar metrik sırasıyla. */
function r_build_(agg, groupFields, grain, metrics) {
  var cols = [];
  if (grain && grain !== 'none') cols.push({ k: 'period', l: grain === 'week' ? 'Hafta (Pzt)' : 'Dönem', t: 'text' });
  groupFields.forEach(function (fld) { cols.push({ k: fld, l: FIELD_LABELS[fld] || fld, t: 'text' }); });
  metrics.forEach(function (m) { cols.push({ k: m.k, l: m.l, t: m.u, g: m.g, orig: !!m.orig, d: !!m.d }); });
  var withCur = metrics.some(function (m) { return m.orig; });
  if (withCur) cols.push({ k: '_cur', l: 'currency', t: 'hidden' });

  function metricRow(sv) {
    var o = {};
    R_SUMS.forEach(function (k, i) { o[k] = sv[i]; });
    return metrics.map(function (m) { var v = m.d ? m.d(o) : o[m.k]; return v == null || !isFinite(v) ? null : v; });
  }
  var groups = agg.groups();
  var si = R_SUMS.indexOf('spend_usd');
  groups.sort(function (a, b) {
    if (a.period !== b.period) return a.period < b.period ? -1 : 1;
    return b.s[si] - a.s[si];
  });
  var MAX = 60000;
  var rows = groups.slice(0, MAX).map(function (gr) {
    var r = grain && grain !== 'none' ? [gr.period] : [];
    r = r.concat(gr.gv, metricRow(gr.s));
    if (withCur) r.push(gr.cur);
    return r;
  });
  var totals = metricRow(agg.total());
  if (withCur) {
    var tc = agg.currencies();
    metrics.forEach(function (m, i) { if (m.orig && tc.length !== 1) totals[i] = null; });
    totals.push(tc.length === 1 ? tc[0] : '');
  }
  return { columns: cols, rows: rows, totals: totals, truncated: groups.length > MAX ? groups.length : 0, scanned: agg.count() };
}

/** Seçili satır filtresi: filters.pick = { fields: ['country','platform'], keys: ['KZ|Meta', ...] } → o => bool */
function r_pickFn_(f) {
  var pk = f && f.pick;
  if (!pk || !pk.fields || !pk.fields.length || !pk.keys) return null;
  var set = {};
  pk.keys.forEach(function (k) { set[String(k)] = 1; });
  return function (o) { return !!set[pk.fields.map(function (fl) { return String(o[fl] == null ? '' : o[fl]); }).join('|')]; };
}
