/**
 * Shared.js — ortak veri katmanı.
 * Bu dosya hem Apps Script projesinde hem de Google Ads script'inde (build ile gömülü) çalışır.
 * Sadece SpreadsheetApp / DriveApp / Utilities / Logger kullanır.
 *
 * Veri modeli
 *  - Config spreadsheet: Accounts, Settings, State, Registry, Queue, FX, Log sekmeleri
 *  - Her veri seti "shard" dosyalarına bölünür (yıllık ya da aylık ayrı Google Sheets dosyaları)
 *  - Tüm veri setlerinde 1. kolon = date (YYYY-MM-DD), 2. kolon = account_id
 */

var SHARED_TZ = (typeof BRAND !== 'undefined' && BRAND.TIMEZONE) || 'Europe/Istanbul';

var STORE_DATASETS = {
  gads_campaign: { shard: 'year',  title: 'Google Ads · Kampanya · Günlük' },
  gads_ad:       { shard: 'month', title: 'Google Ads · Ad · Günlük' },
  gads_campaign_2: { shard: 'year',  title: 'Google Ads (MCC 2) · Kampanya · Günlük' },
  gads_ad_2:       { shard: 'month', title: 'Google Ads (MCC 2) · Ad · Günlük' },
  meta_campaign: { shard: 'year',  title: 'Meta · Kampanya · Günlük' },
  meta_ad:       { shard: 'month', title: 'Meta · Ad · Günlük' },
  adjust:        { shard: 'month', title: 'Adjust · Kampanya · Günlük' },
  ga4:           { shard: 'year',  title: 'GA4 · Günlük' },
  adjust_ag:     { shard: 'month', title: 'Adjust · Ad group · Günlük' },
  ga4_ag:        { shard: 'month', title: 'GA4 · Ad group · Günlük' }
};

var SHEET_NAMES = {
  accounts: 'Accounts', settings: 'Settings', state: 'State', registry: 'Registry',
  queue: 'Queue', fx: 'FX', log: 'Log'
};

var ACCOUNT_HEADER = ['Platform', 'Ülke Kodu', 'Ülke', 'Hesap Adı', 'Hesap ID', 'Tip', 'Aktif', 'Para Birimi', 'Son Senkron', 'Not'];
var REGISTRY_HEADER = ['dataset', 'period', 'file_id', 'url', 'rows', 'updated_at'];

/* ---------------- küçük yardımcılar ---------------- */

function sh_today_() {
  return Utilities.formatDate(new Date(), SHARED_TZ, 'yyyy-MM-dd');
}

/** Veri bugünü içermez: çekimler en fazla dünü kapsar. */
function sh_yesterday_() { return sh_addDays_(sh_today_(), -1); }

/** Günlük yenileme: bugün henüz yapılmadıysa ve saat >= hour (İstanbul) ise true. */
function sh_dailyDue_(lastTs, hour) {
  var today = sh_today_();
  var h = +Utilities.formatDate(new Date(), SHARED_TZ, 'H');
  return h >= hour && String(lastTs || '').slice(0, 10) !== today;
}

function sh_now_() {
  return Utilities.formatDate(new Date(), SHARED_TZ, 'yyyy-MM-dd HH:mm:ss');
}

/** Hücre değerini YYYY-MM-DD string'e çevirir (Date objesi gelirse de). */
function sh_dateStr_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, SHARED_TZ, 'yyyy-MM-dd');
  var s = String(v);
  if (/^\d{8}$/.test(s)) return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8);
  return s.slice(0, 10);
}

/** 'YYYY-MM-DD' + n gün */
function sh_addDays_(dateStr, n) {
  var p = dateStr.split('-');
  var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function sh_monthStart_(dateStr) { return dateStr.slice(0, 7) + '-01'; }

function sh_monthEnd_(dateStr) {
  var p = dateStr.split('-');
  var d = new Date(Date.UTC(+p[0], +p[1], 0));
  return d.toISOString().slice(0, 10);
}

/** [from,to] aralığını ay parçalarına böler → [{from,to}] */
function sh_splitMonths_(from, to) {
  var out = [];
  var cur = sh_monthStart_(from);
  while (cur <= to) {
    var a = cur < from ? from : cur;
    var e = sh_monthEnd_(cur);
    var b = e > to ? to : e;
    out.push({ from: a, to: b });
    cur = sh_addDays_(e, 1);
  }
  return out;
}

/* ---------------- config sheet erişimi ---------------- */

function sh_sheet_(ss, name) {
  var s = ss.getSheetByName(name);
  if (!s) throw new Error('Config içinde "' + name + '" sekmesi yok.');
  return s;
}

/** Settings sekmesi → {KEY: value} */
function sh_settings_(ss) {
  var vals = sh_sheet_(ss, SHEET_NAMES.settings).getDataRange().getValues();
  var out = {};
  for (var i = 1; i < vals.length; i++) {
    if (vals[i][0] !== '') out[String(vals[i][0]).trim()] = vals[i][1] instanceof Date ? sh_dateStr_(vals[i][1]) : String(vals[i][1]).trim();
  }
  return out;
}

function sh_setSetting_(ss, key, value) {
  var sh = sh_sheet_(ss, SHEET_NAMES.settings);
  var vals = sh.getDataRange().getValues();
  for (var i = 1; i < vals.length; i++) {
    if (String(vals[i][0]).trim() === key) { sh.getRange(i + 1, 2).setValue(value); return; }
  }
  sh.appendRow([key, value, '']);
}

/** State sekmesi (key/value) */
function sh_getState_(ss, key) {
  var vals = sh_sheet_(ss, SHEET_NAMES.state).getDataRange().getValues();
  for (var i = 1; i < vals.length; i++) if (String(vals[i][0]) === key) {
    var v = vals[i][1];
    // Sheets "2026-10-14 19:38:05" / "2026-10" gibi değerleri Date'e çevirebiliyor → string'e geri çevir
    if (v instanceof Date) {
      var hms = Utilities.formatDate(v, SHARED_TZ, 'HH:mm:ss'), d = Utilities.formatDate(v, SHARED_TZ, 'dd');
      if (hms !== '00:00:00') return Utilities.formatDate(v, SHARED_TZ, 'yyyy-MM-dd HH:mm:ss');
      return Utilities.formatDate(v, SHARED_TZ, d === '01' ? 'yyyy-MM' : 'yyyy-MM-dd'); // ay imleçleri ("2026-10") ayın 1'i olarak okunur
    }
    return String(v);
  }
  return '';
}

function sh_setState_(ss, key, value) {
  var sh = sh_sheet_(ss, SHEET_NAMES.state);
  var vals = sh.getDataRange().getValues();
  for (var i = 1; i < vals.length; i++) {
    if (String(vals[i][0]) === key) { sh.getRange(i + 1, 2, 1, 2).setNumberFormat('@').setValues([[String(value), sh_now_()]]); return; }
  }
  var r = sh.getLastRow() + 1;
  sh.getRange(r, 1, 1, 3).setNumberFormat('@').setValues([[key, String(value), sh_now_()]]);
}

/** Log sekmesine satır ekler (en fazla ~3000 satır tutar). */
function sh_log_(ss, source, level, message) {
  try {
    Logger.log('[' + source + '][' + level + '] ' + message);
    var sh = ss.getSheetByName(SHEET_NAMES.log);
    if (!sh) return;
    sh.appendRow([sh_now_(), source, level, String(message).slice(0, 4000)]);
    var n = sh.getLastRow();
    if (n > 3500) sh.deleteRows(2, n - 3000);
  } catch (e) { Logger.log('log error: ' + e); }
}

/** Accounts sekmesi → [{platform, code, country, name, id, tip, active, currency, row}] */
function sh_accounts_(ss, platform) {
  var vals = sh_sheet_(ss, SHEET_NAMES.accounts).getDataRange().getValues();
  var out = [];
  for (var i = 1; i < vals.length; i++) {
    var r = vals[i];
    if (!r[0] || !r[4]) continue;
    var a = {
      platform: String(r[0]).trim(), code: String(r[1]).trim().toUpperCase(), country: String(r[2]).trim(),
      name: String(r[3]).trim(), id: String(r[4]).trim().replace(/^act_/, ''), tip: String(r[5]).trim(),
      active: !(r[6] === false || String(r[6]).toUpperCase() === 'FALSE' || String(r[6]).toUpperCase() === 'HAYIR'),
      currency: String(r[7]).trim().toUpperCase(), row: i + 1
    };
    if (platform && a.platform !== platform) continue;
    out.push(a);
  }
  return out;
}

/** Hesapların para birimi / son senkron bilgisini günceller. updates: {id: {currency}} */
function sh_updateAccounts_(ss, platform, updates) {
  var sh = sh_sheet_(ss, SHEET_NAMES.accounts);
  var accts = sh_accounts_(ss, platform);
  var now = sh_now_();
  accts.forEach(function (a) {
    var u = updates[a.id];
    if (!u) return;
    if (u.currency) sh.getRange(a.row, 8).setValue(u.currency);
    sh.getRange(a.row, 9).setValue(now);
  });
}

/* ---------------- registry + shard dosyaları ---------------- */

function st_registry_(ss) {
  var sh = sh_sheet_(ss, SHEET_NAMES.registry);
  var vals = sh.getDataRange().getValues();
  var map = {};
  for (var i = 1; i < vals.length; i++) {
    if (!vals[i][0]) continue;
    map[vals[i][0] + '|' + String(vals[i][1])] = { dataset: vals[i][0], period: String(vals[i][1]), fileId: vals[i][2], url: vals[i][3], rows: vals[i][4], updated: vals[i][5], row: i + 1 };
  }
  return map;
}

function st_periodOf_(shard, date) { return shard === 'year' ? date.slice(0, 4) : date.slice(0, 7); }

/** [from,to] ile kesişen shard periyotları */
function st_periodsInRange_(shard, from, to) {
  var out = [];
  if (shard === 'year') {
    for (var y = +from.slice(0, 4); y <= +to.slice(0, 4); y++) out.push(String(y));
  } else {
    sh_splitMonths_(from, to).forEach(function (m) { out.push(m.from.slice(0, 7)); });
  }
  return out;
}

/** Shard dosyasını açar; yoksa (create=true ise) oluşturup data klasörüne taşır ve registry'ye yazar. */
function st_getShard_(ss, dataset, period, create) {
  var reg = st_registry_(ss);
  var hit = reg[dataset + '|' + period];
  if (hit && hit.fileId) {
    try { return SpreadsheetApp.openById(hit.fileId); } catch (e) { if (!create) return null; }
  }
  if (!create) return null;
  var def = STORE_DATASETS[dataset];
  var name = ((typeof BRAND !== 'undefined' && BRAND.REPORT_NAME) || 'Rapor') + ' | ' + def.title + ' | ' + period;
  var nss = SpreadsheetApp.create(name);
  var folderId = sh_settings_(ss).DATA_FOLDER_ID;
  if (folderId) {
    try {
      var file = DriveApp.getFileById(nss.getId());
      var folder = DriveApp.getFolderById(folderId);
      try { file.moveTo(folder); } catch (e1) { folder.addFile(file); DriveApp.getRootFolder().removeFile(file); }
    } catch (e2) { sh_log_(ss, 'store', 'WARN', 'Dosya klasöre taşınamadı: ' + e2); }
  }
  var sheet = nss.getSheets()[0];
  sheet.setName('data');
  sh_sheet_(ss, SHEET_NAMES.registry).appendRow([dataset, "'" + period, nss.getId(), nss.getUrl(), 0, sh_now_()]);
  return nss;
}

function st_touchRegistry_(ss, dataset, period, rows) {
  var reg = st_registry_(ss);
  var hit = reg[dataset + '|' + period];
  if (hit) sh_sheet_(ss, SHEET_NAMES.registry).getRange(hit.row, 5, 1, 2).setValues([[rows, sh_now_()]]);
}

/** Sheet'i header + satırlar olarak okur. */
function st_readSheet_(sheet) {
  var lr = sheet.getLastRow(), lc = sheet.getLastColumn();
  if (lr < 1 || lc < 1) return { header: [], rows: [] };
  var vals = sheet.getRange(1, 1, lr, lc).getValues();
  var header = vals[0].map(String);
  var rows = vals.slice(1);
  for (var i = 0; i < rows.length; i++) {
    if (!(typeof rows[i][0] === 'string' && rows[i][0].length === 10)) rows[i][0] = sh_dateStr_(rows[i][0]);
    rows[i][1] = String(rows[i][1]);
  }
  return { header: header, rows: rows };
}

function st_remapFn_(from, to) {
  var idx = to.map(function (h) { return from.indexOf(h); });
  var same = from.length === to.length && idx.every(function (v, i) { return v === i; });
  if (same) return function (r) { return r; };
  return function (r) { return idx.map(function (j) { return j < 0 ? '' : r[j]; }); };
}

/** Sheet'i header + rows ile baştan yazar; boyutu tam ayarlar (hücre limitini korumak için). */
/**
 * Sheet'i header + satırlarla yeniden yazar. GÜVENLİ SIRA: önce yeni veri mevcut satırların ÜZERİNE yazılır,
 * fazlalık satır/kolonlar en sonda silinir. (Eskiden önce siliniyordu; Sheets servis hatası araya girince
 * dosya boş kalıyor ve veri kayboluyordu.) Yazma sırasında hata olursa en kötü ihtimalle eski satırlar
 * dosyada kalır; sonraki upsert aynı hesap/tarih aralığını yeniden temizler.
 */
function st_writeSheet_(sheet, header, rows, textCols) {
  var nR = Math.max(rows.length + 1, 2), nC = Math.max(header.length, 1);
  var maxR = sheet.getMaxRows(), maxC = sheet.getMaxColumns();
  if (maxC < nC) sheet.insertColumnsAfter(maxC, nC - maxC);
  if (maxR < nR) sheet.insertRowsAfter(maxR, nR - maxR);
  textCols = textCols || [];
  header.forEach(function (h, i) {
    if (textCols.indexOf(h) >= 0) sheet.getRange(1, i + 1, nR, 1).setNumberFormat('@');
  });
  sheet.getRange(1, 1, 1, nC).setValues([header]).setFontWeight('bold');
  var CHUNK = 20000;
  for (var off = 0; off < rows.length; off += CHUNK) {
    var part = rows.slice(off, off + CHUNK);
    st_retry_(function () { sheet.getRange(2 + off, 1, part.length, nC).setValues(part); });
  }
  if (!rows.length) sheet.getRange(2, 1, 1, nC).clearContent();
  // fazlalıkları en sonda temizle
  var maxR2 = sheet.getMaxRows(), maxC2 = sheet.getMaxColumns();
  if (maxR2 > nR) sheet.deleteRows(nR + 1, maxR2 - nR);
  if (maxC2 > nC) sheet.deleteColumns(nC + 1, maxC2 - nC);
  if (sheet.getFrozenRows() !== 1) sheet.setFrozenRows(1);
}

/** Geçici Sheets servis hatalarında (Service Spreadsheets failed / timed out) 3 kez tekrar dener. */
function st_retry_(fn) {
  for (var i = 0; ; i++) {
    try { return fn(); } catch (e) {
      if (i >= 2 || !/Service Spreadsheets|timed out|Service error/i.test(String(e && e.message || e))) throw e;
      Utilities.sleep(2000 * (i + 1));
    }
  }
}

/**
 * Upsert: [replace.from, replace.to] aralığında replace.accounts hesaplarına ait eski satırları siler,
 * yeni satırları ekler. Aralık birden fazla shard'a yayılırsa hepsini günceller. İdempotent.
 *  header: kolon adları (0=date, 1=account_id)
 *  rows:   header'a hizalı diziler
 *  textCols: metin olarak saklanacak kolonlar (ID'lerin bozulmaması için)
 */
function st_upsert_(ss, dataset, header, rows, replace, textCols) {
  var def = STORE_DATASETS[dataset];
  if (!def) throw new Error('Bilinmeyen dataset: ' + dataset);
  if (header[0] !== 'date' || header[1] !== 'account_id') throw new Error('Header date,account_id ile başlamalı');
  var acct = {};
  replace.accounts.forEach(function (a) { acct[String(a)] = 1; });
  var byPeriod = {};
  rows.forEach(function (r) {
    var p = st_periodOf_(def.shard, r[0]);
    (byPeriod[p] = byPeriod[p] || []).push(r);
  });
  var periods = st_periodsInRange_(def.shard, replace.from, replace.to);
  Object.keys(byPeriod).forEach(function (p) { if (periods.indexOf(p) < 0) periods.push(p); });
  var total = 0;
  periods.forEach(function (p) {
    var newRows = byPeriod[p] || [];
    var file = st_getShard_(ss, dataset, p, newRows.length > 0);
    if (!file) return;
    var sheet = file.getSheets()[0];
    var ex = st_readSheet_(sheet);
    var U = ex.header.length ? ex.header.slice() : [];
    header.forEach(function (h) { if (U.indexOf(h) < 0) U.push(h); });
    var remE = st_remapFn_(ex.header, U), remN = st_remapFn_(header, U);
    var out = [];
    for (var i = 0; i < ex.rows.length; i++) {
      var r = ex.rows[i];
      if (acct[r[1]] && r[0] >= replace.from && r[0] <= replace.to) continue;
      out.push(remE(r));
    }
    for (var j = 0; j < newRows.length; j++) out.push(remN(newRows[j]));
    out.sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; });
    st_writeSheet_(sheet, U, out, (textCols || []).concat(['date', 'account_id']));
    st_touchRegistry_(ss, dataset, p, out.length);
    total += newRows.length;
  });
  return total;
}

/* ---------------- GA4 property listesi (Brand.js > GA4_PROPERTIES) ---------------- */
// [property ID, Ülke kodu, Ülke, Hesap adı, Aktif]
var SEED_GA4 = ((typeof BRAND !== 'undefined' && BRAND.GA4_PROPERTIES) || []).map(function (g) {
  var m = (BRAND.MARKETS || {})[g[1]];
  return [String(g[0]), g[1] || '', m ? m.tr : '', g[2] || ('GA4 ' + g[0]), true];
});

/** Brand.js'teki GA4 property'lerini Accounts'a ekler (idempotent). */
function sh_seedGa4_(ss) {
  var have = {};
  sh_accounts_(ss, 'GA4').forEach(function (a) { have[a.id] = 1; });
  var sh = sh_sheet_(ss, SHEET_NAMES.accounts);
  var added = 0;
  SEED_GA4.forEach(function (g) {
    if (have[g[0]]) return;
    var row = sh.getLastRow() + 1;
    sh.getRange(row, 5).setNumberFormat('@');
    sh.getRange(row, 1, 1, 10).setValues([['GA4', g[1], g[2], g[3], g[0], 'Web', g[4], '', '', '']]);
    try { sh.getRange(row, 7).insertCheckboxes(); } catch (e) {}
    added++;
  });
  return added;
}
