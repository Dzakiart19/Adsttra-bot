---
name: Chrome library & start.sh
description: How start.sh resolves Chrome binary and Nix library paths for dev and deployment containers
---

## Rule
`start.sh` harus inject Nix libs dari dua sumber sebelum run node:

1. **`.nix_env` file** (prioritas utama) — di-generate saat build via Python script di `.replit` build command. Format: `REPLIT_LD_LIBRARY_PATH|/nix/store/.../mesa-libgbm-*/lib`. File ini harus ADA di project (tidak di `.gitignore`) agar tersedia saat deployment startup.

2. **`REPLIT_LD_LIBRARY_PATH`** dari `.cache/replit/nix/env.json` — fallback jika `.nix_env` tidak ada. Gunakan regex `"REPLIT_LD_LIBRARY_PATH":"([^"]+)"` (bukan `LD_LIBRARY_PATH`).

3. **`mesa-libgbm`** — di NixOS 25.05, `libgbm.so.1` TIDAK ada di `mesa` utama. Ada di derivation terpisah bernama `mesa-libgbm-*`. Cari via Python regex dari env.json. Pattern: `re.findall(r'/nix/store/[a-z0-9]+-mesa-libgbm[^":/\s]*', content)`.

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
- **Production (deployed)**: `.nix_env` file di-bake saat build — ini cara paling andal. Build command di `.replit` menjalankan Python script yang save LD+GBM path ke `.nix_env`. Start.sh baca file ini pertama.

**Why:** Nix store hash prefix berubah tiap update Nix. Path dinamis dari env.json/build selalu current. `mesa-libgbm` terpisah dari `mesa` sejak NixOS 24.x+. `.nix_env` harus ada di repo (tidak di gitignore) agar tersedia saat container startup sebelum build command jalan.

**How to apply:** Tiap kali edit `start.sh`, pastikan: (1) baca `.nix_env` dulu, (2) fallback ke env.json, (3) inject GBM+LD ke `LD_LIBRARY_PATH`. Jangan pakai `find /nix/store` (timeout).
