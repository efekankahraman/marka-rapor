/**
 * Sync.js — Meta / Adjust / GA4 çekim kuyruğu ve zamanlayıcı.
 * runSync() her 10 dakikada bir tetiklenir; kuyruktaki işleri ~4.5 dk boyunca işler.
 */

var QUEUE_HEADER = ['source', 'account_id', 'from', 'to', 'status', 'attempts', 'message', 'updated_at'];
var SYNC_BUDGET_MS = 270 * 1000;
var MAX_ATTEMPTS = 4;

function runSync() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(2000)) return 'busy';
  var t0 = Date.now();
  try {
    var ss = cfg_();
    // Brand.js / kod güncellemesiyle yeni ayar anahtarları geldiyse Config'e ekle
    var pp = PropertiesService.getScriptProperties();
    if (pp.getProperty('SETTINGS_V') !== String(DEFAULT_SETTINGS.length)) { ensureSettings_(ss); pp.setProperty('SETTINGS_V', String(DEFAULT_SETTINGS.length)); }
    // İlk çalıştırma: kurlar hemen gelsin (USD çevrimi), günlük yenileme saatini beklemesin
    if (pp.getProperty('FX_INIT') !== '1') {
      try { fx_sync_(ss); pp.setProperty('FX_INIT', '1'); } catch (e) { sh_log_(ss, 'fx', 'ERROR', e.message || e); }
      t0 = Date.now();
    }
    maybeDaily_(ss);
    try { guests_sync_(ss); } catch (e) { sh_log_(ss, 'guests', 'ERROR', e.message || e); }
    try { probe_status_(ss); } catch (e) {}
    // Önce kuyruk (küp kurulumu 2-7 dk sürebildiği için önce kurulursa kuyruğa zaman kalmıyordu)
    var r = processQueue_(ss, t0);
    // sonra rapor küpü: veri dosyaları güncellendiyse yeniden kur (eşleştirme burada bir kez yapılır)
    try { cube_maybeRebuild_(ss); } catch (e) { sh_log_(ss, 'cube', 'ERROR', e.message || e); }
    return r;
  } finally {
    lock.releaseLock();
  }
}

/** Günlük: FX güncelle + son N günü kuyruğa al (saat DAILY_REFRESH_HOUR sonrasında, günde bir kez). */
function maybeDaily_(ss) {
  var props = PropertiesService.getScriptProperties();
  var today = sh_today_();
  var hour = +Utilities.formatDate(new Date(), SHARED_TZ, 'H');
  var s = sh_settings_(ss);
  if (props.getProperty('LAST_DAILY') === today || hour < +(s.DAILY_REFRESH_HOUR || 3)) return;
  try { fx_sync_(ss); } catch (e) { sh_log_(ss, 'fx', 'ERROR', e.message || e); }
  enqueueRecent_(ss, ['meta', 'adjust', 'adjust_ag', 'ga4', 'ga4_ag']);
  props.setProperty('LAST_DAILY', today);
  props.setProperty('LAST_DAILY_AT', sh_now_());
}

/* ---------------- kuyruk ---------------- */

function queueSheet_(ss) { return sh_sheet_(ss, SHEET_NAMES.queue); }

function readQueue_(ss) {
  var sh = queueSheet_(ss);
  var vals = sh.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < vals.length; i++) {
    var r = vals[i];
    if (!r[0]) continue;
    out.push({ row: i + 1, source: String(r[0]), account: String(r[1]), from: sh_dateStr_(r[2]), to: sh_dateStr_(r[3]),
      status: String(r[4]), attempts: +r[5] || 0, message: String(r[6] || '') });
  }
  return out;
}

function enqueue_(ss, items) {
  if (!items.length) return 0;
  var q = readQueue_(ss);
  var pending = {};
  q.forEach(function (it) { if (it.status === 'pending') pending[[it.source, it.account, it.from, it.to].join('|')] = 1; });
  var rows = [];
  items.forEach(function (it) {
    var k = [it.source, it.account, it.from, it.to].join('|');
    if (pending[k]) return;
    pending[k] = 1;
    rows.push([it.source, it.account, it.from, it.to, 'pending', '0', '', sh_now_()]);
  });
  if (rows.length) {
    var sh = queueSheet_(ss);
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, QUEUE_HEADER.length).setNumberFormat('@').setValues(rows);
  }
  compactQueue_(ss);
  return rows.length;
}

/** Tamamlanmış eski kayıtları temizler (son 300 done kalır). */
function compactQueue_(ss) {
  var sh = queueSheet_(ss);
  var vals = sh.getDataRange().getValues();
  if (vals.length < 1500) return;
  var head = vals[0], body = vals.slice(1);
  var done = body.filter(function (r) { return r[4] === 'done'; });
  var keep = body.filter(function (r) { return r[4] !== 'done'; }).concat(done.slice(-300));
  sh.getRange(2, 1, sh.getMaxRows() - 1, head.length).clearContent();
  if (keep.length) sh.getRange(2, 1, keep.length, head.length).setValues(keep);
}

function sourceTargets_(ss, source) {
  if (source === 'meta') return sh_accounts_(ss, 'Meta').filter(function (a) { return a.active; }).map(function (a) { return a.id; });
  if (source === 'ga4' && ga4External_(ss)) return []; // GA4 köprü script'i (başka hesap) çekiyor
  if (source === 'ga4') return sh_accounts_(ss, 'GA4').filter(function (a) { return a.active; }).map(function (a) { return a.id; });
  if (source === 'adjust' || source === 'adjust_ag') return sh_settings_(ss).ADJUST_APP_TOKENS ? ['ALL'] : [];
  if (source === 'ga4_ag') return !ga4External_(ss) && String(sh_settings_(ss).GA4_GLOBAL_PROPERTY || '').trim() ? ['ALL'] : [];
  return [];
}

function ga4External_(ss) {
  return String(sh_settings_(ss).GA4_MODE || '').toLowerCase() === 'external';
}

function sourceReady_(source) {
  var p = PropertiesService.getScriptProperties();
  if (source === 'meta') return !!p.getProperty('META_TOKEN');
  if (source === 'adjust' || source === 'adjust_ag') return !!p.getProperty('ADJUST_TOKEN');
  return true;
}

/** START_DATE'ten bugüne ay ay backfill (en yeni ay önce). */
function enqueueBackfill_(ss, sources, start) {
  var s = sh_settings_(ss);
  var months = sh_splitMonths_(start || s.START_DATE || '2025-01-01', sh_yesterday_()).reverse();
  var items = [];
  sources.forEach(function (src) {
    var targets = sourceTargets_(ss, src);
    months.forEach(function (m) {
      targets.forEach(function (t) { items.push({ source: src, account: t, from: m.from, to: m.to }); });
    });
  });
  return enqueue_(ss, items);
}

function enqueueRecent_(ss, sources) {
  var s = sh_settings_(ss);
  var today = sh_yesterday_(); // veri bugünü içermez
  var lb = { meta: +s.META_LOOKBACK_DAYS || 7, adjust: +s.ADJUST_LOOKBACK_DAYS || 7, adjust_ag: +s.ADJUST_LOOKBACK_DAYS || 7, ga4: +s.GA4_LOOKBACK_DAYS || 3, ga4_ag: +s.GA4_LOOKBACK_DAYS || 3 };
  var items = [];
  sources.forEach(function (src) {
    var from = sh_addDays_(today, -lb[src]);
    if (from < s.START_DATE) from = s.START_DATE;
    sourceTargets_(ss, src).forEach(function (t) { items.push({ source: src, account: t, from: from, to: today }); });
  });
  // yenileme işleri kuyruğun başına alınsın diye ayrı yazıyoruz
  return enqueue_(ss, items);
}

/** Kuyruğun sonuna satır ekler (compact yapmaz → işlenmekte olan satır numaraları kaymaz). */
function appendQueueRows_(ss, list) {
  var sh = queueSheet_(ss);
  var rows = list.map(function (x) { return [x[0], x[1], x[2], x[3], 'pending', '0', '', sh_now_()]; });
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, QUEUE_HEADER.length).setNumberFormat('@').setValues(rows);
}

function sh_daysBetween_(a, b) {
  return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
}

function setQueueRow_(ss, it, status, attempts, message) {
  queueSheet_(ss).getRange(it.row, 5, 1, 4).setValues([[status, String(attempts), String(message || '').slice(0, 1000), sh_now_()]]);
}

function processQueue_(ss, t0) {
  var all = readQueue_(ss).filter(function (it) { return it.status === 'pending'; });
  // Sıra: önce günlük yenileme (dünü kapsayan) işleri, sonra kaynaklar arasında sırayla (round-robin)
  // → Adjust / GA4 işleri yüzlerce Meta backfill işinin arkasında beklemez
  var y = sh_yesterday_();
  // önce son ~31 günü kapsayan işler (rapor varsayılan olarak son 30 günle açılır), yeniden eskiye
  var recent = all.filter(function (it) { return it.to >= sh_addDays_(y, -31); })
    .sort(function (a, b) { return a.to < b.to ? 1 : a.to > b.to ? -1 : 0; });
  var rest = all.filter(function (it) { return recent.indexOf(it) < 0; });
  var bySrc = {}, srcs = [];
  rest.forEach(function (it) { if (!bySrc[it.source]) { bySrc[it.source] = []; srcs.push(it.source); } bySrc[it.source].push(it); });
  var q = recent.slice(), more = true;
  for (var r = 0; more; r++) {
    more = false;
    srcs.forEach(function (sc) { if (bySrc[sc][r]) { q.push(bySrc[sc][r]); more = true; } });
  }
  // Meta: sıradaki birkaç işin async raporunu şimdiden paralel başlat (Meta tarafında aynı anda hazırlanır)
  try { meta_prestart_(ss, q.filter(function (it) { return it.source === 'meta' && !/^run:/.test(it.message); }).slice(0, 6)); }
  catch (e) { sh_log_(ss, 'meta', 'WARN', 'Paralel başlatma: ' + (e.message || e)); }
  var done = 0, failed = 0;
  for (var i = 0; i < q.length; i++) {
    if (Date.now() - t0 > SYNC_BUDGET_MS) break;
    var it = q[i];
    if (!sourceReady_(it.source)) continue;
    if ((it.source === 'ga4' || it.source === 'ga4_ag') && ga4External_(ss)) { setQueueRow_(ss, it, 'done', it.attempts, 'GA4 köprü script\'i çekiyor (atlandı)'); continue; }
    try {
      var n = runItem_(ss, it, t0);
      setQueueRow_(ss, it, 'done', it.attempts + 1, n + ' satır');
      done++;
    } catch (e) {
      var msg = (e && e.message) || String(e);
      // Meta: "reduce the amount of data" → tarih aralığını ikiye böl, yeni işler olarak kuyruğa ekle
      if (it.source === 'meta' && /reduce the amount of data/i.test(msg) && it.from < it.to) {
        var mid = sh_addDays_(it.from, Math.floor(sh_daysBetween_(it.from, it.to) / 2));
        appendQueueRows_(ss, [[it.source, it.account, it.from, mid], [it.source, it.account, sh_addDays_(mid, 1), it.to]]);
        setQueueRow_(ss, it, 'done', it.attempts + 1, 'bölündü: ' + it.from + '→' + mid + ' + ' + sh_addDays_(mid, 1) + '→' + it.to);
        sh_log_(ss, 'meta', 'INFO', it.account + ' ' + it.from + '→' + it.to + ': veri çok büyük, ikiye bölündü');
        continue;
      }
      var keepRun = it.runId ? 'run:' + it.runId + ' ' : '';
      var att = it.attempts + 1;
      var retryable = /timeout|zaman aşımı|rate|limit|too many|temporar|503|500|429|#17|#4|#80004|#613/i.test(msg);
      var status = /Adjust uygulamalarına erişemiyor/.test(msg) ? 'error' : att >= MAX_ATTEMPTS && !retryable ? 'error' : (att >= MAX_ATTEMPTS * 3 ? 'error' : 'pending');
      setQueueRow_(ss, it, status, att, keepRun + msg);
      sh_log_(ss, it.source, status === 'error' ? 'ERROR' : 'WARN', it.account + ' ' + it.from + '→' + it.to + ': ' + msg);
      failed++;
      if (/rate|limit|too many|#17|#4|#80004|#613|429/i.test(msg)) break; // rate limit: bu turu bitir
    }
  }
  return { done: done, failed: failed, pending: q.length - done };
}

function runItem_(ss, it, t0) {
  var m = /^run:(\S+)/.exec(it.message);
  it.runId = m ? m[1] : null;
  if (it.source === 'meta') return meta_sync_(ss, it, t0);
  if (it.source === 'adjust') return adjust_sync_(ss, it.from, it.to);
  if (it.source === 'adjust_ag') return adjust_agSync_(ss, it.from, it.to);
  if (it.source === 'ga4') return ga4_sync_(ss, it.account, it.from, it.to);
  if (it.source === 'ga4_ag') return ga4_agSync_(ss, it.from, it.to);
  throw new Error('Bilinmeyen kaynak ' + it.source);
}

/* ---------------- HTTP yardımcı ---------------- */

function fetchJson_(url, opts) {
  opts = opts || {};
  opts.muteHttpExceptions = true;
  var res = UrlFetchApp.fetch(url, opts);
  var code = res.getResponseCode();
  var text = res.getContentText();
  var body;
  try { body = JSON.parse(text); } catch (e) { body = null; }
  if (code >= 300) {
    var msg = body && body.error ? (body.error.message || JSON.stringify(body.error)) + (body.error.code ? ' #' + body.error.code : '') : text.slice(0, 500);
    throw new Error('HTTP ' + code + ': ' + msg);
  }
  if (body === null) throw new Error('JSON parse hatası: ' + text.slice(0, 300));
  return body;
}

/* ---------------- FX (1 USD = X birim) ---------------- */

/**
 * Kaynak: https://github.com/fawazahmed0/exchange-api (ücretsiz, anahtarsız, günlük tarihçe).
 * FX sekmesi: date | EUR | TRY | ... (1 USD karşılığı birim).
 */
function fx_sync_(ss) {
  var s = sh_settings_(ss);
  var curs = {};
  String(s.FX_CURRENCIES || '').split(',').forEach(function (c) { c = c.trim().toUpperCase(); if (c && c !== 'USD') curs[c] = 1; });
  sh_accounts_(ss).forEach(function (a) { if (a.currency && a.currency !== 'USD') curs[a.currency] = 1; });
  var list = Object.keys(curs).sort();

  var sh = sh_sheet_(ss, SHEET_NAMES.fx);
  var ex = st_readSheet_(sh);
  var map = {};
  ex.rows.forEach(function (r) {
    var o = {};
    ex.header.forEach(function (h, i) { if (i > 0 && r[i] !== '' && r[i] !== null) o[h] = +r[i]; });
    map[r[0]] = o;
  });
  var start = s.START_DATE || '2025-01-01', today = sh_today_();
  var missing = [];
  for (var d = start; d <= today; d = sh_addDays_(d, 1)) {
    var o2 = map[d];
    var need = !o2 || list.some(function (c) { return !(c in o2); }) || d >= sh_addDays_(today, -2);
    if (need) missing.push(d);
  }
  var t0 = Date.now();
  for (var i = 0; i < missing.length && Date.now() - t0 < 150000; i += 25) {
    var batch = missing.slice(i, i + 25);
    var reqs = batch.map(function (day) {
      return { url: 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@' + day + '/v1/currencies/usd.min.json', muteHttpExceptions: true };
    });
    var resps = UrlFetchApp.fetchAll(reqs);
    resps.forEach(function (res, k) {
      var day = batch[k];
      var body = null;
      if (res.getResponseCode() === 200) { try { body = JSON.parse(res.getContentText()); } catch (e) {} }
      if (!body) {
        try {
          var r2 = UrlFetchApp.fetch('https://' + day + '.currency-api.pages.dev/v1/currencies/usd.min.json', { muteHttpExceptions: true });
          if (r2.getResponseCode() === 200) body = JSON.parse(r2.getContentText());
        } catch (e) {}
      }
      if (!body || !body.usd) return;
      var o3 = map[day] || {};
      list.forEach(function (c) { var v = body.usd[c.toLowerCase()]; if (v) o3[c] = v; });
      map[day] = o3;
    });
  }
  var days = Object.keys(map).sort();
  var header = ['date'].concat(list);
  var rows = days.map(function (dd) { return [dd].concat(list.map(function (c) { return map[dd][c] || ''; })); });
  st_writeSheet_(sh, header, rows, ['date']);
  sh_log_(ss, 'fx', 'INFO', 'FX güncellendi: ' + list.join(',') + ' / ' + rows.length + ' gün');
  return rows.length;
}

/** {date: {CUR: perUsd}} + ileri doldurma fonksiyonu */
function fx_loader_(ss) {
  var ex = st_readSheet_(sh_sheet_(ss, SHEET_NAMES.fx));
  var map = {};
  ex.rows.forEach(function (r) {
    var o = {};
    ex.header.forEach(function (h, i) { if (i > 0 && r[i] !== '' && +r[i] > 0) o[h] = +r[i]; });
    map[r[0]] = o;
  });
  var days = Object.keys(map).sort();
  var cache = {};
  return function perUsd(date, cur) {
    if (!cur || cur === 'USD') return 1;
    var k = date + cur;
    if (k in cache) return cache[k];
    var v = map[date] && map[date][cur];
    if (!v) {
      // en yakın önceki gün, yoksa ilk bilinen
      var lo = 0, hi = days.length - 1, idx = -1;
      while (lo <= hi) { var mid = (lo + hi) >> 1; if (days[mid] <= date) { idx = mid; lo = mid + 1; } else hi = mid - 1; }
      for (var j = idx; j >= 0 && !v; j--) v = map[days[j]][cur];
      for (var j2 = Math.max(idx, 0); j2 < days.length && !v; j2++) v = map[days[j2]][cur];
    }
    cache[k] = v || null;
    return cache[k];
  };
}
