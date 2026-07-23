---
name: Drama card modal flow
description: Cara navigasi bot ke watch.html via modal di site dramacina--dzeckart.replit.app
---

## Rule
Navigasi ke watch.html harus melalui alur modal, bukan mencari `a[href*="watch.html"]`.

## Detail
- Drama cards adalah `div.drama-card` (bukan `<a>`), klik → `openModal()` dipanggil
- Modal fetch `/api/drama/{provider}/{id}` → tampilkan `#watchNowBtn`
- Klik `#watchNowBtn` → `window.location.href = /watch.html?...`
- Tidak ada anchor `href*="watch.html"` di homepage (SPA, semua via JS)

## Critical bugs ditemukan & fixed
1. **scrollIntoView harus pakai `{inline: 'center'}`** — tanpa ini, card di kolom kanan halaman punya x > viewport width, klik tidak register pada element manapun
2. **Modal wait 4s** (bukan 2.5s) — API fetch drama detail via proxy bisa sampai 3-4s
3. **Filter bounds horizontal** — setelah scrollIntoView, validasi `rect.left >= 0 && rect.right <= window.innerWidth`

## Mengapa real DOM click (page.mouse.click) wajib
- `ads-adsterra.js` pasang: `document.addEventListener("click", openOnce, true)` — capture phase
- Direct Link HANYA fire saat `event.isTrusted = true` (real mouse click)
- `element.click()` via evaluate = untrusted → Direct Link tidak fire
- 2 Direct Link per sesi: klik drama card + klik watchNowBtn

**Why:** Site dramacina adalah SPA; HTML statis tidak punya drama card links; bot harus ikuti alur UI seperti user nyata.

**How to apply:** Setiap perubahan selector drama card atau navigasi watch page harus fetch `/js/home.js` site target dulu untuk verifikasi struktur DOM terkini.
