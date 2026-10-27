/**
 * Setup.js — tek seferlik kurulum: Drive klasörleri, Config spreadsheet, tetikleyiciler.
 */

function cfg_() {
  var id = PropertiesService.getScriptProperties().getProperty('CONFIG_ID');
  if (!id) throw new Error('Kurulum yapılmamış. Ana linki bir kez açın (kurulum kendiliğinden çalışır) ya da editörde setup() çalıştırın.');
  return SpreadsheetApp.openById(id);
}

function isSetUp_() {
  return !!PropertiesService.getScriptProperties().getProperty('CONFIG_ID');
}

/** Kurulum — idempotent. */
function setup() {
  var props = PropertiesService.getScriptProperties();
  var ss;
  if (props.getProperty('CONFIG_ID')) {
    ss = SpreadsheetApp.openById(props.getProperty('CONFIG_ID'));
  } else {
    var root = DriveApp.createFolder(APP_NAME);
    var dataF = root.createFolder('data');
    var expF = root.createFolder('exports');
    ss = SpreadsheetApp.create(APP_NAME + ' | Config');
    DriveApp.getFileById(ss.getId()).moveTo(root);
    props.setProperties({ CONFIG_ID: ss.getId(), ROOT_FOLDER_ID: root.getId() });
    buildConfigSheets_(ss, dataF.getId(), expF.getId());
  }
  installTriggers_();
  enqueueBackfill_(ss, ['meta', 'adjust', 'ga4'].concat(Object.keys(EXT_SOURCES)));
  try { manual_sheet_(ss); } catch (e) {}
  enqueueBackfill_(ss, ['adjust_ag', 'ga4_ag'], String(sh_settings_(ss).AG_START_DATE || BRAND.AG_START_DATE || '2026-01-01'));
  props.setProperty('SETTINGS_V', String(DEFAULT_SETTINGS.length));
  sh_log_(ss, 'setup', 'INFO', 'Kurulum tamam.');
  return { configUrl: ss.getUrl(), folderUrl: DriveApp.getFolderById(props.getProperty('ROOT_FOLDER_ID')).getUrl() };
}

function buildConfigSheets_(ss, dataFolderId, exportFolderId) {
  ss.setSpreadsheetTimeZone(SHARED_TZ);
  var first = ss.getSheets()[0];

  var acc = ss.insertSheet(SHEET_NAMES.accounts);
  var rows = SEED_ACCOUNTS.map(function (a) {
    return [a[0], a[1], COUNTRIES[a[1]] ? COUNTRIES[a[1]].tr : '', a[2], a[3], a[4], true, '', '', a[5]];
  });
  acc.getRange(1, 1, 1, ACCOUNT_HEADER.length).setValues([ACCOUNT_HEADER]).setFontWeight('bold');
  acc.getRange(2, 5, rows.length + 200, 1).setNumberFormat('@');
  if (rows.length) {
    acc.getRange(2, 1, rows.length, ACCOUNT_HEADER.length).setValues(rows);
    acc.getRange(2, 7, rows.length, 1).insertCheckboxes();
  }
  acc.setFrozenRows(1);
  acc.getRange(Math.max(rows.length, 1) + 8, 1).setValue('Hesap eklemek için yeni satır: Platform = Google Ads / Meta / GA4 / TikTok / Microsoft Ads / Yandex Direct / RTB House / Yango Ads / Criteo, Hesap ID (Google Ads: 123-456-7890, Meta: rakamlar, GA4: property ID, TikTok: advertiser ID, Yandex: Client-Login, RTB House: advertiser hash, Microsoft Ads: hesap numarası), Aktif kutusu işaretli.').setFontStyle('italic');

  var set = ss.insertSheet(SHEET_NAMES.settings);
  set.getRange(1, 1, 1, 3).setValues([['Anahtar', 'Değer', 'Açıklama']]).setFontWeight('bold');
  set.getRange(2, 2, DEFAULT_SETTINGS.length, 1).setNumberFormat('@');
  set.getRange(2, 1, DEFAULT_SETTINGS.length, 3).setValues(DEFAULT_SETTINGS);
  set.setFrozenRows(1);
  set.setColumnWidth(1, 220); set.setColumnWidth(2, 360); set.setColumnWidth(3, 520);

  var st = ss.insertSheet(SHEET_NAMES.state);
  st.getRange(1, 1, 1, 3).setValues([['key', 'value', 'updated_at']]).setFontWeight('bold');
  st.getRange('B:B').setNumberFormat('@');

  var reg = ss.insertSheet(SHEET_NAMES.registry);
  reg.getRange(1, 1, 1, REGISTRY_HEADER.length).setValues([REGISTRY_HEADER]).setFontWeight('bold');
  reg.getRange('B:B').setNumberFormat('@');

  var q = ss.insertSheet(SHEET_NAMES.queue);
  q.getRange(1, 1, 1, QUEUE_HEADER.length).setValues([QUEUE_HEADER]).setFontWeight('bold');
  q.getRange('A:H').setNumberFormat('@');

  var fx = ss.insertSheet(SHEET_NAMES.fx);
  fx.getRange(1, 1).setValue('date');

  var log = ss.insertSheet(SHEET_NAMES.log);
  log.getRange(1, 1, 1, 4).setValues([['time', 'source', 'level', 'message']]).setFontWeight('bold');

  sh_setSetting_(ss, 'DATA_FOLDER_ID', dataFolderId);
  sh_setSetting_(ss, 'EXPORT_FOLDER_ID', exportFolderId);
  seedGa4Brand_(ss);

  first.setName('README');
  first.getRange(1, 1, 8, 1).setValues([
    [APP_NAME + ' — Config'],
    ['Accounts: rapora giren hesaplar. Aktif kutusunu kaldırarak hesabı hariç tutabilirsiniz. GA4 property\'leri buraya eklenir.'],
    ['Settings: ayarlar (API sürümü, lookback, Adjust/GA4 metrikleri).'],
    ['Registry: veri dosyalarının listesi (yıllık/aylık Google Sheets dosyaları, "data" klasöründe).'],
    ['Queue: Meta / Adjust / GA4 / TikTok / Yandex / RTB House çekim kuyruğu (backfill + günlük yenileme). Manuel Veri: API\'si olmayan platformlar (Yango Ads, Criteo).'],
    ['FX: günlük kurlar (1 USD = X birim). Kaynak: fawazahmed0/currency-api.'],
    ['Log: senkron logları.'],
    ['Tokenlar (Meta, Adjust) güvenlik için burada değil, script özelliklerinde saklanır — web uygulamasındaki Durum sekmesinden girin.']
  ]);
  first.getRange(1, 1).setFontWeight('bold').setFontSize(14);
  first.setColumnWidth(1, 900);
}

function installTriggers_() {
  var have = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
  if (have.indexOf('runSync') < 0) ScriptApp.newTrigger('runSync').timeBased().everyMinutes(10).create();
}

/** Brand.js'teki GA4 property'lerini ve (varsa) global property'yi Accounts'a ekler. */
function seedGa4Brand_(ss) {
  sh_seedGa4_(ss);
  var gid = String(BRAND.GA4_GLOBAL_PROPERTY || '').trim();
  if (!gid) return;
  var sh = sh_sheet_(ss, SHEET_NAMES.accounts);
  var g = sh_accounts_(ss, 'GA4').filter(function (a) { return a.id === gid; })[0];
  if (g) { sh.getRange(g.row, 6).setValue('Global (ülke kırılımlı)'); return; }
  var row = sh.getLastRow() + 1;
  sh.getRange(row, 5).setNumberFormat('@');
  sh.getRange(row, 1, 1, 10).setValues([['GA4', '', '', APP_NAME + ' GA4', gid, 'Global (ülke kırılımlı)', true, '', '', 'Pazarlar ülke kırılımıyla ayrılır']]);
  try { sh.getRange(row, 7).insertCheckboxes(); } catch (e) {}
}

/** Brand.js > SHARE_WITH hesaplarını rapor klasörüne düzenleyen olarak ekler (liste değişince bir kez). */
function shareRoot_(ss) {
  var list = (BRAND.SHARE_WITH || []).map(function (x) { return String(x).trim().toLowerCase(); }).filter(String);
  var p = PropertiesService.getScriptProperties();
  var key = list.join(',');
  if (!key || p.getProperty('SHARED_WITH') === key) return;
  var root = DriveApp.getFolderById(p.getProperty('ROOT_FOLDER_ID'));
  var have = root.getEditors().map(function (u) { return String(u.getEmail()).toLowerCase(); });
  list.forEach(function (em) { if (have.indexOf(em) < 0) root.addEditor(em); });
  p.setProperty('SHARED_WITH', key);
  sh_log_(ss, 'share', 'INFO', 'Rapor klasörü paylaşıldı (düzenleyen): ' + key);
}
