#!/usr/bin/env bash
# Fully dynamic start.sh — JANGAN pernah hardcode /nix/store/HASH-... paths.
# Hash Nix berubah setiap update paket; script ini selalu baca environment saat ini.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

ENV_JSON="${SCRIPT_DIR}/.cache/replit/nix/env.json"

# ── Step 1: Base LD_LIBRARY_PATH dari REPLIT_LD_LIBRARY_PATH ─────────────────
# REPLIT_LD_LIBRARY_PATH di-set oleh Nix environment (freetype, fontconfig, dll).
# CATATAN: di production autoscale runtime, env var ini ADA tapi mesa/GBM mungkin
# tidak di-include — di-handle di Step 2b.
BASE_LD="${REPLIT_LD_LIBRARY_PATH:-}"

# ── Fallback: .nix_env (di-capture saat build command jalan) ─────────────────
# Format: BASE_LD_PATHS|GBM_LIB_PATH
if [ -z "$BASE_LD" ] && [ -f "${SCRIPT_DIR}/.nix_env" ]; then
  IFS='|' read -r _nix_ld _nix_gbm < "${SCRIPT_DIR}/.nix_env"
  BASE_LD="${_nix_ld:-}"
  echo "[start.sh] REPLIT_LD_LIBRARY_PATH kosong — fallback ke .nix_env"
fi

# ── Step 2: GBM path — 3 cara, prioritas berurutan ───────────────────────────

GBM_LIB=""

# 2a) Cek apakah mesa sudah ada di BASE_LD (kasus dev/lokal normal)
MESA_IN_BASE=$(echo "${BASE_LD}" | tr ':' '\n' | grep '/mesa-' | head -1)
if [ -n "$MESA_IN_BASE" ] && [ -f "${MESA_IN_BASE}/libgbm.so.1" ]; then
  : # GBM sudah ada di BASE_LD — tidak perlu set GBM_LIB terpisah
fi

# 2b) Baca dari .nix_env (GBM part yang di-save saat build)
if [ -z "$GBM_LIB" ] && [ -f "${SCRIPT_DIR}/.nix_env" ]; then
  IFS='|' read -r _nix_ld _nix_gbm < "${SCRIPT_DIR}/.nix_env"
  if [ -n "${_nix_gbm:-}" ] && [ -f "${_nix_gbm}/libgbm.so.1" ]; then
    GBM_LIB="${_nix_gbm}"
  fi
fi

# 2c) Cari mesa dari Nix store: ls top-level (cepat) + iterasi cek libgbm.so.1
# Diperlukan di production autoscale: mesa ada di Nix store tapi tidak di REPLIT_LD_LIBRARY_PATH.
# ls /nix/store hanya listing direktori — tidak rekursif, tidak lambat.
if [ -z "$GBM_LIB" ] && [ -z "$MESA_IN_BASE" ]; then
  for _mesa_pkg in $(ls /nix/store 2>/dev/null | grep -E '^[a-z0-9]+-mesa-[0-9]'); do
    if [ -f "/nix/store/${_mesa_pkg}/lib/libgbm.so.1" ]; then
      GBM_LIB="/nix/store/${_mesa_pkg}/lib"
      echo "[start.sh] GBM ditemukan via Nix store: ${_mesa_pkg}"
      break
    fi
  done
  if [ -z "$GBM_LIB" ]; then
    echo "[start.sh] WARNING: libgbm.so.1 tidak ditemukan — Chrome mungkin gagal launch"
  fi
fi

# ── Step 3: Gabungkan — GBM di-prepend (harus dapat prioritas lebih tinggi) ──
if [ -n "$GBM_LIB" ] && [ -n "$BASE_LD" ]; then
  export LD_LIBRARY_PATH="${GBM_LIB}:${BASE_LD}${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
elif [ -n "$BASE_LD" ]; then
  export LD_LIBRARY_PATH="${BASE_LD}${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
elif [ -n "$GBM_LIB" ]; then
  export LD_LIBRARY_PATH="${GBM_LIB}${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi

# Diagnostik: tampilkan freetype dan mesa/GBM yang aktif
_ft=$(echo "$LD_LIBRARY_PATH" | tr ':' '\n' | grep -o 'freetype-[0-9.]*' | head -1)
_gbm=$(echo "$LD_LIBRARY_PATH" | tr ':' '\n' | grep '/mesa-' | grep -o 'mesa-[0-9.]*' | head -1)
echo "[start.sh] LD_LIBRARY_PATH set (freetype=${_ft:-none}, mesa/gbm=${_gbm:-${GBM_LIB:-none}})"

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
