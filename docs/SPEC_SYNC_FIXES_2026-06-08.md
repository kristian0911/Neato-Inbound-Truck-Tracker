# Inbound Truck Tracker: Sync Fixes Spec (D2/D4/D5)

**From:** JARVIS
**To:** Vision
**Date:** 2026-06-08
**Source audit:** `shared/exchange/jarvis-sir-truck-tracker-sync-audit-20260608.md`

---

## Repo & Branch

- **Repo:** `kristian0911/Neato-Inbound-Truck-Tracker`
- **Vercel project:** `neato-inbound-truck-tracker` (auto-deploys preview on push)
- **Branch:** `sync-fixes` (off `main`)
- **PR target:** `main`. Open the PR. Do NOT merge. Sir reviews the Vercel preview, then merges.

If you do not already have push access, ping Sir before starting. He'll handle access.

---

## Scope

Three changes to `Inbound_Truck_Tracker.html`. Zero changes to `api/data.js`. Zero changes to `vercel.json` or `package.json`.

All three changes ship in one PR.

### Change 1: Boot-race fix (D4)

**File:** `Inbound_Truck_Tracker.html`, current boot IIFE at lines 1101-1114.

**Current behavior (broken):**
```js
// Schema-version check fires localStorage writes that POST to cloud.
// Then DEFAULT_POS POSTs to cloud.
// Then we await the cloud GET. By the time it lands, we have already
// clobbered cloud state with defaults on a fresh device.
```

**Required behavior:**
1. Read `posVer` from localStorage only. Do not write yet.
2. `await store.loadCloud("pos", null)` FIRST.
3. If cloud returned a non-null, non-empty array: that becomes `pos`, write it to localStorage, render.
4. If cloud returned null or empty: fall back in priority order: (a) localStorage `pos` if non-empty, (b) `DEFAULT_POS`. Whatever you fall back to, write it to cloud AND localStorage.
5. Same pattern for `archive`.
6. Schema-version check happens AFTER the cloud read settles. If `posVer` drift is detected, log to console and proceed; do not auto-clear cloud state on a version bump in this PR (that is a separate change).
7. Single `render()` call at the end of the IIFE. No double-render.

**Acceptance:** open the preview in an incognito window with a fresh localStorage. Network tab should show GET `/api/data?key=pos` resolve BEFORE any POST `/api/data` fires. If cloud already had data, no POST of `DEFAULT_POS` should appear.

### Change 2: Polling (D2(b))

**Add a polling layer that keeps the active tab in sync without user action.**

Requirements:
1. Poll interval: **10 seconds**.
2. Poll target: `GET /api/data?key=pos`. (Skip polling `archive` in this PR. Archive does not need to be live.)
3. On poll response: if `JSON.stringify(cloudValue) !== JSON.stringify(currentPos)`, replace `pos`, write to localStorage, re-render.
4. **Pause polling while the edit modal is open.** Detect via the existing `#overlay` element's display state. Do NOT clobber the form mid-edit. Resume polling when the modal closes.
5. **Pause polling when the tab is hidden.** Use `document.addEventListener("visibilitychange", ...)`. Resume on visible.
6. **On visibility-becomes-visible, fire one immediate poll** before resuming the interval. User tabbing back to a stale view should see fresh data within ~2 seconds, not wait up to 10.
7. Polling failures (network error, non-200 response, JSON parse error) must NOT crash the page and must NOT spam the console on each tick. Surface via the sync indicator (Change 3); log once per state-transition to console.

**Acceptance:**
- Open the preview on desktop. Open the same URL on mobile or a second browser. Make an edit on desktop. Mobile reflects the change within ~12 seconds without manual refresh, modal closed.
- Open the edit modal on mobile. Make an edit on desktop. Mobile does NOT clobber the open form. Close the modal on mobile. Within ~12 seconds, the change appears.
- Network tab confirms polling pauses (no `/api/data` GET) while the tab is hidden.

### Change 3: Sync indicator (D5)

**A small status pill in the header, next to the wall clock (`#clk`), surfacing sync state.**

States and visuals (Vision, you have design latitude here, anchor to the existing visual language):
1. **Synced** (green): default state when last cloud op succeeded recently. Brief flash to a brighter "synced" pulse on each successful POST or fresh poll, then settle back to a calm green dot.
2. **Syncing** (amber): an in-flight POST. Acceptable to skip this state if it adds noise; not required.
3. **Stale** (red): the last cloud op failed (POST or GET). Hover/tap tooltip: "Last synced at HH:MM:SS." If we have never synced this session, tooltip reads "Working offline."

Implementation requirements:
1. Replace the silent `.catch(function(){})` on line 273 with a handler that flips the indicator to "Stale" and `console.warn`s the error.
2. Add a similar handler around the `loadCloud` call and the polling fetch.
3. Persist `lastSyncAt` (ISO timestamp) to localStorage under key `lastSyncAt` on every successful cloud op (POST or GET with a non-error response).
4. On boot, read `lastSyncAt` from localStorage. If the first cloud read fails, show "Stale" with the persisted timestamp in the tooltip.
5. The indicator must be visible on mobile (current header already responsive; mirror the pattern).

**Acceptance:**
- Make an edit with Redis healthy: indicator briefly pulses green.
- Force a failure (Vision: easiest reproduction is to point `REDIS_URL` at an invalid host on a Vercel preview deploy, OR mock the fetch to reject). Indicator flips red with the last-sync time in tooltip.
- Restore connectivity: next successful poll or POST returns the indicator to green.

---

## Out of Scope (Do NOT Build in This PR)

- **D3 per-PO patching.** Server stays last-write-wins on the whole array. Sir will revisit if multi-operator editing becomes a real workflow.
- **D6 auth.** Not addressed in this PR.
- **The "PO 750 Archives in NaNd" display bug.** Cosmetic, unrelated, separate ticket.
- **Photo / BOL size limits.** Separate audit pending.
- **Any change to `api/data.js`.** Server contract is frozen for this PR.
- **Any change to vendor list, CSV columns, status flow, or visual layout** other than the sync pill in the header.

---

## Decisions Already Locked

| ID | Decision | Source |
|---|---|---|
| Poll interval | 10 seconds | JARVIS, with bias toward warehouse-ops responsiveness over Redis load. Sir locked the bundle without overriding. |
| Polling key | `pos` only, not `archive` | JARVIS; archive does not need to be live. |
| Modal-open behavior | Pause polling | JARVIS; mid-edit clobber is the worst UX failure mode. |
| Hidden-tab behavior | Pause polling, immediate poll on visible | Standard practice; saves Redis quota. |
| Sync indicator placement | Header, next to `#clk` | JARVIS; you have design latitude on exact pixels and pill style. |
| Server contract | Unchanged in this PR | JARVIS; D3 is the separate decision and is deferred. |

If you hit anything that genuinely contradicts the audit and these decisions, **EscalateToOwner** to Sir. Do not silently re-scope.

---

## Verification (Before You Mark Ready)

Run all of these. Report each as pass/fail in the PR description.

1. Local lint / smoke: the HTML page loads, the existing render path still works (open the file directly or via `vercel dev`).
2. Boot order (Change 1): network tab in incognito shows GET before any POST.
3. Polling latency (Change 2): desktop-to-mobile propagation under 15 seconds, modal closed.
4. Modal-protect (Change 2): mid-edit form does NOT get clobbered by a polled update.
5. Visibility pause (Change 2): no network traffic while tab hidden; one poll fires immediately on visible.
6. Indicator green-path (Change 3): healthy edit pulses green.
7. Indicator red-path (Change 3): simulated failure flips to red with tooltip showing last sync time.
8. No regression on CSV import/export, archive, edit modal, BOL upload, damage photos, or filter views.

---

## Deliverable

- PR URL against `kristian0911/Neato-Inbound-Truck-Tracker` `main`. Draft if you want me to review before flipping to Ready.
- Brief PR description with: scope (which audit IDs landed), verification results, screenshots or short clip of the sync indicator in each state, and any deviation from this spec with rationale.
- Hand back to me when Ready. I will review against the spec and tell Sir to merge.

Sir is verifying D1 (REDIS_URL on Vercel Production) in parallel. If he reports F1 is the active bug, your D5 indicator becomes the primary diagnostic for confirming the fix. If he reports F2 is the active bug, your D2(b) polling is the primary fix.

Either way, all three changes ship in one PR. Go.
