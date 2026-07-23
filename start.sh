#!/usr/bin/env bash
# Fully dynamic start.sh — JANGAN pernah hardcode /nix/store/HASH-... paths.
# Hash Nix berubah setiap update paket; script ini selalu baca environment saat ini.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

ENV_JSON="${SCRIPT_DIR}/.cache/replit/nix/env.json"

# ── Step 1: Base LD_LIBRARY_PATH dari REPLIT_LD_LIBRARY_PATH ─────────────────
# REPLIT_LD_LIBRARY_PATH di-set oleh Nix environment dan selalu berisi path
# yang benar untuk environment saat ini — termasuk freetype versi baru yang
# dibutuhkan harfbuzz (mis: 2.13.3 untuk harfbuzz-10.2.0).
BASE_LD="${REPLIT_LD_LIBRARY_PATH:-}"

# ── Step 2: GBM path dari env.json (tidak ada di REPLIT_LD_LIBRARY_PATH) ─────
# mesa-libgbm dibutuhkan Chrome tapi tidak di-export via REPLIT_LD_LIBRARY_PATH;
# harus dicari dari env.json via regex.
GBM_LIB=""
if [ -f "$ENV_JSON" ]; then
  GBM_LIB=$(python3 - <<'PYEOF'
import json, re, sys
try:
    with open('.cache/replit/nix/env.json') as f:
        raw = f.read()
    m = re.search(r'/nix/store/[a-z0-9]+-mesa-libgbm[^"\s:]*', raw)
    if m:
        p = m.group(0).rstrip('/')
        print(p + '/lib')
except Exception:
    pass
PYEOF
  2>/dev/null || true)
fi

# ── Step 3: Gabungkan — GBM di-prepend (harus dapat prioritas lebih tinggi) ──
if [ -n "$GBM_LIB" ] && [ -n "$BASE_LD" ]; then
  export LD_LIBRARY_PATH="${GBM_LIB}:${BASE_LD}${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
elif [ -n "$BASE_LD" ]; then
  export LD_LIBRARY_PATH="${BASE_LD}${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
elif [ -n "$GBM_LIB" ]; then
  export LD_LIBRARY_PATH="${GBM_LIB}${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi

echo "[start.sh] LD_LIBRARY_PATH set (freetype=$(echo "$LD_LIBRARY_PATH" | tr ':' '\n' | grep -o 'freetype-[0-9.]*' | head -1), gbm=$(echo "$GBM_LIB" | grep -o 'mesa-libgbm-[^ /]*' || echo 'none'))"

# ── Step 4: Cari Chrome binary ────────────────────────────────────────────────
# Hanya scan direktori kecil (JANGAN find /nix/store — terlalu lambat).
CHROME_BIN=""

# Prioritas 1: .puppeteer_cache/ lokal (di-install oleh build command deployment)
if [ -d "${SCRIPT_DIR}/.puppeteer_cache" ]; then
  CHROME_BIN=$(find "${SCRIPT_DIR}/.puppeteer_cache" \
    \( -name "chrome-headless-shell" -o -name "chrome" \) -type f 2>/dev/null | head -1)
fi

# Prioritas 2: ~/.cache/puppeteer (lokasi default puppeteer download)
if [ -z "$CHROME_BIN" ] && [ -d "/home/runner/.cache/puppeteer" ]; then
  CHROME_BIN=$(find "/home/runner/.cache/puppeteer" \
    \( -name "chrome-headless-shell" -o -name "chrome" \) -type f 2>/dev/null | head -1)
fi

# Prioritas 3: system chromium
if [ -z "$CHROME_BIN" ]; then
  for p in /usr/bin/chromium-browser /usr/bin/chromium /usr/bin/google-chrome; do
    if [ -f "$p" ]; then CHROME_BIN="$p"; break; fi
  done
fi

# Prioritas 4: auto-install jika tidak ditemukan sama sekali
if [ -z "$CHROME_BIN" ]; then
  echo "[start.sh] Chrome tidak ditemukan — auto-install via puppeteer..."
  PUPPETEER_CACHE_DIR="${SCRIPT_DIR}/.puppeteer_cache" \
    npx puppeteer browsers install chrome-headless-shell 2>&1 | tail -5
  CHROME_BIN=$(find "${SCRIPT_DIR}/.puppeteer_cache" \
    -name "chrome-headless-shell" -type f 2>/dev/null | head -1)
fi

if [ -n "$CHROME_BIN" ]; then
  export PUPPETEER_EXECUTABLE_PATH="$CHROME_BIN"
  echo "[start.sh] Chrome: $CHROME_BIN"
else
  echo "[start.sh] WARNING: Chrome binary tidak ditemukan — Puppeteer akan cari sendiri"
fi

# ── Step 5: Build jika dist/ belum ada ───────────────────────────────────────
if [ ! -f "${SCRIPT_DIR}/dist/main.js" ]; then
  echo "[start.sh] dist/main.js belum ada — build dulu..."
  npm run build
fi

exec node dist/main.js "$@"
