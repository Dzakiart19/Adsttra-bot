---
name: Chrome library & start.sh
description: How start.sh resolves Chrome binary and Nix library paths for dev and deployment containers
---

## Rule
`start.sh` harus inject Nix libs dari dua sumber sebelum run node:

1. **`REPLIT_LD_LIBRARY_PATH`** dari `.cache/replit/nix/env.json` — berisi 32 paths Nix yang dikelola Replit (systemd, xkbcommon, freetype, mesa, dll). Gunakan regex `"REPLIT_LD_LIBRARY_PATH":"([^"]+)"` (bukan `LD_LIBRARY_PATH`).

2. **`mesa-libgbm`** — di NixOS 25.05, `libgbm.so.1` TIDAK ada di `mesa` utama. Ada di derivation terpisah bernama `mesa-libgbm-*`. Cari via Python regex dari env.json (glob `/nix/store/*mesa-libgbm*` terlalu lambat — timeout). Pattern: `re.findall(r'/nix/store/[a-z0-9]+-mesa-libgbm[^":/\s]*', content)`.

## Chrome binary resolution
`start.sh` menemukan `chrome-headless-shell` via `find .puppeteer_cache -name chrome-headless-shell -type f`. Jika binary hilang:
1. Cek apakah folder ada tapi binary tidak ada → `rm -rf .puppeteer_cache/chrome-headless-shell` dulu (partial folder blokir re-download)
2. Baru `npx puppeteer browsers install chrome-headless-shell`

`PUPPETEER_EXECUTABLE_PATH` hanya di-set jika binary benar-benar ditemukan.

## Struktur env.json
File besar (>25k token) — jangan JSON parse penuh. Gunakan Python regex read-as-string untuk ekstrak nilai spesifik. Key yang relevan:
- `"REPLIT_LD_LIBRARY_PATH"` — bukan `"LD_LIBRARY_PATH"` (tidak ada di top level)
- Cari `mesa-libgbm` path dengan regex `/nix/store/[a-z0-9]+-mesa-libgbm[^":/\s]*`

## Perintah yang JANGAN dipakai (timeout)
- `find /nix/store -name "libgbm.so.1"` → timeout (terlalu dalam)
- `ls -d /nix/store/*-mesa-libgbm-*` → timeout (glob expand semua entry)
- `ls /nix/store | grep mesa` → timeout

## Deployment vs dev
- **Dev (workspace)**: env.json ada di `.cache/replit/nix/env.json`, `REPLIT_LD_LIBRARY_PATH` berisi semua paths kecuali `mesa-libgbm` (harus inject manual)
- **Production (deployed)**: sama, `start.sh` yang baru harus sudah di-deploy agar fix aktif — butuh redeploy setelah perubahan `start.sh`

**Why:** Nix store hash prefix berubah tiap update Nix. Path dinamis dari env.json selalu current. `mesa-libgbm` terpisah dari `mesa` sejak NixOS 24.x+.

**How to apply:** Tiap kali edit `start.sh`, pastikan kedua step (REPLIT_LD_LIBRARY_PATH + mesa-libgbm) ada. Jalankan keduanya di satu Python script untuk efisiensi.
