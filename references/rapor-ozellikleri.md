# Rapor: ne gösterir, nasıl çalışır

Kullanıcıya raporu anlatırken ya da "şu metrik nereden geliyor" sorusuna cevap verirken buradan yararlan.

## Mimari

```
Google Ads MCC Script ───────┐
Meta Marketing API ──────────┤
Adjust Report API ───────────┤   Apps Script (10 dk'da bir)    ┌─ Config (hesaplar, ayarlar, kuyruk, kurlar, log,
GA4 Data API (köprüyle de) ──┼──────────────────────────────▶  │   Eşleştirme, Views, Hedefler, Kreatifler, Manuel Veri)
TikTok / Yandex / RTB House ─┤                                  ├─ data/     günlük kampanya / ad / varlık dosyaları (Sheets)
Criteo / Yango API ──────────┤                                  └─ exports/  "Sheets'e aktar" ile oluşan tablolar
Microsoft Ads Script (POST) ─┤                                         │
Config > Manuel Veri ────────┘                                         ▼
                Web uygulaması: Rapor · Web · App · Kreatif · CPAS · Hedefler · Durum (admin)
```

- Hepsi raporu kuran ajans hesabının Drive'ında durur. Ücretli bağlayıcı (Supermetrics vb.) yok.
- Veri **günlük** tutulur, START_DATE'ten itibaren. Kampanya seviyesi yıllık, ad / varlık seviyesi aylık dosyalarda (Sheets 10M hücre sınırı için).
- İlk çekim (backfill) en yeni aydan geriye doğru ilerler; son aylar ilk 1-2 saatte hazır olur, geçmişin tamamı birkaç saat sürer.
- Her gece REFRESH_HOUR'dan sonra son günler yeniden çekilir (attribution gecikmesi için): Meta/Adjust 7 gün, GA4 3 gün, Google Ads 14 gün, diğer platformlar 7 gün.
- Veri bugünü içermez; en fazla dün.
- Tüm harcama ve gelir günlük kurla **raporun para birimine** çevrilir (Brand.js > REPORT_CURRENCY, ör. TRY). Kolon başlıklarında para simgesi yok, değerlerde var.
- Kampanya seviyesi sorgular önceden eşleştirilmiş tek bir "küp" dosyasından gelir (hızlı). Ad group / ad seviyesi canlı hesaplanır.

## Sekmeler

### Rapor (reklam performansı)
- **Seviye:** Toplam › Ülke › Platform › Hesap › Kampanya › Ad group › Ad. İsimlere tıklayınca bir alt seviyeye inilir; üstteki etiketlerden geri çıkılır. Zaman: dönemsiz / günlük / haftalık / aylık.
- Tek ülkede yayındaysa (`SHOW_COUNTRY: false`) ülke seviyesi, filtresi ve kolonu yok.
- **Kartlar:** tablonun üstündeki KPI kartları eklenir, çıkarılır, sürükle-bırakla sıralanır. Kart ekranından formülle **yeni metrik** oluşturulabilir (ör. `spend / tot_purchases`).
- **Kolonlar ve özel metrikler:** "Görünüm" ekranından kolon seç/sırala, formülle özel kolon ekle. Marjin = harcama / gelir.
- **Kayıtlı raporlar:** filtreler, tarih (son N gün olarak da), seviye, kolonlar, kartlar ve karşılaştırma ayarı ad verilerek kaydedilir. Görünürlük: **Özel** (sadece ben + paylaştığım e-postalar) ya da **Herkese açık**. Her rapor `?r=ID` linkiyle açılır.
- **Karşılaştırma:** tarih seçicinin yanındaki "Karşılaştır". Önceki dönem (varsayılan), geçen yıl aynı dönem ya da özel aralık. Değişim yüzdesi kartlarda ve tablodaki her hücrede görünür; maliyet metriklerinde düşüş yeşildir. Tüm sekmelerde geçerli.
- **Hedef kartları:** Hedefler sekmesinde girilen hedefler (satış tutarı, satış adedi, session, harcama) seçili tarih aralığına göre gün oranlı hesaplanıp ilerleme kartı olarak görünür. "Bu ay" seçiliyken beklenen tempo çizgisi ve ay sonu tahmini de var.
- **Filtreler:** ülke, mecra, hesap, kampanya grubu (CAMPAIGN_GROUP varsa), kampanya adı içerir / içermez (YA DA / VE), metrik filtresi (ör. ROAS > 3), seçili satırlarla sınırla.
- **Trend:** birden çok metrik, isteğe bağlı kırılım, metrik başına grafik ya da tek grafik (endeks).
- CSV ve "Google Sheets'e aktar" görünen kolonları ve (varsa) seçili satırları içerir.
- Ad / ad group seviyesinde tarih aralığı en fazla 186 gün (Settings > AD_LEVEL_MAX_DAYS).

### Web (GA4)
- Sitenin tamamı (sadece reklam kaynaklı değil): oturum, kullanıcı, etkileşim oranı, satın alma, gelir, CVR, sepet → satın alma, AOV, oturum başı gelir; reklam harcamasıyla blended ROAS ve marjin.
- Kırılım: kanal, kaynak / araç, cihaz, yeni / geri gelen. Huni: oturum → sepete ekleme → checkout → satın alma. Grafikte metrikler seçilebilir.

### App (Adjust)
- Gelir, satın alma, AOV, CVR, sepet → satın alma, oturum, DAU, ARPDAU, install, organik pay, retention D1/D7/D30.
- **Network tablosunda drill-down:** partner › kampanya › ad group › kreatif (Adjust'taki gibi). OS kırılımında verisi olmayan OS'ler gizlenir.
- Sepete ekleme ve checkout event'leri Adjust event listesinden otomatik bulunur (Settings > ADJUST_APP_EVENTS).
- Adjust'a maliyet aktarılmıyorsa CPI / ROAS, Meta (app objective) ve Google Ads App kampanyalarının **panel harcamasından** hesaplanır.

### Kreatif
- Verisi akan tüm mecraların kreatifleri, seçili tarih aralığındaki performansla: Meta (görsel / video / carousel), Google Ads (PMax asset group görsel ve videoları ayrı ayrı, Search görsel uzantıları, Demand Gen / YouTube), RTB House, Yandex.
- Aynı içerik (farklı boyutlar dahil) **birleşik** gösterilir; detayda boyut bazında performans. "Ayrı ayrı" seçeneği de var.
- **Eklenen / Otomatik** etiketi ve filtresi (Google'ın otomatik ürettiği varlıklar ayrılır). Logolar ve görseli olmayan katalog reklamları gizlenir.
- Tıklayınca açılır pencerede tam boy görsel, YouTube videosu ya da HTML banner.
- **Metinler** görünümü: Google başlık, açıklama, sabitlenen öğeler, sitelink, promosyon, açıklama metni, snippet; Meta primary text, headline, description.

### CPAS (isteğe bağlı)
- Brand.js > CPAS_ACCOUNTS doluysa açılır (ör. Trendyol Collaborative Ads). Bu hesaplar ana rapora girmez; sadece Meta panel verisiyle (catalog_segment satışları) özel bir sekme: kartlar, grafik, huni, haftanın günü, en iyi kampanya / reklam / kreatifler, tablo.

### Hedefler
- Aylık hedef girişi: ay + kapsam (Toplam ya da tek mecra) + satış tutarı / satış adedi / session / harcama. Önceki aydan kopyalama, düzenleme, silme. Config > Hedefler sayfasında durur.
- Satış ve session gerçekleşmesi **reklam kaynaklıdır** (kampanyalarla eşleşen GA4 + Adjust).

### Durum (sadece admin)
- Token girişi (Meta, Adjust, TikTok, Yandex, RTB House, Criteo, Yango), kuyruk, loglar, veri dosyaları, Config linki, misafir linki, backfill / önbellek düğmeleri, geri bildirimler.

Sağ üstteki "Raporda değişmesini istediğim bir şey var" düğmesi Config > Feedback'e yazar.

## Metrikler

| Grup | Kolonlar |
|---|---|
| PLATFORM | Spend, ROAS, Marjin, CPI, CPS, Clicks, Impressions, CPC, CTR, Installs (platform), Cost / Install |
| GA4 WEB | GA4 Sessions, GA4 Purchase, GA4 Purchase Revenue |
| ADJUST | Adjust Sessions, Purchase, Revenue, Installs (+ 0W cohort) |
| TOTAL | Total Sessions, Total Purchase, Total Revenue, Total Installs |

- ROAS = Total Revenue / Spend · Marjin = Spend / Total Revenue · CPI = Spend / Total Installs · CPS = Spend / Total Sessions
- Cohort ROAS = (GA4 gelir + Adjust 0W cohort gelir) / Spend
- Clicks: Google'da clicks, Meta'da link clicks.
- Gelir ve satış **GA4 / Adjust'tan** gelir, platformların kendi bildirdiği dönüşüm değerinden değil. (Criteo gibi bir mecrada panelde gelir var ama raporda yoksa sebep eşleşmedir; aşağıya bak.)

## GA4 / Adjust eşleştirme

Sırayla denenir:
1. **Kampanya ID / adı:** GA4 `sessionCampaignName` ↔ kampanya adı; Adjust campaign_network içindeki "(ID)" ↔ kampanya ID'si, yoksa ad. Büyük/küçük harf, URL kodlaması, boşluk ve sondaki yıl eki yok sayılır.
2. **Eşleştirme kuralları:** Config > Eşleştirme sayfası. Sütunlar: Kaynak (GA4 / Adjust / boş) · kampanya adı kalıbı (regex olabilir) · mecra · hedef kampanya (boş = mecradaki ilk kampanya). Ör. `GA4 | ^rtbhouse | RTB House |`.
3. **Kaynak / araç (sadece GA4):** kampanya adı tutmazsa ücretli görünen trafik (cpc, display, paid…; criteo, rtbhouse, yango kaynakları) kaynağa göre mecraya yazılır: google → Google Ads, facebook/instagram → Meta, bing → Microsoft Ads, yandex, criteo, rtbhouse, yango, tiktok. Bu trafik o mecranın **"(Eşleşmeyen kampanyalar)"** satırında görünür; mecra toplamına girer. Özel kural: Eşleştirme sayfasında Kaynak = `GA4 kaynak`, kalıp = kaynak / araç regex'i.

- Ad group seviyesi: GA4'te `sessionGoogleAdsAdGroupName`, `utm_term` (Meta ad set), `utm_content` (Meta ad); Adjust'ta adgroup. AG_START_DATE'ten sonrası ve GA4_GLOBAL_PROPERTY doluysa. Bulunamayanlar kampanyanın "(eşleşmeyen ad group)" satırında.
- Eşleşmeyen kampanyalar Rapor sekmesinin altında listelenir. Oran Log'daki `cube` satırında görünür.
- Meta'da reklam URL'lerinde utm_campaign = {{campaign.name}}, utm_term = {{adset.name}}, utm_content = {{ad.name}}, utm_id = {{campaign.id}} olmalı. Diğer mecralarda utm_campaign = kampanya adı.

## Erişim

- Ajans alan adındaki hesaplar (AGENCY_DOMAIN) ana linkten direkt girer.
- Marka ekibi **misafir linkini** açar, e-postasını yazar, 6 haneli kodla girer (30 gün geçerli oturum). Sadece Config > Settings > GUEST_EMAILS'teki adreslere kod gider; liste 5 dk önbellekte.
- Herkes Durum hariç tüm sekmeleri görür. Durum ve yönetim düğmeleri sadece ADMIN_EMAILS + raporu kuran hesap.
