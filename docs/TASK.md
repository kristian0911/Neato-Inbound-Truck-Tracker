# BUILD TASK — Inbound Truck Tracker Sync Fixes

**For:** Claude Code build agent dispatched by Vision
**Delegation from:** Jarvis (task t-mq5nnf920002)
**Date:** 2026-06-08
**Branch:** `sync-fixes` (already checked out, off `main` of `kristian0911/Neato-Inbound-Truck-Tracker`)
**Worktree:** `/tmp/truck-tracker-sync-fixes`

---

## Your Job

Read `docs/SPEC_SYNC_FIXES_2026-06-08.md` in this repo. That is the authoritative spec from Jarvis. Implement all three changes (D4 boot-race fix, D2(b) polling, D5 sync indicator) in **one PR** against `main`.

Then open a Draft PR, run the verification checklist, flip to Ready when DoD passes, and exit.

---

## Hard Constraints (Locked — Do NOT Re-Litigate)

1. **Only `Inbound_Truck_Tracker.html` may be modified for code changes.** Zero changes to `api/data.js`, `vercel.json`, `package.json`.
2. Poll interval is **exactly 10 seconds**. Not 5, not 15.
3. Poll **`pos` only**, not `archive`.
4. **Pause polling while modal open** (detect via `#overlay` display state). **Pause while tab hidden** (visibilitychange). **Fire one immediate poll on visible**.
5. **One single `render()` call** at the end of the boot IIFE. No double-render.
6. **Replace the silent `.catch(function(){})` on line ~273.** Do not leave silent failure handlers anywhere in the cloud-op path.
7. Persist `lastSyncAt` ISO timestamp to localStorage on every successful cloud op.
8. Sync indicator pill goes in the header **next to `#clk`** (the wall clock). Design latitude on exact styling, but anchor to the existing visual language.
9. **Open a Draft PR first.** Flip to Ready only after the verification checklist passes.
10. **Do NOT merge.** Sir reviews the Vercel preview and merges.

---

## Concrete File Locations (verify, do not assume)

- Boot IIFE: spec says lines 1101-1114. File is 1118 lines total. Grep for `DEFAULT_POS` and the boot IIFE wrapper to confirm before editing.
- Silent catch: spec says line ~273. Grep for `.catch(function(){})` and `.catch(()=>{})`.
- Modal overlay: spec says `#overlay`. Grep to confirm the element exists and what controls its `display`.
- Wall clock element: `#clk`. Grep to confirm.

If the line numbers drift from the spec, trust the grep and the surrounding code, not the spec's line numbers. The spec was written against current `main` but small drift is expected.

---

## Stop Conditions — Ping and Pause (do NOT silently re-scope)

Drop a query file at `/Users/jarvis/neato-hive/shared/exchange/vision-jarvis-truck-tracker-<slug>-query-20260608.md` and exit if you hit any of:

1. **The boot IIFE structure on `main` is materially different from the spec's description** (e.g., it already awaits `loadCloud`, or `DEFAULT_POS` is no longer written from boot). The fix's premise is wrong; surface it.
2. **There is no `#overlay` element, or modal open/close is controlled differently** (e.g., a class toggle rather than display state, or a different element ID). Need clarification on detection method.
3. **`loadCloud` / `saveCloud` helper functions don't exist by those names** or have a different signature than implied (the spec references `store.loadCloud("pos", null)`). Need clarification on the actual store API.
4. **The silent `.catch` on ~line 273 doesn't exist or wraps something other than a cloud POST.** Need clarification on which catches to replace.

For all other ambiguities — design of the sync pill, exact color tokens, where to declare the pill markup in the header, how to express the green-pulse animation — exercise judgment. Vision-style: anchor to existing visual language, prefer the small calm choice.

---

## Verification Checklist (must run before flipping Ready)

Per spec §Verification:

1. HTML page loads. Open the file directly in a browser (`open Inbound_Truck_Tracker.html`) or via `vercel dev` if available; render path still works.
2. (Boot order, Change 1) Network tab in incognito on Vercel preview shows GET `/api/data?key=pos` resolve BEFORE any POST `/api/data` fires. If cloud already had data, no POST of `DEFAULT_POS` should appear.
3. (Polling, Change 2) Desktop-to-mobile (or two browser windows on Vercel preview) propagation under 15 seconds with modal closed.
4. (Modal-protect, Change 2) Mid-edit form does NOT get clobbered by a polled update.
5. (Visibility pause, Change 2) No network traffic while tab hidden. One poll fires immediately on visible.
6. (Indicator green-path, Change 3) Healthy edit pulses green.
7. (Indicator red-path, Change 3) Simulated failure (mock fetch reject in DevTools) flips to red with tooltip showing last sync time.
8. (No regression) CSV import/export, archive view, edit modal, BOL upload, damage photos, filter views all still work.

For items 2-7 that need a live Vercel preview, the preview deploys automatically on push to `sync-fixes`. Wait for the preview URL, then test there.

If you cannot run all 8 (e.g., no mobile device available, can't easily mock fetch), capture what you can, document the gaps in the PR description, and leave Draft for Vision/Jarvis to call.

---

## PR Description Requirements

- Scope: which audit IDs landed (D4, D2(b), D5).
- Verification results: each of the 8 items above as pass / fail / skipped-with-reason.
- Screenshots or short clip of the sync indicator in each state if you can capture them.
- Any deviation from the spec, with rationale, in a numbered list (the Vision-standard "spec said X; shipped Y because Z" format).
- Link the spec file: `docs/SPEC_SYNC_FIXES_2026-06-08.md`.

---

## Definition of Done (DoD)

1. Three changes implemented in `Inbound_Truck_Tracker.html`. Zero changes to other source files.
2. Single `render()` at end of boot IIFE.
3. Polling has all four guards (10s interval, modal pause, visibility pause, immediate-on-visible).
4. Silent `.catch` is gone. Indicator surfaces failures.
5. `lastSyncAt` persisted on every successful cloud op.
6. Sync pill renders in header next to `#clk`, visible on mobile.
7. PR opened as Draft against `main`, branch `sync-fixes`.
8. PR description has scope, verification matrix, deviations.
9. Local smoke test: opening the file in a browser still renders the page (no JS console errors on boot).
10. Verification matrix is filled in. Items requiring live preview are tested against the Vercel preview URL.
11. Flipped to Ready if 10/10 pass, or left Draft with a clear note if any fail or are blocked.
12. Exit cleanly. Do NOT merge.

---

## How To Push & Open PR

```bash
cd /tmp/truck-tracker-sync-fixes
git add -A
git commit -m "<atomic message per change>"
# After all commits:
git push -u origin sync-fixes
gh pr create --base main --head sync-fixes --draft \
  --title "Sync fixes: boot-race, polling, indicator (D4/D2(b)/D5)" \
  --body "$(cat <<'EOF'
<your PR body here per the spec>
EOF
)"
```

Atomic commits per change preferred (one for boot-race, one for polling, one for indicator, plus any prep refactor commits). Squash will happen at merge time.

---

## When You're Done

Exit with `claude` exiting normally. Vision's on-complete handler picks up from there: verifies PR Ready, posts to Sir, and closes Jarvis's delegation.
