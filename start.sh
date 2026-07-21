#!/usr/bin/env bash
# Veneno Traffic Bot — launcher dengan LD_LIBRARY_PATH dari Nix env.json

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

ENV_JSON="${SCRIPT_DIR}/.cache/replit/nix/env.json"

# ── 1. Extract LD_LIBRARY_PATH + mesa-libgbm path sekaligus dari env.json ─────
NIX_PATHS=$(python3 - <<'PYEOF'
import re, sys

try:
    with open('.cache/replit/nix/env.json', 'r') as f:
        content = f.read()
except Exception as e:
    sys.exit(0)

# Ambil REPLIT_LD_LIBRARY_PATH
m = re.search(r'"REPLIT_LD_LIBRARY_PATH":"([^"]+)"', content)
ld_path = m.group(1) if m else ''

# Cari semua path mesa-libgbm (ambil yang versi tertinggi)
gbm_paths = re.findall(r'/nix/store/[a-z0-9]+-mesa-libgbm[^":/\s]*', content)
gbm_paths = sorted(set(gbm_paths))
gbm_lib = gbm_paths[-1] + '/lib' if gbm_paths else ''

# Output: LD_PATH|GBM_PATH
print(f'{ld_path}|{gbm_lib}')
PYEOF
)

NIX_LD="${NIX_PATHS%%|*}"
GBM_LIB="${NIX_PATHS##*|}"

if [ -n "$GBM_LIB" ] && [ -d "$GBM_LIB" ]; then
  export LD_LIBRARY_PATH="${GBM_LIB}${NIX_LD:+:$NIX_LD}${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
  echo "[start.sh] mesa-libgbm: $GBM_LIB"
elif [ -n "$NIX_LD" ]; then
  export LD_LIBRARY_PATH="${NIX_LD}${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi

if [ -n "$NIX_LD" ]; then
  echo "[start.sh] LD_LIBRARY_PATH: $(echo "$LD_LIBRARY_PATH" | tr ':' '\n' | wc -l) paths"
else
  echo "[start.sh] WARNING: REPLIT_LD_LIBRARY_PATH tidak ditemukan di env.json"
fi

# ── 2. Set PUPPETEER_CACHE_DIR ke dalam project ──────────────────────────────
export PUPPETEER_CACHE_DIR="${SCRIPT_DIR}/.puppeteer_cache"

# ── 3. Auto-detect Chrome — hapus folder rusak jika binary hilang ─────────────
CHROME_DIR="${PUPPETEER_CACHE_DIR}/chrome-headless-shell"
CHROME_BIN=$(find "${CHROME_DIR}" -name "chrome-headless-shell" -type f 2>/dev/null | head -1)

if [ -z "$CHROME_BIN" ]; then
  if [ -d "$CHROME_DIR" ]; then
    echo "[start.sh] Chrome folder ada tapi binary hilang — hapus dan download ulang..."
    rm -rf "$CHROME_DIR"
  else
    echo "[start.sh] Chrome tidak ditemukan — mendownload chrome-headless-shell..."
  fi
  PUPPETEER_CACHE_DIR="${PUPPETEER_CACHE_DIR}" npx puppeteer browsers install chrome-headless-shell
  CHROME_BIN=$(find "${CHROME_DIR}" -name "chrome-headless-shell" -type f 2>/dev/null | head -1)
fi

if [ -n "$CHROME_BIN" ]; then
  export PUPPETEER_EXECUTABLE_PATH="$CHROME_BIN"
  echo "[start.sh] Chrome: $CHROME_BIN"
else
  echo "[start.sh] WARNING: Chrome tidak ditemukan setelah download!"
fi

# ── 4. Jalankan bot ──────────────────────────────────────────────────────────
exec node dist/main.js "$@"
