/**
 * GA4 Köprü Script'i
 * ------------------------------------------------------------
 * GA4 yetkisi raporu kuran hesapta değil de başka bir Google hesabındaysa bu script O HESAPLA çalıştırılır.
 * GA4 verisini çekip rapordaki ga4 veri dosyalarına yazar; ana rapor bu veriyi okur.
 *
 * Kurulum (skill clasp ile yapar): ga4-script/project klasörü GA4 yetkisi olan hesaba push edilir,
 *  web uygulaması o hesapla açılıp izin verilir → kurulum() çalışır:
 *   - Brand.js'teki GA4 property'lerini ve erişilebilir property'leri Config > Accounts'a ekler
 *     (adı Brand.js > GA4_PROPERTY_MATCH ile eşleşen ve pazarı tahmin edilenler aktif)
 *   - Saatlik tetikleyiciyi kurar, ilk çekimi başlatır.
 *  Not: Config dosyası bu hesapla da DÜZENLEME yetkisiyle paylaşılmış olmalı.
 *
 * Mantık: Her property için START_DATE'ten düne ay ay backfill (en yeni ay önce); her gün DAILY_REFRESH_HOUR'dan sonra
 * bir kez son GA4_LOOKBACK_DAYS günü yeniler. Veri bugünü içermez.
 * Ana projede Settings > GA4_MODE = external olur; ana proje GA4'ü kendisi çekmeye çalışmaz.
 */

var CONFIG_URL = '__CONFIG_URL__';
var PREFIX = 'GA4X_';
var BUDGET_MS = 300 * 1000; // Apps Script 6 dk sınırı için

/** Web uygulaması olarak açılırsa kurulumu çalıştırır (tek tık kurulum). */
function doGet() {
  var msg;
  try { msg = kurulum(); } catch (e) { msg = 'HATA: ' + (e.message || e); }
  return HtmlService.createHtmlOutput('<div style="font:14px sans-serif;padding:24px;white-space:pre-wrap">' +
    String(msg).replace(/</g, '&lt;') + '</div>').setTitle(BRAND.REPORT_NAME + ' · GA4 köprü');
}

function kurulum() {
  var ss = SpreadsheetApp.openByUrl(CONFIG_URL);
  sh_setSetting_(ss, 'GA4_MODE', 'external');
  sh_seedGa4_(ss);
  ga4_globalSetup_(ss);
  var found = ga4_discover_(ss);
  var have = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'main'; });
  if (!have) ScriptApp.newTrigger('main').timeBased().everyHours(1).create();
  main(90 * 1000);
  var props = sh_accounts_(ss, 'GA4');
  return 'Kurulum tamam.\n\nGA4 property\'leri (Config > Accounts, Platform = GA4):\n' + props.map(function (a) {
    return (a.active ? '✓ ' : '✗ ') + a.id + '  ' + a.name + '  [' + (a.code || '?') + ', ' + (a.currency || '?') + ']';
  }).join('\n') + '\n\n' + found + '\n✓ = rapora giriyor. Yanlış eşleşme varsa Accounts\'ta Aktif kutusunu / Ülke Kodu\'nu düzeltin.\nSaatlik tetikleyici kuruldu; geçmiş veri birkaç saat içinde tamamlanır.';
}

/* ---------- GA4 property keşfi (Analytics Admin API) ---------- */
// Pazar ipuçları Brand.js > MARKETS'tan üretilir: kod, Türkçe/İngilizce ad, alan adı uzantısı
var GA4_COUNTRY_HINTS = (function () {
  var o = {};
  Object.keys(BRAND.MARKETS || {}).forEach(function (c) { var m = BRAND.MARKETS[c]; o[c] = [c, m.en, m.tr, '.' + c.toLowerCase()].filter(Boolean); });
  return o;
})();
var GA4_SINGLE_MARKET = Object.keys(BRAND.MARKETS || {}).length === 1 ? Object.keys(BRAND.MARKETS)[0] : '';

function ga4_guessCountry_(name) {
  var n = ' ' + String(name) + ' ';
  for (var c in GA4_COUNTRY_HINTS) {
    var hit = GA4_COUNTRY_HINTS[c].some(function (h) {
      if (h.length === 2) return new RegExp('(^|[^A-Za-z])' + h + '([^A-Za-z]|$)').test(n); // büyük harf kod
      return n.toLowerCase().indexOf(h.toLowerCase()) >= 0;
    });
    if (hit) return c;
  }
  return GA4_SINGLE_MARKET;
}

/** Erişilebilir tüm GA4 property'lerini Accounts'a ekler (yeni olanları). Adı GA4_PROPERTY_MATCH ile eşleşen ve pazarı bulunanlar aktif, diğerleri pasif. */
function ga4_discover_(ss) {
  var existing = {};
  sh_accounts_(ss, 'GA4').forEach(function (a) { existing[a.id] = 1; });
  var found = [], token = null;
  do {
    var r = AnalyticsAdmin.AccountSummaries.list({ pageSize: 200, pageToken: token || undefined });
    (r.accountSummaries || []).forEach(function (acc) {
      (acc.propertySummaries || []).forEach(function (p) {
        found.push({ id: p.property.split('/')[1], name: p.displayName, account: acc.displayName });
      });
    });
    token = r.nextPageToken;
  } while (token);
  var sh = sh_sheet_(ss, SHEET_NAMES.accounts);
  var added = 0;
  found.forEach(function (p) {
    if (existing[p.id]) return;
    var code = ga4_guessCountry_(p.name + ' ' + p.account);
    var cur = '';
    try { cur = AnalyticsAdmin.Properties.get('properties/' + p.id).currencyCode || ''; } catch (e) {}
    var re = BRAND.GA4_PROPERTY_MATCH ? new RegExp(BRAND.GA4_PROPERTY_MATCH, 'i') : null;
    var active = !!re && !!code && !ga4Excluded_(code) && !/test|server/i.test(p.name) && re.test(p.name + ' ' + p.account);
    var row = sh.getLastRow() + 1;
    sh.getRange(row, 5).setNumberFormat('@');
    sh.getRange(row, 1, 1, 10).setValues([['GA4', code, (BRAND.MARKETS[code] || {}).tr || '', p.name, p.id, '', active, cur, '', 'Otomatik bulundu · hesap: ' + p.account]]);
    sh.getRange(row, 7).insertCheckboxes();
    added++;
  });
  // para birimi boş olan GA4 satırlarını doldur (gelirin USD çevrimi için)
  sh_accounts_(ss, 'GA4').forEach(function (a) {
    if (a.currency) return;
    try { var c = AnalyticsAdmin.Properties.get('properties/' + a.id).currencyCode; if (c) sh.getRange(a.row, 8).setValue(c); } catch (e) {}
  });
  return found.length + ' property bulundu, ' + added + ' yeni satır eklendi.';
}

function main(budget) {
  var t0 = Date.now();
  var LIMIT = typeof budget === 'number' ? budget : BUDGET_MS; // tetikleyici event objesi gönderir → varsayılan
  var ss = SpreadsheetApp.openByUrl(CONFIG_URL);
  var s = sh_settings_(ss);
  if (String(s.GA4_MODE || '').toLowerCase() !== 'external') sh_setSetting_(ss, 'GA4_MODE', 'external');
  var start = s.START_DATE || '2025-01-01';
  var today = sh_yesterday_(); // veri bugünü içermez
  sh_setState_(ss, PREFIX + 'LAST_RUN', sh_now_());
  ga4_globalSetup_(ss);
  s = sh_settings_(ss);
  var gid = String(s.GA4_GLOBAL_PROPERTY || '');
  // Global property önce işlensin (ülke sitelerinin güncel verisi orada)
  var props = sh_accounts_(ss, 'GA4').filter(function (a) { return a.active; })
    .sort(function (a, b) { return (b.id === gid) - (a.id === gid); });
  if (!props.length) { sh_setState_(ss, PREFIX + 'STATUS', 'Config > Accounts\'ta GA4 satırı yok'); return; }

  // 1) Yenileme
  var last = sh_getState_(ss, PREFIX + 'LAST_REFRESH');
  if (sh_dailyDue_(last, +s.DAILY_REFRESH_HOUR || 3)) { // her gün 03:00'ten sonra bir kez
    var from = sh_addDays_(today, -(+s.GA4_LOOKBACK_DAYS || 3));
    if (from < start) from = start;
    var allOk = true;
    props.forEach(function (p) {
      sh_setState_(ss, PREFIX + 'PHASE', 'yenileme ' + p.id + ' başladı ' + sh_now_());
      try { ga4_sync_(ss, p.id, from, today); }
      catch (e) { allOk = false; sh_log_(ss, 'ga4x', 'ERROR', p.id + ' yenileme: ' + (e.message || e)); }
    });
    if (allOk) sh_setState_(ss, PREFIX + 'LAST_REFRESH', sh_now_());
  }

  // 1b) Ad group seviyesi (global property): günlük yenileme + AG_START_DATE'e kadar aylık backfill
  if (gid) {
    var agStart = String(s.AG_START_DATE || '2026-01-01');
    var agLast = sh_getState_(ss, PREFIX + 'AG_LAST_REFRESH');
    if (sh_dailyDue_(agLast, +s.DAILY_REFRESH_HOUR || 3) && Date.now() - t0 < LIMIT) {
      try { ga4_agSync_(ss, sh_addDays_(today, -(+s.GA4_LOOKBACK_DAYS || 3)), today); sh_setState_(ss, PREFIX + 'AG_LAST_REFRESH', sh_now_()); }
      catch (e) { sh_log_(ss, 'ga4x', 'ERROR', 'ad group yenileme: ' + (e.message || e)); }
    }
    var agc = sh_getState_(ss, PREFIX + 'AG_CURSOR') || today.slice(0, 7);
    while (agc >= agStart.slice(0, 7) && Date.now() - t0 < LIMIT * 0.6) {
      var aFrom = agc + '-01', aTo = sh_monthEnd_(aFrom);
      if (aTo > today) aTo = today;
      try {
        sh_setState_(ss, PREFIX + 'PHASE', 'ad group backfill ' + aFrom + ' başladı ' + sh_now_());
        var an = ga4_agSync_(ss, aFrom, aTo);
        sh_log_(ss, 'ga4x', 'INFO', 'ad group ' + aFrom + '→' + aTo + ': ' + an + ' satır');
      } catch (e) { sh_log_(ss, 'ga4x', 'ERROR', 'ad group ' + aFrom + ': ' + (e.message || e)); break; }
      agc = sh_addDays_(aFrom, -1).slice(0, 7);
      sh_setState_(ss, PREFIX + 'AG_CURSOR', agc);
    }
  }
  // 2) Backfill (property başına ay imleci)
  var pending = 0;
  for (var i = 0; i < props.length; i++) {
    var key = PREFIX + 'CURSOR_' + props[i].id;
    var cursor = sh_getState_(ss, key) || today.slice(0, 7);
    while (cursor >= start.slice(0, 7)) {
      if (Date.now() - t0 > LIMIT) break;
      var mFrom = cursor + '-01', mTo = sh_monthEnd_(mFrom);
      if (mTo > today) mTo = today;
      if (mFrom < start) mFrom = start;
      try {
        sh_setState_(ss, PREFIX + 'PHASE', 'backfill ' + props[i].id + ' ' + mFrom + ' başladı ' + sh_now_());
        var n = ga4_sync_(ss, props[i].id, mFrom, mTo);
        sh_log_(ss, 'ga4x', 'INFO', props[i].id + ' ' + mFrom + '→' + mTo + ': ' + n + ' satır');
      } catch (e) {
        sh_log_(ss, 'ga4x', 'ERROR', props[i].id + ' ' + mFrom + ': ' + (e.message || e));
        break; // bu property'yi sonraki çalıştırmada tekrar dene
      }
      cursor = sh_addDays_(mFrom.slice(0, 7) + '-01', -1).slice(0, 7);
      sh_setState_(ss, key, cursor);
    }
    if (cursor >= start.slice(0, 7)) pending++;
  }
  sh_setState_(ss, PREFIX + 'PHASE', 'bitti ' + sh_now_());
  sh_setState_(ss, PREFIX + 'STATUS', props.length + ' property · ' + (pending ? 'backfill devam ediyor (' + pending + ')' : 'backfill tamam'));
}

/**
 * Brand.js > GA4_GLOBAL_PROPERTY: tüm pazarları içeren property ülke kırılımıyla (countryId) çekilir.
 * Pazar property'leri de çekilmeye devam eder; rapor aynı gün + ülke için global veri varsa pazar property'sini yok sayar.
 */
function ga4_globalSetup_(ss) {
  var gid = String(BRAND.GA4_GLOBAL_PROPERTY || '').trim();
  if (!gid || sh_getState_(ss, PREFIX + 'GLOBAL_V1') === gid) return;
  sh_setSetting_(ss, 'GA4_GLOBAL_PROPERTY', gid);
  var sh = sh_sheet_(ss, SHEET_NAMES.accounts);
  var acc = sh_accounts_(ss, 'GA4').filter(function (a) { return a.id === gid; })[0];
  if (acc) {
    sh.getRange(acc.row, 6).setValue('Global (ülke kırılımlı)');
    sh.getRange(acc.row, 7).setValue(true);
    if (!acc.currency) { try { var c = AnalyticsAdmin.Properties.get('properties/' + gid).currencyCode; if (c) sh.getRange(acc.row, 8).setValue(c); } catch (e) {} }
  } else {
    var row = sh.getLastRow() + 1;
    sh.getRange(row, 5).setNumberFormat('@');
    sh.getRange(row, 1, 1, 10).setValues([['GA4', '', '', BRAND.REPORT_NAME + ' GA4', gid, 'Global (ülke kırılımlı)', true, '', '', 'Pazarlar ülke kırılımıyla ayrılır']]);
    sh.getRange(row, 7).insertCheckboxes();
  }
  sh_setState_(ss, PREFIX + 'GLOBAL_V1', gid);
  sh_log_(ss, 'ga4x', 'INFO', 'Global GA4 (' + gid + ') eklendi, ülke kırılımıyla backfill başlıyor');
}

function tsOf_(s) {
  var m = /(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/.exec(s);
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime() : 0;
}


