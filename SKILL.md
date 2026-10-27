---
name: marka-rapor
description: Bir marka için Google Ads, Meta, GA4, Adjust ve diğer reklam platformlarının (TikTok, Microsoft Ads, Yandex, RTB House, Criteo, Yango) verisini günlük çekip Google Drive'da tutan, ajansa ve marka ekibine (mail koduyla) açık bir web raporu kurar. "Marka için rapor kur", "X markasına rapor hazırla", "performans raporu / dashboard kur", "dinamik rapor kur" isteklerinde kullan.
---

# Marka Rapor kurulum skill'i

Bu skill, bir markanın reklam verisini tek ekranda toplayan **web raporunu** kurar:
- **Veri kaynakları:** Google Ads (MCC script'i), Meta (Marketing API), GA4 (web), Adjust (app), TikTok, Microsoft Ads (script), Yandex Direct, RTB House, Criteo, Yango Ads ve API'si olmayanlar için Manuel Veri sayfası. GA4 ve Adjust kampanya / ad group adıyla, olmazsa kaynak / araçla reklam verisine bağlanır.
- **Sekmeler:** Rapor (reklam performansı), Web (GA4), App (Adjust), Kreatif (tüm mecraların kreatifleri ve metinleri), CPAS (isteğe bağlı), Hedefler, Durum (admin).
- **Özellikler:**
  - Seviye kırılımı (toplam → ülke → platform → hesap → kampanya → ad group → ad).
  - Önceki dönemle / geçen yılla karşılaştırma.
  - Kayıtlı raporlar (özel / herkese açık / kişiyle paylaşılan).
  - Düzenlenebilir KPI kartları ve formülle yeni metrik.
  - Aylık hedefler ve ilerleme kartları.
  - Sheets / CSV aktarımı.
- **Barındırma ve erişim:** Veriler raporu kuran ajans hesabının Google Drive'ında (Sheets) durur, 10 dakikada bir senkronlanır. Ücretli araç yok. Ajans hesapları ana linkten girer; marka ekibi misafir linkinden e-postasına gelen 6 haneli kodla girer.

Kod hazır ve çalışır durumda: `assets/`. Markaya özel her şey **tek dosyada**, `assets/apps-script/Brand.js`. Kodun geri kalanına dokunma.

Kullanıcıların çoğu teknik değil. Amaç: soruları bir iki turda toplamak, teknik adımları senin yapman, kullanıcının sadece izin vermesi ve token yapıştırması.

## Kaynaklar

Skill tek dosya olarak yüklendiyse kod ve rehberler yanında olmayabilir. O zaman önce repoyu indir:
`git clone https://github.com/efekankahraman/marka-rapor.git` (git yoksa `https://github.com/efekankahraman/marka-rapor/archive/refs/heads/main.zip`).

- `references/kurulum-rehberi.md`: adım adım kurulum komutları (clasp, yayın, Meta, Google Ads, GA4 köprüsü, Adjust, ek platformlar, Microsoft Ads). **Kuruluma başlamadan oku.**
- `references/lessons.md`: önceki kurulumlarda çıkan hatalar ve çözümleri. Bir şey ters giderse ya da kodu değiştirmen gerekirse önce bunu oku.
- `references/rapor-ozellikleri.md`: rapor ne gösterir, metrikler nereden gelir, eşleştirme nasıl çalışır. Kullanıcıya raporu anlatırken kullan.

## Akış

### 1. Kısa tanıtım

Ne kurulacağını 3-4 cümleyle anlat. Neler gerekeceğini baştan söyle:
- Ajans Google hesabı (raporun sahibi olacak).
- Bilgisayarda clasp (yoksa sen kurarsın; girişi kullanıcı yapar).
- Meta için System User token.
- Google Ads için hesapların bağlı olduğu MCC'ye erişim.
- Varsa GA4 erişimi, Adjust API token'ı ve diğer platformların token'ları (tablo: rehber > 9).

### 2. Bilgileri topla (kod üretmeden önce, ZORUNLU)

Varsayımla ilerleme. AskUserQuestion ile, birbirine bağlı soruları tek turda 3-4 soru olarak sor. Seçenek + serbest metin kullan.

**Tur 1**
1. **Marka, rapor adı ve logo.**
   - Rapor adı sekme başlığında, giriş kodu mailinde ve Drive dosyalarında görünür (ör. "Marka X x SEM Rapor").
   - Logo: markanın sitesindeki logo URL'si (png/svg), `LOGO_URL`. Bulamazsan siteden kendin bul ve onaylat. Yoksa ad yazılır.
2. **Pazarlar ve para birimi.**
   - Tek ülke mi, çok ülke mi? Ülke kodları (ISO-2) ve Türkçe/İngilizce adları.
   - Hariç tutulacak pazar var mı? Ör. yurtdışı raporunda TR. Varsa GA4'teki ülke adlarıyla al.
   - **Reklamlar tek ülkede mi yayında?** Mutlaka ayrıca sor. Evet ise `SHOW_COUNTRY: false`, `MARKETS`'a sadece o ülke. Birden fazla ülkede yayındaysa `SHOW_COUNTRY: null`.
   - Raporun para birimi (`REPORT_CURRENCY`: TRY, USD, EUR…). Tüm harcama ve gelir günlük kurla buna çevrilir.
3. **Veri kaynakları** (çoklu seçim): Google Ads, Meta, GA4, Adjust, TikTok, Microsoft Ads, Yandex Direct, RTB House, Criteo, Yango Ads, diğer (Manuel Veri).
4. **Erişim.**
   - Marka ekibinden rapora girecek e-postalar.
   - Durum sekmesini görecek ajans yöneticileri (kurulumu yapan hesap otomatik admin).

**Tur 2**
5. **Hesap listesi.** Her platform için hesap ID'leri (biçimler Brand.js > ACCOUNTS açıklamasında); her biri için ad, ülke kodu ve tip (Performans / Branding).
   - Kullanıcıdan liste yapıştırmasını ya da Excel/CSV eklemesini iste.
   - Bağlantıların varsa hesapları oradan bulup onaylatabilirsin.
6. **Kampanya grubu filtresi.** Kampanya adlarında grubu ayıran bir kelime var mı? Ör. performans kampanyalarında "ecom" geçiyor, kurumsallarda geçmiyor.
   - Varsa kelimeyi, iki grubun adını ve varsayılan grubu al.
   - Yoksa `CAMPAIGN_GROUP: null`.
7. **CPAS / Collaborative Ads.** Pazaryeri (Trendyol, Hepsiburada…) ile Collaborative Ads yürüten bir Meta hesabı var mı?
   - Varsa hesap ID'sini `CPAS_ACCOUNTS`'a, sekme adını `CPAS_LABEL`'a yaz. Bu hesap ana rapora girmez, kendi sekmesinde görünür.
8. **GA4** (seçildiyse):
   - Property ID'leri ve hangi pazara ait oldukları.
   - Tüm pazarlar tek property'de mi? Öyleyse "global" property olur ve ad group seviyesini açar. Tek pazar + tek property ise de onu global yap.
   - Raporu kuracak ajans hesabının erişimi var mı? Yoksa erişimi olan hesap hangisi? O zaman köprü script'i kurulur ve o hesap `SHARE_WITH`'e yazılır.
9. **Adjust** (seçildiyse): Adjust hesap ID'si ve app token'ları. API token'ı burada alma; kullanıcı onu Durum sekmesine kendisi girer.
10. **Başlangıç tarihi.**
    - Varsayılan: 2025-01-01. Daha eski tarih backfill'i uzatır.
    - Ad group seviyesi GA4/Adjust için başlangıç: varsayılan bu yılın başı.

Kullanıcı bir şeyi bilmiyorsa varsayılanı kullan ve bunu açıkça söyle. Eksik bilgisi olan kaynağı şimdilik kapalı kur. Sonra Config'ten açılabilir (Accounts sekmesi, Settings).

### 3. Dosyaları hazırla

- Repoyu indir (yukarıdaki "Kaynaklar"). `assets/` içeriğini markanın klasörüne kopyala.
  - Bağlı klasör varsa onun içine koy, ör. `<Marka>/<Rapor adı>/`.
  - Yoksa kullanıcının bilgisayarında uygun bir klasöre koy.
- `apps-script/Brand.js`'i doldur. Her alanın açıklaması dosyanın içinde. Örnek satırları temizle.
  - `ACCOUNTS` satırı: `[Platform, Ülke kodu, Hesap adı, Hesap ID, Tip, Not]`.
  - Google Ads ID'si tireli yazılır. Meta ID'si `act_` öneki olmadan, sadece rakam.
  - `AGENCY_DOMAIN`: ajansın alan adı. Varsayılan `semtr.com`.
  - `GUEST_DEPLOYMENT_ID` ve `BING_PUSH_KEY`: boş bırak. `deploy.sh --init` doldurur.
- `apps-script/appsscript.json` içindeki `timeZone`'u Brand.js > TIMEZONE ile eşitle.
- Doldurduğun Brand.js'i kullanıcıya özetle (pazarlar, para birimi, hesap sayıları, kaynaklar, CPAS, erişim) ve onay al.

### 4. Kurulumu yürüt

`references/kurulum-rehberi.md`'yi sırayla izle. Her kullanıcı adımından sonra "tamam mı?" diye sor. Kısaca:
1. **Ön kontroller.** clasp, ajans hesabıyla giriş, Apps Script API'nin açık olması.
2. **Proje ve yayın.**
   - `clasp create-script`, ardından manifesti geri koy.
   - `deploy.sh --init`, sonra `deploy.sh v1`.
3. **İlk açılış.** Kullanıcı ana linki açar ve izin verir. Rapor kendini kurar. Durum'dan CONFIG_URL'ü al.
4. **Meta token.** Kullanıcı Durum'a yapıştırır.
5. **Google Ads.**
   - `node tools/build-ads.js "<CONFIG_URL>"` çalıştır.
   - Script dosyasını kullanıcıya ver. Kullanıcı MCC'ye yapıştırır ve saatlik çalışacak şekilde ayarlar.
6. **GA4.** Erişim aynı hesaptaysa ek iş yok. Değilse köprü script'ini kur.
7. **Adjust.** Token'ları kullanıcı Durum'a girer.
8. **Ek platformlar.**
   - TikTok, Yandex, RTB House, Criteo ve Yango token'larını kullanıcı Durum > API erişimleri'ne girer.
   - Microsoft Ads için `dist/MicrosoftAds_Script.js` Microsoft Ads > Script'ler'e eklenir.
9. **Marka ekibi.** Misafir linkini kullanıcıya ver ve gizli pencere notunu ekle.

Kurallar:
- Şifre, token, API anahtarı girmek kullanıcının işi. Token'ları sohbete yazmasını isteme. Durum sekmesine kendisi yapıştırır.
- Google izin ekranlarını, MCC'de ve Microsoft Ads'te "Yetkilendir"i kullanıcı onaylar.
- Komutları kullanıcının bilgisayarında çalıştır (rehber > "0. Komutları nerede çalıştıracağın").

### 5. Kontrol ve teslim

- Durum sekmesinde kuyruğun ilerlediğini ve hata olmadığını gör. Drive bağlantın varsa `data/rapor_durum.json`'ı oku.
- İlk veriler gelince (≤1 saat) kullanıcıyla raporu birlikte aç. Hesap sayıları tutuyor mu, harcama platformla uyumlu mu?
- Rapor sekmesinin altındaki **eşleşmeyen kampanyalar** listesine bak. Kaynak / araçla mecraya düşmeyenleri kullanıcıya sor ve Config > Eşleştirme'ye kural yaz.
- Teslimde kısa bir özet ver:
  - Ana link ve misafir link.
  - Config dosyası.
  - Kalan adımlar (ör. MCC2 script'i, GA4 köprüsü, onay bekleyen API'ler).
  - Marka ekibine gönderilecek kısa erişim notu (gizli pencere + e-posta kodu).
  - Hedefler sekmesine aylık hedef girilebileceği.

## Sonraki istekler

- **Erişim ekle/çıkar:** Config > Settings > `GUEST_EMAILS`. 5 dk içinde geçerli olur.
- **Hesap ekle/çıkar:** Config > Accounts (yeni satır ya da Aktif kutusu). Meta için Durum > "Meta backfill". Google Ads ve Microsoft Ads script'leri yeni hesabı bir sonraki saatlik çalışmada alır.
- **Eşleşmeyen GA4 / Adjust trafiği:** Config > Eşleştirme'ye kural (Kaynak · kalıp · mecra · kampanya), sonra Durum > "Rapor önbelleğini yenile".
- **Rapor davranışı değişikliği:** Önce Settings'te karşılığı var mı bak. Yoksa kodu değiştir; önce `references/lessons.md`'yi oku. Sonra `/bin/bash tools/deploy.sh vN`.
- **Kod güncellemesi:** rehber > "Kod güncellemesi". Markanın Brand.js'ini koru, yeni alanları varsayılanla ekle.
- **Sorun teşhisi:** Tahmin etme. Durum sekmesindeki kuyruk/log satırlarına ya da `rapor_durum.json`'a bak. "Panelde gelir var, raporda yok" sorunu neredeyse her zaman eşleşmedir (lessons > 23).
