/**
 * Cube.js — hız katmanı.
 *
 * 1) Rapor küpü: Google Ads + Meta kampanya/gün verisi, GA4 (web) ve Adjust (app) ile ÖNCEDEN eşleştirilmiş halde,
 *    tek bir gzip'li JSON dosyasında (Drive) tutulur. Eşleştirme sadece küp kurulurken bir kez yapılır.
 *    Toplam / Ülke / Platform / Hesap / Kampanya seviyeleri bu küpten okunur (onlarca Sheets dosyası yerine tek dosya).
 *    Küp; veri dosyaları güncellendiğinde runSync (10 dk tetikleyici) tarafından yeniden kurulur.
 * 2) Sorgu önbelleği: aynı parametreli sorgu sonucu CacheService'te tutulur (küp sürümüne bağlı → veri değişince geçersiz).
 */

var CUBE_MIN_REBUILD_MIN = 30;   // backfill sırasında en fazla 30 dk'da bir yeniden kur
var QCACHE_TTL = 6 * 3600;       // sn

// Küp satırı: [date, campIdx, spend, spend_usd, clicks, impressions, installs,
//              ga_sessions, ga_purchases, ga_revenue_usd, adj_sessions, adj_purchases, adj_revenue_usd, adj_installs,
//              adj_c_purchases, adj_c_revenue_usd]   (Adjust 0W cohort)
var CUBE_SUM_KEYS = ['spend', 'spend_usd', 'clicks', 'impressions', 'installs',
  'ga_sessions', 'ga_purchases', 'ga_revenue_usd', 'adj_sessions', 'adj_purchases', 'adj_revenue_usd', 'adj_installs', 'adj_c_purchases', 'adj_c_revenue_usd'];

function cube_build_(ss) {
  var t0 = Date.now();
  var s = sh_settings_(ss);
  var from = s.START_DATE || '2025-01-01', to = sh_yesterday_();
  var perUsd = fx_loader_(ss);
  var camps = [], campIdx = {}, byKey = {}, byId = {};
  var rows = {}, nRows = 0;
  function camp(platform, acct, cid, cname, cur) {
    var k = platform + '|' + acct + '|' + cid;
    var i = campIdx[k];
    if (i == null) {
      i = campIdx[k] = camps.length;
      camps.push([platform, String(acct), String(cid), String(cname), String(cur || '')]);
    } else camps[i][3] = String(cname); // en güncel ad
    return i;
  }
  function row(date, ci) {
    var k = date + '|' + ci;
    var r = rows[k];
    if (!r) { r = rows[k] = [date, ci, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; nRows++; }
    return r;
  }
  // 1) platform
  var gRead = function (r, ix) {
    var name = String(r[ix.campaign_name]), ch = String(r[ix.channel_type] || ''), cur = r[ix.currency];
    var ci = camp('Google Ads', r[1], r[ix.campaign_id], name, cur);
    var rr = row(r[0], ci), cost = +r[ix.cost] || 0, rate = perUsd(r[0], cur);
    rr[2] += cost; rr[3] += rate ? cost / rate : 0;
    rr[4] += +r[ix.clicks] || 0; rr[5] += +r[ix.impressions] || 0;
    if (ch === 'MULTI_CHANNEL' && !/engagement/i.test(name)) rr[6] += +r[ix.conversions] || 0;
  };
  q_readShards_(ss, 'gads_campaign', from, to, gRead);
  q_readShards_(ss, 'gads_campaign_2', from, to, gRead);
  q_readShards_(ss, 'meta_campaign', from, to, function (r, ix) {
    var cur = r[ix.currency];
    var ci = camp('Meta', r[1], r[ix.campaign_id], r[ix.campaign_name], cur);
    var rr = row(r[0], ci), sp = +r[ix.spend] || 0, rate = perUsd(r[0], cur);
    rr[2] += sp; rr[3] += rate ? sp / rate : 0;
    rr[4] += +r[ix.link_clicks] || 0; rr[5] += +r[ix.impressions] || 0; rr[6] += +r[ix.installs] || 0;
  });
  camps.forEach(function (c, i) {
    var k = r_ckey_(c[3]);
    if (k && !(k in byKey)) byKey[k] = i;
    byId[c[2]] = i;
  });

  // 2) GA4 (web) + Adjust (app) eşleştirme — sadece burada, bir kez
  var unmatched = {}, diag = { ga4: { rows: 0, sessions: 0, matched: 0 }, adj: { rows: 0, sessions: 0, matched: 0 } };
  function miss(src, month, name, country, sess, pur) {
    var k = src + '|' + month + '|' + name + '|' + country;
    var u = unmatched[k] || (unmatched[k] = [month, src, name, country, 0, 0]);
    u[4] += sess; u[5] += pur;
  }
  ga4_rows_(ss, from, to, function (r, ix, pa, code) {
    var name = ix.sessionCampaignName != null ? String(r[ix.sessionCampaignName]) : '';
    var sess = ix.sessions != null ? +r[ix.sessions] || 0 : 0;
    var pur = ix.ecommercePurchases != null ? +r[ix.ecommercePurchases] || 0 : 0;
    diag.ga4.rows++; diag.ga4.sessions += sess;
    var id = r_cid_(name);
    var ci = id && byId[id] != null ? byId[id] : r_ckLookup_(byKey, name);
    if (ci == null) { miss('GA4', r[0].slice(0, 7), name, code || '', sess, pur); return; }
    diag.ga4.matched += sess;
    var rate = perUsd(r[0], (pa && pa.currency) || 'USD');
    var rev = ix.purchaseRevenue != null ? +r[ix.purchaseRevenue] || 0 : 0;
    var rr = row(r[0], ci);
    rr[7] += sess; rr[8] += pur; rr[9] += rate ? rev / rate : 0;
  });
  var pm = String(s.ADJUST_PURCHASE_METRIC || 'revenue_events').trim();
  var rm = String(s.ADJUST_REVENUE_METRIC || 'revenue').trim();
  var acur = String(s.ADJUST_CURRENCY || 'USD').trim().toUpperCase();
  q_readShards_(ss, 'adjust', from, to, function (r, ix) {
    var name = String(r[ix.campaign] || '');
    var sess = ix.sessions != null ? +r[ix.sessions] || 0 : 0;
    var pur = ix[pm] != null ? +r[ix[pm]] || 0 : 0;
    diag.adj.rows++; diag.adj.sessions += sess;
    var id = r_cid_(name);
    var ci = id && byId[id] != null ? byId[id] : r_ckLookup_(byKey, name);
    if (ci == null) { miss('Adjust', r[0].slice(0, 7), name, String(r[ix.country] || ''), sess, pur); return; }
    diag.adj.matched += sess;
    var rate = perUsd(r[0], acur);
    var rev = ix[rm] != null ? +r[ix[rm]] || 0 : 0;
    var rr = row(r[0], ci);
    rr[10] += sess; rr[11] += pur; rr[12] += rate ? rev / rate : 0; rr[13] += ix.installs != null ? +r[ix.installs] || 0 : 0;
    rr[14] += ix.cohort_purchases != null ? +r[ix.cohort_purchases] || 0 : 0;
    rr[15] += ix.cohort_revenue != null && rate ? (+r[ix.cohort_revenue] || 0) / rate : 0;
  });

  var list = [];
  for (var k in rows) list.push(rows[k].map(function (v, i) { return i > 1 && typeof v === 'number' ? Math.round(v * 100) / 100 : v; }));
  var um = Object.keys(unmatched).map(function (k) { return unmatched[k]; });
  var cube = { v: sh_now_(), from: from, to: to, camps: camps, rows: list, unmatched: um, diag: diag };
  var blob = Utilities.gzip(Utilities.newBlob(JSON.stringify(cube), 'application/json', 'report_cube.json'), 'report_cube.json.gz');
  var props2 = PropertiesService.getScriptProperties();
  var fid = props2.getProperty('CUBE_FILE_ID');
  // gzip ikili olduğu için her kurulumda yeni dosya yazılır, eskisi çöpe atılır
  var folderId = s.DATA_FOLDER_ID;
  var folder = folderId ? DriveApp.getFolderById(folderId) : DriveApp.getRootFolder();
  var file = folder.createFile(blob);
  if (fid) { try { DriveApp.getFileById(fid).setTrashed(true); } catch (e) {} }
  props2.setProperties({ CUBE_FILE_ID: file.getId(), CUBE_BUILT_AT: cube.v });
  CacheService.getScriptCache().remove('cube_meta');
  sh_log_(ss, 'cube', 'INFO', 'Rapor küpü kuruldu: ' + camps.length + ' kampanya, ' + list.length + ' satır, ' +
    Math.round(blob.getBytes().length / 1024) + ' KB, ' + Math.round((Date.now() - t0) / 1000) + ' sn. GA4 eşleşme: ' +
    pct_(diag.ga4.matched, diag.ga4.sessions) + ' · Adjust eşleşme: ' + pct_(diag.adj.matched, diag.adj.sessions));
  return { campaigns: camps.length, rows: list.length, diag: diag };
}

function pct_(a, b) { return b ? Math.round(a / b * 1000) / 10 + '%' : '—'; }

var CUBE_MEM_ = null;
function cube_load_() {
  var p = PropertiesService.getScriptProperties();
  var id = p.getProperty('CUBE_FILE_ID');
  if (!id) return null;
  var v = p.getProperty('CUBE_BUILT_AT');
  if (CUBE_MEM_ && CUBE_MEM_.v === v) return CUBE_MEM_;
  var blob = DriveApp.getFileById(id).getBlob();
  blob.setContentType('application/x-gzip');
  CUBE_MEM_ = JSON.parse(Utilities.ungzip(blob).getDataAsString());
  return CUBE_MEM_;
}

/** Veri dosyaları küpten yeni mi? (registry updated_at > küp kurulum zamanı) */
function cube_stale_(ss) {
  var p = PropertiesService.getScriptProperties();
  var built = p.getProperty('CUBE_BUILT_AT') || '';
  if (!p.getProperty('CUBE_FILE_ID')) return true;
  var reg = st_registry_(ss), newest = '';
  for (var k in reg) {
    var u = reg[k].updated instanceof Date ? Utilities.formatDate(reg[k].updated, SHARED_TZ, 'yyyy-MM-dd HH:mm:ss') : String(reg[k].updated);
    if (u > newest) newest = u;
  }
  return newest > built;
}

/** runSync içinden: bayatsa ve son kurulumdan beri yeterli süre geçtiyse küpü yeniden kur. */
function cube_maybeRebuild_(ss, force) {
  var p = PropertiesService.getScriptProperties();
  var built = p.getProperty('CUBE_BUILT_AT') || '';
  if (!force) {
    if (!cube_stale_(ss)) return false;
    var m = /(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/.exec(built);
    if (m) {
      var age = (Date.now() - new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime()) / 60000;
      // saat dilimi farkı için tolerans: script TZ İstanbul
      if (age < CUBE_MIN_REBUILD_MIN) return false;
    }
  }
  cube_build_(ss);
  return true;
}

/** Küp üzerinden rapor (Toplam…Kampanya seviyeleri). */
function q_reportCube_(ss, p, cube) {
  var t0 = Date.now();
  var level = R_LEVELS[p.level] ? p.level : 'campaign';
  var groupFields = R_LEVELS[level];
  var hasAcct = groupFields.indexOf('account_id') >= 0;
  var metrics = R_METRICS.filter(function (m) { return hasAcct || !m.orig; });
  var acc = {};
  sh_accounts_(ss).forEach(function (a) { acc[a.platform + '|' + a.id] = a; });
  var f = p.filters || {};
  var plat = f.platforms && f.platforms.length ? q_set_(f.platforms) : null;
  var cset = f.countries && f.countries.length ? q_set_(f.countries) : null;
  var aset = f.accounts && f.accounts.length ? q_set_(f.accounts) : null;
  var tips = f.tips && f.tips.length ? f.tips : null;
  var inc = q_regex_(f.campInc), exc = q_regex_(f.campExc), kindFn = q_kindFn_(f);
  var eq = f.eq || {};
  var pickFn = r_pickFn_(f);

  // kampanya boyutlarını bir kez hesapla (filtre dışı = null)
  var dims = cube.camps.map(function (c) {
    var a = acc[c[0] + '|' + c[1]];
    if (!a || !a.active) return null;
    if (plat && !plat[c[0]]) return null;
    if (cset && !cset[a.code]) return null;
    if (aset && !aset[c[0] + '|' + c[1]]) return null;
    if (tips && !tips.some(function (t) { return a.tip.indexOf(t) >= 0; })) return null;
    if (inc && !inc.test(c[3])) return null;
    if (exc && exc.test(c[3])) return null;
    if (kindFn && !kindFn(c[3])) return null;
    var d = { platform: c[0], country: a.code, tip: a.tip, account_name: a.name, account_id: c[1], campaign_id: c[2], campaign_name: c[3], currency: c[4] };
    for (var k in eq) if (eq[k] !== '' && eq[k] != null && String(d[k]) !== String(eq[k])) return null;
    if (pickFn && !pickFn(d)) return null;
    return d;
  });
  var agg = q_agg_(groupFields, p.grain, R_SUMS);
  var rows = cube.rows, from = p.from, to = p.to;
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (r[0] < from || r[0] > to) continue;
    var d = dims[r[1]];
    if (!d) continue;
    agg.add({
      date: r[0], platform: d.platform, country: d.country, account_name: d.account_name, account_id: d.account_id,
      campaign_name: d.campaign_name, campaign_id: d.campaign_id, currency: d.currency,
      spend: r[2], spend_usd: r[3], clicks: r[4], impressions: r[5], installs: r[6],
      ga_sessions: r[7], ga_purchases: r[8], ga_revenue_usd: r[9],
      adj_sessions: r[10], adj_purchases: r[11], adj_revenue_usd: r[12], adj_installs: r[13], adj_c_purchases: r[14] || 0, adj_c_revenue_usd: r[15] || 0
    });
  }
  var out = r_build_(agg, groupFields, p.grain, metrics);
  out.warnings = [];
  if (!cube.rows.length) out.warnings.push('Henüz veri yok (senkron devam ediyor olabilir).');
  if (out.truncated) out.warnings.push(out.truncated + ' satırdan ilk 60.000 gösteriliyor. Filtre ekleyin.');

  // eşleşme özeti + eşleşmeyenler (seçili tarih ve ülke)
  var fm = from.slice(0, 7), tm = to.slice(0, 7), um = {};
  cube.unmatched.forEach(function (u) {
    if (u[0] < fm || u[0] > tm) return;
    if (cset && u[3] && !cset[u[3]]) return;
    var k = u[1] + '|' + u[2];
    var x = um[k] || (um[k] = { src: u[1], name: u[2], sessions: 0, purchases: 0 });
    x.sessions += u[4]; x.purchases += u[5];
  });
  out.unmatched = Object.keys(um).map(function (k) { return um[k]; }).sort(function (a, b) { return b.sessions - a.sessions; }).slice(0, 50);
  out.diag = cube.diag;
  out.cubeAt = cube.v;
  out.ms = Date.now() - t0;
  return out;
}

/* ---------------- sorgu önbelleği (CacheService, parçalı) ---------------- */

function qcache_key_(p) {
  var v = PropertiesService.getScriptProperties().getProperty('CUBE_BUILT_AT') || '';
  var d = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(p) + '|' + v);
  return 'q' + Utilities.base64EncodeWebSafe(d).replace(/=+$/, '');
}

function qcache_get_(key) {
  try {
    var c = CacheService.getScriptCache();
    var n = c.get(key + ':n');
    if (!n) return null;
    var keys = [];
    for (var i = 0; i < +n; i++) keys.push(key + ':' + i);
    var parts = c.getAll(keys);
    var out = '';
    for (var j = 0; j < keys.length; j++) { if (parts[keys[j]] == null) return null; out += parts[keys[j]]; }
    return out;
  } catch (e) { return null; }
}

function qcache_put_(key, str) {
  try {
    if (str.length > 4 * 1024 * 1024) return;
    var c = CacheService.getScriptCache(), CH = 45000, obj = {}, n = Math.ceil(str.length / CH);
    for (var i = 0; i < n; i++) obj[key + ':' + i] = str.slice(i * CH, (i + 1) * CH);
    obj[key + ':n'] = String(n);
    c.putAll(obj, QCACHE_TTL);
  } catch (e) {}
}

/**
 * GA4 satırlarını okur. Global property (Settings > GA4_GLOBAL_PROPERTY) ülke kırılımlıdır (country = ISO kod).
 * Aynı gün + ülke için global veri varsa o ülkenin kendi property'sinin satırları atlanır (çift sayım olmaz);
 * global'de olmayan dönemler (taşınmadan önce) ülke property'sinden gelir.
 * cb(row, ix, propertyAccount, countryCode)
 */
function ga4_rows_(ss, from, to, cb) {
  var gid = String(sh_settings_(ss).GA4_GLOBAL_PROPERTY || '').trim();
  var props = {};
  sh_accounts_(ss, 'GA4').forEach(function (a) { props[a.id] = a; });
  var buf = [], cover = {};
  q_readShards_(ss, 'ga4', from, to, function (r, ix) {
    var id = String(r[1]), pa = props[id];
    if (pa && !pa.active) return;
    var isG = !!gid && id === gid;
    var code = isG ? String(ix.country != null ? r[ix.country] : '').toUpperCase() : ((pa && pa.code) || '');
    if (isG) cover[r[0] + '|' + code] = 1;
    buf.push([r, ix, pa, code, isG]);
  });
  for (var i = 0; i < buf.length; i++) {
    var b = buf[i];
    if (!b[4] && b[3] && cover[b[0][0] + '|' + b[3]]) continue;
    cb(b[0], b[1], b[2], b[3]);
  }
}
