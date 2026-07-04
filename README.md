# AR Billiards Trainer (alpha)

Point an Android phone at a real pool table, tap the four playing-surface
corners, and the app overlays training-drill ball positions and plays a
physics animation of the shot. WebXR website — no app install.

**Status: alpha.** See [PLAN.md](PLAN.md) for the plan, current state, and next steps.

## License note (important)

`src/physics/vendor/` is vendored from
[tailuge/billiards](https://github.com/tailuge/billiards) under **GPL-3.0**,
which makes this whole app GPL-3.0 when distributed. See
`src/physics/vendor/README.md`.

## Run

```bash
npm install
npm run dev        # https, LAN-exposed (vite --host + basic-ssl)
npm test           # vitest: physics + registration math
npm run build
```

- **Desktop (no phone):** open `https://localhost:5173/?debug` — table +
  drills + shot playback with orbit controls. Accept the self-signed cert.
- **Phone (Android Chrome):** open `https://<laptop-LAN-ip>:5173`, accept the
  cert warning, tap Enter AR. Alternative without cert warning:
  `adb reverse tcp:5173 tcp:5173` then open `https://localhost:5173` on the phone.

## Phone test checklist (run after any AR-flow change)

1. Enter AR from the start screen (camera feed appears, overlay UI visible).
2. Reticle ring tracks the table felt as you aim around.
3. Tap 4 corners in order → yellow markers appear where you aimed.
4. Overlay buttons do **not** place corners (`beforexrselect` suppression).
5. Fit screen: wireframe matches the real table; RMS < 3 cm; size class right.
6. Accept → overlay stays glued to the table while you walk around it.
7. Put a real ball on the foot spot — rendered spot within ~2–3 cm.
8. Pick each drill, Play — balls animate on the table surface; Replay works.
9. Exit AR returns to the start screen.

## Structure

See the architecture table in [PLAN.md](PLAN.md). Quick map:
`appStore.ts` (phase state machine) · `registration/` (4-corner rectangle
fit) · `physics/` (adapter over vendored GPL engine) · `drills/` ·
`xr/` + `scene/` (R3F/WebXR) · `ui/Overlay.tsx` (DOM-overlay UI) ·
`DebugApp.tsx` (`?debug` desktop route).
