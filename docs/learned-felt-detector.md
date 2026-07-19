# Learned felt detector — plan

Layer a **learned felt-segmentation** stage into the existing web-repo CV
pipeline, replacing only the fragile HSV colour threshold while keeping the
strong sub-pixel rail-line fit and PnP pose intact.

## Why this shape (not corner regression)

The current pipeline is a detector chain feeding one PnP solver:

```
detectQuadCv(image) → 4 corners [TL,TR,BR,BL] ┐
   ↓ null?                                     ├→ solveTablePose (SOLVEPNP_IPPE) → pose
detectQuad(image)   → 4 corners [TL,TR,BR,BL] ┘
```

Inside `detectQuadCv` the stages are:

```
HSV colour threshold → mask   ← FRAGILE (glare, odd cloth, sample-on-ball)
   → morphology → largest contour
   → rail-line TLS fit (fitQuadFromMask) → sub-pixel corners   ← STRONG (occlusion-robust, off-frame corners)
```

The weak link is the felt **mask**, not the corner geometry. So the learned
model outputs a **felt segmentation mask** and drops in at that single seam.
The rail-line fit, gravity check, size-class search and PnP are untouched.

Rejected alternative — direct 4-corner regression: bypasses the rail-line fit,
loses sub-pixel accuracy and the occlusion/off-frame reconstruction. Strictly
worse pairing.

| Approach | Model output | Reuses rail-fit | Sub-pixel | Blast radius |
|---|---|---|---|---|
| **Mask (chosen)** | felt mask 256² | yes | yes (TLS) | swap 1 stage |
| Corner regression | 4 coords | no | no | replace detector |

## Compatibility verdict

Fully compatible with the current solution — the learned mask enters at one
seam behind a `MaskSource` interface; everything downstream is unchanged. No
parallel baseline pipeline is needed: the `?detect` A/B rig runs both mask
sources through the *same* downstream and compares `reprojRmsPx`.

## Phases

### Phase 1 — the seam + A/B rig  ← START HERE

- Extract HSV masking out of `detectQuadCv` into `hsvFeltMask`, behind a
  `MaskSource = (cv, image, opts) => FeltMask | null` interface. Pure refactor,
  **no behaviour change** — the default mask source is `hsvFeltMask`.
- Thread an optional `maskSource` through `detectQuadCv` opts.
- `?detect` A/B: once a second source exists, run both on the same frame →
  same rail-fit → `solveTablePose`, show both `reprojRmsPx` in the caption.
- **Gate:** proves whether a learned mask actually beats HSV *before* investing
  in training. Measure first.

### Phase 2 — pseudo-labelled data  ← DONE

Built into `?detect` (reuses the existing in-browser folder workflow — no
node/wasm batch harness, no new deps):

- Load a folder of table photos → each auto-detected.
- **Auto-accept gate = `refined && !clipped`** (rail-line fit succeeded, felt
  not frame-clipped). NOT `reprojRmsPx` — a still has no real intrinsics, so 4
  coplanar corners reproject near-perfectly at any FOV; that residual is
  theatre. Per-cell checkbox overrides the gate.
- **Label = polygon-fill of the DETECTED QUAD**, white=felt / black=not — crisp
  and leak-free, inheriting the rail-fit's robustness (vs the noisy raw HSV
  blob).
- **Export** → File System Access API writes `frame_i.png`, `frame_i.mask.png`,
  `manifest.json` into a picked folder. Chrome/Edge only.
- Correction of hard cases: **`?label` tool** (LabelDebug.tsx) — steps through
  images, shows the proposed quad with draggable corners, Save adds the
  corrected quad to the batch, Export writes it via the shared exporter. This is
  what teaches the net beyond HSV: hard frames (glare, clutter, weird cloth) get
  hand-fixed instead of dropped.
- Two entry points, same output format (shared `datasetExport.ts`): `?detect`
  for bulk auto-accept, `?label` for one-by-one correction.
- Target ~500–1000 frames, binary felt / not-felt.

### Phase 3 — model + web inference

- Tiny binary segmenter (MobileNetV3-small U-Net class), input 256×256, int8.
- Runtime: ONNX Runtime Web (WASM+SIMD) or tfjs-wasm. ~tens of ms/frame,
  ~2–5 MB bundle, lazy-loaded only when HSV fails first.
- Ship ordering: HSV first (free) → learned mask fallback when HSV nulls/clips.
  `?detect` A/B decides whether to promote learned to tier-1.

## Risks / calibration knobs

- On-device inference latency — measure in the Phase 1 rig on a real phone
  before committing to per-frame inference.
- Bundle size vs the current zero-dependency detector — lazy-load weights.
- Pseudo-labels clone HSV's blind spots unless the hard frames are hand-fixed.
  // VERIFY on a held-out hard set.
- Throwaway when the native rewrite lands (TFLite/NNAPI is the real home). The
  Phase 1 harness and Phase 2 labels carry over; the web WASM runtime does not.

## Sources (approach grounding — verify before prod; we own the code)

- Deep Image Homography Estimation — https://arxiv.org/pdf/1606.03798
- PlaneRCNN (CVPR 2019) — https://openaccess.thecvf.com/content_CVPR_2019/papers/Liu_PlaneRCNN_3D_Plane_Detection_and_Reconstruction_From_a_Single_Image_CVPR_2019_paper.pdf
- PlaneSegNet — https://ar5iv.labs.arxiv.org/html/2103.15428
- Roboflow pool-table detection — https://blog.roboflow.com/pool-table-analytics-object-detection/
