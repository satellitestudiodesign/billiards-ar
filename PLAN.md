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

| Module | Role |
|---|---|
| `appStore.ts` | zustand state machine: `registering → confirming → ready → animating` (discriminated union `Phase`) |
| `registration/fitRectangle.ts` | pure math: 4 noisy taps → plane fit → CCW order → 2D Kabsch per size class → best `RectFit` (center, quaternion, rms). Fully unit-tested. |
| `physics/index.ts` | **only** file the app imports physics from: `configureTableSize`, `tableLayout`, `simulate(balls, shot) → {duration, events, stateAt(t)}` |
| `physics/vendor/**` | tailuge/billiards physics, headless-stripped, `@ts-nocheck`, GPL-3.0. Don't edit equations; re-vendor to update. |
| `drills/drills.ts` | drill defs in fractional table coords (scale to any size); ghost-ball aiming for pocket shots |
| `xr/` | `xrStore` singleton (hitTest+anchors+domOverlay), `reticleState` (jitter-averaged hit-test pose, non-React) |
| `scene/` | `ARScene` (phase router) → `RegistrationScene` (reticle + tap corners) / `AnchoredTable` (XR anchor at fit pose, falls back to plain group) → `TableContents` + `DrillBalls` (useFrame-driven playback) |
| `ui/Overlay.tsx` | `XRDomOverlay` HTML UI per phase; `beforexrselect` preventDefault so UI taps don't place corners |
| `DebugApp.tsx` | `?debug` desktop route: table + drills + playback with OrbitControls, no phone needed |

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
1. **Phone smoke test (M0-on-device)** — Pixel/Android Chrome: cert flow, reticle tracks felt, `beforexrselect` actually suppresses UI-tap corner placement (fallback if flaky: ignore `select` within 300ms of overlay pointerdown), anchor stability walking around. See README checklist.
2. **Registration accuracy pass** — register a real table, put a real ball on the foot spot, compare with rendered spot (target ≤ 2–3 cm). Tune reticle averaging window if needed.
3. **UX polish** — corner markers numbered, "tracking lost" toast, animation-finished state (auto show Replay), sounds on events (`Simulation.events` already carries collision/cushion/pot times).
4. **Real-ball layout check** (future) — detect real ball positions vs drill start layout.
5. **CV auto-registration v2** (future) — WebXR raw camera access + OpenCV.js in worker → same 4-corner output as taps. Check three.js `getCameraTexture` crash (issue #33404) vs pinned versions before starting.
6. **iOS** (future) — Variant Launch SDK bridge.
7. **License decision** — confirm GPL-3.0 distribution is acceptable, add LICENSE at repo root (currently only in `src/physics/vendor/`).

**Known constraints / gotchas:**
- One table size at a time: vendored geometry is global static (`configureTableSize`). Fine for this app.
- `Ball.id` is a global counter upstream; `simulate()` resets it for determinism.
- Never render/move `<XROrigin>` — anchor creation uses `relativeTo:'world'` and assumes scene coords == XR reference space.
- Vendored physics rolls long (low rolling resistance): drills can run ~10s; head-on layouts can re-collide off the foot rail (that's real physics, design drills accordingly).
- Emulator (IWER, auto on localhost) validates logic but not handheld taps/DOM overlay.

**Org policy reminders (Global Fishing Watch):** review the GFW AI policies; the human owns this content — read and understand the vendored physics and the registration math before production; ask for sources and double-check AI claims (table dims marked `// VERIFY vs WPA specs` in `fitRectangle.ts`).
