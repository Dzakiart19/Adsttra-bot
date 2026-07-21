#!/usr/bin/env bash
# Veneno Traffic Bot — launcher
# Fully self-contained: auto-install, auto-build, auto-download Chrome, set LD libs.
# Fresh clone dari GitHub → bash start.sh → langsung jalan, tidak perlu setup manual.

set -e  # berhenti jika ada error fatal
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── 0. Auto-install & auto-build (fresh clone detection) ──────────────────────

# Install node_modules jika belum ada
if [ ! -d "${SCRIPT_DIR}/node_modules/.bin" ]; then
  echo "[start.sh] node_modules tidak ada — menjalankan npm install..."
  npm install --prefix "${SCRIPT_DIR}"
  echo "[start.sh] npm install selesai ✓"
fi

# Build TypeScript jika dist/main.js belum ada
if [ ! -f "${SCRIPT_DIR}/dist/main.js" ]; then
  echo "[start.sh] dist/main.js tidak ada — menjalankan npm run build..."
  npm run build --prefix "${SCRIPT_DIR}"
  echo "[start.sh] Build selesai ✓"
fi

set +e  # matikan strict mode untuk bagian library detection (error disini tidak fatal)

# ── 1. Baca Nix paths ──────────────────────────────────────────────────────────
# Prioritas 1: .nix_env (di-generate saat build — paling andal di deployment)
# Prioritas 2: parse env.json langsung (fallback dev)
NIX_PATHS=$(python3 - <<'PYEOF'
import re, sys

# Priority 1: baca .nix_env yang di-save saat build
try:
    with open('.nix_env', 'r') as f:
        line = f.read().strip()
    if '|' in line and len(line) > 5:
        print(line)
        sys.exit(0)
except Exception:
    pass

# Priority 2: parse env.json langsung
try:
    with open('.cache/replit/nix/env.json', 'r') as f:
        content = f.read()
except Exception:
    print('|')
    sys.exit(0)

m = re.search(r'"REPLIT_LD_LIBRARY_PATH":"([^"]+)"', content)
ld_path = m.group(1) if m else ''

gbm_paths = re.findall(r'/nix/store/[a-z0-9]+-mesa-libgbm[^":/\s]*', content)
gbm_paths = sorted(set(gbm_paths))
gbm_lib = gbm_paths[-1] + '/lib' if gbm_paths else ''

print(f'{ld_path}|{gbm_lib}')
# Juga update .nix_env supaya tersimpan untuk runtime berikutnya
try:
    with open('.nix_env', 'w') as f:
        f.write(f'{ld_path}|{gbm_lib}')
except Exception:
    pass
PYEOF
)

NIX_LD="${NIX_PATHS%%|*}"
GBM_LIB="${NIX_PATHS##*|}"

if [ -n "$GBM_LIB" ] && [ -d "$GBM_LIB" ]; then
  export LD_LIBRARY_PATH="${GBM_LIB}${NIX_LD:+:$NIX_LD}${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
  echo "[start.sh] mesa-libgbm: $GBM_LIB"
elif [ -n "$NIX_LD" ]; then
  export LD_LIBRARY_PATH="${NIX_LD}${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
  echo "[start.sh] WARNING: mesa-libgbm path kosong — Chrome mungkin gagal launch!"
fi

if [ -n "$LD_LIBRARY_PATH" ]; then
  echo "[start.sh] LD_LIBRARY_PATH: $(echo "$LD_LIBRARY_PATH" | tr ':' '\n' | wc -l) paths"
else
  echo "[start.sh] WARNING: LD_LIBRARY_PATH kosong!"
fi

# ── 2. Set PUPPETEER_CACHE_DIR ke dalam project ───────────────────────────────
export PUPPETEER_CACHE_DIR="${SCRIPT_DIR}/.puppeteer_cache"

# ── 3. Auto-detect Chrome — hapus folder rusak jika binary hilang ──────────────
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

# ── 4. Jalankan bot ───────────────────────────────────────────────────────────
set -e
exec node dist/main.js "$@"
