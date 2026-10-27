# Kurulum rehberi (Claude için, adım adım)

Komutların hepsi kullanıcının bilgisayarında, raporun kök klasöründe (içinde `apps-script/`, `tools/` olan klasör) çalışır.

## 0. Komutları nerede çalıştıracağın

Google API'lerine erişim gerektiği için clasp kullanıcının **kendi bilgisayarında** çalışmalı:

1. **Mac + "Control your Mac" (osascript) aracı varsa:** `do shell script "export PATH=/opt/homebrew/bin:/usr/local/bin:$PATH; cd '<klasör>' && <komut>"`. En güvenilir yol.
2. Yoksa yerel shell (device_bash) dene: `clasp --version` ve `curl -sI https://script.googleapis.com` çalışıyorsa orada devam et.
3. İkisi de olmuyorsa komutları kullanıcıya Terminal'e yapıştırması için ver; çıktıyı geri istemeyi unutma.

Etkileşimli komutlar (onay soran) osascript'te takılır. Uzun komutları `perl -e 'alarm 170; exec @ARGV' <komut>` ile sınırla. osascript içinde heredoc çalışmaz; uzun dosya/script'i base64 ile yaz. Python'u `/tmp`'den çalıştıracaksan `python3 -I` kullan (`/tmp`'deki eski bir `grp.py` gibi dosyalar standart modülleri ezebilir).

## 1. Ön kontroller

```
node --version          # yoksa: brew install node  (ya da nodejs.org)
clasp --version         # yoksa: npm install -g @google/clasp   (3.x beklenir)
clasp show-authorized-user
```

- Giriş yapılmamışsa ya da hesap ajans hesabı (Brand.js > AGENCY_DOMAIN) değilse: kullanıcı Terminal'de **kendisi** `clasp login` çalıştırır, tarayıcıda ajans hesabını seçer. Şifre girmek kullanıcının işi.
- Apps Script API açık olmalı: https://script.google.com/home/usersettings → "Google Apps Script API" **Açık**.
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
/bin/bash tools/deploy.sh --init            # main + guest deployment'ları oluşturur; guest ID'sini ve Microsoft Ads anahtarını Brand.js'e yazar
/bin/bash tools/deploy.sh v1                # kodu iki linke birlikte yayınlar
```

- `tools/deploy.json` ve `apps-script/.clasp.json` kuruluma özeldir; silme, paylaşma, repoya koyma.
- Ana link (`main`): ajans hesapları. Misafir link (`guest`): marka ekibi.
- Sonraki her kod değişikliğinde: `/bin/bash tools/deploy.sh vN` (push + deploy birlikte uzun sürerse ikiye böl: önce sadece push'u dene).

## 4. İlk açılış (kullanıcı yapar)

1. Kullanıcı **ana linki** ajans hesabıyla açar. Google izin ekranı çıkar ("Bu uygulama doğrulanmadı" uyarısı çıkarsa: Gelişmiş → Git). İzinleri kullanıcı onaylar.
2. Rapor ilk açılışta kurulumu kendisi yapar: Drive'da `<REPORT_NAME>` klasörü (Config + data + exports) ve 10 dk'lık senkron tetikleyicisi oluşur.
3. **Bu adımdan önce misafir linki 403 "Erişim reddedildi" verir.** Normal; sahibin izni gelince açılır.
4. Durum sekmesinde Config linkini (`CONFIG_URL`) al; Google Ads, Microsoft Ads ve GA4 köprüsü için lazım.

## 5. Meta token

Kullanıcı token'ı Durum > "Meta erişim token'ı" alanına kendisi yapıştırır (token'ı sohbete yazmasını isteme).

Kalıcı yol (önerilen), **System User token**:
1. business.facebook.com > Ayarlar > Kullanıcılar > Sistem kullanıcıları > Ekle (rol: Çalışan). Markanın BM'sinde yetki yoksa hesaplara partner olarak erişen **ajans BM'sinde** oluştur.
2. Sistem kullanıcısı > Varlık ekle > Reklam hesapları: rapordaki hesapları seç (CPAS hesabı dahil), izin "Performansı görüntüle".
3. Yeni token oluştur: uygulama seç (yoksa developers.facebook.com'da Business tipi app + Marketing API), süre "Hiçbir zaman", izin `ads_read`.
4. Kaydet → token doğrulanır, Meta backfill başlar. Kreatif bilgisi (görsel, video, metinler) günde bir çekilir → Config > Kreatifler.

## 6. Google Ads

```
node tools/build-ads.js "<CONFIG_URL>"
```

`dist/GoogleAds_Script_MCC1.js` oluşur. Dosyayı kullanıcıya ver (bağlı klasöre yaz, panoya kopyala ya da sohbete gönder). Kullanıcı:
1. Hesapların bağlı olduğu **MCC** > Araçlar > Toplu işlemler > Script'ler > **+**.
2. Dosyanın tamamını yapıştırır > Yetkilendir (ajans hesabı) > Çalıştır.
3. Sıklık: **Saatlik**.

- Script kampanya, ad group, ad ve **varlık** (PMax görsel/video, uzantılar, başlık/açıklama metinleri) verisini çeker; Kreatif sekmesi buradan dolar. Varlık geçmişi ilk günlerde ayrıca doldurulur.
- Hesaplar birbirine bağlı olmayan iki MCC'deyse ikinci MCC'ye `GoogleAds_Script_MCC2.js` eklenir (aynı dosya iki MCC'ye eklenmez).
- Durum'daki "Google Ads · MCC 1" satırında erişilen hesap sayısı Brand.js'teki Google Ads hesap sayısıyla tutmalı.
- Script kodu değiştiğinde (build-ads yeniden çalışınca) kullanıcı MCC'deki script'in içeriğini yenisiyle değiştirir.

## 7. GA4

**Raporu kuran hesabın GA4 property'lerine erişimi varsa:** ek iş yok. Brand.js'teki property'ler Config > Accounts'a eklenir, kuyruk çeker.

**Erişim başka bir hesaptaysa (ör. ortak analytics hesabı): köprü script'i**
1. Brand.js > `SHARE_WITH`'e o hesabı yaz (senkron Drive klasörünü Düzenleyen olarak paylaşır) ya da kullanıcı klasörü elle paylaşır.
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
5. Çıkan deployment linkini kullanıcı **o hesapla** açar, izin verir. Sayfa bulunan property'leri listeler; ✓ olanlar rapora girer.
6. Köprü saatlik çalışır: kampanya verisi (kampanya adı + kaynak / araç), ad group verisi ve Web sekmesi verisi. Durum'daki "GA4 (köprü)" satırı ilerlemeyi gösterir.
7. Köprü kodu değişince: `build-ads.js` + `cd ga4-script/project && clasp --user ga4 push --force` (deployment değişmez, tetikleyici yeni kodu kullanır).

## 8. Adjust (varsa)

Kullanıcı Durum'a girer: API token (Adjust Suite > profil > Account settings > API token), hesap ID (birden fazla Adjust hesabına erişimi varsa şart), app token'ları (AppView > uygulama > All settings). Kaydet → token test edilir ve backfill başlar. "app token eşleşmesi 0/N" görürse hesap ID'si yanlıştır. App sekmesinin sepete ekleme / checkout event'leri otomatik bulunur.

## 9. Ek platformlar (varsa)

Hesaplar Brand.js > ACCOUNTS'a (ya da sonra Config > Accounts'a) eklenir; token'ları kullanıcı Durum > API erişimleri'ne yapıştırır. Kaydedince token test edilir ve backfill kuyruğa girer.

| Platform | Hesap ID | Durum'a girilen |
|---|---|---|
| TikTok | advertiser ID | TikTok for Business Marketing API access token (uygulama onaylı olmalı) |
| Yandex Direct | Client-Login | Yandex OAuth token (Direct API erişimi açık) |
| RTB House | advertiser hash | RTB House panel > API token |
| Criteo | advertiser ID ya da adı (ilk çekimde ID bulunur) | `client_id:client_secret` (Criteo developer uygulaması; advertiser için onay linki onaylanmış olmalı) |
| Yango Ads | kampanya / hesap ID | Yango API token (space.yango.com > Organization > Access > Tokens). API yanıt vermezse Config > Manuel Veri |
| Microsoft Ads | hesap numarası (F…) | token yok; script ile gelir (aşağıda) |

**Microsoft Ads:** `node tools/build-ads.js "<CONFIG_URL>"` → `dist/MicrosoftAds_Script.js`. Kullanıcı ads.microsoft.com > Araçlar > Toplu işlemler > Script'ler > Oluştur'a yapıştırır, yetkilendirir, **Saatlik** yapar. Script veriyi misafir linkine anahtarla gönderir (Brand.js > BING_PUSH_KEY, `deploy.sh --init` üretir).

**Manuel Veri:** API'si olmayan mecralar için Config > Manuel Veri sekmesi (tarih, platform, hesap ID, kampanya, harcama, para birimi, gösterim, tıklama, dönüşüm, değer). Her senkronda okunur.

## 10. Marka ekibine erişim

- E-postalar Config > Settings > `GUEST_EMAILS` (virgülle). Brand.js'te verdiklerin ilk kurulumda oraya yazıldı; sonraki eklemeler Config'ten.
- Misafir linki Durum sekmesinde ("Marka ekibine gönderilecek misafir linki").
- Linki gönderirken: "Linki gizli pencerede açın, iş e-postanızı yazın, gelen 6 haneli kodu girin."

## 11. Kontrol

- Durum > Kuyruk: bekleyen işler azalıyor mu, "Hata" sütunu boş mu. Log'da `cube` satırı GA4 / Adjust eşleşme oranını yazar.
- Drive > `<REPORT_NAME>/data/rapor_durum.json`: her senkronda güncellenir (son loglar, kuyruk, state). Drive bağlantın varsa buradan oku.
- İlk veriler 1 saat içinde, geçmişin tamamı birkaç saatte gelir.
- Eşleşmeyen kampanyalar Rapor sekmesinin altında listelenir. Çoğu kaynak / araçla mecraya düşer; kalanlar için kullanıcıya sorup Config > Eşleştirme'ye kural yaz.

## Kod güncellemesi (ileride)

Yeni sürümü repodan al, markanın klasöründe `Brand.js`, `tools/deploy.json` ve `.clasp.json` hariç dosyaları değiştir. Repodaki Brand.js'te yeni alan varsa (ör. LOGO_URL, CPAS_ACCOUNTS, REPORT_CURRENCY) markanın Brand.js'ine varsayılanıyla ekle. Sonra `/bin/bash tools/deploy.sh vN`. Google Ads / Microsoft Ads / GA4 köprü script'i değiştiyse `build-ads.js` ile yeniden üret ve ilgili yere yükle.
