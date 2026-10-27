/**
 * Creative.js — Kreatif raporu: tüm mecralardaki reklamlar / kreatifler (görsel, durum) + seçilen dönemdeki panel performansı.
 * Meta: Graph API'den reklam + kreatif bilgisi (görsel, video, önizleme linki) günde bir kez "Kreatifler" sayfasına yazılır.
 * Google Ads: ad seviyesindeki veri (gads_ad); durum = son 7 günde harcama var mı.
 */
var CR_HDR = ['platform', 'account_id', 'ad_id', 'name', 'status', 'object_type', 'thumb', 'image', 'video_id', 'preview', 'permalink', 'title', 'body', 'created', 'synced', 'catalog', 'texts'];
function cr_sheet_(ss) { return ss.getSheetByName('Kreatifler') || ss.insertSheet('Kreatifler'); }
function creative_syncDaily_(ss) {
  var last = sh_getState_(ss, 'CREATIVE_LAST'), s = sh_settings_(ss), csh = ss.getSheetByName('Kreatifler');
  var fresh = csh && csh.getLastColumn() >= CR_HDR.length && String(csh.getRange(1, CR_HDR.length).getValue()) === CR_HDR[CR_HDR.length - 1];
  if (fresh && last && !sh_dailyDue_(last, +s.DAILY_REFRESH_HOUR || 3)) return;
  creative_sync_(ss);
  sh_setState_(ss, 'CREATIVE_LAST', sh_now_());
}
function creative_sync_(ss) {
  var token = PropertiesService.getScriptProperties().getProperty('META_TOKEN');
  if (!token) return 0;
  var s = sh_settings_(ss), base = 'https://graph.facebook.com/' + (s.META_API_VERSION || 'v23.0') + '/';
  var fields = 'id,name,effective_status,created_time,preview_shareable_link,' +
    'creative.thumbnail_width(480).thumbnail_height(480){thumbnail_url,image_url,video_id,object_type,title,body,instagram_permalink_url,product_set_id,object_story_spec,asset_feed_spec}';
  var out = [], now = sh_now_();
  sh_accounts_(ss, 'Meta').filter(function (a) { return a.active; }).forEach(function (a) {
    var url = base + 'act_' + String(a.id).replace(/^act_/, '') + '/ads?fields=' + encodeURIComponent(fields) + '&limit=100&access_token=' + encodeURIComponent(token), pages = 0;
    while (url && pages++ < 40) {
      var j = fetchJson_(url);
      (j.data || []).forEach(function (ad) {
        var c = ad.creative || {};
        out.push(['Meta', String(a.id), String(ad.id), ad.name || '', ad.effective_status || '', c.object_type || '', c.thumbnail_url || '', c.image_url || '', c.video_id || '',
          ad.preview_shareable_link || '', c.instagram_permalink_url || '', String(c.title || '').slice(0, 300), String(c.body || '').slice(0, 600), String(ad.created_time || '').slice(0, 10), now, c.product_set_id ? 'yes' : '', JSON.stringify(cr_texts_(c)).slice(0, 40000)]);
      });
      url = j.paging && j.paging.next;
    }
  });
  var sh = cr_sheet_(ss); sh.clearContents();
  var rows = [CR_HDR].concat(out);
  sh.getRange(1, 1, rows.length, CR_HDR.length).setNumberFormat('@').setValues(rows);
  sh_log_(ss, 'kreatif', 'INFO', out.length + ' Meta reklamının kreatif bilgisi güncellendi');
  return out.length;
}
function cr_meta_(ss) {
  var sh = ss.getSheetByName('Kreatifler'), m = {};
  if (!sh || sh.getLastRow() < 2) return m;
  sh.getRange(2, 1, sh.getLastRow() - 1, Math.min(CR_HDR.length, sh.getLastColumn())).getValues().forEach(function (r) {
    m[r[0] + '|' + r[2]] = { st: String(r[4]), ty: String(r[5]), th: String(r[6]), im: String(r[7]), vi: String(r[8]), pv: String(r[9]), pl: String(r[10]), ti: String(r[11]), bo: String(r[12]), cr: String(r[13]), cat: String(r[15] || '') === 'yes', tx: (function () { try { return JSON.parse(r[16] || '[]'); } catch (e) { return []; } })() };
  });
  return m;
}
function q_creative_(ss, p) {
  var t0 = Date.now(), meta = cr_meta_(ss), perUsd = fx_loader_(ss), acc = {};
  sh_accounts_(ss).forEach(function (a) { acc[a.platform + '|' + a.id] = a; });
  var cpasOnly = !!p.cpas, by = {}, recent = {}, yday = sh_yesterday_(), r7 = sh_addDays_(yday, -6);
  function put(plat, r, ix, o) {
    var a = acc[plat + '|' + r[1]];
    if (!a || !a.active) return;
    var k = plat + '|' + o.id, x = by[k];
    if (!x) x = by[k] = { p: plat, id: o.id, n: o.n, c: o.c, g: o.g, acc: a.name, ty: o.ty || '', s: 0, i: 0, k: 0, cv: 0, v: 0, a: 0, f: r[0], l: r[0] };
    var rate = perUsd(r[0], r[ix.currency] || 'TRY') || 1;
    x.s += o.s / rate; x.i += o.i; x.k += o.k; x.cv += o.cv; x.v += o.v / rate; x.a += o.a || 0;
    if (r[0] < x.f) x.f = r[0];
    if (r[0] > x.l) { x.l = r[0]; x.n = o.n || x.n; }
  }
  q_readShards_(ss, 'meta_ad', p.from, p.to, function (r, ix) {
    if (cpasOnly !== cpas_is_(r[1])) return;
    put('Meta', r, ix, { id: String(r[ix.ad_id]), n: String(r[ix.ad_name] || ''), c: String(r[ix.campaign_name] || ''), g: String(r[ix.adset_name] || ''),
      s: +r[ix.spend] || 0, i: +r[ix.impressions] || 0, k: +r[ix.link_clicks] || 0, cv: +r[ix.purchases] || 0, v: +r[ix.purchase_value] || 0, a: +r[ix.add_to_cart] || 0 });
  });
  var texts = {};
  function addText(plat, ft, t, camp, o) {
    t = String(t || '').trim(); if (!t) return;
    var k = plat + '|' + ft + '|' + t, x = texts[k];
    if (!x) x = texts[k] = { p: plat, ft: ft, t: t, s: 0, i: 0, k: 0, cv: 0, v: 0, camps: {} };
    x.s += o.s || 0; x.i += o.i || 0; x.k += o.k || 0; x.cv += o.cv || 0; x.v += o.v || 0; if (camp) x.camps[camp] = 1;
  }
  if (!cpasOnly) {
    // Google Ads: görseller ve videolar ayrı kart (PMax asset group, Demand Gen / Display, Search görsel uzantıları); metinler ayrı listede
    var aR = function (r, ix) {
      var ty = String(r[ix.asset_type] || ''), ft = String(r[ix.field_type] || ''), camp = String(r[ix.campaign_name] || '');
      var a = acc['Google Ads|' + r[1]]; if (!a || !a.active) return;
      var rate = perUsd(r[0], r[ix.currency] || 'TRY') || 1;
      var m = { s: (+r[ix.cost] || 0) / rate, i: +r[ix.impressions] || 0, k: +r[ix.clicks] || 0, cv: +r[ix.conversions] || 0, v: (+r[ix.conv_value] || 0) / rate };
      if (ty !== 'IMAGE' && ty !== 'YOUTUBE_VIDEO') { if (r[ix.text]) addText('Google Ads', ft, r[ix.text], camp, m); return; }
      if (/LOGO/i.test(ft)) return; // işletme logoları kreatif değil
      var yt = String(r[ix.youtube_id] || ''), img = String(r[ix.image_url] || '');
      if (!yt && !img) return; // görüntülenemeyen varlık (ör. otomatik üretilmiş, ID'siz video) gösterilmez
      put('Google Ads', r, ix, { id: String(r[ix.asset_id]) + '@' + String(r[ix.container_id]), n: String(r[ix.asset_name] || '') || (yt ? 'YouTube ' + yt : 'Görsel ' + r[ix.asset_id]),
        c: camp, g: String(r[ix.container_name] || ''), ty: ft || ty, s: +r[ix.cost] || 0, i: m.i, k: m.k, cv: m.cv, v: +r[ix.conv_value] || 0 });
      var x = by['Google Ads|' + String(r[ix.asset_id]) + '@' + String(r[ix.container_id])];
      if (x && !x.src) x.src = String(r[ix.source] || '');
      if (x && !x.th) { x.th = yt ? 'https://i.ytimg.com/vi/' + yt + '/hqdefault.jpg' : img; x.im = img; x.vi = yt; x.pv = yt ? 'https://youtu.be/' + yt : img; x.lvl = String(r[ix.level] || ''); }
    };
    q_readShards_(ss, 'ext_ad', p.from, p.to, function (r, ix) {
      var plat = String(r[ix.platform] || ''), camp = String(r[ix.campaign_name] || ''), a = acc[plat + '|' + r[1]];
      if (!a || !a.active) return;
      var rate = perUsd(r[0], r[ix.currency] || 'TRY') || 1;
      var m = { s: (+r[ix.spend] || 0) / rate, i: +r[ix.impressions] || 0, k: +r[ix.clicks] || 0, cv: +r[ix.conversions] || 0, v: (+r[ix.conv_value] || 0) / rate };
      if (r[ix.title]) addText(plat, 'Başlık', r[ix.title], camp, m);
      if (r[ix.text]) addText(plat, 'Metin', r[ix.text], camp, m);
      if (!r[ix.image_url] && !r[ix.html_url]) return; // görseli olmayan metin reklamları sadece Metinler'de
      put(plat, r, ix, { id: String(r[ix.ad_id]), n: String(r[ix.ad_name] || r[ix.ad_id]), c: camp, g: String(r[ix.group_name] || ''), ty: String(r[ix.ad_type] || ''),
        s: +r[ix.spend] || 0, i: m.i, k: m.k, cv: m.cv, v: +r[ix.conv_value] || 0 });
      var x = by[plat + '|' + String(r[ix.ad_id])];
      if (x && !x.meta) { x.meta = 1; x.im = String(r[ix.image_url] || ''); x.th = x.im; x.hu = String(r[ix.html_url] || ''); x.hw = +r[ix.width] || 0; x.hh = +r[ix.height] || 0;
        x.ti = String(r[ix.title] || ''); x.bo = String(r[ix.text] || ''); x.st = String(r[ix.status] || ''); x.pv = x.hu || x.im; }
    });
    q_readShards_(ss, 'gads_asset', p.from, p.to, aR);
    q_readShards_(ss, 'gads_asset_2', p.from, p.to, aR);
    var gRecent = function (r, ix) { if ((+r[ix.impressions] || 0) > 0) recent['Google Ads|' + r[ix.asset_id] + '@' + r[ix.container_id]] = 1; };
    q_readShards_(ss, 'gads_asset', r7, yday, gRecent);
    q_readShards_(ss, 'gads_asset_2', r7, yday, gRecent);
  }
  var items = [], nAct = 0;
  Object.keys(by).forEach(function (k) {
    var x = by[k], m = meta[k];
    if (m && x.p === 'Meta' && m.cat && !m.im && !m.vi) return; // görsel / video kullanmayan katalog reklamı
    if (m && x.p === 'Meta') { if (m.tx && m.tx.length) m.tx.forEach(function (t) { addText('Meta', t[0], t[1], x.c, x); }); else { if (m.ti) addText('Meta', 'Headline', m.ti, x.c, x); if (m.bo) addText('Meta', 'Primary text', m.bo, x.c, x); } }
    if (m) { x.st = m.st; x.ty = m.ty || x.ty; x.th = m.th; x.im = m.im; x.vi = m.vi; x.pv = m.pv; x.pl = m.pl; x.ti = m.ti; x.bo = m.bo; x.cr = m.cr; x.act = m.st === 'ACTIVE'; }
    else if (x.p === 'Meta') { x.st = ''; x.act = x.l >= r7; }
    else if (x.meta) { x.act = x.st === 'ACTIVE' && x.l >= r7; }
    else { x.act = !!recent[k]; x.st = x.act ? 'ACTIVE' : 'INACTIVE'; }
    if (x.act) nAct++;
    if (p.status === 'active' && !x.act) return;
    x.s = Math.round(x.s * 100) / 100; x.v = Math.round(x.v * 100) / 100;
    items.push(x);
  });
  items.sort(function (a, b) { return b.s - a.s; });
  var sh = ss.getSheetByName('Kreatifler');
  var tl = Object.keys(texts).map(function (k) { var t = texts[k]; t.nc = Object.keys(t.camps).length; delete t.camps; t.s = Math.round(t.s * 100) / 100; t.v = Math.round(t.v * 100) / 100; return t; })
    .sort(function (a, b) { return b.i - a.i; }).slice(0, 3000);
  var gHas = Object.keys(by).some(function (k) { return k.indexOf('Google Ads|') === 0; });
  return { texts: tl, gAssets: gHas, items: items.slice(0, 1500), total: Object.keys(by).length, active: nAct, synced: sh_getState_(ss, 'CREATIVE_LAST') || '', ms: Date.now() - t0,
    warnings: Object.keys(by).length ? [] : ['Seçilen aralıkta ad seviyesinde veri yok.'] };
}
function apiCreative(paramsJson, gk) { GK_ = gk || '';
  return api_(function () {
    var p = JSON.parse(paramsJson);
    if (p.to > sh_yesterday_()) p.to = sh_yesterday_();
    return q_creative_(cfg_(), p);
  });
}

/** Meta kreatifinde kullanıcının gördüğü metinler: primary text, headline, description (tekil, carousel, dinamik / Advantage+ varyasyonları). */
function cr_texts_(c) {
  var out = [], seen = {};
  function add(t, v) { v = String(v || '').trim(); if (!v || seen[t + '|' + v]) return; seen[t + '|' + v] = 1; out.push([t, v.slice(0, 600)]); }
  add('Primary text', c.body); add('Headline', c.title);
  var o = c.object_story_spec || {}, ld = o.link_data || {}, vd = o.video_data || {}, td = o.template_data || {};
  add('Primary text', ld.message); add('Headline', ld.name); add('Description', ld.description);
  add('Primary text', vd.message); add('Headline', vd.title); add('Description', vd.link_description);
  add('Primary text', td.message); add('Headline', td.name); add('Description', td.description);
  (ld.child_attachments || []).forEach(function (ch) { add('Headline', ch.name); add('Description', ch.description); });
  var af = c.asset_feed_spec || {};
  (af.bodies || []).forEach(function (b) { add('Primary text', b.text); });
  (af.titles || []).forEach(function (b) { add('Headline', b.text); });
  (af.descriptions || []).forEach(function (b) { add('Description', b.text); });
  return out;
}

/* ======================= Diğer mecraların kreatifleri (ext_ad): RTB House, Yandex Direct ======================= */
var EXTAD_HDR = ['date', 'account_id', 'platform', 'campaign_id', 'campaign_name', 'group_name', 'ad_id', 'ad_name', 'ad_type', 'image_url', 'html_url', 'width', 'height',
  'title', 'text', 'status', 'impressions', 'clicks', 'spend', 'conversions', 'conv_value', 'currency'];
var EXTAD_TEXT = ['platform', 'campaign_id', 'campaign_name', 'group_name', 'ad_id', 'ad_name', 'ad_type', 'image_url', 'html_url', 'title', 'text', 'status', 'currency'];
/** Her senkronda: günlük son 14 gün yenileme + START_DATE'e kadar ay ay geçmiş (çalıştırma başına en fazla ~90 sn). */
function extad_syncAll_(ss) {
  var t0 = Date.now(), s = sh_settings_(ss), start = s.START_DATE || '2025-01-01', yday = sh_yesterday_(), pp = PropertiesService.getScriptProperties();
  var jobs = [];
  if (pp.getProperty('RTBHOUSE_TOKEN')) sh_accounts_(ss, 'RTB House').filter(function (a) { return a.active; }).forEach(function (a) { jobs.push(['rtbhouse', 'RTB House', a]); });
  if (pp.getProperty('YANDEX_TOKEN')) sh_accounts_(ss, 'Yandex Direct').filter(function (a) { return a.active; }).forEach(function (a) { jobs.push(['yandex', 'Yandex Direct', a]); });
  jobs.forEach(function (j) {
    var key = 'EXTAD_' + j[0] + '_' + j[2].id;
    try {
      if (sh_dailyDue_(sh_getState_(ss, key + '_LAST'), +s.DAILY_REFRESH_HOUR || 3)) {
        var rf = sh_addDays_(yday, -13); if (rf < start) rf = start;
        extad_run_(ss, j, rf, yday); sh_setState_(ss, key + '_LAST', sh_now_());
      }
      var cur = sh_getState_(ss, key + '_CURSOR') || yday.slice(0, 7);
      while (cur >= start.slice(0, 7) && Date.now() - t0 < 90000) {
        var f = cur + '-01', to = sh_monthEnd_(f); if (to > yday) to = yday; if (f < start) f = start;
        extad_run_(ss, j, f, to);
        cur = sh_addDays_(cur + '-01', -1).slice(0, 7); sh_setState_(ss, key + '_CURSOR', cur);
      }
    } catch (e) { sh_log_(ss, 'kreatif', 'WARN', j[1] + ': ' + (e.message || e)); }
  });
}
function extad_run_(ss, j, from, to) {
  var rows = j[0] === 'rtbhouse' ? extad_rtb_(ss, j[2], from, to) : extad_yandex_(ss, j[2], from, to);
  st_upsert_(ss, 'ext_ad', EXTAD_HDR, rows, { accounts: [String(j[2].id)], from: from, to: to }, EXTAD_TEXT);
  sh_log_(ss, 'kreatif', 'INFO', j[1] + ' ' + from + '→' + to + ': ' + rows.length + ' kreatif satırı');
}
function extad_rtbGet_(path, token) {
  var r = UrlFetchApp.fetch('https://api.panel.rtbhouse.com/v5/' + path, { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
  var b = null; try { b = JSON.parse(r.getContentText()); } catch (e) {}
  if (r.getResponseCode() >= 300 || !b || b.status !== 'ok') throw new Error('RTB House HTTP ' + r.getResponseCode() + ' ' + r.getContentText().slice(0, 200));
  return b.data || [];
}
function extad_rtb_(ss, a, from, to) {
  var token = ext_token_('rtbhouse'), hash = String(a.id), s = sh_settings_(ss);
  var prev = {};
  extad_rtbGet_('advertisers/' + hash + '/rtb-creatives', token).forEach(function (c) { prev[c.hash] = c.previews || []; });
  var st = extad_rtbGet_('advertisers/' + hash + '/rtb-stats?dayFrom=' + from + '&dayTo=' + to + '&groupBy=day-creative&metrics=campaignCost-impsCount-clicksCount-conversionsCount-conversionsValue&countConvention=' +
    encodeURIComponent(s.RTBHOUSE_COUNT_CONVENTION || 'ATTRIBUTED'), token);
  return st.map(function (d) {
    var pv = prev[d.creative] || [], w = +d.creativeWidth || 0, h = +d.creativeHeight || 0;
    var m = pv.filter(function (x) { return +x.width === w && +x.height === h; })[0] || pv[0] || {};
    return [d.day, hash, 'RTB House', '', a.name || 'RTB House', d.creativeNamesFamily || '', String(d.creative), d.creativeName || '', d.creativeType || '', '', m.previewUrl || '',
      w || m.width || '', h || m.height || '', '', '', d.creativeStatus || '', +d.impsCount || 0, +d.clicksCount || 0, +d.campaignCost || 0, +d.conversionsCount || 0, +d.conversionsValue || 0, a.currency || 'TRY'];
  });
}
function extad_yxCall_(service, params, token, login) {
  var res = UrlFetchApp.fetch('https://api.direct.yandex.com/json/v5/' + service, { method: 'post', contentType: 'application/json; charset=utf-8', muteHttpExceptions: true,
    headers: yandex_headers_(token, login), payload: JSON.stringify({ method: 'get', params: params }) });
  var b = JSON.parse(res.getContentText());
  if (b.error) throw new Error('Yandex ' + service + ' ' + b.error.error_code + ': ' + b.error.error_string + ' ' + (b.error.error_detail || ''));
  return b.result || {};
}
function extad_yandex_(ss, a, from, to) {
  var token = ext_token_('yandex'), login = String(a.id), s = sh_settings_(ss), cur = a.currency || 'TRY';
  var vat = String(s.YANDEX_INCLUDE_VAT || 'NO').toUpperCase() === 'YES' ? 'YES' : 'NO';
  var payload = JSON.stringify({ params: {
    SelectionCriteria: { DateFrom: from, DateTo: to },
    FieldNames: ['Date', 'CampaignId', 'CampaignName', 'AdGroupName', 'AdId', 'Impressions', 'Clicks', 'Cost', 'Conversions', 'Revenue'],
    ReportName: 'kreatif_' + login + '_' + from + '_' + to + '_' + vat, ReportType: 'AD_PERFORMANCE_REPORT', DateRangeType: 'CUSTOM_DATE',
    Format: 'TSV', IncludeVAT: vat, IncludeDiscount: 'NO' } });
  var h = yandex_headers_(token, login); h.processingMode = 'auto'; h.returnMoneyInMicros = 'false'; h.skipReportHeader = 'true'; h.skipReportSummary = 'true';
  var t0 = Date.now(), res, code;
  while (true) {
    res = UrlFetchApp.fetch('https://api.direct.yandex.com/json/v5/reports', { method: 'post', contentType: 'application/json; charset=utf-8', headers: h, payload: payload, muteHttpExceptions: true });
    code = res.getResponseCode();
    if (code === 200) break;
    if (code === 201 || code === 202) {
      if (Date.now() - t0 > 60000) throw new Error('Yandex reklam raporu hazırlanıyor (sonraki senkronda devam)');
      Utilities.sleep(Math.min(+(res.getHeaders().retryIn || res.getHeaders().RetryIn || 10), 15) * 1000); continue;
    }
    throw new Error('Yandex HTTP ' + code + ' ' + res.getContentText().slice(0, 300));
  }
  var lines = res.getContentText().split('\n').filter(String);
  if (lines.length < 2) return [];
  var head = lines[0].split('\t'), ix = {}; head.forEach(function (k, i) { ix[k] = i; });
  var num = function (v) { return v == null || v === '--' ? 0 : +v || 0; };
  var data = lines.slice(1).map(function (l) { return l.split('\t'); });
  var ids = {}; data.forEach(function (c) { ids[c[ix.AdId]] = 1; });
  var meta = {}, list = Object.keys(ids);
  for (var i = 0; i < list.length; i += 1000) {
    var r = extad_yxCall_('ads', { SelectionCriteria: { Ids: list.slice(i, i + 1000).map(Number) }, FieldNames: ['Id', 'Type', 'State', 'Status'],
      TextAdFieldNames: ['Title', 'Title2', 'Text', 'AdImageHash'], TextImageAdFieldNames: ['AdImageHash'] }, token, login);
    (r.Ads || []).forEach(function (ad) { meta[String(ad.Id)] = ad; });
  }
  var hashes = {};
  Object.keys(meta).forEach(function (k) { var m = meta[k], hh = (m.TextAd && m.TextAd.AdImageHash) || (m.TextImageAd && m.TextImageAd.AdImageHash); if (hh) hashes[hh] = 1; });
  var img = {}, hl = Object.keys(hashes);
  for (var q = 0; q < hl.length; q += 1000) {
    try { (extad_yxCall_('adimages', { SelectionCriteria: { AdImageHashes: hl.slice(q, q + 1000) }, FieldNames: ['AdImageHash', 'OriginalUrl', 'PreviewUrl'] }, token, login).AdImages || [])
      .forEach(function (x) { img[x.AdImageHash] = x.OriginalUrl || x.PreviewUrl || ''; }); } catch (e) {}
  }
  return data.map(function (c) {
    var m = meta[c[ix.AdId]] || {}, ta = m.TextAd || {}, hh = ta.AdImageHash || (m.TextImageAd && m.TextImageAd.AdImageHash) || '';
    var title = [ta.Title, ta.Title2].filter(Boolean).join(' — ');
    return [c[ix.Date], login, 'Yandex Direct', c[ix.CampaignId], c[ix.CampaignName], c[ix.AdGroupName] || '', String(c[ix.AdId]), title || ('Reklam ' + c[ix.AdId]), m.Type || '',
      img[hh] || '', '', '', '', title, ta.Text || '', m.State === 'ON' ? 'ACTIVE' : (m.State || ''), num(c[ix.Impressions]), num(c[ix.Clicks]), num(c[ix.Cost]),
      num(c[ix.Conversions]), num(c[ix.Revenue]), cur];
  });
}
