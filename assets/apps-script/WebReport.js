/**
 * WebReport.js — Web sekmesi: GA4 web verisi (ga4_web) + tüm mecraların reklam harcaması (küpten) → blended ROAS.
 */
var WEB_DIM_LABELS = { channel: 'Kanal', source_medium: 'Kaynak / Araç', device: 'Cihaz', user_type: 'Ziyaretçi' };
function q_web_(ss, p) {
  var t0 = Date.now();
  var dims = (p.dims || []).filter(function (d) { return WEB_DIM_LABELS[d]; });
  var grain = p.grain || 'none';
  var perUsd = fx_loader_(ss);
  var gcur = {}; sh_accounts_(ss, 'GA4').forEach(function (a) { gcur[a.id] = a.currency || 'USD'; });
  var K = ['sessions', 'totalUsers', 'newUsers', 'engagedSessions', 'screenPageViews', 'userEngagementDuration', 'addToCarts', 'checkouts', 'ecommercePurchases', 'purchaseRevenue', 'spend'];
  function blank() { var o = {}; K.forEach(function (k) { o[k] = 0; }); return o; }
  function add(o, v) { K.forEach(function (k) { o[k] += v[k] || 0; }); }
  var groups = {}, order = [], total = blank(), daily = {}, byCh = {}, byDev = {};
  var files = q_readShards_(ss, 'ga4_web', p.from, p.to, function (r, ix) {
    var date = r[0], rate = perUsd(date, gcur[String(r[1])] || 'TRY');
    var v = {}; K.forEach(function (k) { v[k] = ix[k] != null ? +r[ix[k]] || 0 : 0; });
    v.purchaseRevenue = rate ? v.purchaseRevenue / rate : 0;
    var dv = { channel: String(r[ix.channel] || ''), source_medium: String(r[ix.source_medium] || ''), device: String(r[ix.device] || ''), user_type: String(r[ix.user_type] || '') || '(bilinmiyor)' };
    var per = grain === 'none' ? '' : q_period_(date, grain);
    var key = per + '\u0001' + dims.map(function (d) { return dv[d]; }).join('\u0001');
    var g = groups[key];
    if (!g) { g = groups[key] = blank(); g.per = per; g.dv = dims.map(function (d) { return dv[d]; }); order.push(key); }
    add(g, v); add(total, v);
    add(daily[date] || (daily[date] = blank()), v);
    add(byCh[dv.channel] || (byCh[dv.channel] = blank()), v);
    add(byDev[dv.device] || (byDev[dv.device] = blank()), v);
  });
  // reklam harcaması (tüm mecralar, küpten; rapor para birimi)
  try {
    var cube = cube_load_();
    if (cube) cube.rows.forEach(function (r) {
      if (r[0] < p.from || r[0] > p.to) return;
      var c = cube.camps[r[1]];
      total.spend += r[3] || 0;
      var dd = daily[r[0]] || (daily[r[0]] = blank()); dd.spend += r[3] || 0;
      if (grain !== 'none' && !dims.length) { var per = q_period_(r[0], grain), key = per + '\u0001'; var g = groups[key]; if (!g) { g = groups[key] = blank(); g.per = per; g.dv = []; order.push(key); } g.spend += r[3] || 0; }
      else if (!dims.length) { var g0 = groups['\u0001'] || (groups['\u0001'] = (function () { var b = blank(); b.per = ''; b.dv = []; order.push('\u0001'); return b; })()); g0.spend += r[3] || 0; }
    });
  } catch (e) {}
  var M = [
    { k: 'sessions', l: 'Sessions', u: 'int' },
    { k: 'totalUsers', l: 'Users', u: 'int' },
    { k: 'new_share', l: 'Yeni kullanıcı', u: 'pct', d: function (o) { return q_div_(o.newUsers, o.totalUsers); } },
    { k: 'eng_rate', l: 'Etkileşim oranı', u: 'pct', d: function (o) { return q_div_(o.engagedSessions, o.sessions); } },
    { k: 'eng_time', l: 'Ort. etkileşim (sn)', u: 'int', d: function (o) { return q_div_(o.userEngagementDuration, o.sessions); } },
    { k: 'pps', l: 'Sayfa / Session', u: 'num', d: function (o) { return q_div_(o.screenPageViews, o.sessions); } },
    { k: 'addToCarts', l: 'Add to Cart', u: 'int' },
    { k: 'checkouts', l: 'Checkout', u: 'int' },
    { k: 'ecommercePurchases', l: 'Purchase', u: 'int' },
    { k: 'purchaseRevenue', l: 'Revenue', u: 'usd' },
    { k: 'cvr', l: 'CVR', u: 'pct', d: function (o) { return q_div_(o.ecommercePurchases, o.sessions); } },
    { k: 'aov', l: 'AOV', u: 'usd', d: function (o) { return q_div_(o.purchaseRevenue, o.ecommercePurchases); } },
    { k: 'rps', l: 'Revenue / Session', u: 'usd', d: function (o) { return q_div_(o.purchaseRevenue, o.sessions); } },
    { k: 'cart_rate', l: 'Sepete ekleme oranı', u: 'pct', d: function (o) { return q_div_(o.addToCarts, o.sessions); } },
    { k: 'cart_to_purchase', l: 'Sepet → Satın alma', u: 'pct', d: function (o) { return q_div_(o.ecommercePurchases, o.addToCarts); } }
  ];
  if (!dims.length) M = M.concat([
    { k: 'spend', l: 'Reklam harcaması', u: 'usd' },
    { k: 'blended_roas', l: 'Blended ROAS', u: 'x', d: function (o) { return q_div_(o.purchaseRevenue, o.spend); } },
    { k: 'margin', l: 'Marjin', u: 'pct', d: function (o) { return q_div_(o.spend, o.purchaseRevenue); } }
  ]);
  function vals(o) { return M.map(function (m) { var v = m.d ? m.d(o) : o[m.k]; return v == null || !isFinite(v) ? null : v; }); }
  var cols = [];
  if (grain !== 'none') cols.push({ k: 'period', l: grain === 'week' ? 'Hafta (Pzt)' : 'Dönem', t: 'text' });
  dims.forEach(function (d) { cols.push({ k: d, l: WEB_DIM_LABELS[d], t: 'text' }); });
  M.forEach(function (m) { cols.push({ k: m.k, l: m.l, t: m.u, d: !!m.d }); });
  var list = order.map(function (k) { return groups[k]; });
  list.sort(function (a, b) { return a.per !== b.per ? (a.per < b.per ? -1 : 1) : b.sessions - a.sessions; });
  var tv = vals(total);
  if (dims.length) { // KPI'larda harcama da görünsün
    tv = tv.concat([total.spend, q_div_(total.purchaseRevenue, total.spend), q_div_(total.spend, total.purchaseRevenue)]);
  }
  function mini(map) {
    return Object.keys(map).map(function (k) { var o = map[k]; return [k || '(not set)', o.sessions, q_div_(o.sessions, total.sessions), q_div_(o.ecommercePurchases, o.sessions), o.purchaseRevenue, q_div_(o.purchaseRevenue, total.purchaseRevenue)]; })
      .sort(function (a, b) { return b[1] - a[1]; }).slice(0, 12);
  }
  var kpiCols = cols.slice();
  if (dims.length) kpiCols = kpiCols.concat([{ k: 'spend', l: 'Reklam harcaması', t: 'usd' }, { k: 'blended_roas', l: 'Blended ROAS', t: 'x' }, { k: 'margin', l: 'Marjin', t: 'pct' }]);
  return {
    columns: cols, rows: list.slice(0, 20000).map(function (g) { return (grain !== 'none' ? [g.per] : []).concat(g.dv, vals(g)); }), totals: vals(total),
    kpi: { columns: kpiCols, totals: tv },
    funnel: [['Sessions', total.sessions], ['Add to Cart', total.addToCarts], ['Checkout', total.checkouts], ['Purchase', total.ecommercePurchases]],
    daily: Object.keys(daily).sort().map(function (d) { var o = daily[d]; return [d, o.sessions, o.ecommercePurchases, o.purchaseRevenue, o.spend]; }),
    byCh: mini(byCh), byDev: mini(byDev),
    warnings: files ? [] : ['Seçilen aralıkta web verisi yok (GA4 köprüsü web verisini saatlik olarak dolduruyor).'],
    ms: Date.now() - t0
  };
}
function apiWeb(paramsJson, gk) { GK_ = gk || '';
  return api_(function () {
    var p = JSON.parse(paramsJson);
    if (p.to > sh_yesterday_()) p.to = sh_yesterday_();
    var ss = cfg_(); return cmp_run_(p, function (q) { return q_web_(ss, q); });
  });
}
