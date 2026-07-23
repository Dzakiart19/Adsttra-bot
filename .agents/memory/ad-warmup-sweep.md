---
name: Ad warm-up full-page sweep
description: Why ad warm-up must scroll the entire page in viewport chunks, not a fixed pixel amount — critical for multi-ad-unit pages using IntersectionObserver
---

## Rule
Ad warm-up in TrafficOrchestrator must scroll the **entire page height** in chunks of ~60% viewport height, pausing 700–1100ms at each step, then sweep back up partially.

**Why:**
Adsterra (and most modern ad networks) use `IntersectionObserver` to detect when an ad element enters the viewport for the first time. An impression XHR is only fired at that moment. A fixed-pixel scroll (e.g. 550px net) only covers 1–2 ads near the top. A page with 10 ad units distributed across the full height requires the bot to pass each unit through the viewport individually.

**How to apply:**
1. Call `engine.evaluate()` to read `document.body.scrollHeight` and `window.innerHeight`.
2. Set `chunkSize = Math.floor(viewportHeight * 0.6)`.
3. Loop `Math.ceil(scrollHeight / chunkSize)` times: `engine.scroll(0, chunkSize)` + `engine.wait(700–1100ms)`.
4. Hold at bottom for 1.5s (bottom ads need extra time).
5. Sweep back up ~60% of steps at 500–800ms per step.
6. `engine.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }))`.

**Target context:** `simpanin.web.app` — single page, 10 Adsterra ad units, Firebase Hosting (no proxy blocking). SESSION_TIME=30s.
