---
name: Chrome launch error detection vs proxy error
description: Bug pattern — semua error di proxy retry loop diperlakukan sebagai proxy error, termasuk Chrome crash
---

## Rule
Di `main.ts` local sequential loop, catch block HARUS membedakan dua jenis error:

1. **Chrome launch error** — bukan masalah proxy. Retry dengan proxy berbeda tidak akan membantu.
   - Pattern: `"Failed to launch the browser process"`, `"Failed to launch browser"`, `/Code:\s*12[0-9]/` (exit 127 = lib missing, 126 = permission)
   - Aksi: `break` dari proxy retry loop + circuit breaker delay

2. **Proxy error** — ganti proxy berikutnya dan lanjut.
   - Pattern: ERR_TIMED_OUT, ERR_PROXY, ERR_CONNECTION, ERR_TUNNEL, net::ERR, ProtocolError, Target closed, Session closed
   - Aksi: increment proxyRetries, lanjut ke attempt berikutnya

## Circuit Breaker
Jika Chrome gagal launch berulang kali (consecutiveChromeFails >= 3), bot harus pause 60 detik sebelum retry. Reset saat sesi sukses.
Tanpa circuit breaker, Chrome crash + LOOP_FOREVER + no cooldown = spam loop (Round #40+ dalam 8 menit).

**Why:** Error "Failed to launch the browser process: Code: 127" = `libgbm.so.1` missing. Semua 5 proxy retry akan fail dengan error yang sama. Tanpa deteksi, bot cycle 5x setiap sesi × MAX_SESSIONS × round tanpa henti = ribuan request error dalam menit.

**How to apply:** Lihat fungsi `isChromeLaunchError()` di `main.ts`. Pastikan ada di SEMUA catch block yang handle session errors (termasuk worker mode di `runWorker()`).
