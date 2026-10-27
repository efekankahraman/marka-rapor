/**
 * Cpas.js — Trendyol CPAS (Meta Collaborative Ads) sekmesi. Sadece Meta panel verisi (meta_ad), GA4 / Adjust yok.
 * Hesaplar Brand.js > CPAS_ACCOUNTS; bu hesaplar ana rapordan ve küpten çıkarılır.
 */
function cpas_ids_() {
  if (!cpas_ids_.m) { var m = {}; (BRAND.CPAS_ACCOUNTS || []).forEach(function (x) { m[String(x).replace(/^act_/, '')] = 1; }); cpas_ids_.m = m; }
  return cpas_ids_.m;
}
function cpas_is_(id) { return !!cpas_ids_()[String(id).replace(/^act_/, '')]; }
var CPAS_SUMS = ['spend', 'impressions', 'link_clicks', 'clicks', 'add_to_cart', 'initiate_checkout', 'purchases', 'purchase_value', 'landing_page_views'];
function cpas_metrics_() {
  return [
    { k: 'spend', l: 'Harcama', u: 'usd', neu: 1 },
    { k: 'impressions', l: 'Impressions', u: 'int', neu: 1 },
    { k: 'link_clicks', l: 'Link Click', u: 'int' },
    { k: 'ctr', l: 'CTR', u: 'pct', d: function (o) { return q_div_(o.link_clicks, o.impressions); } },
    { k: 'cpc', l: 'CPC', u: 'usd', inv: 1, d: function (o) { return q_div_(o.spend, o.link_clicks); } },
    { k: 'cpm', l: 'CPM', u: 'usd', inv: 1, d: function (o) { return q_div_(o.spend * 1000, o.impressions); } },
    { k: 'add_to_cart', l: 'Add to Cart', u: 'int' },
    { k: 'purchases', l: 'Purchase', u: 'int' },
    { k: 'purchase_value', l: 'Satış tutarı', u: 'usd' },
    { k: 'roas', l: 'ROAS', u: 'x', d: function (o) { return q_div_(o.purchase_value, o.spend); } },
    { k: 'margin', l: 'Marjin', u: 'pct', inv: 1, d: function (o) { return q_div_(o.spend, o.purchase_value); } },
    { k: 'cpa', l: 'CPA', u: 'usd', inv: 1, d: function (o) { return q_div_(o.spend, o.purchases); } },
    { k: 'aov', l: 'AOV', u: 'usd', d: function (o) { return q_div_(o.purchase_value, o.purchases); } },
    { k: 'cvr', l: 'CVR (click → purchase)', u: 'pct', d: function (o) { return q_div_(o.purchases, o.link_clicks); } },
    { k: 'atc_rate', l: 'Sepete ekleme oranı', u: 'pct', d: function (o) { return q_div_(o.add_to_cart, o.link_clicks); } },
    { k: 'cart_to_purchase', l: 'Sepet → Satın alma', u: 'pct', d: function (o) { return q_div_(o.purchases, o.add_to_cart); } },
    { k: 'cost_per_atc', l: 'Sepet başı maliyet', u: 'usd', inv: 1, d: function (o) { return q_div_(o.spend, o.add_to_cart); } }
  ];
}
function q_cpas_(ss, p) {
  var t0 = Date.now(), ids = cpas_ids_();
  if (!Object.keys(ids).length) throw new Error('CPAS hesabı tanımlı değil (Brand.js > CPAS_ACCOUNTS).');
  var perUsd = fx_loader_(ss);
  var days = Math.round((Date.parse(p.to) - Date.parse(p.from)) / 864e5) + 1;
  var pTo = sh_addDays_(p.from, -1), pFrom = sh_addDays_(p.from, -days);
  var level = { campaign: 1, adset: 1, ad: 1 }[p.level] ? p.level : 'campaign', grain = p.grain || 'none';
  function blank() { var o = {}; CPAS_SUMS.forEach(function (k) { o[k] = 0; }); return o; }
  function add(o, v) { CPAS_SUMS.forEach(function (k) { o[k] += v[k]; }); }
  var T = blank(), P = blank(), daily = {}, wd = [0, 1, 2, 3, 4, 5, 6].map(blank), groups = {}, order = [], camps = {}, ads = {};
  var M = cpas_metrics_();
  function vals(o) { return M.map(function (m) { var v = m.d ? m.d(o) : o[m.k]; return v == null || !isFinite(v) ? null : v; }); }
  var files = q_readShards_(ss, 'meta_ad', pFrom, p.to, function (r, ix) {
    if (!ids[String(r[1])]) return;
    var rate = perUsd(r[0], r[ix.currency] || 'TRY') || 1;
    var v = {}; CPAS_SUMS.forEach(function (k) { v[k] = ix[k] != null ? +r[ix[k]] || 0 : 0; });
    v.spend /= rate; v.purchase_value /= rate;
    if (r[0] < p.from) { add(P, v); return; }
    add(T, v);
    add(daily[r[0]] || (daily[r[0]] = blank()), v);
    add(wd[new Date(r[0] + 'T00:00:00Z').getUTCDay()], v);
    var cn = String(r[ix.campaign_name] || ''), an = String(r[ix.adset_name] || ''), dn = String(r[ix.ad_name] || ''), did = String(r[ix.ad_id] || '');
    var c = camps[cn]; if (!c) { c = camps[cn] = blank(); c.name = cn; } add(c, v);
    var a = ads[did]; if (!a) { a = ads[did] = blank(); a.name = dn; a.camp = cn; } add(a, v);
    var per = grain === 'none' ? '' : q_period_(r[0], grain);
    var dv = level === 'campaign' ? [cn, String(r[ix.objective] || '')] : level === 'adset' ? [cn, an] : [cn, an, dn, did];
    var key = per + '\u0001' + dv.join('\u0001'), g = groups[key];
    if (!g) { g = groups[key] = blank(); g.per = per; g.dv = dv; order.push(key); }
    add(g, v);
  });
  var cols = [];
  if (grain !== 'none') cols.push({ k: 'period', l: grain === 'week' ? 'Hafta (Pzt)' : 'Dönem', t: 'text' });
  var dl = level === 'campaign' ? [['campaign_name', 'Kampanya'], ['objective', 'Amaç']] : level === 'adset' ? [['campaign_name', 'Kampanya'], ['adset_name', 'Reklam seti']]
    : [['campaign_name', 'Kampanya'], ['adset_name', 'Reklam seti'], ['ad_name', 'Reklam'], ['ad_id', 'Ad ID']];
  dl.forEach(function (d) { cols.push({ k: d[0], l: d[1], t: 'text' }); });
  var mcols = M.map(function (m) { return { k: m.k, l: m.l, t: m.u, d: !!m.d, inv: !!m.inv, neu: !!m.neu }; });
  cols = cols.concat(mcols);
  var list = order.map(function (k) { return groups[k]; });
  list.sort(function (a, b) { return a.per !== b.per ? (a.per < b.per ? -1 : 1) : b.spend - a.spend; });
  var dates = Object.keys(daily).sort();
  return {
    columns: cols, rows: list.slice(0, 20000).map(function (g) { return (grain !== 'none' ? [g.per] : []).concat(g.dv, vals(g)); }),
    totals: vals(T), prevTotals: vals(P), hasPrev: P.spend > 0 || P.impressions > 0, days: days, prevFrom: pFrom, prevTo: pTo,
    series: { columns: [{ k: 'period', l: 'Tarih', t: 'text' }].concat(mcols), rows: dates.map(function (d) { return [d].concat(vals(daily[d])); }) },
    weekday: wd.map(function (o, i) { return [i, o.spend, o.purchase_value, o.purchases]; }),
    camps: Object.keys(camps).map(function (k) { var o = camps[k]; return [o.name, o.spend, o.purchase_value, o.purchases, o.link_clicks, o.impressions]; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 25),
    ads: Object.keys(ads).map(function (k) { var o = ads[k]; return [k, o.name, o.camp, o.spend, o.purchase_value, o.purchases, o.link_clicks, o.impressions]; }).sort(function (a, b) { return b[4] - a[4]; }).slice(0, 25),
    funnel: [['Impressions', T.impressions], ['Link Click', T.link_clicks], ['Add to Cart', T.add_to_cart], ['Purchase', T.purchases]],
    warnings: files ? [] : ['Seçilen aralıkta CPAS hesabının verisi yok.'], ms: Date.now() - t0
  };
}
function apiCpas(paramsJson, gk) { GK_ = gk || '';
  return api_(function () {
    var p = JSON.parse(paramsJson);
    if (p.to > sh_yesterday_()) p.to = sh_yesterday_();
    var ss = cfg_(); return cmp_run_(p, function (q) { return q_cpas_(ss, q); });
  });
}
