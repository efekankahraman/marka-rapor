/**
 * Marka Rapor — Microsoft Advertising (Bing) Script
 * ------------------------------------------------------------
 * Nereye: ads.microsoft.com > Araçlar (Tools) > Toplu işlemler (Bulk actions) > Script'ler (Scripts) > + Oluştur
 *   Ajans (manager) seviyesinde ya da doğrudan hesabın içinde çalışabilir.
 * Ne yapar: Hesabın kampanya × gün harcama / gösterim / tıklama / dönüşüm / gelir verisini rapora gönderir.
 *   - Her çalıştırmada son LOOKBACK günü yeniler
 *   - Geçmişi (START_DATE'e kadar) her çalıştırmada BACKFILL_DAYS gün geriye giderek doldurur
 * Zamanlama: "Saatlik" (Hourly). Geçmiş birkaç saatte dolar, sonra her saat son günleri tazeler.
 * Veri bugünü içermez.
 */

var PUSH_URL = '__PUSH_URL__';          // raporun misafir web uygulaması linki
var PUSH_KEY = '__PUSH_KEY__';          // Brand.js > BING_PUSH_KEY
var ACCOUNT_NUMBERS = __ACCOUNTS__;     // Config > Accounts > Microsoft Ads hesap numaraları
var DEFAULT_START = '__START_DATE__';
var BACKFILL_DAYS = 45;
var MIN_MS_LEFT = 90 * 1000;

function main() {
  var managed = false;
  try {
    if (typeof AccountsApp !== 'undefined' && AccountsApp.accounts) {
      var it = AccountsApp.accounts().withAccountNumbers(ACCOUNT_NUMBERS).get();
      while (it.hasNext()) {
        var a = it.next();
        AccountsApp.switchToAccount(a);
        managed = true;
        runAccount_();
      }
    }
  } catch (e) {
    Logger.log('Manager modu kullanılamadı (' + e + '), mevcut hesapla devam.');
  }
  if (!managed) runAccount_();
}

function left_() {
  try { return AdsApp.getExecutionInfo().getRemainingTime() * 1000; } catch (e) { return 10 * 60 * 1000; }
}

function post_(o) {
  o.key = PUSH_KEY;
  var res = UrlFetchApp.fetch(PUSH_URL, { method: 'POST', contentType: 'application/json', payload: JSON.stringify(o) });
  var txt = res.getContentText();
  try { return JSON.parse(txt); } catch (e) { return { ok: false, error: 'Yanıt okunamadı: ' + String(txt).slice(0, 200) }; }
}

function ymd_(d) { return d.toISOString().slice(0, 10); }
function addDays_(s, n) { var d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return ymd_(d); }
function yesterdayIst_() { return addDays_(ymd_(new Date(Date.now() + 3 * 3600 * 1000)), -1); }

/** Bir günün kampanya satırları: [date, campaign_id, campaign_name, impr, clicks, cost, conv, revenue] */
function dayRows_(day) {
  var p = day.split('-'), o = { year: +p[0], month: +p[1], day: +p[2] };
  var seen = {}, out = [];
  var sels = [function () { return AdsApp.campaigns(); }];
  try { if (AdsApp.shoppingCampaigns) sels.push(function () { return AdsApp.shoppingCampaigns(); }); } catch (e) {}
  try { if (AdsApp.performanceMaxCampaigns) sels.push(function () { return AdsApp.performanceMaxCampaigns(); }); } catch (e) {}
  sels.forEach(function (mk) {
    var it;
    try { it = mk().forDateRange(o, o).get(); } catch (e) { it = mk().forDateRange(day.replace(/-/g, ''), day.replace(/-/g, '')).get(); }
    while (it.hasNext()) {
      var c = it.next(), id = String(c.getId());
      if (seen[id]) continue;
      seen[id] = 1;
      var s = c.getStats();
      var impr = +s.getImpressions() || 0, cost = +s.getCost() || 0, clicks = +s.getClicks() || 0;
      if (!impr && !cost && !clicks) continue;
      var rev = 0; try { rev = +s.getRevenue() || 0; } catch (e) {}
      out.push([day, id, c.getName(), impr, clicks, cost, +s.getConversions() || 0, rev]);
    }
  });
  return out;
}

function pushRange_(acct, cur, name, from, to, cursor) {
  var rows = [];
  for (var d = to; d >= from; d = addDays_(d, -1)) rows = rows.concat(dayRows_(d));
  var r = post_({ action: 'push', account_id: acct, account_name: name, currency: cur, from: from, to: to, rows: rows, cursor: cursor || '' });
  Logger.log(acct + ' ' + from + '→' + to + ': ' + rows.length + ' satır · ' + JSON.stringify(r));
  return r.ok;
}

function runAccount_() {
  var a = AdsApp.currentAccount();
  var acct = a.getAccountNumber(), cur = a.getCurrencyCode ? a.getCurrencyCode() : '', name = a.getName();
  if (ACCOUNT_NUMBERS.length && ACCOUNT_NUMBERS.indexOf(acct) < 0) { Logger.log('Rapor dışı hesap atlandı: ' + acct); return; }
  var st = post_({ action: 'state', account_id: acct });
  if (!st.ok) Logger.log('Durum alınamadı (' + st.error + '), varsayılanlarla devam.');
  var start = st.start || DEFAULT_START, yday = st.yesterday || yesterdayIst_(), lb = st.lookback || 14;
  // 1) son günler
  var rFrom = addDays_(yday, -lb + 1);
  if (rFrom < start) rFrom = start;
  if (!pushRange_(acct, cur, name, rFrom, yday, st.cursor ? '' : rFrom)) return;
  // 2) geçmiş (cursor = doldurulmuş en eski gün)
  var cursor = st.cursor || rFrom;
  while (cursor > start && left_() > MIN_MS_LEFT) {
    var to = addDays_(cursor, -1), from = addDays_(cursor, -BACKFILL_DAYS);
    if (from < start) from = start;
    if (!pushRange_(acct, cur, name, from, to, from)) return;
    cursor = from;
    if (!st.ok) break; // durum okunamıyorsa cursor saklanamaz; tek parça ile yetin
  }
  if (cursor <= start) Logger.log('Geçmiş tamam (' + start + ').');
}
