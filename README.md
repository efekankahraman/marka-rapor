# Marka Rapor

Bir marka için Google Ads + Meta (isteğe bağlı GA4 ve Adjust) verisini günlük çeken, Google Drive'da tutan ve tek ekranda gösteren web raporu. Kurulumu Claude (Cowork) yapar.

- Seviyeler: toplam → ülke → hesap → kampanya → ad group → ad. Günlük / haftalık / aylık kırılım, trend grafikleri, filtreler, Sheets ve CSV aktarımı.
- GA4 (web) ve Adjust (app) metrikleri kampanya ve ad group adıyla reklam verisine bağlanır: oturum, satın alma, gelir, install, ROAS, CPI.
- Para birimleri günlük kurla USD'ye çevrilir.
- Ajans hesapları ana linkten, marka ekibi misafir linkinden e-posta koduyla girer.
- Ücretli bağlayıcı yok: Google Apps Script + Google Ads Script + Sheets.

## Kurulum (Cowork)

Claude'a şunu yaz:

> https://github.com/efekankahraman/marka-rapor skill'ini kur ve **<marka adı>** için rapor hazırla.

Claude önce marka, pazarlar, hesaplar, veri kaynakları ve erişim hakkında birkaç soru sorar. Sonra kurulumu adım adım yürütür.

Hazır olması gerekenler:

- **Ajans Google hesabı.** Raporun sahibi olur; veriler bu hesabın Drive'ında durur.
- **Google Ads:** hesapların bağlı olduğu MCC'ye bu hesapla erişim.
- **Meta:** reklam hesaplarını gören bir System User token'ı (`ads_read`).
- **İsteğe bağlı:** GA4 property erişimi; Adjust API token'ı, hesap ID'si ve app token'ları.

Sana kalan işler:

- Google izin ekranlarını onaylamak.
- Token'ları rapordaki **Durum** sekmesine yapıştırmak.
- Google Ads script'ini MCC'ye eklemek.

Gerisini Claude yapar.

## Klasörler

| Yol | Ne |
|---|---|
| `SKILL.md` | Claude için kurulum akışı |
| `assets/apps-script/` | Web uygulaması (Apps Script). Markaya özel her şey `Brand.js`'te |
| `assets/ads-script/` | Google Ads MCC script kaynağı (`tools/build-ads.js` ile tek dosyaya çevrilir) |
| `assets/ga4-script/` | GA4 erişimi başka hesaptaysa kullanılan köprü script'i |
| `assets/tools/` | `deploy.sh` (iki linki birlikte yayınlar), `build-ads.js` |
| `references/` | Kurulum rehberi, rapor özellikleri, öğrenilenler |
