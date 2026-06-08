# STRUCTURAL — Move BOL & Damage Photos to Vercel Blob

**Date:** 2026-06-08
**Predecessors:** PR #1 (sync), PR #2 (poll-clobber), PR #3 (image compression — tactical stopgap, just merged as `75c0cc7`)
**Owner approval:** Sir greenlit Vercel Blob + the listed scope ("do your recs").
**Severity:** Architectural — not blocking, but the right shape for warehouse-ops file handling.

---

## Problem

After PR #3, image attachments get compressed to ~300 KB each on the client, then stored inline as base64 `data:` URLs in the `pos` array. That keeps the cumulative payload under Vercel's 4.5 MB body limit *most of the time*. Two structural problems remain:

1. Every 10s poll downloads the entire `pos` array — including every BOL and damage photo — to every connected device. With 18 POs and even modest attachments, that's hundreds of KB to a few MB per poll per device. Mobile data, polling cadence, and Vercel egress all suffer.
2. PDFs and edge cases (multiple POs with attachments, dense damage-photo grids) still trip the 4 MB cap.

PO 751 currently has a 3.4 MB inline BOL in cloud, demonstrating the cliff is real and already hit.

---

## Solution

Move attachments to Vercel Blob. Browser uploads directly to Blob via a signed token (bytes never touch our serverless function). The `pos` array stores only the short blob URL string. Polling payload drops back to kilobytes.

**Backward compatibility is hard-required:** PO 751's existing inline BOL (`{name, dataURL, url}` where `url === dataURL`) must keep rendering. The render path must accept both legacy `dataURL`-bearing shapes and new blob-URL shapes.

---

## Scope (one PR, branch `feat-vercel-blob-attachments-2026-06-08`)

### Change A: Add `@vercel/blob` dependency

`package.json` — add `"@vercel/blob": "^0.27.0"` (or latest compatible). Run `npm install` so `package-lock.json` updates. Commit both.

### Change B: New server route `api/blob-upload.js`

Standard Vercel Blob client-upload pattern. Pseudocode:

```js
import { handleUpload } from '@vercel/blob/client';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const body = req.body;
    const jsonResponse = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => ({
        allowedContentTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
        maximumSizeInBytes: 10 * 1024 * 1024, // 10 MB hard cap per file
        addRandomSuffix: true,
        // tokenPayload is optional; can be used for audit/owner tagging
      }),
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        // No-op for now. Could log or audit here.
      },
    });
    return res.status(200).json(jsonResponse);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}
```

Read the `@vercel/blob` docs to confirm exact API names if they've shifted. The `handleUpload` pattern is stable as of 2026.

### Change C: Client-side upload helpers in `Inbound_Truck_Tracker.html`

Add a helper that takes a `File` (already compressed if image, raw otherwise) and uploads via the Blob client SDK. Since this is a static HTML page (no bundler), use the SDK via ESM CDN OR write the fetch dance manually against the `handleUpload` protocol.

**Preferred:** import via ESM:

```html
<script type="module">
  import { upload } from 'https://esm.sh/@vercel/blob@0.27.0/client';
  window.__blobUpload = upload;
</script>
```

Then in the existing inline script, expose a wrapper:

```js
async function uploadAttachment(file) {
  if (!window.__blobUpload) throw new Error('Blob SDK not ready');
  const result = await window.__blobUpload(file.name, file, {
    access: 'public',
    handleUploadUrl: '/api/blob-upload',
  });
  return { name: file.name, url: result.url, blob: true, size: file.size, contentType: file.type };
}
```

If the ESM CDN approach feels fragile (it can be — supply-chain risk on a warehouse-ops page is real), the fallback is a small hand-rolled implementation of the two-step dance: POST `{ pathname }` to `/api/blob-upload`, receive `{ url, headers }`, PUT the file body directly to `url`. Either is acceptable; pick the one with lower failure surface and document the choice in the PR body.

### Change D: Rework `_bindBolEvents` and `_bindDmgEvents`

Both currently call the new `compressImage` (PR #3) for images, then store `{name, dataURL}` (or `{name, url, dataURL}` for BOL). New behavior:

1. **Image path:** compress (existing `compressImage`) → convert the resulting dataURL back to a Blob (small helper: `dataURLToBlob`) OR change `compressImage` to optionally return a Blob → upload via `uploadAttachment` → store the returned `{name, url, blob: true, ...}`.
2. **PDF path:** upload the original File directly via `uploadAttachment`. Drop the 1 MB PDF rejection from PR #3 (Blob accepts up to 10 MB per the route config).
3. **Failure path:** if upload fails, toast "Upload failed: <message>" and do NOT mutate `_bolFile` / `_dmgPhotos`. The save flow proceeds without the attachment.

### Change E: Render path accepts both shapes

The BOL preview at line ~622 references `_bolFile.url`. The damage photo grid at line ~970 references `_dmgPhotos[i].dataURL`. Update damage render to prefer `.url` then fall back to `.dataURL`:

```js
var src = _dmgPhotos[i].url || _dmgPhotos[i].dataURL;
```

Same shape in the lightbox at line ~1036.

For BOL, the preview already uses `.url`, which is correct for both legacy (where `url === dataURL`) and new (where `url` is the blob URL).

### Change F: Don't drop the `compressImage` from PR #3

Keep compressing images before upload. Reasons:
- Mobile bandwidth on upload (a 4 MB phone photo at q0.75 → 300 KB; one less megabyte on the warehouse Wi-Fi).
- Storage cost (~$0.023/GB-month on Vercel Blob — compression saves real money over a year).
- Damage photos render in a small grid; 1600px is more than enough.

Skip compression for PDFs (no useful client-side compression) and for very small images (no point compressing under 500 KB).

### Change G: Polling payload is now small — no other change needed

Once attachments live as URLs instead of base64, the `pos` array shrinks dramatically. Existing polling logic (10s interval, JSON.stringify compare) keeps working. No tuning needed.

### Change H: Update `store.setJSON` size guard

PR #3 added a "4 MB cloud payload too large" guard. With Blob in place, this should rarely fire. Lower the threshold to 1 MB and reword the toast: "Cloud payload unusually large (X MB). Old attachments may need migration." This gives Sir/Kristian an early signal if a legacy inline BOL is still bloating things, without breaking small payloads.

---

## Out of Scope (Do NOT do in this PR)

- Migrating PO 751's existing 3.4 MB inline BOL to Blob. Leave it. It renders correctly via the backward-compat render path. Kristian can manually remove and re-upload if he wants the polling payload smaller. A separate migration script can come later if Sir wants.
- Signed-URL access controls (`access: 'public'` is fine for warehouse-ops; URLs are unguessable random suffixes).
- Image lightbox lazy-load, virtualization, or any UX polish beyond what's needed for the render path to work.
- Server-side virus scanning, file-type whitelisting beyond what `handleUpload` does.
- A separate Vercel Blob audit log.

---

## Hard Constraints

1. Files modified: `Inbound_Truck_Tracker.html`, `package.json`, `package-lock.json`. New file: `api/blob-upload.js`.
2. Zero changes to `api/data.js`.
3. Branch: `feat-vercel-blob-attachments-2026-06-08`. Base `main` (currently `75c0cc7`).
4. **Architectural change — do NOT auto-merge.** Open PR Ready, Vision will review the diff personally before merging.
5. Backward compatibility for legacy attachment shapes is hard-required. PO 751's BOL must render unchanged.

---

## Owner Action Required (Sir to do once, in parallel)

The agent cannot do this; flag it in the PR body for Sir:

1. Open Vercel dashboard for project `neato-inbound-truck-tracker`.
2. Storage → Create new Blob store → name it whatever (`neato-inbound-truck-tracker-attachments` is fine).
3. Connect it to the project. Vercel auto-injects `BLOB_READ_WRITE_TOKEN` into the project's environment variables.
4. Confirm the env var shows up under Settings → Environment Variables (Production, Preview, Development).
5. After the PR is merged and Production redeploys, the route comes alive.

If Sir does not do this before the PR deploys, the route will return 500 ("BLOB_READ_WRITE_TOKEN is not defined") and uploads will fail. The legacy inline path will already be removed by then, so Kristian sees failed uploads, not a fallback. **Coordinate timing:** do not merge until Sir confirms the token is set in Production.

---

## Verification

1. `node --check` on extracted inline JS — clean.
2. `npm install` — `package-lock.json` updates cleanly, no peer-dep warnings beyond what's already there.
3. Local smoke: open `Inbound_Truck_Tracker.html` directly — page renders, no console errors *except* the expected ESM CDN load (or no error if hand-rolled). The page should remain usable; upload attempts will fail without the API route, but render and existing PO 751 BOL display should work.
4. Vercel preview check goes green.
5. On the Vercel preview, manual test (mark as needs-Sir-or-Kristian if you can't do it from the build agent):
   - Attach a phone photo as damage photo → toast "Photo uploaded" → save → reload → photo renders.
   - Attach a 5 MB PDF as BOL → uploads → save → reload → link renders.
   - Open PO 751 (legacy inline BOL) → BOL link still renders and downloads correctly.
6. Cloud `/api/data?key=pos` payload size after a few attachments: under 500 KB (was 3.4 MB).

---

## Definition of Done

1. All eight code changes applied. New file `api/blob-upload.js` exists.
2. `package.json` and `package-lock.json` reflect the new dependency.
3. PR opened Ready against `main`, branch `feat-vercel-blob-attachments-2026-06-08`.
4. PR body includes: scope, the Sir-action checklist (enable Blob in dashboard), verification matrix, deviation list, and a clear "DO NOT MERGE UNTIL SIR CONFIRMS BLOB_READ_WRITE_TOKEN IS SET" banner.
5. Vercel preview deploy succeeds.
6. **Do NOT auto-merge.** Exit cleanly with the PR open for Vision/Sir review.

The on-complete handler will ping Sir with the PR URL and the Blob-enable checklist; Vision reviews the diff and coordinates with Sir on merge timing.
