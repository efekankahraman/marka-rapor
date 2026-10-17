# Kurulum rehberi (Claude için, adım adım)

Komutların hepsi kullanıcının bilgisayarında, raporun kök klasöründe (içinde `apps-script/`, `tools/` olan klasör) çalışır.

## 0. Komutları nerede çalıştıracağın

Google API'lerine erişim gerektiği için clasp kullanıcının **kendi bilgisayarında** çalışmalı:

1. **Mac + "Control your Mac" (osascript) aracı varsa:** `do shell script "export PATH=/opt/homebrew/bin:/usr/local/bin:$PATH; cd '<klasör>' && <komut>"`. En güvenilir yol.
2. Yoksa yerel shell (device_bash) dene: `clasp --version` ve `curl -sI https://script.googleapis.com` çalışıyorsa orada devam et.
3. İkisi de olmuyorsa komutları kullanıcıya Terminal'e yapıştırması için ver; çıktıyı geri istemeyi unutma.

Etkileşimli komutlar (onay soran) osascript'te takılır. Uzun komutları `perl -e 'alarm 120; exec @ARGV' <komut>` ile sınırla.

## 1. Ön kontroller

```
node --version          # yoksa: brew install node  (ya da nodejs.org)
clasp --version         # yoksa: npm install -g @google/clasp   (3.x beklenir)
clasp show-authorized-user
```

- Giriş yapılmamışsa ya da hesap ajans hesabı (Brand.js > AGENCY_DOMAIN) değilse: kullanıcı Terminal'de **kendisi** `clasp login` çalıştırır, tarayıcıda ajans hesabını seçer. Şifre girmek kullanıcının işi.
- Apps Script API açık olmalı: https://script.google.com/home/usersettings → "Google Apps Script API" **Açık**. Kapalıysa clasp "User has not enabled the Apps Script API" der.
- Raporun sahibi bu hesap olur: veriler onun Drive'ında, tetikleyiciler onun adına çalışır. Ajans içinde paylaşılan bir hesap ya da raporu uzun süre yönetecek kişinin hesabı olmalı.

## 2. Dosyalar

1. Repoyu indir: `git clone https://github.com/efekankahraman/marka-rapor.git` (git yoksa https://github.com/efekankahraman/marka-rapor/archive/refs/heads/main.zip).
2. `assets/` içeriğini markanın klasörüne kopyala, ör. `~/Documents/Claude/<Marka>/<Marka> Rapor/` → içinde `apps-script/ ads-script/ ga4-script/ tools/` olur.
3. **Sadece `apps-script/Brand.js`'i** kullanıcının cevaplarıyla doldur. Başka dosyaya dokunma.
4. `apps-script/appsscript.json` > `timeZone` = Brand.js > TIMEZONE.
5. Dosyayı bilgisayara yazdıysan md5 ile kontrol et (Cowork'te dosya bazen eski haliyle gelir).

## 3. Apps Script projesi ve yayın

```
cd apps-script
cp appsscript.json /tmp/manifest.bak
clasp create-script --type standalone --title "<REPORT_NAME>"
cp /tmp/manifest.bak appsscript.json        # create-script manifesti ezer, geri koy
cd ..
/bin/bash tools/deploy.sh --init            # main + guest deployment'ları oluşturur, guest ID'sini Brand.js'e yazar
/bin/bash tools/deploy.sh v1                # Brand.js'teki guest ID ile kodu yayınlar, iki linki yazar
```

- `tools/deploy.json` ve `apps-script/.clasp.json` kuruluma özeldir; silme, paylaşma.
- Ana link (`main`): ajans hesapları. Misafir link (`guest`): marka ekibi.

## 4. İlk açılış (kullanıcı yapar)

1. Kullanıcı **ana linki** ajans hesabıyla açar. Google izin ekranı çıkar ("Bu uygulama doğrulanmadı" uyarısı çıkarsa: Gelişmiş → Git). İzinleri kullanıcı onaylar.
2. Rapor ilk açılışta kurulumu kendisi yapar: Drive'da `<REPORT_NAME>` klasörü (Config + data + exports) ve 10 dk'lık senkron tetikleyicisi oluşur.
3. **Bu adımdan önce misafir linki 403 "Erişim reddedildi" verir.** Normal; sahibin izni gelince açılır.
4. Durum sekmesinde Config linkini (`CONFIG_URL`) al; Google Ads ve GA4 köprüsü için lazım.

## 5. Meta token

Kullanıcı token'ı Durum > "Meta erişim token'ı" alanına kendisi yapıştırır (token'ı sohbete yazmasını isteme).

Kalıcı yol (önerilen), **System User token**:

1. business.facebook.com > Ayarlar > Kullanıcılar > Sistem kullanıcıları > Ekle (rol: Çalışan). Markanın BM'sinde yetki yoksa hesaplara partner olarak erişen **ajans BM'sinde** oluştur.
2. Sistem kullanıcısı > Varlık ekle > Reklam hesapları: rapordaki hesapları seç, izin "Performansı görüntüle".
3. Yeni token oluştur: uygulama seç (yoksa developers.facebook.com'da Business tipi app + Marketing API), süre "Hiçbir zaman", izin `ads_read`.
4. Kaydet → token doğrulanır, Meta backfill başlar.

Kısa yol: Graph API Explorer kullanıcı token'ı da çalışır ama 60 gün sonra düşer.

## 6. Google Ads

```
node tools/build-ads.js "<CONFIG_URL>"
```

`dist/GoogleAds_Script_MCC1.js` oluşur. Dosyayı kullanıcıya ver (bağlı klasöre yaz ya da sohbete gönder). Kullanıcı:

1. Hesapların bağlı olduğu **MCC** > Araçlar > Toplu işlemler > Script'ler > **+**.
2. Dosyanın tamamını yapıştırır > Yetkilendir (ajans hesabı) > Çalıştır.
3. Sıklık: **Saatlik**.

Hesaplar birbirine bağlı olmayan iki MCC'deyse ikinci MCC'ye `GoogleAds_Script_MCC2.js` eklenir (aynı dosya iki MCC'ye eklenmez). Script MCC seviyesinde çalışır (AdsManagerApp); tek hesaplı markada da hesabın bağlı olduğu ajans MCC'sine eklenir.

Durum sekmesindeki "Google Ads · MCC 1" satırında erişilen hesap sayısı Brand.js'teki Google Ads hesap sayısıyla tutmalı.

## 7. GA4

**Raporu kuran hesabın GA4 property'lerine erişimi varsa:** ek iş yok. Brand.js'teki property'ler Config > Accounts'a eklenir, kuyruk çeker.

**Erişim başka bir hesaptaysa (ör. ortak analytics hesabı): köprü script'i**

1. Drive'daki `<REPORT_NAME>` klasörünü o hesapla **Düzenleyen** olarak paylaş (kullanıcı yapar ya da Drive bağlantısı varsa sen).
2. `node tools/build-ads.js "<CONFIG_URL>"` (henüz yapılmadıysa) → `ga4-script/project/` dolar.
3. Kullanıcı o hesapla clasp'e ikinci kullanıcı olarak girer: `clasp login --user ga4` (Terminal'de kendisi).
4. ```
   cd ga4-script/project
   cp appsscript.json /tmp/ga4manifest.bak
   clasp --user ga4 create-script --type standalone --title "<REPORT_NAME> · GA4 köprü"
   cp /tmp/ga4manifest.bak appsscript.json
   clasp --user ga4 push --force
   clasp --user ga4 create-deployment -d v1
   ```
5. Çıkan deployment linkini (`https://script.google.com/macros/s/<ID>/exec`) kullanıcı **o hesapla** açar, izin verir. Sayfa bulunan property'leri listeler; ✓ olanlar rapora girer. Yanlışlar Config > Accounts'ta Aktif kutusundan düzeltilir.
6. Durum'daki "GA4 (köprü)" satırı saatlik ilerlemeyi gösterir.

## 8. Adjust (varsa)

Kullanıcı Durum'a girer: API token (Adjust Suite > profil > Account settings > API token), hesap ID (birden fazla Adjust hesabına erişimi varsa şart), app token'ları (AppView > uygulama > All settings). Kaydet → token test edilir ve backfill başlar. "app token eşleşmesi 0/N" görürse hesap ID'si yanlıştır.

## 9. Marka ekibine erişim

- E-postalar Config > Settings > `GUEST_EMAILS` (virgülle). Brand.js'te verdiklerin ilk kurulumda oraya yazıldı; sonraki eklemeler Config'ten.
- Misafir linki Durum sekmesinde ("Marka ekibine gönderilecek misafir linki").
- Linki gönderirken: "Linki gizli pencerede açın, iş e-postanızı yazın, gelen 6 haneli kodu girin."

## 10. Kontrol

- Durum > Kuyruk: bekleyen işler azalıyor mu, "Hata" sütunu boş mu.
- Drive > `<REPORT_NAME>/data/rapor_durum.json`: her senkronda güncellenir (son loglar, kuyruk, state). Drive bağlantın varsa buradan oku.
- İlk veriler 1 saat içinde, geçmişin tamamı birkaç saatte gelir. İlk gün kurlar çekilir; "Kur bulunamadı" uyarısı birkaç dakikada kaybolur.

## Kod güncellemesi (ileride)

Yeni sürümü repodan al, markanın klasöründe `Brand.js`, `tools/deploy.json` ve `.clasp.json` hariç dosyaları değiştir, `/bin/bash tools/deploy.sh v2`. Google Ads script'i değiştiyse `build-ads.js` ile yeniden üret, MCC'deki script'in içeriğini değiştir.
