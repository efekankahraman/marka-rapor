/**
 * WebApp.js — web uygulaması girişi ve istemcinin çağırdığı API fonksiyonları.
 */

function doGet(e) {
  GK_ = (e && e.parameter && e.parameter.k) || '';
  if (!access_()) {
    // Misafir girişi: e-posta + tek kullanımlık kod (sadece Settings > GUEST_EMAILS'teki adresler)
    var lt = HtmlService.createTemplateFromFile('Login');
    lt.baseUrl = ScriptApp.getService().getUrl() || '';
    lt.badToken = GK_ ? '1' : '';
    lt.rid = RID_(e);
    return lt.evaluate().setTitle(APP_NAME).setFaviconUrl('https://semtr.com/favicon.ico').addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }
  var t = HtmlService.createTemplateFromFile('Index');
  // İlk veri (bootstrap) sayfaya gömülür → ayrı bir sunucu çağrısı beklenmez
  t.reportId = RID_(e);
  t.guestKey = GUEST_ ? String(GK_).replace(/[^A-Za-z0-9_-]/g, '') : '';
  t.bootJson = apiBootstrap(null, GK_).replace(/</g, '\\u003c');
  return t.evaluate()
    .setTitle(APP_NAME)
    .setFaviconUrl('https://semtr.com/favicon.ico')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/**
 * Erişim: ajans alan adındaki hesaplar (BRAND.AGENCY_DOMAIN) + mail koduyla giriş yapan misafirler.
 * Misafir web uygulaması anonim erişimle yayınlanır; misafir oturumu linkteki ?k= anahtarıyla tanınır.
 * İstemci her çağrıda anahtarı ikinci argüman olarak gönderir.
 */
var GK_ = '', GUEST_ = '';
var ACCESS_DOMAIN = String(BRAND.AGENCY_DOMAIN || '').toLowerCase();
/** Üst bardaki marka logosu (Brand.js > LOGO_URL); yoksa rapor adı yazılır. */
function brandLogo_(sepClass) {
  var esc = function (s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  var sep = '<span class="' + sepClass + '"></span>';
  if (BRAND.LOGO_URL) return sep + '<img class="blogo" src="' + esc(BRAND.LOGO_URL) + '" alt="' + esc(BRAND.REPORT_NAME) + '" style="height:18px;width:auto;display:block' + (BRAND.LOGO_INVERT === false ? '' : ';filter:brightness(0) invert(1)') + '">';
  return sep + '<span class="bname" style="color:#fff;font-weight:600;font-size:14px;white-space:nowrap">' + esc(BRAND.REPORT_NAME) + '</span>';
}
function access_() {
  var v = viewer_();
  if (v && ACCESS_DOMAIN && v.split('@')[1] === ACCESS_DOMAIN) return true;
  var em = guestSession_(GK_);
  if (em) { GUEST_ = em; return true; }
  return false;
}
function who_() { return viewer_() || (/@/.test(GUEST_) ? GUEST_ : ''); }

function api_(fn) {
  if (!access_()) return JSON.stringify({ ok: false, error: 'Bu rapora erişim yetkiniz yok.' });
  try { return JSON.stringify({ ok: true, data: fn() }); }
  catch (e) { return JSON.stringify({ ok: false, error: (e && e.message) || String(e) }); }
}

function viewer_() { try { return String(Session.getActiveUser().getEmail() || '').toLowerCase(); } catch (e) { return ''; } }

/** Durum sekmesi ve yönetim işlemleri sadece admin hesap(lar)ına açık. */
function isAdmin_(ss) {
  var v = viewer_();
  if (!v) return false;
  var list = (BRAND.ADMIN_EMAILS || []).map(function (x) { return String(x).toLowerCase().trim(); });
  try { list = list.concat(String(sh_settings_(ss || cfg_()).ADMIN_EMAILS || '').toLowerCase().split(',').map(function (x) { return x.trim(); })); } catch (e) {}
  try { list.push(String(Session.getEffectiveUser().getEmail() || '').toLowerCase()); } catch (e) {}
  return list.indexOf(v) >= 0;
}
function requireAdmin_() { if (!isAdmin_()) throw new Error('Bu işlem için yetkiniz yok.'); }

/* ---------- kurulum / meta ---------- */

function apiSetup(_a, gk) { GK_ = gk || ''; return api_(function () { requireAdmin_(); return setup(); }); }

function apiBootstrap(_a, gk) { GK_ = gk || '';
  return api_(function () {
    if (!isSetUp_()) setup(); // ilk açılışta kurulumu otomatik yap
    var ss = cfg_();
    var s = sh_settings_(ss);
    var p = PropertiesService.getScriptProperties();
    var admin = isAdmin_(ss);
    var adPlats = ['Google Ads', 'Meta'].concat(EXT_PLATFORMS);
    var accounts = sh_accounts_(ss).filter(function (a) { return a.active && adPlats.indexOf(a.platform) >= 0; })
      .map(function (a) { return { key: a.platform + '|' + a.id, platform: a.platform, code: a.code, name: a.name, tip: a.tip }; });
    var platforms = adPlats.filter(function (pl) { return accounts.some(function (a) { return a.platform === pl; }); });
    var countries = Object.keys(COUNTRIES).filter(function (c) { return !excludedMarket_(c); }).map(function (c) { return { code: c, name: COUNTRIES[c].tr }; });
    var out = {
      accounts: accounts,
      platforms: platforms,
      countries: countries,
      ads: { levels: Object.keys(R_LEVELS), metrics: R_METRICS.map(function (m) { return { k: m.k, l: m.l, u: m.u, g: m.g, orig: !!m.orig, web: !!m.web }; }) },
      viewer: who_(), guest: !!GUEST_,
      appName: APP_NAME,
      curSym: REPORT_SYM, cur: REPORT_CUR,
      showCountry: showCountry_(),
      campaignGroup: BRAND.CAMPAIGN_GROUP ? { inLabel: BRAND.CAMPAIGN_GROUP.IN_LABEL, outLabel: BRAND.CAMPAIGN_GROUP.OUT_LABEL, keyword: BRAND.CAMPAIGN_GROUP.KEYWORD, def: BRAND.CAMPAIGN_GROUP.DEFAULT || '' } : null,
      isAdmin: admin,
      cpasLabel: BRAND.CPAS_LABEL || 'CPAS',
      startDate: s.START_DATE || '2025-01-01',
      today: sh_today_(),
      dataEnd: sh_yesterday_(),
      lastUpdate: p.getProperty('LAST_DAILY_AT') || '',
      refreshHour: +(s.DAILY_REFRESH_HOUR || 3),
      adMaxDays: +s.AD_LEVEL_MAX_DAYS || 186
    };
    if (admin) {
      out.links = { config: ss.getUrl(), folder: p.getProperty('ROOT_FOLDER_ID') ? 'https://drive.google.com/drive/folders/' + p.getProperty('ROOT_FOLDER_ID') : '',
        guest: GUEST_DEPLOYMENT_ID ? 'https://script.google.com/macros/s/' + GUEST_DEPLOYMENT_ID + '/exec' : '' };
      out.secrets = { meta: !!p.getProperty('META_TOKEN'), adjust: !!p.getProperty('ADJUST_TOKEN'),
        adjustHint: p.getProperty('ADJUST_TOKEN') ? '…' + p.getProperty('ADJUST_TOKEN').slice(-4) + (p.getProperty('ADJUST_TOKEN_SAVED_AT') ? ' · ' + p.getProperty('ADJUST_TOKEN_SAVED_AT') : '') : '' };
      Object.keys(EXT_TOKEN_PROP).forEach(function (k) { out.secrets[k] = !!p.getProperty(EXT_TOKEN_PROP[k]); });
      out.adjustApps = s.ADJUST_APP_TOKENS || '';
      out.adjustAccount = s.ADJUST_ACCOUNT_ID || '';
    }
    return out;
  });
}

/* ---------- rapor sorguları ---------- */

/** Karşılaştırma: p.cmp = {from,to} varsa aynı sorgu o aralık için de çalışır → out.cmp = {from,to,columns,rows,totals,kpi} */
function cmp_run_(p, fn) {
  var out = fn(p), c = p.cmp;
  if (!c || !c.from || !c.to || c.from > c.to || !out || !out.columns) return out;
  var p2 = JSON.parse(JSON.stringify(p)); p2.from = c.from; p2.to = c.to; delete p2.cmp;
  var o2 = fn(p2);
  out.cmp = { from: c.from, to: c.to, columns: o2.columns, rows: o2.rows || [], totals: o2.totals || null };
  if (o2.kpi) out.cmp.kpi = o2.kpi;
  return out;
}
function apiQuery(paramsJson, gk) { GK_ = gk || '';
  if (!access_()) return JSON.stringify({ ok: false, error: 'Bu rapora erişim yetkiniz yok.' });
  var p = JSON.parse(paramsJson);
  if (p.to > sh_yesterday_()) p.to = sh_yesterday_(); // veri bugünü içermez
  // 1) önbellek (küp sürümüne bağlı)
  var key = qcache_key_(p);
  var hit = qcache_get_(key);
  if (hit) return hit;
  var out = api_(function () {
    var ss = cfg_();
    var eq = (p.filters && p.filters.eq) || {};
    var cubeOk = p.level !== 'adgroup' && p.level !== 'ad' &&
      Object.keys(eq).every(function (k) { return ['account_id', 'campaign_id', 'platform'].indexOf(k) >= 0; }) &&
      (!(p.filters && p.filters.pick) || p.filters.pick.fields.every(function (k) { return ['country', 'platform', 'account_id', 'campaign_id'].indexOf(k) >= 0; }));
    // 2) küp: önceden eşleştirilmiş tek dosya (hızlı)  3) yoksa canlı hesap (ad seviyesi / küp henüz kurulmadıysa)
    var cube = cubeOk ? cube_load_() : null;
    return cmp_run_(p, function (q) { return cube ? q_reportCube_(ss, q, cube) : q_report_(ss, q); });
  });
  if (out.indexOf('{"ok":true') === 0) qcache_put_(key, out);
  return out;
}

/** Tabloyu yeni bir Google Sheets dosyasına aktarır → URL */
function apiExport(payloadJson, gk) { GK_ = gk || '';
  return api_(function () {
    var p = JSON.parse(payloadJson);
    var ss = cfg_();
    var s = sh_settings_(ss);
    var name = APP_NAME + ' | ' + (p.title || 'Rapor') + ' | ' + sh_now_().slice(0, 16);
    var out = SpreadsheetApp.create(name);
    if (s.EXPORT_FOLDER_ID) { try { DriveApp.getFileById(out.getId()).moveTo(DriveApp.getFolderById(s.EXPORT_FOLDER_ID)); } catch (e) {} }
    var sh = out.getSheets()[0];
    sh.setName('Rapor');
    // gizli para birimi kolonu: orig. değerlere satır bazında sembol formatı uygulanır, kolon yazılmaz
    var curIdx = -1;
    p.columns.forEach(function (c, i) { if (c.k === '_cur') curIdx = i; });
    var keep = p.columns.map(function (c, i) { return c.t === 'hidden' ? -1 : i; }).filter(function (i) { return i >= 0; });
    var rowCur = (p.rows || []).map(function (r) { return curIdx >= 0 ? r[curIdx] : ''; });
    var totCur = p.totals && curIdx >= 0 ? p.totals[curIdx] : '';
    var cols = keep.map(function (i) { return p.columns[i]; });
    var rows = (p.rows || []).map(function (r) { return keep.map(function (i) { return r[i]; }); });
    if (p.totals) p.totals = keep.map(function (i) { return p.totals[i]; });
    var header = cols.map(function (c) { return c.l; });
    var nR = rows.length + 1 + (p.totals ? 1 : 0), nC = header.length;
    if (sh.getMaxRows() < nR) sh.insertRowsAfter(sh.getMaxRows(), nR - sh.getMaxRows());
    if (sh.getMaxColumns() < nC) sh.insertColumnsAfter(sh.getMaxColumns(), nC - sh.getMaxColumns());
    cols.forEach(function (c, i) { if (c.t === 'text') sh.getRange(1, i + 1, nR, 1).setNumberFormat('@'); });
    var data = [header].concat(rows.map(function (r) { return r.map(function (v) { return v == null ? '' : v; }); }));
    if (p.totals) data.push(p.totals.map(function (v) { return v == null ? '' : v; }));
    for (var off = 0; off < data.length; off += 20000) {
      var part = data.slice(off, off + 20000);
      sh.getRange(1 + off, 1, part.length, nC).setValues(part);
    }
    var FMT = { usd: '$#,##0.00', money: '#,##0.00', int: '#,##0', num: '#,##0.00', pct: '0.00%', x: '0.00' };
    var SYM = { USD: '"$"', EUR: '"€"', TRY: '"₺"', GBP: '"£"' };
    function curFmt(c) { return c ? (SYM[c] || '"' + c + ' "') + '#,##0.00' : '#,##0.00'; }
    cols.forEach(function (c, i) {
      if (c.orig && curIdx >= 0) {
        var f = rowCur.map(function (cur) { return [curFmt(cur)]; });
        if (p.totals) f.push([curFmt(totCur)]);
        if (f.length) sh.getRange(2, i + 1, f.length, 1).setNumberFormats(f);
      } else if (FMT[c.t]) sh.getRange(2, i + 1, Math.max(nR - 1, 1), 1).setNumberFormat(FMT[c.t]);
    });
    sh.getRange(1, 1, 1, nC).setFontWeight('bold').setBackground('#eef2f7');
    if (p.totals) sh.getRange(nR, 1, 1, nC).setFontWeight('bold').setBackground('#f5f5f3');
    sh.setFrozenRows(1);
    if (p.meta) {
      var info = out.insertSheet('Filtreler');
      var kv = Object.keys(p.meta).map(function (k) { return [k, String(p.meta[k])]; });
      if (kv.length) info.getRange(1, 1, kv.length, 2).setValues(kv);
    }
    export_share_(out.getId());
    return { url: out.getUrl() };
  });
}

/* ---------- durum / yönetim ---------- */

function apiStatus(_a, gk) { GK_ = gk || '';
  return api_(function () {
    requireAdmin_();
    var ss = cfg_();
    var q = readQueue_(ss);
    var byS = {};
    q.forEach(function (it) {
      var o = byS[it.source] = byS[it.source] || { pending: 0, done: 0, error: 0, lastError: '' };
      o[it.status] = (o[it.status] || 0) + 1;
      if (it.status === 'error' || (it.status === 'pending' && it.message)) o.lastError = it.account + ' ' + it.from + ': ' + it.message;
    });
    var reg = st_registry_(ss);
    var files = Object.keys(reg).map(function (k) { var r = reg[k]; return { dataset: r.dataset, period: r.period, url: r.url, rows: r.rows, updated: r.updated instanceof Date ? sh_dateStr_(r.updated) : String(r.updated) }; })
      .sort(function (a, b) { return a.dataset < b.dataset ? -1 : a.dataset > b.dataset ? 1 : (a.period < b.period ? 1 : -1); });
    var logSh = ss.getSheetByName(SHEET_NAMES.log);
    var n = logSh.getLastRow();
    var logs = n > 1 ? logSh.getRange(Math.max(2, n - 24), 1, Math.min(25, n - 1), 4).getValues().reverse().map(function (r) { return r.map(String); }) : [];
    var fxSh = ss.getSheetByName(SHEET_NAMES.fx);
    var fxLast = fxSh.getLastRow() > 1 ? sh_dateStr_(fxSh.getRange(fxSh.getLastRow(), 1).getValue()) : '';
    var gads = {};
    var gads2 = {};
    ['BACKFILL_CURSOR', 'BACKFILL_DONE', 'LAST_REFRESH', 'LAST_RUN', 'ACCESSIBLE'].forEach(function (k) {
      gads['GADS_' + k] = sh_getState_(ss, 'GADS_' + k);
      gads2['GADS_' + k] = sh_getState_(ss, 'GADS2_' + k);
    });
    var ga4x = { mode: ga4External_(ss) ? 'external' : 'internal' };
    ['GA4X_LAST_RUN', 'GA4X_LAST_REFRESH', 'GA4X_STATUS'].forEach(function (k) { ga4x[k] = sh_getState_(ss, k); });
    var pp = PropertiesService.getScriptProperties();
    return { queue: byS, files: files, logs: logs, fxLast: fxLast, gads: gads, gads2: gads2, ga4x: ga4x, cubeAt: pp.getProperty('CUBE_BUILT_AT') || '',
      bing: sh_getState_(ss, 'BING_LAST_PUSH') };
  });
}

function apiSaveSecrets(json, gk) { GK_ = gk || '';
  return api_(function () {
    requireAdmin_();
    var o = JSON.parse(json);
    var p = PropertiesService.getScriptProperties();
    var ss = cfg_();
    var started = [], needAdj = false;
    // Her alan ayrı denenir: biri hatalıysa diğerleri yine kaydedilir
    function step(label, fn) {
      try { var m = fn(); if (m) started.push('✓ ' + m); }
      catch (e) { started.push('⚠ ' + label + ': ' + ((e && e.message) || e) + ' (kaydedilmedi)'); }
    }
    if (o.meta && String(o.meta).trim()) step('Meta', function () {
      var had = !!p.getProperty('META_TOKEN');
      var s = sh_settings_(ss);
      var me = fetchJson_('https://graph.facebook.com/' + (s.META_API_VERSION || 'v23.0') + '/me?access_token=' + encodeURIComponent(o.meta.trim()));
      p.setProperty('META_TOKEN', o.meta.trim());
      if (!had) enqueueBackfill_(ss, ['meta']);
      return 'Meta token geçerli (' + (me.name || me.id) + ')';
    });
    if (o.adjustAccount != null && String(o.adjustAccount).trim() !== String(sh_settings_(ss).ADJUST_ACCOUNT_ID || '')) step('Adjust hesap ID', function () {
      sh_setSetting_(ss, 'ADJUST_ACCOUNT_ID', String(o.adjustAccount).trim());
      var msg = 'Adjust hesap ID kaydedildi (' + String(o.adjustAccount).trim() + ')';
      if (!o.adjust && p.getProperty('ADJUST_TOKEN')) {
        msg += ' · ' + adjust_testToken_(ss, p.getProperty('ADJUST_TOKEN')).summary;
        readQueue_(ss).forEach(function (it) { if (it.source === 'adjust' && it.status === 'error') setQueueRow_(ss, it, 'pending', 0, ''); });
      }
      return msg;
    });
    if (o.adjustApps != null && String(o.adjustApps).trim() !== '') step('Adjust app token', function () {
      sh_setSetting_(ss, 'ADJUST_APP_TOKENS', o.adjustApps.trim());
      if (p.getProperty('ADJUST_TOKEN')) needAdj = true;
      return 'Adjust app token(lar) kaydedildi';
    });
    if (o.adjust && String(o.adjust).trim()) step('Adjust', function () {
      var at = o.adjust.trim();
      var t = adjust_testToken_(ss, at); // önce doğrula (hatalıysa kaydetmez)
      p.setProperties({ ADJUST_TOKEN: at, ADJUST_TOKEN_SAVED_AT: sh_now_() });
      readQueue_(ss).forEach(function (it) { if (it.source === 'adjust' && it.status === 'error') setQueueRow_(ss, it, 'pending', 0, ''); });
      if (sh_settings_(ss).ADJUST_APP_TOKENS) needAdj = true;
      return 'Adjust token kaydedildi (…' + at.slice(-4) + ') · ' + t.summary;
    });
    Object.keys(EXT_TOKEN_PROP).forEach(function (k) {
      if (!o[k] || !String(o[k]).trim()) return;
      step(EXT_SOURCES[k], function () {
        var tok = String(o[k]).trim();
        var had2 = !!p.getProperty(EXT_TOKEN_PROP[k]);
        var msg = ext_testToken_(ss, k, tok); // önce doğrula (hatalıysa kaydetmez)
        p.setProperty(EXT_TOKEN_PROP[k], tok);
        readQueue_(ss).forEach(function (it) { if (it.source === k && it.status === 'error') setQueueRow_(ss, it, 'pending', 0, ''); });
        if (!had2) msg += ' · backfill: ' + enqueueBackfill_(ss, [k]) + ' iş kuyrukta';
        return msg;
      });
    });
    if (needAdj) step('Adjust backfill', function () {
      var n = enqueueBackfill_(ss, ['adjust']);
      enqueueBackfill_(ss, ['adjust_ag'], String(sh_settings_(ss).AG_START_DATE || '2026-01-01'));
      return 'Adjust backfill: ' + n + ' iş kuyrukta';
    });
    var saved = {};
    ['META_TOKEN', 'ADJUST_TOKEN'].concat(Object.keys(EXT_TOKEN_PROP).map(function (k) { return EXT_TOKEN_PROP[k]; }))
      .forEach(function (k) { saved[k] = !!p.getProperty(k); });
    return { message: started.join('\n') || 'Değişiklik yok', saved: saved };
  });
}

function apiEnqueueBackfill(source, gk) { GK_ = gk || '';
  return api_(function () {
    requireAdmin_();
    var ss = cfg_();
    var n = enqueueBackfill_(ss, [source]);
    return n + ' iş kuyruğa eklendi';
  });
}

function apiSyncNow(_a, gk) { GK_ = gk || '';
  return api_(function () {
    requireAdmin_();
    var ss = cfg_();
    enqueueRecent_(ss, ['meta', 'adjust', 'adjust_ag', 'ga4', 'ga4_ag'].concat(Object.keys(EXT_SOURCES)));
    var r = runSync();
    return r === 'busy' ? 'Senkron zaten çalışıyor; birkaç dakika içinde tamamlanır.' : r;
  });
}

function apiFxSync(_a, gk) { GK_ = gk || ''; return api_(function () { requireAdmin_(); return fx_sync_(cfg_()) + ' gün kur yazıldı'; }); }

function apiRebuildCube(_a, gk) { GK_ = gk || '';
  return api_(function () {
    requireAdmin_();
    var r = cube_build_(cfg_());
    return 'Rapor önbelleği yeniden kuruldu: ' + r.campaigns + ' kampanya, ' + r.rows + ' satır. GA4 eşleşme ' + pct_(r.diag.ga4.matched, r.diag.ga4.sessions) + ', Adjust eşleşme ' + pct_(r.diag.adj.matched, r.diag.adj.sessions);
  });
}

function apiRetryErrors(_a, gk) { GK_ = gk || '';
  return api_(function () {
    requireAdmin_();
    var ss = cfg_();
    var n = 0;
    readQueue_(ss).forEach(function (it) { if (it.status === 'error') { setQueueRow_(ss, it, 'pending', 0, ''); n++; } });
    return n + ' hatalı iş yeniden kuyrukta';
  });
}

/** Adjust'taki event listesi (metrik adı: <id>_events). */
function apiAdjustEvents(_a, gk) { GK_ = gk || '';
  return api_(function () {
    requireAdmin_();
    var ss = cfg_();
    var token = PropertiesService.getScriptProperties().getProperty('ADJUST_TOKEN');
    if (!token) throw new Error('Önce Adjust API token\'ını kaydedin.');
    var apps = String(sh_settings_(ss).ADJUST_APP_TOKENS || '').split(',').map(function (x) { return x.trim(); }).filter(String);
    var url = 'https://automate.adjust.com/reports-service/events' + (apps.length ? '?app_token__in=' + encodeURIComponent(apps.join(',')) : '');
    var body = fetchJson_(url, { headers: adjust_headers_(token) });
    var list = Array.isArray(body) ? body : (body.events || body.results || body.rows || body.data || []);
    return list.map(function (e) {
      var id = e.id || e.slug || e.token || '';
      return { id: id, name: e.name || e.display_name || id, metric: id ? id + '_events' : '' };
    }).sort(function (a, b) {
      var pa = /purchase|satın|satin|order|sipariş/i.test(a.name + a.id) ? 0 : 1, pb = /purchase|satın|satin|order|sipariş/i.test(b.name + b.id) ? 0 : 1;
      return pa - pb || String(a.name).localeCompare(String(b.name));
    });
  });
}

/* ---------- geri bildirim: "Raporda değişmesini istediğim bir şey var" ---------- */

var FEEDBACK_HEADER = ['Zaman', 'E-posta', 'İsim', 'İstek', 'Ekran / filtreler', 'Durum', 'Not'];

function feedbackSheet_(ss) {
  var sh = ss.getSheetByName('Feedback');
  if (!sh) {
    sh = ss.insertSheet('Feedback');
    sh.getRange(1, 1, 1, FEEDBACK_HEADER.length).setValues([FEEDBACK_HEADER]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.setColumnWidth(4, 520); sh.setColumnWidth(5, 360);
  }
  return sh;
}

function apiFeedback(json, gk) { GK_ = gk || '';
  return api_(function () {
    var o = JSON.parse(json);
    var text = String(o.text || '').trim();
    if (!text) throw new Error('Lütfen isteğinizi yazın.');
    var email = who_();
    var ss = cfg_();
    feedbackSheet_(ss).appendRow([sh_now_(), email, String(o.name || '').slice(0, 100), text.slice(0, 5000), String(o.context || '').slice(0, 2000), 'Yeni', '']);
    return 'Kaydedildi, teşekkürler!';
  });
}

function apiFeedbackList(_a, gk) { GK_ = gk || '';
  return api_(function () {
    requireAdmin_();
    var sh = feedbackSheet_(cfg_());
    var n = sh.getLastRow();
    if (n < 2) return [];
    return sh.getRange(2, 1, n - 1, FEEDBACK_HEADER.length).getValues().reverse().slice(0, 50)
      .map(function (r) { return r.map(function (v) { return v instanceof Date ? sh_dateStr_(v) : String(v); }); });
  });
}

/** Adjust token'ını dener: hangi uygulamaları görüyor, Settings'teki app token'ları eşleşiyor mu. */
function adjust_testToken_(ss, token) {
  var apps = adjust_listApps_(token, true);
  var cfgd = String(sh_settings_(ss).ADJUST_APP_TOKENS || '').split(',').map(function (x) { return x.trim(); }).filter(String);
  var ok = apps.filter(function (a) { return cfgd.indexOf(a.t) >= 0; });
  var list = apps.map(function (a) { return (a.n || '?') + ' (' + a.t + ')'; }).join(', ') || '—';
  return { apps: apps, matched: ok.length,
    summary: 'Token ' + apps.length + ' uygulama görüyor: ' + list + ' → app token eşleşmesi: ' + ok.length + '/' + cfgd.length };
}

function apiAdjustTest(_a, gk) { GK_ = gk || '';
  return api_(function () {
    requireAdmin_();
    var p = PropertiesService.getScriptProperties();
    var token = p.getProperty('ADJUST_TOKEN');
    if (!token) throw new Error('Kayıtlı Adjust token yok.');
    var t = adjust_testToken_(cfg_(), token);
    return 'Kayıtlı token: …' + token.slice(-4) + ' (kaydedilme: ' + (p.getProperty('ADJUST_TOKEN_SAVED_AT') || 'bilinmiyor') + ') · Hesap ID: ' + (adjust_accountId_() || 'yok') + '\n' + t.summary;
  });
}

/**
 * Dışa aktarılan dosya web uygulamasının sahibinin Drive'ında oluşur → butona basan kullanıcıya
 * düzenleme yetkisi verilir (bildirim e-postası gönderilmez). Kullanıcının e-postası alınamazsa
 * dosya alan adı içinde linke sahip herkese düzenlenebilir yapılır.
 */
function export_share_(fileId) {
  var email = who_();
  var owner = '';
  try { owner = String(Session.getEffectiveUser().getEmail() || '').toLowerCase(); } catch (e) {}
  if (email && email === owner) return;
  if (email) {
    try {
      var res = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + fileId +
        '/permissions?sendNotificationEmail=false&supportsAllDrives=true', {
        method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
        payload: JSON.stringify({ role: 'writer', type: 'user', emailAddress: email })
      });
      if (res.getResponseCode() < 300) return;
    } catch (e) {}
    try { DriveApp.getFileById(fileId).addEditor(email); return; } catch (e) {}
  }
  // misafir (alan adı dışı) ve kişiye paylaşım başarısızsa: linke sahip olan görüntüleyebilir
  if (GUEST_) { try { DriveApp.getFileById(fileId).setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); return; } catch (e) {} }
  try { DriveApp.getFileById(fileId).setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.EDIT); } catch (e) {
    try { DriveApp.getFileById(fileId).setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e2) {}
  }
}


/**
 * Misafir erişimi: ajans alan adı dışındaki kişiler "misafir" web uygulamasını (anonim erişim) açar, e-posta adresini yazar,
 * adres Config > Settings > GUEST_EMAILS listesindeyse 6 haneli kod e-postayla gönderilir. Kod doğrulanınca 30 günlük oturum açılır.
 * Listeden çıkarılan adresin oturumu bir sonraki istekte geçersiz olur.
 */
var GUEST_DEPLOYMENT_ID = BRAND.GUEST_DEPLOYMENT_ID || '';
var GUEST_SESSION_DAYS = 30;
function guestAllow_() {
  var c = CacheService.getScriptCache(), v = c.get('GUEST_ALLOW');
  if (v == null) {
    v = String(sh_settings_(cfg_()).GUEST_EMAILS || '').toLowerCase().split(',').map(function (x) { return x.trim(); }).filter(function (x) { return /@/.test(x); }).join(',');
    c.put('GUEST_ALLOW', v, 300);
  }
  return v ? v.split(',') : [];
}
function guestSession_(token) {
  token = String(token || '').replace(/[^A-Za-z0-9]/g, '');
  if (token.length < 20) return '';
  var raw = PropertiesService.getScriptProperties().getProperty('GSESS_' + token);
  if (!raw) return '';
  var p = raw.split('|'), em = p[0], exp = +p[1] || 0;
  if (Date.now() > exp || guestAllow_().indexOf(em) < 0) return '';
  return em;
}
function apiGuestStart(email) {
  try {
    email = String(email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(email)) throw new Error('Geçerli bir e-posta adresi yazın.');
    var c = CacheService.getScriptCache();
    if (c.get('OTPRL_' + email)) throw new Error('Kod az önce gönderildi, lütfen bir dakika sonra tekrar deneyin.');
    c.put('OTPRL_' + email, '1', 60);
    var inList = guestAllow_().indexOf(email) >= 0;
    try { sh_log_(cfg_(), 'guest', inList ? 'INFO' : 'WARN', 'Kod istendi: ' + email + (inList ? '' : ' (GUEST_EMAILS listesinde değil, kod gönderilmedi)')); } catch (e0) {}
    if (inList) {
      var code = String(Math.floor(100000 + Math.random() * 900000));
      c.put('OTP_' + email, code + '|0', 600);
      MailApp.sendEmail({ to: email, name: BRAND.OTP_SENDER_NAME || APP_NAME,
        subject: APP_NAME + ' giriş kodu: ' + code,
        htmlBody: '<div style="font-family:Arial,sans-serif;font-size:14px;color:#000E24">' +
          '<p><b>' + APP_NAME + '</b> raporu için giriş kodunuz:</p>' +
          '<p style="font-size:28px;letter-spacing:6px;font-weight:bold;color:#06AEEF">' + code + '</p>' +
          '<p style="color:#6b7a8f">Kod 10 dakika geçerlidir. Bu isteği siz yapmadıysanız e-postayı yok sayabilirsiniz.</p></div>' });
      try { sh_log_(cfg_(), 'guest', 'INFO', 'Kod gönderildi: ' + email); } catch (e1) {}
    }
    // adres listede olmasa da aynı yanıt (liste dışarıya sızmasın)
    return JSON.stringify({ ok: true, data: 'Adresiniz yetkiliyse birkaç saniye içinde 6 haneli bir kod gelecek.' });
  } catch (e) { return JSON.stringify({ ok: false, error: e.message || String(e) }); }
}
function apiGuestVerify(json) {
  try {
    var o = JSON.parse(json || '{}');
    var email = String(o.email || '').trim().toLowerCase(), code = String(o.code || '').replace(/\D/g, '');
    var c = CacheService.getScriptCache(), raw = c.get('OTP_' + email);
    if (!raw) throw new Error('Kodun süresi doldu ya da kod istenmedi. Yeniden kod isteyin.');
    var p = raw.split('|'), tries = +p[1] || 0;
    if (tries >= 5) { c.remove('OTP_' + email); throw new Error('Çok fazla hatalı deneme. Yeniden kod isteyin.'); }
    if (code !== p[0]) { c.put('OTP_' + email, p[0] + '|' + (tries + 1), 600); throw new Error('Kod hatalı.'); }
    c.remove('OTP_' + email);
    var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
    PropertiesService.getScriptProperties().setProperty('GSESS_' + token, email + '|' + (Date.now() + GUEST_SESSION_DAYS * 864e5));
    return JSON.stringify({ ok: true, data: token });
  } catch (e) { return JSON.stringify({ ok: false, error: e.message || String(e) }); }
}
/** Senkronda: misafir linkini State'e yazar, süresi geçmiş oturumları temizler. */
function guests_sync_(ss) {
  var pp = PropertiesService.getScriptProperties(), all = pp.getProperties(), now = Date.now();
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('GSESS_') === 0 && (+String(all[k]).split('|')[1] || 0) < now) pp.deleteProperty(k);
  });
  if (all.GUEST_KEYS) pp.deleteProperty('GUEST_KEYS');
  CacheService.getScriptCache().remove('GUEST_ALLOW');
  var link = GUEST_DEPLOYMENT_ID ? 'https://script.google.com/macros/s/' + GUEST_DEPLOYMENT_ID + '/exec' : '';
  if (link && sh_getState_(ss, 'GUEST_LINKS') !== link) sh_setState_(ss, 'GUEST_LINKS', link);
  return link;
}

/** Bir kez editörden çalıştırılır: e-posta gönderme iznini onaylatır. */
function mailYetkisi() { MailApp.getRemainingDailyQuota(); return 'ok'; }


/* ---------- kayıtlı rapor görünümleri (kişi başına, Config > Views) ---------- */
var VIEW_HDR = ['E-posta', 'Rapor adı', 'Ayarlar (JSON)', 'Güncelleme', 'Görünürlük', 'Paylaşılan kişiler', 'ID'];
function views_sheet_(ss) {
  var sh = ss.getSheetByName('Views');
  if (!sh) { sh = ss.insertSheet('Views'); sh.setFrozenRows(1); }
  if (String(sh.getRange(1, 7).getValue()) !== 'ID') sh.getRange(1, 1, 1, VIEW_HDR.length).setValues([VIEW_HDR]).setFontWeight('bold');
  return sh;
}
function views_rows_(sh) {
  var vals = sh.getRange(1, 1, Math.max(1, sh.getLastRow()), VIEW_HDR.length).getValues();
  for (var i = 1; i < vals.length; i++) {
    if (!String(vals[i][0] || '')) continue;
    if (!String(vals[i][6] || '')) { vals[i][6] = Utilities.getUuid().replace(/-/g, '').slice(0, 10); sh.getRange(i + 1, 7).setNumberFormat('@').setValue(vals[i][6]); }
    if (!String(vals[i][4] || '')) vals[i][4] = 'private';
  }
  return vals;
}
function views_emails_(s) {
  return String(s || '').toLowerCase().split(/[\s,;]+/).filter(function (x) { return x; });
}
function views_kind_(r, me) {
  if (String(r[0]).toLowerCase() === me) return 'mine';
  if (String(r[4]) === 'public') return 'public';
  return views_emails_(r[5]).indexOf(me) >= 0 ? 'shared' : '';
}
function views_list_(ss, me) {
  var vals = views_rows_(views_sheet_(ss)), out = [];
  for (var i = 1; i < vals.length; i++) {
    if (!String(vals[i][0] || '')) continue;
    var kind = views_kind_(vals[i], me);
    if (!kind) continue;
    var v = {}; try { v = JSON.parse(vals[i][2] || '{}'); } catch (e) {}
    out.push({ id: String(vals[i][6]), name: String(vals[i][1]), owner: String(vals[i][0]).toLowerCase(), kind: kind, vis: String(vals[i][4] || 'private'),
      shared: kind === 'mine' ? views_emails_(vals[i][5]).join(', ') : '', view: v, updated: String(vals[i][3]) });
  }
  out.sort(function (a, b) { return a.name.localeCompare(b.name, 'tr'); });
  var g = GUEST_DEPLOYMENT_ID ? 'https://script.google.com/macros/s/' + GUEST_DEPLOYMENT_ID + '/exec' : '';
  var main = ''; try { main = ScriptApp.getService().getUrl() || ''; } catch (e) {}
  return { items: out, url: GUEST_ ? g : main, guest: g, me: me };
}
function apiViews(_a, gk) { GK_ = gk || '';
  return api_(function () { var me = who_(); return me ? views_list_(cfg_(), me) : { items: [], url: '', guest: '' }; });
}
function apiSaveView(json, gk) { GK_ = gk || '';
  return api_(function () {
    var me = who_();
    if (!me) throw new Error('Rapor kaydetmek için giriş yapılmış olmalı.');
    var o = JSON.parse(json), ss = cfg_(), sh = views_sheet_(ss);
    var lock = LockService.getScriptLock(); lock.waitLock(20000);
    try {
      var vals = views_rows_(sh), row = -1, i;
      if (o.id) {
        for (i = 1; i < vals.length; i++) if (String(vals[i][6]) === String(o.id)) { row = i + 1; break; }
        if (row < 0) throw new Error('Rapor bulunamadı (silinmiş olabilir).');
        var owner = String(vals[row - 1][0]).toLowerCase();
        if (owner !== me) throw new Error('Bu rapor ' + owner + ' tarafından kaydedildi; sadece sahibi değiştirebilir ya da silebilir.');
      }
      if (o.del) { if (row > 0) sh.deleteRow(row); return views_list_(ss, me); }
      var name = String(o.name || '').trim().slice(0, 80);
      if (!name) throw new Error('Rapor adı boş olamaz.');
      if (row < 0) for (i = 1; i < vals.length; i++) if (String(vals[i][0]).toLowerCase() === me && String(vals[i][1]) === name) { row = i + 1; break; }
      var vis = o.vis === 'public' ? 'public' : 'private';
      var shared = vis === 'public' ? [] : views_emails_(o.shared).filter(function (e) { return e !== me; });
      var bad = shared.filter(function (e) { return !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e); });
      if (bad.length) throw new Error('Geçersiz e-posta: ' + bad.join(', '));
      if (shared.length > 50) throw new Error('En fazla 50 kişiyle paylaşılabilir.');
      var js = JSON.stringify(o.view || {});
      if (js.length > 45000) throw new Error('Rapor ayarları çok büyük.');
      var id = row > 0 ? String(vals[row - 1][6]) : Utilities.getUuid().replace(/-/g, '').slice(0, 10);
      var rec = [me, name, js, sh_now_(), vis, shared.join(', '), id];
      if (row > 0) sh.getRange(row, 1, 1, rec.length).setNumberFormat('@').setValues([rec]);
      else sh.getRange(sh.getLastRow() + 1, 1, 1, rec.length).setNumberFormat('@').setValues([rec]);
      var res = views_list_(ss, me); res.saved = id; return res;
    } finally { lock.releaseLock(); }
  });
}

/** Paylaşılan rapor linki: ?r=<rapor ID> */
function RID_(e) { return String((e && e.parameter && e.parameter.r) || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 20); }
