# Rapor: ne gösterir, nasıl çalışır

Kullanıcıya raporu anlatırken ya da "şu metrik nereden geliyor" sorusuna cevap verirken buradan yararlan.

## Mimari

```
Google Ads MCC Script ──┐
Meta Insights API ──────┤   Apps Script (10 dk'da bir)   ┌─ Config (hesaplar, ayarlar, kuyruk, kurlar, log)
Adjust Report API ──────┼──────────────────────────────▶ ├─ data/     yıllık kampanya + aylık ad dosyaları (Sheets)
GA4 Data API ───────────┘                                └─ exports/  "Sheets'e aktar" ile oluşan tablolar
                                    │
                                    ▼
          Web uygulaması: Rapor · Trend · Durum (sadece admin)
```

- Hepsi raporu kuran ajans hesabının Drive'ında durur. Ek ücretli araç (Supermetrics vb.) yok.
- Veri **günlük** tutulur, START_DATE'ten itibaren. Kampanya seviyesi yıllık, ad seviyesi aylık dosyalarda (Sheets 10M hücre sınırı için).
- İlk çekim (backfill) en yeni aydan geriye doğru ilerler; son aylar ilk 1-2 saatte hazır olur, geçmişin tamamı hesap sayısına göre birkaç saat sürer.
- Her gün REFRESH_HOUR'dan sonra son günler yeniden çekilir (attribution gecikmesi için): Meta/Adjust 7 gün, GA4 3 gün, Google Ads 14 gün.
- Veri bugünü içermez; en fazla dün.
- Harcama ve gelir günlük kurla USD'ye çevrilir; orijinal para birimi de saklanır.

## Ekranlar

- **Rapor:** Seviye (Toplam › Ülke › Ülke·Platform › Hesap › Kampanya › Ad group › Ad) × Zaman (Dönemsiz / Günlük / Haftalık / Aylık).
  - İsimlere tıklayınca bir alt seviyeye inilir; üstteki etiketlerden geri çıkılır.
  - Satırlar seçilebilir; CSV ve "Google Sheets'e aktar" seçili satırları (yoksa tümünü) ve görünen kolonları içerir.
- **Trend:** birden çok metrik, isteğe bağlı kırılım (en büyük 8 seri), "metrik başına grafik" ya da "tek grafik (endeks)".
- **Durum** (sadece admin): token girişi, kuyruk, loglar, veri dosyaları, Config linki, misafir linki, backfill düğmeleri.
- **Filtreler:** tarih, ülke, platform, hesap, kampanya grubu (Brand.js > CAMPAIGN_GROUP varsa), kampanya adı içerir / içermez (YA DA / VE bağlacıyla).
- Ad / ad group seviyesinde tarih aralığı en fazla 186 gün (Settings > AD_LEVEL_MAX_DAYS).
- Sağ üstteki "Raporda değişmesini istediğim bir şey var" düğmesi Config > Feedback sekmesine yazar; Durum'da da listelenir.

## Kolon grupları

| Grup | Kolonlar | Varsayılan |
|---|---|---|
| PLATFORM | Spend ($), ROAS, CPI, CPS, Spend (orijinal para birimi), Clicks, Impressions, Avg. CPC, CTR, Installs (Platform), Cost / Install | açık |
| GA4 WEB | GA4 Sessions, GA4 Purchase, GA4 Purchase Revenue | kapalı |
| ADJUST | Adjust Sessions, Adjust Purchase, Adjust Purchase Revenue, Adjust Installs (+ 0W cohort) | kapalı |
| TOTAL | Total Sessions, Total Purchase, Total Purchase Revenue, Total Installs | açık |

- ROAS = Total Purchase Revenue / Spend · CPI = Spend / Total Installs · CPS = Spend / Total Sessions
- Cohort ROAS = (GA4 gelir + Adjust 0W cohort gelir) / Spend
- Clicks: Google'da clicks, Meta'da link clicks.
- Installs (Platform): Meta'da mobile app install; Google'da App kampanyalarının dönüşümleri.

## GA4 / Adjust eşleştirme

- GA4: `sessionCampaignName` ↔ kampanya adı. Adjust: campaign_network içindeki "(ID)" ↔ kampanya ID'si, yoksa ad.
- Büyük/küçük harf, URL kodlaması, fazla boşluk ve sondaki yıl eki ("_2026") yok sayılır.
- Ad group seviyesi: GA4'te `sessionGoogleAdsAdGroupName`, `utm_term` (Meta ad set), `utm_content` (Meta ad); Adjust'ta adgroup. Sadece AG_START_DATE'ten sonrası ve GA4 için GA4_GLOBAL_PROPERTY doluysa.
- Eşleşmeyen kampanyalar tablonun altında listelenir. Eşleşme oranı markanın UTM düzenine bağlıdır; Durum > "Rapor önbelleğini yenile" sonucunda ve Log'daki `cube` satırında görünür. PMax ve App kampanyalarının bir kısmı ad group seviyesinde eşleşmez.
- Meta tarafında eşleşme için reklam URL'lerinde utm_campaign = kampanya adı (ya da {{campaign.name}}), utm_term = {{adset.name}}, utm_content = {{ad.name}}, utm_id = {{campaign.id}} olmalı.

## Erişim

- Ajans alan adındaki hesaplar (Brand.js > AGENCY_DOMAIN) ana linkten direkt girer.
- Marka ekibi **misafir linkini** açar, e-postasını yazar, 6 haneli kodla girer (30 gün geçerli oturum). Sadece Config > Settings > GUEST_EMAILS'teki adreslere kod gider; liste 5 dk önbellekte tutulur.
- Durum sekmesi ve yönetim düğmeleri sadece ADMIN_EMAILS + raporu kuran hesap.
