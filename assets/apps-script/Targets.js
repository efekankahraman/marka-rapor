/** Satış / session / harcama hedefleri — Config > "Hedefler" sayfası (ay · kapsam · metrik · hedef). */
var TGT_HDR = ['month', 'scope', 'metric', 'target', 'by', 'updated'];
var TGT_METRICS = ['revenue', 'purchases', 'sessions', 'cost'];
function tgt_sheet_(ss) {
  var sh = ss.getSheetByName('Hedefler');
  if (!sh) {
    sh = ss.insertSheet('Hedefler');
    sh.getRange(1, 1, 1, TGT_HDR.length).setValues([TGT_HDR]).setFontWeight('bold');
    sh.setFrozenRows(1); sh.getRange('A:A').setNumberFormat('@');
  }
  return sh;
}
function tgt_list_(ss) {
  var sh = tgt_sheet_(ss), n = sh.getLastRow();
  if (n < 2) return [];
  return sh.getRange(2, 1, n - 1, TGT_HDR.length).getValues().filter(function (r) { return r[0] && r[2] && r[3] !== ''; }).map(function (r) {
    var m = r[0] instanceof Date ? Utilities.formatDate(r[0], 'Europe/Istanbul', 'yyyy-MM') : String(r[0]).slice(0, 7);
    return { month: m, scope: String(r[1] || 'Toplam'), metric: String(r[2]), target: +r[3] || 0, by: String(r[4] || ''),
      updated: r[5] instanceof Date ? Utilities.formatDate(r[5], 'Europe/Istanbul', 'yyyy-MM-dd HH:mm') : String(r[5] || '') };
  });
}
function apiTargets(_a, gk) { GK_ = gk || ''; return api_(function () { return { items: tgt_list_(cfg_()), canEdit: !!who_() }; }); }
function apiSaveTargets(json, gk) { GK_ = gk || '';
  return api_(function () {
    var me = who_();
    if (!me) throw new Error('Hedef girmek için giriş yapılmış olmalı.');
    var o = JSON.parse(json), ss = cfg_(), sh = tgt_sheet_(ss);
    var month = String(o.month || ''), scope = String(o.scope || 'Toplam').trim().slice(0, 40) || 'Toplam';
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Ay seçilmeli.');
    var vals = o.vals || {};
    var lock = LockService.getScriptLock(); lock.waitLock(20000);
    try {
      var n = sh.getLastRow(), rows = n > 1 ? sh.getRange(2, 1, n - 1, TGT_HDR.length).getValues() : [];
      var keep = rows.filter(function (r) {
        var m = r[0] instanceof Date ? Utilities.formatDate(r[0], 'Europe/Istanbul', 'yyyy-MM') : String(r[0]).slice(0, 7);
        return !(m === month && String(r[1] || 'Toplam') === scope && (o.del || TGT_METRICS.indexOf(String(r[2])) >= 0 && String(r[2]) in vals));
      });
      if (!o.del) TGT_METRICS.forEach(function (k) {
        if (!(k in vals) || vals[k] === '' || vals[k] == null) return;
        var v = +vals[k];
        if (!isFinite(v) || v < 0) throw new Error('Geçersiz hedef: ' + k);
        keep.push([month, scope, k, v, me, new Date()]);
      });
      keep.sort(function (a, b) { return String(a[0]) < String(b[0]) ? 1 : String(a[0]) > String(b[0]) ? -1 : String(a[1]).localeCompare(String(b[1]), 'tr'); });
      if (n > 1) sh.getRange(2, 1, n - 1, TGT_HDR.length).clearContent();
      sh.getRange('A:A').setNumberFormat('@');
      if (keep.length) sh.getRange(2, 1, keep.length, TGT_HDR.length).setValues(keep.map(function (r) { r[0] = String(r[0] instanceof Date ? Utilities.formatDate(r[0], 'Europe/Istanbul', 'yyyy-MM') : r[0]).slice(0, 7); return r; }));
    } finally { lock.releaseLock(); }
    return { items: tgt_list_(ss), canEdit: true };
  });
}
