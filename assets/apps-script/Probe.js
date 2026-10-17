/**
 * Probe.js — teşhis.
 */

/** Teşhis dosyası (data klasöründe rapor_durum.json, her senkronda güncellenir): GA4X state, son loglar, ad group dosyaları, kuyruk özeti.
 *  Kurulum/hata ayıklamada Drive'dan okunur (Apps Script'e giriş gerekmez). */
function probe_status_(ss) {
  var out = { at: sh_now_(), state: {}, log: [], registry: [], queue: {} };
  var st = ss.getSheetByName(SHEET_NAMES.state).getDataRange().getValues();
  st.forEach(function (r) { if (/^(GA4X_|ADJUST_APPS|GUEST_LINKS)/.test(String(r[0])) && !/PROBE/.test(r[0])) out.state[r[0]] = String(r[1]).slice(0, 1500) + ' @' + r[2]; });
  var lg = ss.getSheetByName(SHEET_NAMES.log), n = lg.getLastRow();
  if (n > 1) out.log = lg.getRange(Math.max(2, n - 39), 1, Math.min(40, n - 1), 4).getValues().map(function (r) { return [String(r[0]), r[1], r[2], String(r[3]).slice(0, 250)]; });
  out.guestEmails = String(sh_settings_(ss).GUEST_EMAILS || '');
  var reg = st_registry_(ss);
  Object.keys(reg).forEach(function (k) { if (/_ag\|/.test(k)) out.registry.push([k, reg[k].rows, String(reg[k].updated)]); });
  readQueue_(ss).forEach(function (it) { var k = it.source + ':' + it.status; out.queue[k] = (out.queue[k] || 0) + 1; });
  var txt = JSON.stringify(out, null, 1);
  var folder = DriveApp.getFolderById(sh_settings_(ss).DATA_FOLDER_ID);
  var it = folder.getFilesByName('rapor_durum.json');
  if (it.hasNext()) it.next().setContent(txt); else folder.createFile('rapor_durum.json', txt, 'application/json');
}
