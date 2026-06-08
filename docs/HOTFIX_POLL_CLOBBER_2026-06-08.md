# HOTFIX — Polling Clobbers In-Flight Writes

**Date:** 2026-06-08
**Severity:** Production-blocking (status changes don't persist)
**Owner reported:** "I tried to update PO 771 to complete and it keeps flipping it back to in transit. I tried it on the phone and on the desktop."

---

## Root Cause

`store.setJSON(k, o)` in `Inbound_Truck_Tracker.html` line 349-354:

```js
setJSON:function(k,o){
  try{localStorage.setItem(k,JSON.stringify(o));}catch(e){}
  fetch('/api/data',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:k,value:o})})
    .then(function(r){if(!r.ok)throw new Error("HTTP "+r.status);sync.markSynced();})
    .catch(function(err){sync.markStale(err);});
},
```

The POST is fired but never awaited. Caller (e.g. `savePO`) returns immediately, modal closes, polling resumes.

Polling (line 1242-1264) ticks on a 10s interval. If a tick fires inside the POST's ~200-500ms in-flight window:
1. `pollOnce` fetches `/api/data?key=pos`.
2. Redis still has the OLD value because POST hasn't landed yet.
3. `JSON.stringify(cloudPos) !== JSON.stringify(pos)` is true (cloud is old, local is new).
4. Line 1255: `pos=cloudPos;` — local is clobbered with stale cloud value.
5. `render()` — UI flips back to old status.

Verified against production Redis: PO 771 stored as `status: "transit"` even though Sir clicked "Complete" multiple times across two devices.

---

## Fix

Two coordinated changes:

### Change A: Make `store.setJSON` track in-flight writes and signal completion

Add module-scope state:

```js
var pendingWrites = 0;                    // count of in-flight POSTs
var lastWriteAt = 0;                      // monotonic timestamp of most recent successful POST
var WRITE_GRACE_MS = 15000;               // poll-suppress window after a local write
```

Rewrite `store.setJSON`:

```js
setJSON:function(k,o){
  try{localStorage.setItem(k,JSON.stringify(o));}catch(e){}
  pendingWrites++;
  return fetch('/api/data',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:k,value:o})})
    .then(function(r){
      if(!r.ok)throw new Error("HTTP "+r.status);
      lastWriteAt = Date.now();
      sync.markSynced();
    })
    .catch(function(err){sync.markStale(err);})
    .finally(function(){pendingWrites = Math.max(0, pendingWrites - 1);});
},
```

Notes:
- `pendingWrites` increments on every fire, decrements on settle (success or failure).
- `lastWriteAt` only updates on success.
- The function now returns the promise so future callers CAN await it if they want. Existing callers don't need to change — fire-and-forget still works.

### Change B: Make `pollOnce` respect in-flight writes and the grace window

Update the guard at the top of `pollOnce`:

```js
async function pollOnce(){
  if(pollPaused())return;
  if(pollInFlight)return;
  if(pendingWrites > 0)return;                                  // write in flight — let it land
  if(Date.now() - lastWriteAt < WRITE_GRACE_MS)return;          // post-write grace — local is authoritative
  pollInFlight=true;
  try{
    // ... existing fetch + compare unchanged ...
  }
  // ...
}
```

The grace window means: for 15 seconds after any successful local write, the poll skips overwrites. This covers:
- POST-still-in-flight case (the original race).
- POST landed but Redis read-after-write replication lag (Upstash usually sub-second, but harmless to guard).
- User making multiple rapid edits — each one resets the grace.

### Change C: (Optional safety) Pause polling while editing status chips

If Sir's pattern is "open modal, tap status chip, then linger before tapping save," there's a separate concern: while the modal is open, polling is paused (correct). When Sir saves, modal closes BEFORE the POST resolves. The grace window in Change B covers this, but a belt-and-suspenders is to also clear `pollInFlight=false` defensively at modal-close — currently it's set/unset only inside `pollOnce`. Don't add this unless you see evidence the flag is sticking.

---

## Out of Scope (Do NOT touch)

- `api/data.js` — server contract is fine. The bug is entirely client-side.
- The boot-race fix (D4) from PR #1 — already correct.
- The sync indicator (D5) — already correct.
- The modal-open / visibility-hidden poll pauses — already correct.
- All other sync logic, render path, vendor list, status flow, archive logic, CSV import/export.

---

## Hard Constraints

1. **One file modified:** `Inbound_Truck_Tracker.html` only.
2. **One PR, two commits:** (a) module-scope state + `store.setJSON` rewrite, (b) `pollOnce` guard additions.
3. **PR opens against `main` of `kristian0911/Neato-Inbound-Truck-Tracker`.**
4. **Auto-merge per Sir's standing rule once Vercel preview is green.** This is a sync-layer hotfix; same risk profile as the original PR Sir already greenlit a merge on. Not destructive, not auth, not architectural.
5. **Branch name:** `hotfix-poll-clobber-2026-06-08`.

---

## Verification

1. `node --check` on extracted inline JS — clean.
2. Grep confirms: `pendingWrites` and `lastWriteAt` referenced in both `store.setJSON` and `pollOnce` guards.
3. Local smoke: open the file in a browser, page renders, no console errors.
4. PR description includes a manual repro script for Sir:

```
A. Open the production URL on desktop.
B. Tap PO 771 → tap "Complete" chip → tap Save.
C. Wait 30 seconds. Status should stay "Complete." Reload the page. Status should still be "Complete."
D. Repeat on mobile. Same outcome.
```

5. Cloud check after Sir's verify: `curl -s 'https://neato-inbound-truck-tracker.vercel.app/api/data?key=pos' | jq '.value[] | select(.po=="771") | .status'` should return `"complete"`.

---

## Definition of Done

1. Both code changes applied to `Inbound_Truck_Tracker.html`.
2. PR opened against `main`, branch `hotfix-poll-clobber-2026-06-08`.
3. PR description names the root cause (one paragraph), the fix (the two changes), and the manual repro script.
4. Local smoke + node --check pass.
5. Vercel preview check passes (auto-deploys on push).
6. PR opened as Ready (not Draft) — this is a Sir-flagged production blocker, no separate review gate.
7. **Auto-merge** with `gh pr merge <n> --squash --delete-branch` once the Vercel preview check goes green.
8. After merge, confirm production deploy finishes and verify `markSynced`, `markStale`, `POLL_MS`, `pendingWrites`, `lastWriteAt`, `WRITE_GRACE_MS` are all present in the live HTML at `https://neato-inbound-truck-tracker.vercel.app/Inbound_Truck_Tracker.html`.
9. Exit cleanly.

---

## How to Push, Open PR, Merge

```bash
cd /tmp/truck-tracker-poll-clobber
git checkout -b hotfix-poll-clobber-2026-06-08
# ... edits to Inbound_Truck_Tracker.html ...
git add Inbound_Truck_Tracker.html
git commit -m "Track in-flight cloud writes in store.setJSON"
# ... second edit to pollOnce ...
git add Inbound_Truck_Tracker.html
git commit -m "Suppress poll overwrites during write grace window"
git add docs/HOTFIX_POLL_CLOBBER_2026-06-08.md  # this file
git commit -m "Add hotfix design doc"
git push -u origin hotfix-poll-clobber-2026-06-08
gh pr create --base main --head hotfix-poll-clobber-2026-06-08 \
  --title "Hotfix: stop poll from clobbering in-flight writes" \
  --body "$(cat <<'EOF'
... PR body per requirements above ...
EOF
)"
# Wait for Vercel check to go green, then:
gh pr merge <n> --squash --delete-branch
```
