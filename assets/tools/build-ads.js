// Tek dosyalık script'leri üretir (Brand.js her birinin en başına gömülür):
//  dist/GoogleAds_Script_MCC1.js (+ MCC2) = Brand.js + GAds.src.js + Shared.js   → Google Ads > Script'ler'e yapıştırılır
//  ga4-script/project/                    = Brand.js + Bridge.js + Shared.js + Ga4.js → GA4 köprüsü (clasp ile başka hesaba)
// Kullanım: node tools/build-ads.js "<CONFIG_URL>"
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const cfg = process.argv[2];
if (!cfg || !/^https:\/\/docs\.google\.com\/spreadsheets\//.test(cfg)) {
  console.error('Kullanım: node tools/build-ads.js "<CONFIG_URL>"  (web uygulaması > Durum sekmesindeki Config linki)');
  process.exit(1);
}
const rd = p => fs.readFileSync(path.join(root, p), 'utf8');
const brand = rd('apps-script/Brand.js');
const shared = rd('apps-script/Shared.js');
const dist = path.join(root, 'dist');
fs.mkdirSync(dist, { recursive: true });
[['MCC1', 'GADS_', ''], ['MCC2', 'GADS2_', '_2']].forEach(([name, prefix, suffix]) => {
  const ads = '/* ===== Marka ayarları (Brand.js) ===== */\n' + brand + '\n\n' +
    rd('ads-script/GAds.src.js').replace('__CONFIG_URL__', cfg).replace('__STATE_PREFIX__', prefix).replace('__DATASET_SUFFIX__', suffix) +
    '\n\n/* ===== Ortak veri katmanı (Shared.js) ===== */\n' + shared;
  fs.writeFileSync(path.join(dist, 'GoogleAds_Script_' + name + '.js'), ads);
});
// clasp projesi (GA4 köprüsü)
const pj = path.join(root, 'ga4-script/project');
fs.mkdirSync(pj, { recursive: true });
fs.writeFileSync(path.join(pj, 'Brand.js'), brand);
fs.writeFileSync(path.join(pj, 'Bridge.js'), rd('ga4-script/GA4Bridge.src.js').replace('__CONFIG_URL__', cfg));
fs.writeFileSync(path.join(pj, 'Shared.js'), shared);
fs.writeFileSync(path.join(pj, 'Ga4.js'), rd('apps-script/Ga4.js'));
// Microsoft Ads script'i (veriyi misafir web uygulamasına POST eder)
const B = {};
new Function('o', brand + '\no.BRAND = BRAND;')(B);
const bingAccts = (B.BRAND.ACCOUNTS || []).filter(a => a[0] === 'Microsoft Ads').map(a => String(a[3]));
if (bingAccts.length) {
  if (!B.BRAND.GUEST_DEPLOYMENT_ID || !B.BRAND.BING_PUSH_KEY) { console.error('Microsoft Ads: Brand.js > GUEST_DEPLOYMENT_ID / BING_PUSH_KEY boş (önce deploy.sh --init)'); process.exit(1); }
  fs.writeFileSync(path.join(dist, 'MicrosoftAds_Script.js'), rd('ads-script/MicrosoftAds.src.js')
    .replace('__PUSH_URL__', 'https://script.google.com/macros/s/' + B.BRAND.GUEST_DEPLOYMENT_ID + '/exec')
    .replace('__PUSH_KEY__', B.BRAND.BING_PUSH_KEY)
    .replace('__ACCOUNTS__', JSON.stringify(bingAccts))
    .replace('__START_DATE__', B.BRAND.START_DATE || '2025-01-01'));
}
console.log('ok → dist/GoogleAds_Script_MCC1.js, dist/GoogleAds_Script_MCC2.js, ga4-script/project/' + (bingAccts.length ? ', dist/MicrosoftAds_Script.js' : ''));
