#!/usr/bin/env bash
# =============================================================================
#  Veneno Traffic Bot v2 — One-Shot Installer
#  Jalankan sekali: bash install.sh
#  Mendukung: Replit (NixOS) | Ubuntu 20.04+ | Debian 11+
# =============================================================================

set -euo pipefail

# ── Warna & helpers ───────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }
step()    { echo -e "\n${CYAN}══════════════════════════════════════════${NC}"; echo -e "${CYAN}  $*${NC}"; echo -e "${CYAN}══════════════════════════════════════════${NC}"; }

# ── Deteksi lingkungan ────────────────────────────────────────────────────────
detect_env() {
  if [ -f /etc/NIXOS ] || [ -n "${REPL_ID:-}" ] || [ -d /nix/store ]; then
    echo "replit"
  elif grep -qi "ubuntu\|debian" /etc/os-release 2>/dev/null; then
    echo "ubuntu"
  else
    echo "unknown"
  fi
}

ENV=$(detect_env)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo ""
echo -e "${GREEN}"
echo "  ██╗   ██╗███████╗███╗   ██╗███████╗███╗   ██╗ ██████╗"
echo "  ██║   ██║██╔════╝████╗  ██║██╔════╝████╗  ██║██╔═══██╗"
echo "  ██║   ██║█████╗  ██╔██╗ ██║█████╗  ██╔██╗ ██║██║   ██║"
echo "  ╚██╗ ██╔╝██╔══╝  ██║╚██╗██║██╔══╝  ██║╚██╗██║██║   ██║"
echo "   ╚████╔╝ ███████╗██║ ╚████║███████╗██║ ╚████║╚██████╔╝"
echo "    ╚═══╝  ╚══════╝╚═╝  ╚═══╝╚══════╝╚═╝  ╚═══╝ ╚═════╝"
echo -e "${NC}"
echo -e "  ${CYAN}Traffic Bot v2 — Installer${NC}"
echo -e "  Lingkungan terdeteksi: ${YELLOW}${ENV}${NC}"
echo ""

# =============================================================================
# STEP 1 — System dependencies
# =============================================================================
step "STEP 1/5 — System Dependencies"

if [ "$ENV" = "replit" ]; then
  info "Replit/NixOS — dependencies dikelola via replit.nix (sudah terpasang)"
  info "Verifikasi Nix packages kritis..."

  NIX_MISSING=()
  for pkg in mesa-libgbm systemd-minimal-libs libxkbcommon; do
    if ! ls /nix/store/*-${pkg}* &>/dev/null 2>&1; then
      NIX_MISSING+=("$pkg")
    fi
  done

  if [ ${#NIX_MISSING[@]} -gt 0 ]; then
    warn "Package Nix berikut belum ditemukan di store: ${NIX_MISSING[*]}"
    warn "Pastikan replit.nix sudah di-save dan Replit telah me-reload environment."
  else
    success "Semua Nix packages kritis tersedia"
  fi

elif [ "$ENV" = "ubuntu" ]; then
  info "Ubuntu/Debian — menginstall Chrome dependencies via apt..."
  sudo apt-get update -qq

  CHROME_DEPS=(
    ca-certificates fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0
    libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgbm1
    libgcc1 libglib2.0-0 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0
    libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1
    libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1
    libxss1 libxtst6 lsb-release wget xdg-utils libudev1 libxkbcommon0
  )

  sudo apt-get install -y --no-install-recommends "${CHROME_DEPS[@]}" 2>&1 | \
    grep -E "^(Setting up|Unpacking|Get:|Err:)" || true
  success "System dependencies terpasang"

else
  warn "OS tidak dikenali — skip instalasi system packages"
  warn "Pastikan Chrome dependencies terpasang manual (lihat README)"
fi

# =============================================================================
# STEP 2 — Node.js & npm check
# =============================================================================
step "STEP 2/5 — Node.js Environment"

if ! command -v node &>/dev/null; then
  error "Node.js tidak ditemukan! Install Node.js 18+ terlebih dahulu."
fi
if ! command -v npm &>/dev/null; then
  error "npm tidak ditemukan! Install npm terlebih dahulu."
fi

NODE_VER=$(node --version)
NPM_VER=$(npm --version)
success "Node.js ${NODE_VER} | npm v${NPM_VER}"

# =============================================================================
# STEP 3 — Node.js packages
# =============================================================================
step "STEP 3/5 — Node.js Packages"

cd "$SCRIPT_DIR"

info "Menginstall production dependencies (tanpa devDependencies)..."
npm install --omit=dev --ignore-scripts 2>&1 | tail -5

info "Menginstall TypeScript compiler..."
npm install --save-dev typescript@5 @types/node 2>&1 | tail -3

info "Menginstall ts-node (dibutuhkan untuk download script)..."
npm install --save-dev ts-node 2>&1 | tail -3

success "Node.js packages selesai"

# =============================================================================
# STEP 4 — Chrome / Puppeteer browser
# =============================================================================
step "STEP 4/5 — Chrome Browser (Puppeteer)"

CHROME_CACHE="${HOME}/.cache/puppeteer"
CHROME_FOUND=$(ls -d "${CHROME_CACHE}/chrome/linux-"* 2>/dev/null | head -1 || echo "")

if [ -n "$CHROME_FOUND" ]; then
  CHROME_VER=$(basename "$CHROME_FOUND")
  CHROME_BIN="${CHROME_FOUND}/chrome-linux64/chrome"
  if [ -x "$CHROME_BIN" ]; then
    success "Chrome sudah ada: ${CHROME_VER}"
    skip_download=true
  else
    warn "Folder Chrome ada tapi binary tidak ditemukan, re-download..."
    skip_download=false
  fi
else
  skip_download=false
fi

if [ "$skip_download" = "false" ]; then
  info "Mendownload Chrome untuk Puppeteer (bisa beberapa menit)..."
  node -e "
    const puppeteer = require('puppeteer');
    const { downloadBrowser } = require('puppeteer/internal/node/install.js');
    downloadBrowser().then(() => console.log('Chrome berhasil didownload')).catch(e => {
      // Coba cara lain
      const { execSync } = require('child_process');
      execSync('node node_modules/puppeteer/lib/cjs/puppeteer/node/install.js', { stdio: 'inherit' });
    });
  " 2>/dev/null || \
  PUPPETEER_CACHE_DIR="${CHROME_CACHE}" node -e "
    const { execSync } = require('child_process');
    try {
      execSync('npx puppeteer browsers install chrome', { stdio: 'inherit' });
    } catch(e) {
      execSync('node node_modules/.bin/puppeteer browsers install chrome', { stdio: 'inherit' });
    }
  " 2>&1 | tail -10

  # Verifikasi ulang
  CHROME_FOUND=$(ls -d "${CHROME_CACHE}/chrome/linux-"* 2>/dev/null | head -1 || echo "")
  if [ -n "$CHROME_FOUND" ] && [ -x "${CHROME_FOUND}/chrome-linux64/chrome" ]; then
    success "Chrome berhasil didownload: $(basename "$CHROME_FOUND")"
  else
    error "Download Chrome gagal! Jalankan manual: npx puppeteer browsers install chrome"
  fi
fi

# =============================================================================
# STEP 5 — Build TypeScript
# =============================================================================
step "STEP 5/5 — Build TypeScript"

info "Compiling TypeScript → dist/ ..."
node_modules/.bin/tsc 2>&1
success "Build selesai — output di dist/"

# =============================================================================
# Buat / verifikasi start.sh launcher
# =============================================================================
step "Verifikasi start.sh launcher"

# JANGAN scan /nix/store — terlalu lambat dan menghasilkan path hardcoded yang
# akan rusak setiap kali Nix update paket (hash berubah).
# start.sh yang benar sudah ada di repo dan membaca REPLIT_LD_LIBRARY_PATH
# secara dinamis + ekstrak GBM dari env.json.
# install.sh hanya memastikan file ada dan executable.

if [ -f "${SCRIPT_DIR}/start.sh" ]; then
  chmod +x "${SCRIPT_DIR}/start.sh"
  success "start.sh sudah ada dan siap digunakan (dynamic — tidak perlu di-generate ulang)"
else
  # Fallback: tulis start.sh dinamis jika entah bagaimana tidak ada di repo
  warn "start.sh tidak ditemukan di repo — membuat versi dinamis..."
  cat > "${SCRIPT_DIR}/start.sh" << 'STARTEOF'
#!/usr/bin/env bash
# Fully dynamic start.sh — JANGAN pernah hardcode /nix/store/HASH-... paths.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

ENV_JSON="${SCRIPT_DIR}/.cache/replit/nix/env.json"

# Base LD dari REPLIT_LD_LIBRARY_PATH (selalu berisi versi lib yang benar)
BASE_LD="${REPLIT_LD_LIBRARY_PATH:-}"

# Fallback .nix_env (di-generate saat build/install)
if [ -z "$BASE_LD" ] && [ -f "${SCRIPT_DIR}/.nix_env" ]; then
  IFS='|' read -r _ld _gbm < "${SCRIPT_DIR}/.nix_env"
  BASE_LD="${_ld:-}"
fi

# GBM dari env.json (tidak ada di REPLIT_LD_LIBRARY_PATH)
GBM_LIB=""
if [ -f "$ENV_JSON" ]; then
  GBM_LIB=$(python3 - <<'PYEOF'
import re
try:
    with open('.cache/replit/nix/env.json') as f:
        raw = f.read()
    m = re.search(r'/nix/store/[a-z0-9]+-mesa-libgbm[^"\s:]*', raw)
    if m:
        print(m.group(0).rstrip('/') + '/lib')
except Exception:
    pass
PYEOF
  2>/dev/null || true)
fi

if [ -n "$GBM_LIB" ] && [ -n "$BASE_LD" ]; then
  export LD_LIBRARY_PATH="${GBM_LIB}:${BASE_LD}${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
elif [ -n "$BASE_LD" ]; then
  export LD_LIBRARY_PATH="${BASE_LD}${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
elif [ -n "$GBM_LIB" ]; then
  export LD_LIBRARY_PATH="${GBM_LIB}${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi

CHROME_BIN=""
if [ -d "${SCRIPT_DIR}/.puppeteer_cache" ]; then
  CHROME_BIN=$(find "${SCRIPT_DIR}/.puppeteer_cache" \( -name "chrome-headless-shell" -o -name "chrome" \) -type f 2>/dev/null | head -1)
fi
if [ -z "$CHROME_BIN" ] && [ -d "/home/runner/.cache/puppeteer" ]; then
  CHROME_BIN=$(find "/home/runner/.cache/puppeteer" \( -name "chrome-headless-shell" -o -name "chrome" \) -type f 2>/dev/null | head -1)
fi
if [ -z "$CHROME_BIN" ]; then
  for p in /usr/bin/chromium-browser /usr/bin/chromium /usr/bin/google-chrome; do
    if [ -f "$p" ]; then CHROME_BIN="$p"; break; fi
  done
fi
if [ -z "$CHROME_BIN" ]; then
  PUPPETEER_CACHE_DIR="${SCRIPT_DIR}/.puppeteer_cache" \
    npx puppeteer browsers install chrome-headless-shell 2>&1 | tail -5
  CHROME_BIN=$(find "${SCRIPT_DIR}/.puppeteer_cache" -name "chrome-headless-shell" -type f 2>/dev/null | head -1)
fi
[ -n "$CHROME_BIN" ] && export PUPPETEER_EXECUTABLE_PATH="$CHROME_BIN"

[ ! -f "${SCRIPT_DIR}/dist/main.js" ] && npm run build
exec node dist/main.js "$@"
STARTEOF
  chmod +x "${SCRIPT_DIR}/start.sh"
  success "start.sh dinamis dibuat"
fi

# =============================================================================
# RINGKASAN
# =============================================================================
echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║          INSTALASI SELESAI — Veneno Traffic Bot v2         ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${CYAN}Chrome:${NC}     $(ls -d "${HOME}/.cache/puppeteer/chrome/linux-"* 2>/dev/null | head -1 | xargs basename 2>/dev/null || echo 'not found')"
echo -e "  ${CYAN}Node.js:${NC}    $(node --version)"
echo -e "  ${CYAN}Build:${NC}      dist/main.js ✓"
echo -e "  ${CYAN}Launcher:${NC}   ./start.sh"
echo ""
echo -e "  ${YELLOW}Cara menjalankan bot:${NC}"
echo -e "  ${GREEN}  bash start.sh${NC}"
echo ""
echo -e "  ${YELLOW}Konfigurasi via .env atau environment variables:${NC}"
echo -e "  ${CYAN}  DEFAULT_URL${NC}               = URL target"
echo -e "  ${CYAN}  MAX_SESSIONS${NC}              = jumlah sesi (default: 1)"
echo -e "  ${CYAN}  SESSION_TIME${NC}              = menit per sesi atau 'random'"
echo -e "  ${CYAN}  USE_FREE_PROXIES${NC}          = true/false (auto-fetch proxy gratis)"
echo -e "  ${CYAN}  PROXY_VALIDATE_CONCURRENCY${NC} = jumlah worker validasi proxy (default: 40)"
echo -e "  ${CYAN}  HUMAN_BEHAVIOR${NC}            = true/false"
echo -e "  ${CYAN}  HEADLESS${NC}                  = true/false"
echo -e "  ${CYAN}  ORGANIC_SEARCH${NC}            = true/false"
echo -e "  ${CYAN}  PROXY_URL${NC}                 = host proxy manual (opsional)"
echo ""
echo -e "  ${YELLOW}Contoh dengan .env:${NC}"
echo -e "  ${GREEN}  cat > .env << EOF"
echo -e "  DEFAULT_URL=https://contoh.com/"
echo -e "  MAX_SESSIONS=3"
echo -e "  SESSION_TIME=random"
echo -e "  USE_FREE_PROXIES=true"
echo -e "  HUMAN_BEHAVIOR=true"
echo -e "  EOF"
echo -e "  bash start.sh${NC}"
echo ""
