---
name: marka-rapor
description: Bir marka için Google Ads + Meta (isteğe bağlı GA4 ve Adjust) verisini günlük çekip Google Drive'da tutan, ajansa ve marka ekibine (mail koduyla) açık bir web raporu kurar. "Marka için rapor kur", "X markasına rapor hazırla", "performans raporu / dashboard kur", "export rapor gibi bir rapor" isteklerinde kullan.
---

# Marka Rapor kurulum skill'i

Bu skill, bir markanın reklam verisini tek ekranda toplayan **web raporunu** kurar:

- Google Ads (MCC script'i) ve Meta (Marketing API) günlük verisi, isteğe bağlı GA4 (web) ve Adjust (app). GA4 ve Adjust kampanya ve ad group adıyla reklam verisine bağlanır.
- Veriler raporu kuran ajans hesabının Google Drive'ında (Sheets) durur, 10 dakikada bir senkronlanır. Ücretli araç yok.
- Ajans hesapları ana linkten girer. Marka ekibi misafir linkinden e-postasına gelen 6 haneli kodla girer.
- Rapor ekranı: seviye (toplam → ülke → hesap → kampanya → ad group → ad), zaman kırılımı, trend, filtreler, Sheets/CSV aktarımı.

Kod hazır ve çalışır durumda: `assets/`. Markaya özel her şey **tek dosyada**, `assets/apps-script/Brand.js`. Kodun geri kalanına dokunma.

Kullanıcıların çoğu teknik değil. Amaç: soruları bir iki turda toplamak, teknik adımları senin yapman, kullanıcının sadece izin vermesi ve token yapıştırması.

## Kaynaklar

Skill tek dosya olarak yüklendiyse kod ve rehberler yanında olmayabilir. O zaman önce repoyu indir:
`git clone https://github.com/efekankahraman/marka-rapor.git` (git yoksa `https://github.com/efekankahraman/marka-rapor/archive/refs/heads/main.zip`).

- `references/kurulum-rehberi.md`: adım adım kurulum komutları (clasp, yayın, Meta, Google Ads, GA4 köprüsü, Adjust). **Kuruluma başlamadan oku.**
- `references/lessons.md`: ilk kurulumda çıkan hatalar ve çözümleri. Bir şey ters giderse ya da kodu değiştirmen gerekirse önce bunu oku.
- `references/rapor-ozellikleri.md`: rapor ne gösterir, metrikler nereden gelir. Kullanıcıya raporu anlatırken kullan.

## Akış

### 1. Kısa tanıtım

Ne kurulacağını 3-4 cümleyle anlat. Neler gerekeceğini baştan söyle:

- Ajans Google hesabı (raporun sahibi olacak).
- Bilgisayarda clasp (yoksa sen kurarsın; girişi kullanıcı yapar).
- Meta için System User token.
- Google Ads için hesapların bağlı olduğu MCC'ye erişim.
- Varsa GA4 erişimi ve Adjust API token'ı.

### 2. Bilgileri topla (kod üretmeden önce, ZORUNLU)

Varsayımla ilerleme. AskUserQuestion ile, birbirine bağlı soruları tek turda 3-4 soru olarak sor. Seçenek + serbest metin kullan.

**Tur 1**

1. **Marka ve rapor adı.** Rapor adı ekranda, giriş kodu mailinde ve Drive dosyalarında görünür (ör. "Marka X Türkiye", "Marka X Yurtdışı").
2. **Pazarlar.**
   - Tek ülke mi, çok ülke mi? Ülke kodları (ISO-2) ve Türkçe/İngilizce adları.
   - Raporda hariç tutulacak pazar var mı? Ör. yurtdışı raporunda TR. Varsa GA4'teki ülke adlarıyla birlikte al (`Turkey, Türkiye`).
3. **Veri kaynakları** (çoklu seçim): Google Ads, Meta, GA4, Adjust.
4. **Erişim.**
   - Marka ekibinden rapora girecek e-postalar.
   - Durum sekmesini görecek ajans yöneticileri (kurulumu yapan hesap otomatik admin).

**Tur 2**

5. **Hesap listesi.** Google Ads müşteri ID'leri (123-456-7890) ve Meta reklam hesabı ID'leri; her biri için ad, ülke kodu ve tip (Performans / Branding).
   - Kullanıcıdan liste yapıştırmasını ya da Excel/CSV eklemesini iste.
   - Google Ads / Meta bağlantıların varsa hesapları oradan bulup onaylatabilirsin.
6. **Kampanya grubu filtresi.** Kampanya adlarında grubu ayıran bir kelime var mı? Ör. performans kampanyalarında "ecom" geçiyor, kurumsallarda geçmiyor.
   - Varsa kelimeyi, iki grubun adını ve raporun varsayılan olarak hangi grupla açılacağını al.
   - Yoksa `CAMPAIGN_GROUP: null`.
7. **GA4** (seçildiyse):
   - Property ID'leri ve hangi pazara ait oldukları.
   - Tüm pazarlar tek property'de mi? Öyleyse bu, ülke kırılımlı "global" property olur ve ad group seviyesi GA4'ü açar. Tek pazar + tek property ise de onu global yap.
   - Raporu kuracak ajans hesabının bu property'lere erişimi var mı? Yoksa erişimi olan hesap hangisi? O zaman köprü script'i kurulur.
8. **Adjust** (seçildiyse): Adjust hesap ID'si ve app token'ları. API token'ı burada alma; kullanıcı onu Durum sekmesine kendisi girer.
9. **Başlangıç tarihi.**
   - Varsayılan: 2025-01-01. Daha eski tarih backfill'i uzatır.
   - Ad group seviyesi GA4/Adjust için başlangıç: varsayılan bu yılın başı.

Kullanıcı bir şeyi bilmiyorsa varsayılanı kullan ve bunu açıkça söyle. GA4/Adjust bilgisi eksikse o kaynağı şimdilik kapalı kur. Sonra Config'ten açılabilir (Accounts sekmesi, Settings).

### 3. Dosyaları hazırla

- Repoyu indir (yukarıdaki "Kaynaklar"). `assets/` içeriğini markanın klasörüne kopyala.
  - Bağlı klasör varsa onun içine koy, ör. `<Marka>/<Rapor adı>/`.
  - Yoksa kullanıcının bilgisayarında uygun bir klasöre koy.
- `apps-script/Brand.js`'i doldur. Her alanın açıklaması dosyanın içinde. Örnek değerleri temizle.
  - `ACCOUNTS` satırı: `[Platform, Ülke kodu, Hesap adı, Hesap ID, Tip, Not]`.
  - Google Ads ID'si tireli yazılır. Meta ID'si `act_` öneki olmadan, sadece rakam.
  - `AGENCY_DOMAIN`: ajansın alan adı. Varsayılan `semtr.com`. Farklı ajanssa değiştir.
  - `GUEST_DEPLOYMENT_ID`: boş bırak. `deploy.sh --init` doldurur.
- `apps-script/appsscript.json` içindeki `timeZone`'u Brand.js > TIMEZONE ile eşitle.
- Doldurduğun Brand.js'i kullanıcıya özetle (pazarlar, hesap sayıları, kaynaklar, erişim) ve onay al.

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
8. **Marka ekibi.** Misafir linkini kullanıcıya ver ve gizli pencere notunu ekle.

Kurallar:

- Şifre, token, API anahtarı girmek kullanıcının işi. Token'ları sohbete yazmasını isteme. Durum sekmesine kendisi yapıştırır.
- Google izin ekranlarını ve MCC'de "Yetkilendir"i kullanıcı onaylar.
- Komutları kullanıcının bilgisayarında çalıştır (rehber > "0. Komutları nerede çalıştıracağın").

### 5. Kontrol ve teslim

- Durum sekmesinde kuyruğun ilerlediğini ve hata olmadığını gör. Drive bağlantın varsa `data/rapor_durum.json`'ı oku.
- İlk veriler gelince (≤1 saat) kullanıcıyla raporu birlikte aç. Hesap sayıları tutuyor mu, harcama platformla uyumlu mu?
- Teslimde kısa bir özet ver:
  - Ana link ve misafir link.
  - Config dosyası.
  - Kalan adımlar (ör. MCC2 script'i, GA4 köprüsü).
  - Marka ekibine gönderilecek kısa erişim notu (gizli pencere + e-posta kodu).

## Sonraki istekler

- **Erişim ekle/çıkar:** Config > Settings > `GUEST_EMAILS`. 5 dk içinde geçerli olur.
- **Hesap ekle/çıkar:** Config > Accounts (yeni satır ya da Aktif kutusu). Meta için Durum > "Meta backfill". Google Ads script'i yeni hesabı bir sonraki saatlik çalışmada alır.
- **Rapor davranışı değişikliği:** Önce Settings'te karşılığı var mı bak. Yoksa kodu değiştir; önce `references/lessons.md`'yi oku. Sonra `/bin/bash tools/deploy.sh vN`.
- **Sorun teşhisi:** Tahmin etme. Durum sekmesindeki kuyruk/log satırlarına ya da `rapor_durum.json`'a bak.
