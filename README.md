# Marka Rapor

Bir marka için reklam, web ve app verisini günlük çeken, Google Drive'da tutan ve tek ekranda gösteren web raporu. Kurulumu Claude yapar.

- **Veri kaynakları:**
  - Reklam platformları: Google Ads, Meta, TikTok, Microsoft Ads, Yandex Direct, RTB House, Criteo, Yango Ads.
  - Web ve app: GA4 (web) ve Adjust (app).
  - API'si olmayan mecralar için Config'teki Manuel Veri sayfası.
- **Sekmeler:**
  - **Rapor:** toplam → ülke → platform → hesap → kampanya → ad group → ad kırılımı, trend, filtreler, kayıtlı raporlar, düzenlenebilir kartlar, formülle metrik.
  - **Web (GA4):** kanal / kaynak / cihaz kırılımı ve huni.
  - **App (Adjust):** network → kampanya → ad group → kreatif drill-down, retention, huni.
  - **Kreatif:** tüm mecraların görsel, video ve metinleri performansla birlikte.
  - **CPAS:** Collaborative Ads hesabı için ayrı sekme (isteğe bağlı).
  - **Hedefler:** aylık satış, session ve harcama hedefleri, ilerleme kartları.
  - **Durum:** token girişi ve kuyruk, sadece admin.
- **Karşılaştırma:** önceki dönem, geçen yıl aynı dönem ya da özel aralıkla; kartlarda ve her hücrede değişim yüzdesi.
- **Eşleştirme:** GA4 ve Adjust, kampanya / ad group adıyla reklam verisine bağlanır; tutmazsa GA4 kaynak / araçla mecraya yazılır. Ek kurallar Config'teki Eşleştirme sayfasından.
- **Para birimi:** günlük kurla raporun para birimine (TRY, USD…) çevrilir.
- **Erişim:** ajans hesapları ana linkten, marka ekibi misafir linkinden e-posta koduyla girer.
- **Maliyet:** ücretli bağlayıcı yok. Altyapı Google Apps Script, Google Ads / Microsoft Ads script'leri ve Sheets.

## Kurulum

Claude'a (Claude Code ya da Cowork) şunu yaz:

> https://github.com/efekankahraman/marka-rapor skill'ini kur ve **<marka adı>** için rapor hazırla.

Claude önce marka, pazarlar, hesaplar, veri kaynakları ve erişim hakkında birkaç soru sorar. Sonra kurulumu adım adım yürütür.

Hazır olması gerekenler:
- **Ajans Google hesabı.** Raporun sahibi olur; veriler bu hesabın Drive'ında durur.
- **Google Ads:** hesapların bağlı olduğu MCC'ye bu hesapla erişim.
- **Meta:** reklam hesaplarını gören bir System User token'ı (`ads_read`).
- **İsteğe bağlı:**
  - GA4 property erişimi.
  - Adjust API token'ı, hesap ID'si ve app token'ları.
  - TikTok, Yandex, RTB House, Criteo ve Yango token'ları.
  - Microsoft Ads hesap erişimi.

Sana kalan işler:
- Google izin ekranlarını onaylamak.
- Token'ları rapordaki **Durum** sekmesine yapıştırmak.
- Google Ads (ve varsa Microsoft Ads) script'ini panele eklemek.

Gerisini Claude yapar.

## Klasörler

| Yol | Ne |
|---|---|
| `SKILL.md` | Claude için kurulum akışı |
| `assets/apps-script/` | Web uygulaması (Apps Script). Markaya özel her şey `Brand.js`'te |
| `assets/ads-script/` | Google Ads MCC ve Microsoft Ads script kaynakları (`tools/build-ads.js` ile tek dosyaya çevrilir) |
| `assets/ga4-script/` | GA4 erişimi başka hesaptaysa kullanılan köprü script'i |
| `assets/tools/` | `deploy.sh` (iki linki birlikte yayınlar), `build-ads.js` |
| `references/` | Kurulum rehberi, rapor özellikleri, öğrenilenler |
