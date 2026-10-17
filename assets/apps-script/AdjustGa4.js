/**
 * AdjustGa4.js — Adjust Report Service API çekimi (GA4 → Ga4.js).
 */

/* ---------------- Adjust ---------------- */
// Dokümantasyon: https://dev.adjust.com/en/api/rs-api/reports-endpoint
// Rapor kampanya bazında eşleştirdiği için kırılım sade tutulur (dosya boyutu / hız)
var ADJUST_DIMS = ['day', 'app_token', 'country_code', 'partner_name', 'campaign_network'];
var ADJUST_HEADER_DIMS = ['date', 'account_id', 'country', 'partner', 'campaign'];

function adjust_sync_(ss, from, to) {
  var token = PropertiesService.getScriptProperties().getProperty('ADJUST_TOKEN');
  if (!token) throw new Error('ADJUST_TOKEN tanımlı değil');
  var s = sh_settings_(ss);
  var apps = String(s.ADJUST_APP_TOKENS || '').split(',').map(function (x) { return x.trim(); }).filter(String);
  if (!apps.length && !adjust_accountId_()) throw new Error('Settings > ADJUST_APP_TOKENS boş');
  apps = adjust_resolveApps_(ss, token, apps);
  var metrics = String(s.ADJUST_METRICS || 'installs').split(',').map(function (x) { return x.trim(); }).filter(String);
  [s.ADJUST_PURCHASE_METRIC || 'revenue_events', s.ADJUST_REVENUE_METRIC].forEach(function (m) { m = String(m || '').trim(); if (m && metrics.indexOf(m) < 0) metrics.push(m); });
  var excl = String(s.ADJUST_EXCLUDE_COUNTRIES || '').toLowerCase().split(',').map(function (x) { return x.trim(); }).filter(String);
  // 0W cohort (install haftası: D0–D6) satın alma + gelir — metrik adları bir kez denenerek bulunur
  var coh = adjust_cohortMetrics_(ss, token, apps);
  if (coh.pur && metrics.indexOf(coh.pur) < 0) metrics.push(coh.pur);
  if (coh.rev && metrics.indexOf(coh.rev) < 0) metrics.push(coh.rev);

  var url = 'https://automate.adjust.com/reports-service/report' +
    '?app_token__in=' + encodeURIComponent(apps.join(',')) +
    '&date_period=' + from + ':' + to +
    '&dimensions=' + ADJUST_DIMS.join(',') +
    '&metrics=' + encodeURIComponent(metrics.join(',')) +
    '&attribution_source=' + encodeURIComponent(s.ADJUST_ATTRIBUTION_SOURCE || 'dynamic') +
    '&attribution_types=' + encodeURIComponent(s.ADJUST_ATTRIBUTION_TYPE || 'click') +
    '&cohort_maturity=immature' +
    '&utc_offset=' + encodeURIComponent(s.ADJUST_UTC_OFFSET || '+03:00');
  var body = fetchJson_(url, { headers: adjust_headers_(token) });
  // Rapor sadece kampanya eşleştirmesi kullanır → satırlar gün + app + kampanya düzeyine toplanır
  // (ülke/partner kırılımı satır sayısını ~10 kat büyütüyordu). Kampanyasız trafik (unknown, Organic,
  // Expired Attributions…) tek bir "(kampanyasız)" satırında toplanır.
  var NOCAMP = /^(unknown|organic|expired attributions|untrusted devices|google organic search|\(?none\)?|)$/i;
  var agg = {}, order = [];
  (body.rows || []).forEach(function (r) {
    var cc = String(r.country_code || '').toLowerCase();
    if (excl.indexOf(cc) >= 0) return;
    var camp = String(r.campaign_network || '').trim();
    if (NOCAMP.test(camp)) camp = '(kampanyasız)';
    var k = r.day + '|' + r.app_token + '|' + camp;
    var a = agg[k];
    if (!a) {
      a = agg[k] = { row: [sh_dateStr_(r.day), r.app_token || '', '', r.partner_name || '', camp].concat(metrics.map(function () { return 0; })), cs: {} };
      order.push(k);
    }
    metrics.forEach(function (m, i) { a.row[5 + i] += +r[m] || 0; });
    var w = +r.sessions || +r.installs || 1;
    a.cs[cc] = (a.cs[cc] || 0) + w;
  });
  var rows = order.map(function (k) {
    var a = agg[k], best = '', bw = -1;
    for (var c in a.cs) if (a.cs[c] > bw) { bw = a.cs[c]; best = c; }
    a.row[2] = best.toUpperCase(); // en çok oturumun geldiği ülke (eşleşmeyen kampanya teşhisi için)
    return a.row;
  });
  st_upsert_(ss, 'adjust', ADJUST_HEADER_DIMS.concat(metrics.map(function (x) { return x === coh.pur ? 'cohort_purchases' : x === coh.rev ? 'cohort_revenue' : x; })), rows, { accounts: apps, from: from, to: to },
    ['country', 'partner', 'campaign']);
  return rows.length;
}

/**
 * Adjust token'ının erişebildiği uygulamaları bulur (6 saat önbellek).
 * Settings'teki app token'larından erişilebilir olanları kullanır; hiçbiri eşleşmezse hata verir
 * (başka markanın uygulamaları çekilmez). Sonuç State > ADJUST_APPS'e yazılır.
 */
/**
 * Adjust istek başlıkları. Kullanıcı birden fazla Adjust hesabındaysa token varsayılan olarak tek bir hesaba gider;
 * X-Account-ID başlığı hangi hesabın verisinin döneceğini belirler (Settings > ADJUST_ACCOUNT_ID).
 */
function adjust_headers_(token, accountId) {
  var h = { Authorization: 'Bearer ' + token };
  var acc = accountId != null ? accountId : adjust_accountId_();
  if (acc) h['X-Account-ID'] = String(acc);
  return h;
}

function adjust_accountId_() {
  try { return String(sh_settings_(cfg_()).ADJUST_ACCOUNT_ID || '').trim(); } catch (e) { return ''; }
}

function adjust_listApps_(token, fresh) {
  // önbellek anahtarı token + hesap ID'ye bağlı → ikisinden biri değişince eski liste kullanılmaz
  var key = 'ADJ_APPS_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, token + '|' + adjust_accountId_())).slice(0, 12);
  var cache = CacheService.getScriptCache();
  var avail = null;
  if (!fresh) { try { avail = JSON.parse(cache.get(key) || 'null'); } catch (e) {} }
  if (!avail) {
    var y = sh_yesterday_(), from = sh_addDays_(y, -90);
    var url = 'https://automate.adjust.com/reports-service/report?date_period=' + from + ':' + y +
      '&dimensions=app,app_token&metrics=installs';
    var body = fetchJson_(url, { headers: adjust_headers_(token) });
    var seen = {};
    avail = [];
    (body.rows || []).forEach(function (r) {
      if (r.app_token && !seen[r.app_token]) { seen[r.app_token] = 1; avail.push({ t: r.app_token, n: r.app || '' }); }
    });
    cache.put(key, JSON.stringify(avail), 21600);
  }
  return avail;
}

function adjust_resolveApps_(ss, token, configured) {
  var avail = adjust_listApps_(token);
  var ok = configured.filter(function (t) { return avail.some(function (a) { return a.t === t; }); });
  var desc = avail.map(function (a) { return (a.n || '?') + ' (' + a.t + (ok.indexOf(a.t) >= 0 ? ' ✓' : '') + ')'; }).join(', ');
  sh_setState_(ss, 'ADJUST_APPS', (ok.length ? '' : 'UYARI: Settings\'teki app token\'larının hiçbiri bu API token\'ı ile görünmüyor. Token\'ın gördüğü uygulamalar: ') + desc);
  // Başka markanın uygulamalarını asla çekme: eşleşme yoksa dur
  // Hesap ID (X-Account-ID) ile markanın hesabı seçildiyse o hesaptaki tüm uygulamalar markanındır → hepsini kullan
  if (!ok.length && adjust_accountId_() && avail.length) {
    sh_setState_(ss, 'ADJUST_APPS', 'Hesap ' + adjust_accountId_() + ' · Settings token\'ları eşleşmedi, hesaptaki tüm uygulamalar kullanılıyor: ' + desc);
    return avail.map(function (a) { return a.t; });
  }
  if (!ok.length) throw new Error('Adjust API token\'ı Adjust uygulamalarına erişemiyor (görünen: ' + desc + '). Markanın Adjust hesabına erişen API token\'ı girilmeli ya da Durum > Adjust hesap ID doldurulmalı.');
  return ok;
}


/**
 * 0W cohort metrik adlarını bulur (Adjust: W0 = kurulumdan sonraki ilk 7 gün, D0–D6 kümülatif).
 * Adjust API metrik adlarını sabit belgelemediği için adaylar 1 günlük istekle denenir; ilk çalışan
 * Settings > ADJUST_COHORT_PURCHASE_METRIC / ADJUST_COHORT_REVENUE_METRIC'e yazılır (elle de değiştirilebilir).
 */
var ADJ_COHORT_CANDIDATES = {
  rev: ['revenue_total_w0', 'all_revenue_total_w0', 'revenue_w0', 'revenue_total_d6', 'all_revenue_total_d6'],
  pur: ['revenue_events_total_w0', 'revenue_events_w0', 'revenue_events_total_d6', 'revenue_events_d6']
};
function adjust_cohortMetrics_(ss, token, apps) {
  var s = sh_settings_(ss);
  var out = { pur: String(s.ADJUST_COHORT_PURCHASE_METRIC || '').trim(), rev: String(s.ADJUST_COHORT_REVENUE_METRIC || '').trim() };
  if ((out.pur && out.rev) || String(s.ADJUST_COHORT_PROBED || '') === '1') return out;
  var d = sh_addDays_(sh_yesterday_(), -14);
  function ok(metric) {
    var url = 'https://automate.adjust.com/reports-service/report?app_token__in=' + encodeURIComponent(apps.join(',')) +
      '&date_period=' + d + ':' + d + '&dimensions=day&metrics=' + encodeURIComponent(metric) + '&cohort_maturity=immature';
    var res = UrlFetchApp.fetch(url, { headers: adjust_headers_(token), muteHttpExceptions: true });
    return res.getResponseCode() === 200;
  }
  var log = [];
  ['rev', 'pur'].forEach(function (k) {
    if (out[k]) return;
    for (var i = 0; i < ADJ_COHORT_CANDIDATES[k].length; i++) {
      var m = ADJ_COHORT_CANDIDATES[k][i];
      if (ok(m)) { out[k] = m; break; }
      log.push(m + ' ✗');
    }
  });
  if (out.rev) sh_setSetting_(ss, 'ADJUST_COHORT_REVENUE_METRIC', out.rev);
  if (out.pur) sh_setSetting_(ss, 'ADJUST_COHORT_PURCHASE_METRIC', out.pur);
  sh_setSetting_(ss, 'ADJUST_COHORT_PROBED', '1');
  sh_log_(ss, 'adjust', out.rev && out.pur ? 'INFO' : 'WARN', '0W cohort metrikleri: gelir=' + (out.rev || 'bulunamadı') +
    ', satın alma=' + (out.pur || 'bulunamadı') + (log.length ? ' (denenen: ' + log.join(', ') + ')' : ''));
  return out;
}


/**
 * Ad group seviyesi Adjust (adgroup_network). Rapor ad group satırlarını kampanya + ad group adıyla eşleştirir.
 * Ayrı veri seti (adjust_ag, aylık) — kampanya seviyesi veri seti etkilenmez. AG_START_DATE'ten itibaren tutulur.
 */
function adjust_agSync_(ss, from, to) {
  var token = PropertiesService.getScriptProperties().getProperty('ADJUST_TOKEN');
  if (!token) throw new Error('ADJUST_TOKEN tanımlı değil');
  var s = sh_settings_(ss);
  var start = String(s.AG_START_DATE || '2026-01-01');
  if (to < start) return 0;
  if (from < start) from = start;
  var apps = String(s.ADJUST_APP_TOKENS || '').split(',').map(function (x) { return x.trim(); }).filter(String);
  apps = adjust_resolveApps_(ss, token, apps);
  var metrics = ['installs', 'sessions'];
  [s.ADJUST_PURCHASE_METRIC || 'revenue_events', s.ADJUST_REVENUE_METRIC || 'revenue'].forEach(function (m) { m = String(m || '').trim(); if (m && metrics.indexOf(m) < 0) metrics.push(m); });
  var coh = adjust_cohortMetrics_(ss, token, apps);
  if (coh.pur && metrics.indexOf(coh.pur) < 0) metrics.push(coh.pur);
  if (coh.rev && metrics.indexOf(coh.rev) < 0) metrics.push(coh.rev);
  var excl = String(s.ADJUST_EXCLUDE_COUNTRIES || '').toLowerCase().split(',').map(function (x) { return x.trim(); }).filter(String);
  var url = 'https://automate.adjust.com/reports-service/report' +
    '?app_token__in=' + encodeURIComponent(apps.join(',')) +
    '&date_period=' + from + ':' + to +
    '&dimensions=day,app_token,country_code,campaign_network,adgroup_network' +
    '&metrics=' + encodeURIComponent(metrics.join(',')) +
    '&attribution_source=' + encodeURIComponent(s.ADJUST_ATTRIBUTION_SOURCE || 'dynamic') +
    '&attribution_types=' + encodeURIComponent(s.ADJUST_ATTRIBUTION_TYPE || 'click') +
    '&cohort_maturity=immature' +
    '&utc_offset=' + encodeURIComponent(s.ADJUST_UTC_OFFSET || '+03:00');
  var body = fetchJson_(url, { headers: adjust_headers_(token) });
  var NOCAMP = /^(unknown|organic|expired attributions|untrusted devices|google organic search|\(?none\)?|)$/i;
  var agg = {}, order = [];
  (body.rows || []).forEach(function (r) {
    if (excl.indexOf(String(r.country_code || '').toLowerCase()) >= 0) return;
    var camp = String(r.campaign_network || '').trim();
    if (NOCAMP.test(camp)) return; // kampanyasız trafik ad group raporunda yer almaz
    var ag = String(r.adgroup_network || '').trim();
    if (/^unknown$/i.test(ag)) ag = '';
    var k = r.day + '|' + r.app_token + '|' + camp + '|' + ag;
    var a = agg[k];
    if (!a) { a = agg[k] = [sh_dateStr_(r.day), r.app_token || '', camp, ag].concat(metrics.map(function () { return 0; })); order.push(k); }
    metrics.forEach(function (m, i) { a[4 + i] += +r[m] || 0; });
  });
  var rows = order.map(function (k) { return agg[k]; });
  st_upsert_(ss, 'adjust_ag', ['date', 'account_id', 'campaign', 'adgroup'].concat(metrics.map(function (x) {
    return x === coh.pur ? 'cohort_purchases' : x === coh.rev ? 'cohort_revenue' : x; })), rows, { accounts: apps, from: from, to: to }, ['campaign', 'adgroup']);
  return rows.length;
}
