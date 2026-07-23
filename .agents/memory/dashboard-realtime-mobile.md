---
name: Dashboard real-time action text & mobile design
description: BehaviorService now emits StateService updates for every action; DashboardServer redesigned for mobile-first responsiveness.
---

## Rules

### BehaviorService → StateService real-time
`BehaviorService.simulateRandomAction()` calls `StateService.update({ action: '...' })` before each action:
- Scroll: `📜 Scroll ↓/↑ Xpx`
- Mouse move: `🖱️ Gerakkan mouse ke (X, Y)`
- Reading pause: `📖 Membaca konten halaman... (Xs)`
- Micro-wait: `⏸ Jeda sejenak... (Xms)`

**Why:** Previously the dashboard showed a static "Step N/M: browsing..." during the entire dwell time. Users couldn't see what the bot was actually doing. Now every sub-action surfaces immediately via SSE.

**How to apply:** BehaviorService imports StateService directly (same infrastructure layer — no circular dep). Keep this pattern for any new behavior actions added in future.

### TrafficOrchestrator granular action text
Every phase has a distinct emoji-prefixed message:
- `🚀` browser launch, `🌐` navigate, `✅` page loaded
- `⏳` waiting for ad script, `📺 Ad warm-up ↓ step X/N`, `📺 Ad warm-up ↑ step X/Y`
- `🚫` proxy blocked, `🔗` referrer set, `🔍` SERP search, `⌨️` typing keyword

**Why:** Without per-step messages, users saw a frozen action text during the 10–20s ad warm-up sweep (N steps × ~900ms each). Now each scroll step broadcasts its own state.

### Dashboard mobile CSS
Layout: CSS Grid with `grid-template-columns: repeat(3, 1fr)` on mobile, `repeat(auto-fit, minmax(130px, 1fr))` on desktop (≥600px breakpoint).
Action box: `background: var(--surf2)`, bold text `color: #e0f7fa`, `font-size: 12px` mobile / `13px` desktop.
Log height: 220px mobile / 320px desktop.

**Why:** Original dashboard had no responsive CSS — rendered as desktop layout on phones (small text, horizontal overflow).

**How to apply:** Always test dashboard at ~375px width when making changes. The `@media(min-width:600px)` block overrides font sizes and padding for desktop.
