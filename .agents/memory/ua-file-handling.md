---
name: UA file handling
description: UserAgentService loadEntries() must handle empty or invalid JSON UA files without throwing
---

Only `useragent/most-common.json` contains real data. Other files (safari, opera, firefox, edge, etc.) are empty (0 bytes).

**Rule:** Wrap JSON.parse in try/catch in `loadEntries()`; return `[]` on empty or parse error. Already cached after first load.

**Why:** FingerprintService always calls `getRandomUA('most-common')` so the bug is latent, but any future call with another type would crash.

**How to apply:** Any new UA file type added must either be populated or the graceful fallback handles it automatically.
