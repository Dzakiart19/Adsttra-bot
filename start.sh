#!/usr/bin/env bash
# Fully dynamic start.sh — JANGAN pernah hardcode /nix/store/HASH-... paths.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── Step 1: Base LD_LIBRARY_PATH dari REPLIT_LD_LIBRARY_PATH ─────────────────
BASE_LD="${REPLIT_LD_LIBRARY_PATH:-}"

# Fallback: .nix_env (di-capture saat build command jalan)
# Format: BASE_LD_PATHS|GBM_LIB_PATH
if [ -f "${SCRIPT_DIR}/.nix_env" ]; then
  IFS='|' read -r _nix_ld _nix_gbm < "${SCRIPT_DIR}/.nix_env"
  if [ -z "$BASE_LD" ] && [ -n "${_nix_ld:-}" ]; then
    BASE_LD="${_nix_ld}"
    echo "[start.sh] REPLIT_LD_LIBRARY_PATH kosong — fallback ke .nix_env"
  fi
fi

# ── Step 2: GBM path — prioritas berurutan ────────────────────────────────────
GBM_LIB=""

# 2a) Bundled libs: .lib/libgbm.so.1 disalin ke workspace saat build command.
#     Ini cara UTAMA di production autoscale (Nix store runtime tidak punya mesa).
if [ -f "${SCRIPT_DIR}/.lib/libgbm.so.1" ]; then
  GBM_LIB="${SCRIPT_DIR}/.lib"
  echo "[start.sh] GBM dari bundled libs: ${GBM_LIB}"
fi

# 2b) .nix_env GBM part (disimpan oleh bundle_libs.sh saat build)
if [ -z "$GBM_LIB" ] && [ -f "${SCRIPT_DIR}/.nix_env" ]; then
  IFS='|' read -r _nix_ld _nix_gbm < "${SCRIPT_DIR}/.nix_env"
  if [ -n "${_nix_gbm:-}" ] && [ -f "${_nix_gbm}/libgbm.so.1" ]; then
    GBM_LIB="${_nix_gbm}"
    echo "[start.sh] GBM dari .nix_env: ${GBM_LIB}"
  fi
fi

# 2c) Mesa sudah ada di BASE_LD (kasus dev/lokal normal)
if [ -z "$GBM_LIB" ]; then
  MESA_IN_BASE=$(echo "${BASE_LD}" | tr ':' '\n' | grep '/mesa-' | head -1)
  if [ -n "$MESA_IN_BASE" ] && [ -f "${MESA_IN_BASE}/libgbm.so.1" ]; then
    GBM_LIB="$MESA_IN_BASE"
    echo "[start.sh] GBM sudah ada di REPLIT_LD_LIBRARY_PATH: ${GBM_LIB}"
  fi
fi

# 2d) Fallback: cari mesa dari Nix store (ls top-level saja, cepat)
#     Diperlukan di dev/lokal jika mesa tidak ada di BASE_LD.
if [ -z "$GBM_LIB" ]; then
  for _mesa_pkg in $(ls /nix/store 2>/dev/null | grep -E '^[a-z0-9]+-mesa-[0-9]'); do
    if [ -f "/nix/store/${_mesa_pkg}/lib/libgbm.so.1" ]; then
      GBM_LIB="/nix/store/${_mesa_pkg}/lib"
      echo "[start.sh] GBM ditemukan via Nix store: ${_mesa_pkg}"
      break
    fi
  done
fi

if [ -z "$GBM_LIB" ]; then
  echo "[start.sh] WARNING: libgbm.so.1 tidak ditemukan — Chrome mungkin gagal launch"
fi

# ── Step 3: Gabungkan LD_LIBRARY_PATH ─────────────────────────────────────────
# GBM harus di-prepend agar dapat prioritas lebih tinggi dari REPLIT paths.
if [ -n "$GBM_LIB" ] && [ -n "$BASE_LD" ]; then
  export LD_LIBRARY_PATH="${GBM_LIB}:${BASE_LD}${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
elif [ -n "$BASE_LD" ]; then
  export LD_LIBRARY_PATH="${BASE_LD}${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
elif [ -n "$GBM_LIB" ]; then
  export LD_LIBRARY_PATH="${GBM_LIB}${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi

# Diagnostik
_ft=$(echo "$LD_LIBRARY_PATH" | tr ':' '\n' | grep -o 'freetype-[0-9.]*' | head -1)
_gbm_diag=""
if [ -n "$GBM_LIB" ]; then
  _gbm_diag=$(echo "$GBM_LIB" | grep -o 'mesa-[0-9.]*' || echo "$GBM_LIB")
fi
echo "[start.sh] LD_LIBRARY_PATH set (freetype=${_ft:-none}, mesa/gbm=${_gbm_diag:-none})"

# ── Step 4: Cari Chrome binary ────────────────────────────────────────────────
CHROME_BIN=""

# Prioritas 1: .puppeteer_cache/ lokal (di-install oleh build command deployment)
if [ -d "${SCRIPT_DIR}/.puppeteer_cache" ]; then
  CHROME_BIN=$(find "${SCRIPT_DIR}/.puppeteer_cache" \
    \( -name "chrome-headless-shell" -o -name "chrome" \) -type f 2>/dev/null | head -1)
fi

# Prioritas 2: ~/.cache/puppeteer (lokasi default)
if [ -z "$CHROME_BIN" ] && [ -d "/home/runner/.cache/puppeteer" ]; then
  CHROME_BIN=$(find "/home/runner/.cache/puppeteer" \
    \( -name "chrome-headless-shell" -o -name "chrome" \) -type f 2>/dev/null | head -1)
fi

# Prioritas 3: system chromium
if [ -z "$CHROME_BIN" ]; then
  for p in /usr/bin/chromium-browser /usr/bin/chromium /usr/bin/google-chrome; do
    [ -f "$p" ] && CHROME_BIN="$p" && break
  done
fi

# Prioritas 4: auto-install
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
  echo "[start.sh] WARNING: Chrome binary tidak ditemukan"
fi

# ── Step 5: Build jika dist/ belum ada ───────────────────────────────────────
if [ ! -f "${SCRIPT_DIR}/dist/main.js" ]; then
  echo "[start.sh] dist/main.js belum ada — build dulu..."
  npm run build
fi

exec node dist/main.js "$@"
