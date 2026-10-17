#!/bin/bash
# Kullanım: /bin/bash tools/deploy.sh <açıklama>
# Aynı koddan iki web uygulaması yayınlanır (ID'ler tools/deploy.json'da):
#   main  → ajans alan adı (DOMAIN): ajans hesapları direkt girer
#   guest → anonim (ANYONE_ANONYMOUS): marka ekibi e-posta + kodla girer
# İlk kurulumda deploy.json yoksa: /bin/bash tools/deploy.sh --init  (deployment'ları oluşturur, ID'leri yazar)
set -e
export PATH=/opt/homebrew/bin:/usr/local/bin:$PATH
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CFG="$ROOT/tools/deploy.json"
cd "$ROOT/apps-script"

set_access() { python3 - "$1" <<'PY'
import json,sys
p='appsscript.json'; d=json.load(open(p)); d['webapp']['access']=sys.argv[1]; open(p,'w').write(json.dumps(d,indent=2)+'\n')
PY
}
# clasp push: "zaten güncel" dışındaki hatalarda dur (eski kodun yanlış erişim ayarıyla yayınlanmasını önler)
push() { local out; out=$(clasp push --force 2>&1) || { echo "$out" | grep -qi "up to date\|already" || { echo "HATA: clasp push"; echo "$out"; exit 1; }; }; }
new_dep() { clasp create-deployment -d "$1" 2>&1 | grep -oE 'AKfyc[A-Za-z0-9_-]+' | head -1; }

if [ "$1" = "--init" ]; then
  set_access DOMAIN;           push; MAIN=$(new_dep "main-v1")
  set_access ANYONE_ANONYMOUS; push; GUEST=$(new_dep "guest-v1")
  set_access DOMAIN
  [ -n "$MAIN" ] && [ -n "$GUEST" ] || { echo "HATA: deployment oluşturulamadı"; exit 1; }
  printf '{ "main": "%s", "guest": "%s" }\n' "$MAIN" "$GUEST" > "$CFG"
  # misafir deployment ID'sini Brand.js'e yaz (giriş kodu maili ve Durum sekmesindeki link için)
  python3 - "$GUEST" <<'PY'
import re,sys
p='Brand.js'; s=open(p).read()
s=re.sub(r"GUEST_DEPLOYMENT_ID:\s*'[^']*'", "GUEST_DEPLOYMENT_ID: '"+sys.argv[1]+"'", s); open(p,'w').write(s)
PY
  echo "main=$MAIN"; echo "guest=$GUEST"
  echo "Brand.js güncellendi → şimdi: /bin/bash tools/deploy.sh v1"
  exit 0
fi

[ -f "$CFG" ] || { echo "HATA: tools/deploy.json yok. Önce: /bin/bash tools/deploy.sh --init"; exit 1; }
MAIN=$(python3 -c "import json;print(json.load(open('$CFG'))['main'])")
GUEST=$(python3 -c "import json;print(json.load(open('$CFG'))['guest'])")
D="${1:-update}"
set_access DOMAIN;           push; clasp update-deployment "$MAIN"  -d "$D" | tail -1
set_access ANYONE_ANONYMOUS; push; clasp update-deployment "$GUEST" -d "$D-guest" | tail -1
set_access DOMAIN
echo "Ana link:     https://script.google.com/macros/s/$MAIN/exec"
echo "Misafir link: https://script.google.com/macros/s/$GUEST/exec"
