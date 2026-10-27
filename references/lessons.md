# Öğrenilenler (kurulumlardan)

Kodu değiştirmeden ya da bir sorunu teşhis etmeden önce oku. Her madde gerçek bir hatadan geliyor.

## Erişim ve misafir girişi

1. **Tek link, iki deployment.** Apps Script web uygulaması ya alan adına (DOMAIN) ya da herkese açılabiliyor. Ajans hesapları için `main` (DOMAIN), marka ekibi için `guest` (ANYONE_ANONYMOUS + e-posta kodu) deployment'ı aynı koddan yayınlanır. `tools/deploy.sh` ikisini birlikte günceller.
2. **"Maalesef şu anda dosyayı açamıyoruz" / "Sayfa bulunamadı".** Tarayıcıda birden fazla Google hesabı açıkken Google misafir linkini `/macros/u/N/` adresine yönlendiriyor ve sayfa açılmıyor. Çözüm: linki **gizli pencerede** açmak. Marka ekibine linki gönderirken bunu mutlaka yaz.
3. **Kişiye özel anahtarlı linkler işe yaramadı.** Workspace politikası + çoklu hesap yüzünden açılmıyordu. Ortak misafir linki + e-posta kodu kalıcı çözüm oldu.
4. **Kod maili gitmiyor.** Neredeyse her zaman adres GUEST_EMAILS listesinde değildir (log'da "listesinde değil, kod gönderilmedi" yazar). Liste 5 dk önbellekte; ekledikten sonra 5 dk bekle ya da bir senkron turunu bekle.
5. **Mail izni.** `script.send_mail` kapsamı manifestte baştan var; ilk açılıştaki izin ekranında onaylanır. Kapsam sonradan eklenirse editörde `mailYetkisi` fonksiyonu bir kez çalıştırılıp izin verilmeli.
6. Giriş ekranındaki e-posta örneği markanın alan adını göstermemeli (`ornek@sirket.com`).

## Veri ve Sheets

7. **Sheets tarihleri Date'e çeviriyor.** State'e yazılan "2026-10-14 19:38:05" ya da "2026-10" gibi değerler Date olarak geri okunuyordu; GA4 köprüsünün "bugün yenilendi mi" kontrolü hep "hayır" dönüyordu. `sh_setState_` metin formatıyla yazar, `sh_getState_` Date gelirse geri çevirir. Yeni State/Settings yazımında bu fonksiyonları kullan.
8. **10M hücre sınırı.** Adjust'ı yıllık dosyada tutmak (ülke × partner kırılımıyla ~800 bin satır) sınırı aştı, aylar kayboldu. Büyük kırılımlı veri aylık dosyaya yazılır (`STORE_DATASETS.shard = 'month'`).
9. **Önce yaz, sonra sil.** Sheets servis hatası araya girince "önce temizle sonra yaz" dosyayı boş bırakıyordu. `st_writeSheet_` yeni veriyi üzerine yazar, fazlalığı en sonda siler.
10. **Meta "reduce the amount of data".** Kuyruk işi tarih aralığını ikiye bölüp yeniden kuyruğa ekler; elle müdahale gerekmez.
11. **GA4 metrik kolon kayması.** Boyut sayısı değişince metrik indeksi sabit yazılmamalı (`mi = 2 + dv.length - 1`).

## Eşleştirme

12. Kampanya adı karşılaştırması `r_ckey_` ile yapılır (URL-decode, sondaki "(ID)" atılır, sadece harf+rakam). Sonunda yıl eki olan adlar ("…_2026") için `r_ckLookup_` yılı atıp tekrar dener.
13. Ad group seviyesi GA4 için aday boyutlar sırayla denenir: Google Ads ad group adı, utm_term, utm_content. Meta'da utm_term = ad set, utm_content = ad, utm_id = kampanya ID olmalı.
14. Ad group'u bulunamayan satırlar kampanyanın "(eşleşmeyen ad group)" satırında toplanır; toplamlar kaybolmaz.

## Adjust

15. **Yanlış markanın uygulamaları.** API token'ı birden fazla Adjust hesabını görüyorsa varsayılan hesaba gider. `ADJUST_ACCOUNT_ID` (X-Account-ID başlığı) doldurulmalı. Kod, Settings'teki app token'larıyla eşleşmeyen uygulamaları asla çekmez.
16. Satın alma = `revenue_events` (gelir event'leri). Markada farklı bir satın alma event'i varsa slug'ı (`<event_slug>_events`) Config > Settings > `ADJUST_PURCHASE_METRIC`'e yazılır.

## Kurulum / yayınlama

17. **clasp yerel VM'de ya da bulutta çalışmayabilir** (Google API'lerine çıkış kapalı). Kullanıcının kendi bilgisayarında (Mac: "Control your Mac" osascript ile `do shell script`) çalıştır.
18. `clasp push` "already up to date" deyince hata kodu döner; deploy.sh `|| true` ile devam eder. deploy.sh'ı her zaman `/bin/bash tools/deploy.sh` ile çalıştır (dosya kopyalanınca çalıştırma izni kaybolabiliyor).
19. **Dosya kopyası gecikmesi.** Cowork'te bilgisayara yazılan dosya bazen eski haliyle geliyor. Yayınlamadan önce md5 ile kontrol et; eşleşmezse tekrar yaz.
20. `clasp create-script` mevcut `appsscript.json`'u varsayılanla ezebilir. Oluşturduktan sonra manifesti assets'teki haliyle geri koy.
21. Dosya yükleme sırası alfabetiktir: `Brand.js`'teki `BRAND` nesnesine sadece adı B'den sonra gelen dosyalar dosya seviyesinde (fonksiyon dışında) erişebilir. Yeni bir dosyaya üst seviyede `BRAND` kullanacaksan adını buna göre seç.
22. Meta tokenı, Adjust API tokenı gibi gizli bilgiler Brand.js'e ya da Config'e yazılmaz; web uygulaması > Durum'dan girilir ve Script Properties'te durur.

## İkinci kurulum (tek pazarlı e-ticaret markası, web + app, 9 mecra)

23. **Gelir panelden değil GA4 / Adjust'tan gelir.** "Criteo'da gelir yok" gibi şikayetlerde önce Durum'daki teşhise bak: panelde gelir varsa sorun eşleşmedir. GA4 trafiği kampanya adıyla tutmuyorsa kaynak / araç eşleştirmesi (GA4_DIMENSIONS = `sessionCampaignName,sessionSourceMedium`) mecraya yazar. Bu ayar sonradan açıldıysa State > `GA4X_CURSOR_<property>`'yi bu aya çekip GA4'ü yeniden çektir.
24. **Kampanyasız ama ücretli trafik.** GA4 senkronu `(organic)`, `(direct)`, `(not set)` kampanyalarını atar; kaynak / araç boyutu varsa ücretli görünen araçlar (cpc, display, paid…) yine tutulur.
25. **Küpü yeniden kurdurmak.** Cube.js'te eşleştirme mantığı değişince Sync.js'teki `CUBE_CUR` anahtarının sonekini değiştir (ör. `'|sm1'`); bir sonraki senkron küpü bir kez yeniden kurar.
26. **Collaborative Ads (CPAS).** Satış ve değer standart `actions` alanında değil `catalog_segment_actions` / `catalog_segment_value`'da gelir. CPAS hesapları ana rapordan ve küpten çıkarılır (`cpas_is_`), kendi sekmesinde gösterilir.
27. **GA4 413 "response too large".** Ad group sorgusunda sayfa boyutu 20000'e düşürüldü. Yeni sorgu eklerken büyük LIMIT kullanma.
28. **Yango API'si sık 504 veriyor.** Kod 5xx'te 3 kez dener, sonra güne böler ve başarısız kampanyayı atlayıp uyarı yazar. Tamamen düşerse Manuel Veri sekmesi yedek.
29. **CSS `</style>`'dan sonra eklenirse sayfanın üstünde ham metin olarak görünür.** Styles.html'e eklemeyi her zaman `</style>`'dan önce yap.
30. **Uzun komutlar osascript'te zaman aşımına uğrar.** clasp push + deploy + build'i ayrı çağrılara böl.
31. **Kreatif kartları:** Google'ın düşük çözünürlüklü (≤120 px) YouTube önizlemeleri ve açılmayan görseller kartta gizlenir; logolar (`LOGO` alan tipi) gösterilmez.
32. **Karşılaştırma iki sorgu çalıştırır** (`cmp_run_`): seçili dönem + karşılaştırma dönemi. Ad seviyesinde büyük aralıklar yavaşlayabilir; bu normal.
