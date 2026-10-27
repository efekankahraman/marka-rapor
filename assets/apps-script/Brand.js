/**
 * Brand.js — markaya özel TÜM ayarlar bu dosyada.
 * Kurulumda sadece bu dosya doldurulur; kodun geri kalanına dokunulmaz.
 * Bu dosya Google Ads script'ine ve GA4 köprü script'ine de (build ile) gömülür.
 *
 * Kurulumdan sonra çoğu ayar Config dosyasından (Accounts / Settings sekmeleri) değiştirilebilir.
 * Buradaki değerler sadece İLK kurulumda Config'e yazılır.
 */
var BRAND = {
  // Rapor adı: sekme başlığı, ekrandaki başlık, giriş kodu maili ve Drive dosya adlarında görünür
  REPORT_NAME: 'Marka Rapor',
  // Üst barda ve giriş ekranında görünen marka logosu (png/svg URL). Boşsa rapor adı yazılır.
  // Logo koyu zemin üstünde beyaza çevrilir; renkli kalsın istenirse LOGO_INVERT: false
  LOGO_URL: '',

  // Ajans: bu alan adındaki Google hesapları rapora direkt girer (misafir koduna gerek yok)
  AGENCY_DOMAIN: 'semtr.com',
  // Durum sekmesini ve yönetim düğmelerini görebilen hesaplar (kurulumu yapan hesap otomatik eklenir)
  ADMIN_EMAILS: [],
  // Rapor klasörünü (Config + data) DÜZENLEYEN olarak paylaşılacak hesaplar (ör. GA4 köprü hesabı). Senkron bir kez paylaşır
  SHARE_WITH: [],
  // Misafir (marka ekibi) e-postaları: rapora mail kodu ile girer. Sonra Config > Settings > GUEST_EMAILS'ten yönetilir
  GUEST_EMAILS: [],
  // Giriş kodu mailinin gönderen adı
  OTP_SENDER_NAME: 'SEM - Rapor - Güvenlik Sistemi',

  // Verinin başladığı tarih (backfill bu tarihe kadar geriye gider)
  START_DATE: '2025-01-01',
  // Ad group seviyesinde GA4 / Adjust verisinin başladığı tarih (daha kısa tutmak çekimi hızlandırır)
  AG_START_DATE: '2026-01-01',
  // Saat dilimi ve günlük yenileme saati
  TIMEZONE: 'Europe/Istanbul',
  REFRESH_HOUR: 3,

  // Pazarlar (ülke kodu → Türkçe ad / İngilizce ad). Tek pazarlı markada tek satır yeterli.
  // İngilizce ad GA4 / Adjust'taki ülke adıyla eşleştirmede kullanılır.
  MARKETS: {
    TR: { tr: 'Türkiye', en: 'Turkey' }
  },
  // Raporda ülke kırılımı (Ülke seviyesi, ülke filtresi, ülke kolonu) gösterilsin mi?
  // null = otomatik: hariç tutulanlar dışında birden fazla pazar varsa göster. Hesaplar tek ülkede yayındaysa false.
  SHOW_COUNTRY: null,
  // Adjust / GA4'te hariç tutulacak ülkeler (ör. yurtdışı raporunda TR). Kod + GA4'teki ülke adları
  EXCLUDE_MARKET_CODES: [],
  EXCLUDE_MARKET_NAMES: [],

  // Kampanya grubu filtresi: kampanya adında KEYWORD geçenler bir grup, geçmeyenler diğer grup.
  // Kullanılmayacaksa null yapın.  DEFAULT: 'in' = raporda varsayılan olarak sadece KEYWORD geçenler, 'out' = geçmeyenler, '' = hepsi
  CAMPAIGN_GROUP: null,
  // Örnek: { KEYWORD: 'ecom', IN_LABEL: 'E-com (performans)', OUT_LABEL: 'Kurumsal', DEFAULT: 'in' },

  // Reklam hesapları: [Platform, Ülke kodu, Hesap adı, Hesap ID, Tip, Not]
  //   Platform: 'Google Ads' (ID: 123-456-7890) ya da 'Meta' (ID: act_ olmadan rakamlar)
  //   Tip: 'Performans' | 'Branding' | 'Performans + Branding' (raporda filtre/kırılım olarak görünür)
  //   Ek platformlar (Ext.js): 'TikTok' (advertiser ID), 'Yandex Direct' (Client-Login), 'RTB House' (advertiser hash),
  //   'Microsoft Ads' (hesap numarası; veri Microsoft Ads script'iyle gelir), 'Criteo' (advertiser ID ya da adı), 'Yango Ads' (Config > Manuel Veri sekmesinden)
  ACCOUNTS: [
    // ['Google Ads', 'TR', 'Marka - Search', '123-456-7890', 'Performans', ''],
    // ['Meta', 'TR', 'Marka Meta', '1234567890123456', 'Performans', ''],
    // ['TikTok', 'TR', 'Marka TikTok', '7500000000000000000', 'Performans', ''],
    // ['Microsoft Ads', 'TR', 'Marka Microsoft Ads', 'F000XXXX', 'Performans', 'Veri Microsoft Ads script\'inden gelir'],
    // ['Yandex Direct', 'TR', 'Marka Yandex', 'client-login', 'Performans', 'Client-Login'],
    // ['RTB House', 'TR', 'Marka RTB House', 'advertiserHash', 'Performans', ''],
    // ['Criteo', 'TR', 'Marka TR', 'Marka TR', 'Performans', 'ilk çekimde advertiser ID bulunur'],
    // ['Yango Ads', 'TR', 'Marka Yango', '1234', 'Performans', 'API yoksa Config > Manuel Veri']
  ],

  // GA4 property'leri: [Property ID, Ülke kodu, Ad]. Boş bırakılabilir.
  GA4_PROPERTIES: [],
  // Tüm pazarlar tek GA4 property'sindeyse (ya da tek pazar + tek property) onun ID'si.
  // Doluysa bu property ülke kırılımıyla çekilir ve ad group seviyesinde GA4 verisi açılır.
  GA4_GLOBAL_PROPERTY: '',
  // GA4 yetkisi başka bir Google hesabındaysa köprü script'i kullanılır: property adında aranacak kelime (regex, ör. 'marka|brand')
  GA4_PROPERTY_MATCH: '',
  // GA4'ten sadece web verisi çekilsin mi? ('web' = evet; app verisi Adjust'tan geliyorsa önerilir. '' = tüm platformlar)
  GA4_PLATFORM: 'web',

  // Adjust (yoksa boş bırakın): hesap ID (X-Account-ID) ve app token'ları (virgülle)
  ADJUST_ACCOUNT_ID: '',
  ADJUST_APP_TOKENS: '',

  // USD çevrimi için kurlar (hesap para birimleri otomatik eklenir)
  FX_CURRENCIES: 'EUR,TRY',
  // Raporun para birimi: tüm harcama / gelir bu birime çevrilir (USD, TRY, EUR…)
  REPORT_CURRENCY: 'TRY',

  // Microsoft Ads script'inin rapora veri gönderirken kullandığı anahtar: boş bırak, deploy.sh --init üretir (script'e gömülür)
  BING_PUSH_KEY: '',

  // CPAS / Collaborative Ads hesapları (Meta hesap ID'leri): ana rapora girmez, sadece kendi sekmesinde görünür. Yoksa []
  CPAS_ACCOUNTS: [],
  // CPAS sekmesinin adı (iş ortağına göre: 'Trendyol CPAS', 'Hepsiburada CPAS'…). CPAS_ACCOUNTS boşsa sekme hiç görünmez
  CPAS_LABEL: 'Trendyol CPAS',
  // Misafir web uygulamasının deployment ID'si: boş bırak, deploy.sh --init doldurur
  GUEST_DEPLOYMENT_ID: ''
};
