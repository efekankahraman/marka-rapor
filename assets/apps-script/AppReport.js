/**
 * AppReport.js — App sekmesi: Adjust'tan zengin app verisi (OS, network, kampanya, ülke kırılımlı).
 * Veri seti: adjust_app (aylık). Metrikler hesapta bir kez denenir (Settings > ADJUST_APP_METRICS).
 */
var APP_API_DIMS = ['day', 'app_token', 'app', 'os_name', 'country_code', 'partner_name', 'campaign_network', 'adgroup_network', 'creative_network'];
var APP_HEADER_DIMS = ['date', 'account_id', 'app', 'os', 'country', 'partner', 'campaign', 'adgroup', 'creative'];
var APP_CANDIDATES = ['installs', 'reattributions', 'clicks', 'impressions', 'sessions', 'daus', 'uninstalls', 'reinstalls',
  'revenue', 'revenue_events', 'cost', 'retention_rate_d1', 'retention_rate_d7', 'retention_rate_d30'];

function app_metrics_(ss, token, apps) {
  var s = sh_settings_(ss), have = String(s.ADJUST_APP_METRICS || '').trim();
  var pm = String(s.ADJUST_PURCHASE_METRIC || 'revenue_events').trim();
  var list;
  if (have) list = have.split(',').map(function (x) { return x.trim(); }).filter(String);
  else {
    var d = sh_addDays_(sh_yesterday_(), -14), cands = APP_CANDIDATES.slice();
    if (pm && cands.indexOf(pm) < 0) cands.push(pm);
    var reqs = cands.map(function (m) {
      return { url: 'https://automate.adjust.com/reports-service/report?app_token__in=' + encodeURIComponent(apps.join(',')) + '&date_period=' + d + ':' + d +
        '&dimensions=day&metrics=' + encodeURIComponent(m) + '&cohort_maturity=immature', headers: adjust_headers_(token), muteHttpExceptions: true };
    });
    list = [];
    UrlFetchApp.fetchAll(reqs).forEach(function (r, i) { if (r.getResponseCode() === 200) list.push(cands[i]); });
    if (!list.length) throw new Error('Adjust app metrikleri doğrulanamadı');
    sh_setSetting_(ss, 'ADJUST_APP_METRICS', list.join(','));
    sh_log_(ss, 'adjust_app', 'INFO', 'App metrikleri: ' + list.join(', ') + ' (desteklenmeyen: ' + cands.filter(function (m) { return list.indexOf(m) < 0; }).join(', ') + ')');
  }
  return list;
}

function adjust_appSync_(ss, from, to) {
  var token = PropertiesService.getScriptProperties().getProperty('ADJUST_TOKEN');
  if (!token) throw new Error('ADJUST_TOKEN tanımlı değil');
  var s = sh_settings_(ss);
  var apps = adjust_resolveApps_(ss, token, String(s.ADJUST_APP_TOKENS || '').split(',').map(function (x) { return x.trim(); }).filter(String));
  var metrics = app_metrics_(ss, token, apps);
  var ev = app_events_(ss, token, apps), evm = ev.map(function (e) { return e.metric; });
  var excl = String(s.ADJUST_EXCLUDE_COUNTRIES || '').toLowerCase().split(',').map(function (x) { return x.trim(); }).filter(String);
  var url = 'https://automate.adjust.com/reports-service/report?app_token__in=' + encodeURIComponent(apps.join(',')) +
    '&date_period=' + from + ':' + to + '&dimensions=' + APP_API_DIMS.join(',') + '&metrics=' + encodeURIComponent(metrics.concat(evm).join(',')) +
    '&attribution_source=' + encodeURIComponent(s.ADJUST_ATTRIBUTION_SOURCE || 'dynamic') +
    '&attribution_types=' + encodeURIComponent(s.ADJUST_ATTRIBUTION_TYPE || 'click') +
    '&cohort_maturity=immature&utc_offset=' + encodeURIComponent(s.ADJUST_UTC_OFFSET || '+03:00');
  var body = fetchJson_(url, { headers: adjust_headers_(token) });
  // retention oranları toplanabilir olsun diye "elde tutulan kullanıcı" sayısına çevrilir (oran × install)
  var cols = metrics.map(function (m) { var r = /^retention_rate_(d\d+)$/.exec(m); return r ? 'ret_' + r[1] : m; }).concat(ev.map(function (e) { return e.col; }));
  var rows = [];
  (body.rows || []).forEach(function (r) {
    var cc = String(r.country_code || '').toLowerCase();
    if (excl.indexOf(cc) >= 0) return;
    var inst = +r.installs || 0;
    rows.push([sh_dateStr_(r.day), r.app_token || '', r.app || '', r.os_name || '', cc.toUpperCase(), r.partner_name || '', String(r.campaign_network || '').trim() || '(kampanyasız)', String(r.adgroup_network || '').trim() || '(yok)', String(r.creative_network || '').trim() || '(yok)']
      .concat(metrics.map(function (m) {
        var v = +r[m] || 0;
        if (/^retention_rate_/.test(m)) { if (v > 1) v = v / 100; return Math.round(v * inst * 100) / 100; }
        return v;
      }), ev.map(function (e) { return +r[e.metric] || 0; })));
  });
  st_upsert_(ss, 'adjust_app', APP_HEADER_DIMS.concat(cols), rows, { accounts: apps, from: from, to: to }, ['app', 'os', 'country', 'partner', 'campaign', 'adgroup', 'creative']);
  return rows.length;
}

/* ---------------- sorgu ---------------- */
var APP_DIM_LABELS = { os: 'OS', partner: 'Network', campaign: 'Kampanya', adgroup: 'Reklam grubu', creative: 'Kreatif', country: 'Ülke', app: 'App' };
function q_app_(ss, p) {
  var t0 = Date.now(), s = sh_settings_(ss);
  var dims = (p.dims || []).filter(function (d) { return APP_DIM_LABELS[d]; });
  var pf = null; if (p.f) { pf = {}; Object.keys(p.f).forEach(function (k) { if (APP_DIM_LABELS[k]) pf[k] = String(p.f[k]); }); if (!Object.keys(pf).length) pf = null; }
  var grain = p.grain || 'none';
  var pm = String(s.ADJUST_PURCHASE_METRIC || 'revenue_events').trim();
  var acur = String(s.ADJUST_CURRENCY || 'USD').trim().toUpperCase();
  var perUsd = fx_loader_(ss);
  var groups = {}, order = [], daily = {}, byOs = {}, byNet = {}, have = {};
  var SUMS = ['installs', 'reattributions', 'clicks', 'impressions', 'sessions', 'daus', 'uninstalls', 'reinstalls', 'purchases', 'revenue', 'cost', 'ret_d1', 'ret_d7', 'ret_d30', 'organic', 'atc', 'checkout'];
  function blank() { var o = { days: {} }; SUMS.forEach(function (k) { o[k] = 0; }); return o; }
  var total = blank();
  function add(o, v, date) { SUMS.forEach(function (k) { o[k] += v[k] || 0; }); o.days[date] = 1; }
  var files = q_readShards_(ss, 'adjust_app', p.from, p.to, function (r, ix) {
    for (var h in ix) have[h] = 1;
    var date = r[0], rate = perUsd(date, acur);
    var g = function (k) { return ix[k] != null ? +r[ix[k]] || 0 : 0; };
    var partner = String(r[ix.partner] || '');
    var v = { installs: g('installs'), reattributions: g('reattributions'), clicks: g('clicks'), impressions: g('impressions'), sessions: g('sessions'),
      daus: g('daus'), uninstalls: g('uninstalls'), reinstalls: g('reinstalls'), purchases: g(pm),
      revenue: rate ? g('revenue') / rate : 0, cost: rate ? g('cost') / rate : 0, ret_d1: g('ret_d1'), ret_d7: g('ret_d7'), ret_d30: g('ret_d30'), atc: g('atc'), checkout: g('checkout') };
    v.organic = /organic/i.test(partner) ? v.installs : 0;
    var dv = { os: String(r[ix.os] || ''), partner: partner, campaign: String(r[ix.campaign] || ''), country: String(r[ix.country] || ''), app: String(r[ix.app] || ''),
      adgroup: String(r[ix.adgroup] || '') || '(yok)', creative: String(r[ix.creative] || '') || '(yok)' };
    if (pf) for (var fk in pf) if (dv[fk] !== pf[fk]) return;
    var per = grain === 'none' ? '' : q_period_(date, grain);
    var key = per + '\u0001' + dims.map(function (d) { return dv[d]; }).join('\u0001');
    var gr = groups[key];
    if (!gr) { gr = groups[key] = blank(); gr.per = per; gr.dv = dims.map(function (d) { return dv[d]; }); order.push(key); }
    add(gr, v, date); add(total, v, date);
    var dd = daily[date] || (daily[date] = blank()); add(dd, v, date);
    var o1 = byOs[dv.os || '?'] || (byOs[dv.os || '?'] = blank()); add(o1, v, date);
    var tk = v.organic ? 'Organik' : 'Ücretli';
    var o2 = byNet[tk] || (byNet[tk] = blank()); add(o2, v, date);
  });
  // Adjust'a maliyet aktarılmıyorsa: Meta + Google Ads app kampanyalarının panel harcaması
  var costSrc = '';
  if (!total.cost) {
    var sp = app_spend_(ss, p.from, p.to, perUsd), onlyPlat = pf && pf.partner ? app_partnerPlat_(pf.partner) : null;
    var partial = pf && Object.keys(pf).some(function (k) { return k !== 'partner'; });
    if (sp.total && !partial && onlyPlat !== '') {
      costSrc = 'panel'; have.cost = 1;
      var perOf = function (d) { return grain === 'none' ? '' : q_period_(d, grain); };
      Object.keys(sp.by).forEach(function (d) {
        var o = sp.by[d], c = 0;
        Object.keys(o).forEach(function (pl) { if (!onlyPlat || pl === onlyPlat) c += o[pl]; });
        total.cost += c;
        (daily[d] || (daily[d] = blank())).cost += c;
        if (!dims.length) { var gk = perOf(d) + '\u0001', gg = groups[gk]; if (gg) gg.cost += c; }
      });
      if (dims.length === 1 && dims[0] === 'partner') order.forEach(function (k) {
        var gg = groups[k], pl = app_partnerPlat_(gg.dv[0]); if (!pl) return;
        Object.keys(sp.by).forEach(function (d) { if (grain === 'none' || perOf(d) === gg.per) gg.cost += sp.by[d][pl] || 0; });
      });
    }
  }
  var M = [
    { k: 'installs', l: 'Installs', u: 'int' },
    { k: 'organic_share', l: 'Organik pay', u: 'pct', d: function (o) { return q_div_(o.organic, o.installs); } },
    { k: 'reattributions', l: 'Reattributions', u: 'int', need: 'reattributions' },
    { k: 'purchases', l: 'Purchase', u: 'num' },
    { k: 'revenue', l: 'Revenue', u: 'usd', need: 'revenue' },
    { k: 'aov', l: 'AOV', u: 'usd', need: 'revenue', d: function (o) { return q_div_(o.revenue, o.purchases); } },
    { k: 'rev_per_install', l: 'Revenue / Install', u: 'usd', need: 'revenue', d: function (o) { return q_div_(o.revenue, o.installs); } },
    { k: 'cvr', l: 'Purchase / Session', u: 'pct', d: function (o) { return q_div_(o.purchases, o.sessions); } },
    { k: 'atc', l: 'Add to Cart', u: 'int', need: 'atc' },
    { k: 'checkout', l: 'Checkout', u: 'int', need: 'checkout' },
    { k: 'cart_rate', l: 'Sepete ekleme / Session', u: 'pct', need: 'atc', d: function (o) { return q_div_(o.atc, o.sessions); } },
    { k: 'cart_to_purchase', l: 'Sepet → Satın alma', u: 'pct', need: 'atc', d: function (o) { return q_div_(o.purchases, o.atc); } },
    { k: 'ret_d1', l: 'Retention D1', u: 'pct', need: 'ret_d1', d: function (o) { return q_div_(o.ret_d1, o.installs); } },
    { k: 'ret_d7', l: 'Retention D7', u: 'pct', need: 'ret_d7', d: function (o) { return q_div_(o.ret_d7, o.installs); } },
    { k: 'ret_d30', l: 'Retention D30', u: 'pct', need: 'ret_d30', d: function (o) { return q_div_(o.ret_d30, o.installs); } },
    { k: 'avg_dau', l: 'DAU (ort.)', u: 'int', need: 'daus', d: function (o) { var n = Object.keys(o.days).length; return n ? o.daus / n : null; } },
    { k: 'arpdau', l: 'ARPDAU', u: 'usd', need: 'daus', d: function (o) { return q_div_(o.revenue, o.daus); } },
    { k: 'sess_per_dau', l: 'Session / DAU', u: 'num', need: 'daus', d: function (o) { return q_div_(o.sessions, o.daus); } },
    { k: 'uninstalls', l: 'Uninstalls', u: 'int', need: 'uninstalls' },
    { k: 'uninstall_rate', l: 'Uninstall / Install', u: 'pct', need: 'uninstalls', d: function (o) { return q_div_(o.uninstalls, o.installs); } },
    { k: 'cost', l: costSrc ? 'Reklam harcaması (panel)' : 'Maliyet (Adjust)', u: 'usd', need: 'cost' },
    { k: 'cpi', l: 'CPI', u: 'usd', need: 'cost', d: function (o) { return q_div_(o.cost, o.installs); } },
    { k: 'roas', l: 'ROAS', u: 'x', need: 'cost', d: function (o) { return q_div_(o.revenue, o.cost); } },
    { k: 'margin', l: 'Marjin', u: 'pct', need: 'cost', d: function (o) { return q_div_(o.cost, o.revenue); } },
    { k: 'click_install', l: 'Install / Click', u: 'pct', need: 'clicks', d: function (o) { return q_div_(o.installs, o.clicks); } },
    { k: 'sessions', l: 'Sessions', u: 'int' },
    { k: 'clicks', l: 'Clicks', u: 'int', need: 'clicks' },
    { k: 'impressions', l: 'Impressions', u: 'int', need: 'impressions' }
  ].filter(function (m) { return !m.need || have[m.need]; });
  // maliyet hiç gelmiyorsa (Adjust'a reklam maliyeti aktarılmıyorsa) maliyet kolonları gizlenir
  if (!total.cost) M = M.filter(function (m) { return ['cost', 'cpi', 'roas'].indexOf(m.k) < 0; });
  function vals(o) { return M.map(function (m) { var v = m.d ? m.d(o) : o[m.k]; return v == null || !isFinite(v) ? null : v; }); }
  var cols = [];
  if (grain !== 'none') cols.push({ k: 'period', l: grain === 'week' ? 'Hafta (Pzt)' : 'Dönem', t: 'text' });
  dims.forEach(function (d) { cols.push({ k: d, l: APP_DIM_LABELS[d], t: 'text' }); });
  M.forEach(function (m) { cols.push({ k: m.k, l: m.l, t: m.u, d: !!m.d }); });
  var list = order.map(function (k) { return groups[k]; });
  list.sort(function (a, b) { return a.per !== b.per ? (a.per < b.per ? -1 : 1) : b.installs - a.installs; });
  var rows = list.slice(0, 20000).map(function (g) { return (grain !== 'none' ? [g.per] : []).concat(g.dv, vals(g)); });
  function mini(map) {
    return Object.keys(map).filter(function (k) { var o = map[k]; return o.installs || o.purchases || o.revenue || o.sessions; })
      .map(function (k) { var o = map[k]; return [k, o.installs, q_div_(o.installs, total.installs), o.purchases, o.revenue, q_div_(o.ret_d7, o.installs)]; })
      .sort(function (a, b) { return b[1] - a[1]; }).slice(0, 12);
  }
  var dkeys = Object.keys(daily).sort();
  return {
    columns: cols, rows: rows, totals: vals(total), truncated: list.length > 20000 ? list.length : 0,
    daily: dkeys.map(function (d) { var o = daily[d]; return [d, o.installs, o.purchases, o.revenue, o.sessions, o.organic]; }),
    byOs: mini(byOs), byNet: mini(byNet), hasRet: !!have.ret_d7,
    funnel: have.atc || have.checkout ? [['Sessions', total.sessions], ['Add to Cart', total.atc], ['Checkout', total.checkout], ['Purchase', total.purchases]].filter(function (x, i) { return i === 0 || i === 3 || x[1]; }) : null,
    costNote: costSrc ? 'Reklam harcaması / CPI / ROAS: Adjust\'a maliyet aktarılmadığı için Meta (app objective) ve Google Ads App kampanyalarının panel harcamasından hesaplandı' + (dims.length && !(dims.length === 1 && dims[0] === 'partner') ? '; kırılım satırlarında sadece toplamda gösterilir.' : '.') : '',
    warnings: files ? [] : ['Seçilen aralıkta app verisi yok (Adjust app verisi ilk çekimde birkaç dakika sürebilir).'],
    ms: Date.now() - t0
  };
}

function apiApp(paramsJson, gk) { GK_ = gk || '';
  return api_(function () {
    var p = JSON.parse(paramsJson);
    if (p.to > sh_yesterday_()) p.to = sh_yesterday_();
    var ss = cfg_(); return cmp_run_(p, function (q) { return q_app_(ss, q); });
  });
}

/** Adjust event listesinden sepete ekleme / checkout eventlerini bulur, rapor metriği olarak dener (Settings > ADJUST_APP_EVENTS'e yazar). */
function app_events_(ss, token, apps) {
  var s = sh_settings_(ss), have = String(s.ADJUST_APP_EVENTS || '').trim();
  if (have) return have === '-' ? [] : have.split(',').map(function (x) { var p = x.split('='); return { col: p[0].trim(), metric: (p[1] || '').trim() }; }).filter(function (e) { return e.col && e.metric; });
  var out = [], names = [];
  try {
    var body = fetchJson_('https://automate.adjust.com/reports-service/events?app_token__in=' + encodeURIComponent(apps.join(',')), { headers: adjust_headers_(token) });
    var list = Array.isArray(body) ? body : (body.events || body.data || body.rows || body.results || []);
    names = list.map(function (e) { return String(e.name || e.slug || e.id || ''); });
    var pick = { atc: /add.?to.?cart|addtocart|sepet|add_cart|cart_add/i, checkout: /checkout|initiat|begin.?check|ödeme|odeme|payment_info/i };
    var d = sh_addDays_(sh_yesterday_(), -14);
    Object.keys(pick).forEach(function (col) {
      var cands = list.filter(function (e) { return pick[col].test([e.name, e.slug, e.id, e.token].join(' ')) && !/purchase|satın|satin|revenue/i.test(String(e.name || '')); });
      for (var i = 0; i < cands.length; i++) {
        var e = cands[i], keys = [e.slug, e.id, e.token, e.name].filter(Boolean), ok = null;
        for (var j = 0; j < keys.length && !ok; j++) {
          var m = String(keys[j]) + '_events';
          var r = UrlFetchApp.fetch('https://automate.adjust.com/reports-service/report?app_token__in=' + encodeURIComponent(apps.join(',')) + '&date_period=' + d + ':' + d +
            '&dimensions=day&metrics=' + encodeURIComponent(m) + '&cohort_maturity=immature', { headers: adjust_headers_(token), muteHttpExceptions: true });
          if (r.getResponseCode() === 200) ok = m;
        }
        if (ok) { out.push({ col: col, metric: ok, name: e.name || ok }); break; }
      }
    });
  } catch (e) { sh_log_(ss, 'adjust_app', 'WARN', 'Adjust event listesi alınamadı: ' + (e.message || e)); return []; }
  sh_setSetting_(ss, 'ADJUST_APP_EVENTS', out.length ? out.map(function (o) { return o.col + '=' + o.metric; }).join(',') : '-');
  sh_log_(ss, 'adjust_app', 'INFO', 'App eventleri: ' + (out.map(function (o) { return o.col + ' ← ' + o.name + ' (' + o.metric + ')'; }).join(', ') || 'sepet / checkout eventi bulunamadı') +
    ' · tüm eventler: ' + names.slice(0, 80).join(', '));
  return out;
}

/** App kampanyalarının panel harcaması (Meta app objective + Google Ads App kampanyaları), rapor para biriminde, gün × mecra. */
function app_spend_(ss, from, to, perUsd) {
  var by = {}, tot = 0;
  function put(d, plat, v) { var o = by[d] || (by[d] = {}); o[plat] = (o[plat] || 0) + v; tot += v; }
  var gR = function (r, ix) {
    if (String(r[ix.channel_type] || '') !== 'MULTI_CHANNEL') return;
    var rate = perUsd(r[0], r[ix.currency]) || 1; put(r[0], 'Google Ads', (+r[ix.cost] || 0) / rate);
  };
  q_readShards_(ss, 'gads_campaign', from, to, gR);
  q_readShards_(ss, 'gads_campaign_2', from, to, gR);
  q_readShards_(ss, 'meta_campaign', from, to, function (r, ix) {
    if (cpas_is_(r[1])) return;
    if (!/APP_INSTALL|APP_PROMOTION|MOBILE_APP/i.test(String(r[ix.objective] || ''))) return;
    var rate = perUsd(r[0], r[ix.currency]) || 1; put(r[0], 'Meta', (+r[ix.spend] || 0) / rate);
  });
  return { by: by, total: tot };
}
function app_partnerPlat_(p) {
  p = String(p || '');
  if (/facebook|instagram|meta|audience network/i.test(p)) return 'Meta';
  if (/google|adwords|youtube|admob/i.test(p)) return 'Google Ads';
  return '';
}
