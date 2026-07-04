# AR Billiards Training Aid

## What this project is
A mobile AR **website** (not a native app): the user points their phone at a real
pool table, the app overlays where the balls of a training drill should go, and a
physics-based animation shows how the balls should respond to the shot.

## Stack decisions (already made — don't relitigate without reason)
- **React + TypeScript + Vite**
- **React Three Fiber** for rendering
- **@react-three/xr v6** (pmndrs/xr) for WebXR: hit testing, anchors, DOM overlay
  for handheld AR UI. This repo is cloned from / based on the pmndrs/xr examples
  (handheld AR + hit-test).
- **Physics: analytic, event-based billiards physics — NOT a generic engine**
  (no Rapier/cannon for ball dynamics). Reference implementation:
  https://github.com/tailuge/billiards (TypeScript, browser, based on the
  Mathavan cushion paper; models backspin, sidespin, cushion rebound).
  NOTE: tailuge/billiards is GPL — check license compatibility before copying
  code; porting the math from the underlying papers (Han 2005, Leckie &
  Greenspan, Mathavan) is the safe route.
- Physics is decoupled from rendering: the simulation produces ball states,
  R3F meshes are driven from those states inside the AR anchor's coordinate frame.

## Table registration strategy
Key insight: pool tables are standardized. Registering the playing-surface
rectangle (position, orientation, size class: 7ft/8ft/9ft/snooker) gives pocket
positions, spots, and cushions for free via known geometry. Never "detect pockets".

- **v1 (build first): manual 4-corner tap registration.** WebXR hit-test on the
  table plane, user taps the four playing-surface corners, fit the known table
  rectangle, create an XR anchor for the table frame. This stays forever as the
  fallback path.
- **v2: CV auto-detection** using the WebXR Raw Camera Access API
  (Chrome/Android, ARCore-backed): grab camera frame + camera pose/intrinsics,
  segment felt by color (OpenCV.js in a web worker), fit quadrilateral / Hough
  lines on rails, ray-cast 2D corners onto the detected plane → same 4-corner
  output as manual taps. Same downstream code. Run at registration time (or
  1–2 fps for drift correction), never every frame.
  - Known issue to verify: Chrome 147+ on Android crashed with three.js
    `getCameraTexture` (three.js issue #33404). Check if fixed in pinned versions.
- Future feature: detect real ball positions (Hough circles or small TF.js/ONNX
  model) to check the physical layout matches the drill's starting position.

## Platform constraints (important)
- **Android Chrome: works today** with WebXR immersive-ar. Prototype here.
- **iOS Safari: NO WebXR immersive-ar support** (as of mid-2026). Options:
  Variant Launch SDK (drop-in WebAR bridge, removable later if Apple ships
  WebXR), 8th Wall (commercial), or Android-only v1.
- WebXR requires HTTPS and a user gesture to enter the session. For local dev
  on a phone use `vite --host` + a trusted cert (e.g. vite-plugin-mkcert) or
  adb reverse port forwarding.

## Physics accuracy notes
- Ball ~57 mm diameter; drill placement needs cm-level accuracy, so registration
  quality matters more than rendering quality.
- Model must handle: sliding→rolling friction transition (draw/follow/english),
  spin transfer on ball-ball collision (throw), spin-dependent cushion rebound.
- Small fixed timestep if any numerical stepping is used; analytic event
  detection preferred.

## Working agreements (org policy)
- No vibe coding to production: every piece of physics/calibration math must be
  understood and traceable to its source paper.
- Ask for sources and double-check AI-generated claims (Global Fishing Watch AI
  policy — the human owns the content).
