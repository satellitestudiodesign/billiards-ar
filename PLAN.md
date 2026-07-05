# AR Billiards Trainer — plan & state

Working plan for the project. Original product spec lives in `docs/SPEC.md`.
Update the **State** section at the end of every working session.

## What this is

Mobile AR **website** (Android Chrome, WebXR immersive-ar): point the phone at
a real pool table, tap the 4 playing-surface corners to register it, the app
overlays where drill balls go and plays a physics animation of the shot.

## Decisions made

- **Stack**: React 19 + TypeScript + Vite, React Three Fiber 9, `@react-three/xr` ^6.6 (published npm), zustand, drei.
- **Standalone repo** (this one), not inside the pmndrs/xr monorepo. The pmndrs/xr clone at `../xr` is API reference only (`examples/hit-testing`, `examples/handheld-ar` are the patterns used here).
- **Physics: vendored from tailuge/billiards** (user decision 2026-07-04, superseding the spec's port-the-papers plan). See `src/physics/vendor/README.md` for provenance (commit `19532e3`), what was stripped, and geometry conventions.
  - ⚠️ **GPL-3.0 consequence**: the vendored physics makes the whole app a derivative work → the app must be distributed under GPL-3.0 with source available. Revisit before any closed/commercial distribution (alternatives: re-port math from papers per original spec, or negotiate).
- **Android-only v1**. iOS has no WebXR; Variant Launch SDK deferred.
- **Registration**: manual 4-corner tap (stays as permanent fallback). v2 CV auto-detection (OpenCV.js + raw camera access) deferred.
- Tables are 2:1 standardized: 7ft 1.9812m / 8ft 2.2352m / 9ft 2.54m playing length. Vendored geometry is `88R × 44R`, so `setR(L/88)` reproduces the surface exactly (`configureTableSize`).

## Architecture (all in `src/`)

| Module                         | Role                                                                                                                                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `appStore.ts`                  | zustand state machine: `registering → confirming → ready → animating` (discriminated union `Phase`)                                                                                                     |
| `registration/fitRectangle.ts` | pure math: 4 noisy taps → plane fit → CCW order → 2D Kabsch per size class → best `RectFit` (center, quaternion, rms). Fully unit-tested.                                                               |
| `physics/index.ts`             | **only** file the app imports physics from: `configureTableSize`, `tableLayout`, `simulate(balls, shot) → {duration, events, stateAt(t)}`                                                               |
| `physics/vendor/**`            | tailuge/billiards physics, headless-stripped, `@ts-nocheck`, GPL-3.0. Don't edit equations; re-vendor to update.                                                                                        |
| `drills/drills.ts`             | drill defs in fractional table coords (scale to any size); ghost-ball aiming for pocket shots                                                                                                           |
| `xr/`                          | `xrStore` singleton (hitTest+anchors+domOverlay), `reticleState` (jitter-averaged hit-test pose, non-React)                                                                                             |
| `scene/`                       | `ARScene` (phase router) → `RegistrationScene` (reticle + tap corners) / `AnchoredTable` (XR anchor at fit pose, falls back to plain group) → `TableContents` + `DrillBalls` (useFrame-driven playback) |
| `ui/Overlay.tsx`               | `XRDomOverlay` HTML UI per phase; `beforexrselect` preventDefault so UI taps don't place corners                                                                                                        |
| `DebugApp.tsx`                 | `?debug` desktop route: table + drills + playback with OrbitControls, no phone needed                                                                                                                   |

Frames: physics/table frame is x = long axis, y = short axis, z = up, origin =
table center (meters). Render layer maps physics `(x, y, z)` → three.js
table-local `(x, z + R, y)`. The XR anchor carries the table frame: +X long,
+Y up, +Z short.

## State — updated 2026-07-04 (session 1)

**Done (alpha):**

- Scaffold, deps installed, `tsc` clean, `vite build` green.
- Physics vendored + adapter; **14/14 vitest green** (`npm test`): geometry, determinism, draw/follow, cushion, pot, clamping + fitRectangle noise/orientation/size-disambiguation suite.
- Full AR flow implemented (not yet phone-tested): Enter AR → reticle → 4 taps → fit + size confirm (RMS shown) → anchor → table overlay → drill select → play/replay.
- 3 drills: stop shot, draw shot, cut to corner (ghost-ball aiming).
- Desktop debug route works end-to-end: `npm run dev` → `https://localhost:5173/?debug`.

**Not done / next steps (in order):**

1. **Phone smoke test (M0-on-device)** — Pixel/Android Chrome: cert flow, reticle tracks felt, anchor stability walking around. See README checklist. NOTE: `beforexrselect` did NOT suppress UI-tap corner placement on-device — fallback implemented (`ui/overlayGuard.ts`: overlay panel records pointerdown, corner handler ignores `select` within 500ms). Verify the 500ms window feels right on-device.
2. **Registration accuracy pass** — register a real table, put a real ball on the foot spot, compare with rendered spot (target ≤ 2–3 cm). Tune reticle averaging window if needed.
3. **UX polish** — corner markers numbered, "tracking lost" toast, animation-finished state (auto show Replay). (No sounds — dropped by user decision 2026-07-05.)
4. **Real-ball layout check** (future) — detect real ball positions vs drill start layout.
5. **CV auto-registration** (implemented, pending device test) — optional "✨ Auto-detect" button in the registering phase. Pipeline in `src/registration/cv/`: `captureFrame` (WebXR raw camera → RGBA, needs `camera-access` optional feature, added in `xrStore`) → `detectQuad` (felt colour-threshold + extreme-point corners, pure/tested, dependency-free — **not** OpenCV yet) → `projectToPlane` (back-project onto the reticle's hit-test plane, pure/tested) → `submitCorners` → same fit path as manual taps. Degrades to manual on any failure.
   - **VERIFY on-device (blocking before trust):** (a) `camera-access` granted on the Pixel; (b) three.js `getCameraImage`/readback vs crash issue #33404; (c) raw-camera image frustum vs render-camera frustum — if they differ the NDC mapping is biased, switch `projectToPlane` to XRView camera intrinsics (calibration knob noted in-file).
   - If the colour-threshold detector proves fragile on real felt, swap in OpenCV.js behind the `DetectQuad` interface — rest of the pipeline is unchanged. Deferred until on-device evidence it's needed (avoids an ~8 MB wasm dep speculatively).
6. **iOS** (future) — Variant Launch SDK bridge.
7. **License decision** — GPL-3.0 `LICENSE` now at repo root (copied from `src/physics/vendor/`). ⚠️ Still owed: explicit confirmation that GPL-3.0 public distribution is acceptable for this project. Publishing to Pages (below) *is* distribution → repo must stay public + source available.

**Deployment:** GitHub Pages via `.github/workflows/pages.yml` (build on push to `main` → publish `dist/`). URL: `https://satellitestudiodesign.github.io/billiards-ar/`. Trusted HTTPS (WebXR secure-context OK). `vite.config.ts` sets `base:'/billiards-ar/'` for build only; dev keeps `/` + mkcert https + tunnel host allowlist. One-time repo setup: Settings → Pages → Source = GitHub Actions.

**Known constraints / gotchas:**

- One table size at a time: vendored geometry is global static (`configureTableSize`). Fine for this app.
- `Ball.id` is a global counter upstream; `simulate()` resets it for determinism.
- Never render/move `<XROrigin>` — anchor creation uses `relativeTo:'world'` and assumes scene coords == XR reference space.
- Vendored physics rolls long (low rolling resistance): drills can run ~10s; head-on layouts can re-collide off the foot rail (that's real physics, design drills accordingly).
- Emulator (IWER, auto on localhost) validates logic but not handheld taps/DOM overlay.
