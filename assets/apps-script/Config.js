/**
 * Config.js — sabitler ve varsayılan ayarlar. Markaya özel değerler Brand.js'ten gelir.
 */

var APP_NAME = BRAND.REPORT_NAME;

var COUNTRIES = BRAND.MARKETS || {};

// [Platform, Ülke kodu, Hesap adı, Hesap ID, Tip, Not]
var SEED_ACCOUNTS = BRAND.ACCOUNTS || [];

/** Hariç tutulan pazar mı? (Adjust / GA4 ülke filtresi) */
function excludedMarket_(code) {
  return (BRAND.EXCLUDE_MARKET_CODES || []).map(function (x) { return String(x).toUpperCase(); }).indexOf(String(code || '').toUpperCase()) >= 0;
}

/** Raporda ülke kırılımı gösterilsin mi? (Brand.js > SHOW_COUNTRY; null = birden fazla aktif pazar varsa) */
function showCountry_() {
  if (BRAND.SHOW_COUNTRY === true || BRAND.SHOW_COUNTRY === false) return BRAND.SHOW_COUNTRY;
  return Object.keys(COUNTRIES).filter(function (c) { return !excludedMarket_(c); }).length > 1;
}

// [anahtar, değer, açıklama]
var DEFAULT_SETTINGS = [
  ['START_DATE', BRAND.START_DATE || '2025-01-01', 'Tüm kaynaklar için verinin başladığı tarih'],
  ['DATA_FOLDER_ID', '', 'Kurulum doldurur — veri dosyalarının klasörü'],
  ['EXPORT_FOLDER_ID', '', 'Kurulum doldurur — Sheets exportlarının klasörü'],
  ['META_API_VERSION', 'v23.0', 'Graph API sürümü'],
  ['META_LOOKBACK_DAYS', '7', 'Günlük yenilemede Meta için geriye dönük gün (attribution gecikmesi)'],
  ['META_PAGE_LIMIT', '1000', 'Meta insights sayfa boyutu'],
  ['GADS_LOOKBACK_DAYS', '14', 'Google Ads script günlük yenilemede geriye dönük gün'],
  ['GADS_REFRESH_EVERY_HOURS', '6', 'Google Ads script yenileme sıklığı (saat)'],
  ['ADJUST_APP_TOKENS', BRAND.ADJUST_APP_TOKENS || '', 'Adjust app token(ları), virgülle — Adjust > Apps > app ayarlarında'],
  ['ADJUST_METRICS', 'installs,sessions,revenue,revenue_events', 'Adjust Report Service metrikleri (event: <slug>_events)'],
  ['ADJUST_EXCLUDE_COUNTRIES', (BRAND.EXCLUDE_MARKET_CODES || []).join(',').toLowerCase(), 'Hariç tutulacak ülke kodları'],
  ['ADJUST_LOOKBACK_DAYS', '7', 'Adjust günlük yenileme geriye dönük gün'],
  ['GA4_DIMENSIONS', 'sessionCampaignName', 'GA4 boyutları (date otomatik eklenir). Rapor kampanya adıyla eşleştirir'],
  ['GA4_METRICS', 'sessions,ecommercePurchases,purchaseRevenue', 'GA4 metrikleri'],
  ['GA4_EXCLUDE_COUNTRIES', (BRAND.EXCLUDE_MARKET_NAMES || []).join(','), 'GA4 country boyutunda hariç tutulacaklar'],
  ['GA4_LOOKBACK_DAYS', '3', 'GA4 günlük yenileme geriye dönük gün'],
  ['GA4_PLATFORM', BRAND.GA4_PLATFORM == null ? 'web' : BRAND.GA4_PLATFORM, 'GA4 platform filtresi: web (app verisi Adjust\'tan). Boş = filtre yok'],
  ['GA4_MODE', '', 'external = GA4 köprü script\'i (başka hesap) çekiyor'],
  ['ADJUST_PURCHASE_METRIC', 'revenue_events', 'Adjust satın alma metriği (varsayılan revenue_events = gelir event\'leri = satın alma)'],
  ['ADJUST_ATTRIBUTION_SOURCE', 'dynamic', 'Adjust attribution source: dynamic | first'],
  ['ADJUST_ATTRIBUTION_TYPE', 'click', 'Adjust attribution type: click | impression | all'],
  ['ADJUST_UTC_OFFSET', '+03:00', 'Adjust rapor saat dilimi (İstanbul = +03:00)'],
  ['GA4_GLOBAL_PROPERTY', BRAND.GA4_GLOBAL_PROPERTY || '', 'Tüm pazarları içeren GA4 property ID (ülke kırılımıyla çekilir, ad group seviyesi GA4 açılır)'],
  ['ADJUST_COHORT_REVENUE_METRIC', '', 'Adjust 0W cohort gelir metriği (boşsa otomatik bulunur, ör. revenue_total_w0)'],
  ['ADJUST_COHORT_PURCHASE_METRIC', '', 'Adjust 0W cohort satın alma metriği (boşsa otomatik bulunur)'],
  ['ADJUST_ACCOUNT_ID', BRAND.ADJUST_ACCOUNT_ID || '', 'Adjust hesap ID (X-Account-ID) — birden fazla Adjust hesabına erişimi olan kullanıcıda markanın hesabını seçer'],
  ['ADJUST_REVENUE_METRIC', 'revenue', 'Adjust gelir metriği (Web+App için)'],
  ['ADJUST_CURRENCY', 'USD', 'Adjust raporlama para birimi (gelir USD çevrimi için)'],
  ['FX_CURRENCIES', BRAND.FX_CURRENCIES || 'EUR,TRY', 'USD çevrimi için kur listesi (hesap para birimleri otomatik eklenir)'],
  ['DAILY_REFRESH_HOUR', String(BRAND.REFRESH_HOUR == null ? 3 : BRAND.REFRESH_HOUR), 'Günlük yenileme saati (İstanbul). Tüm kaynaklar bu saatte dünü + lookback gününü çeker'],
  ['ADMIN_EMAILS', (BRAND.ADMIN_EMAILS || []).join(', '), 'Durum sekmesini görebilen hesaplar (virgülle)'],
  ['AD_LEVEL_MAX_DAYS', '186', 'Rapor ekranında ad/ad group seviyesi için maks. tarih aralığı (gün)'],
  ['AG_START_DATE', BRAND.AG_START_DATE || '2026-01-01', 'Ad group seviyesinde GA4 / Adjust verisinin başladığı tarih'],
  ['GUEST_EMAILS', (BRAND.GUEST_EMAILS || []).join(', '), BRAND.AGENCY_DOMAIN + ' dışından rapora erişebilecek e-postalar (virgülle). Misafir linkini açıp e-postasına gelen kodla girer. Link: State > GUEST_LINKS']
];

/** Eski Config dosyalarına yeni ayar anahtarlarını ekler. */
function ensureSettings_(ss) {
  var have = sh_settings_(ss);
  var sh = sh_sheet_(ss, SHEET_NAMES.settings);
  DEFAULT_SETTINGS.forEach(function (d) {
    if (!(d[0] in have)) {
      var r = sh.getLastRow() + 1;
      sh.getRange(r, 2).setNumberFormat('@');
      sh.getRange(r, 1, 1, 3).setValues([d]);
    }
  });
}
