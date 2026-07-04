# Vendored billiards physics — tailuge/billiards

- Upstream: https://github.com/tailuge/billiards
- Commit: `19532e3f0d8b7b6ca4f73ea07decb61c55fc6152`
- License: **GPL-3.0** (see `LICENSE` in this directory)

Because this GPL-3.0 code is compiled into the app bundle, the whole app is a
derivative work: **billiards-ar must be distributed under GPL-3.0** (source
made available). Keep this in mind before any closed/commercial distribution.

## What is vendored

Only the physics core (models from Han 2005, Mathavan et al. 2010, Stronge;
see upstream README and https://ekiefl.github.io/2020/04/24/pooltool-theory/
for the underlying papers):

- `model/ball.ts`, `model/table.ts`, `model/outcome.ts`
- `model/physics/*` (collision, collisionthrow, constants, cushion, knuckle,
  mathavan, physics, pocket, stronge)
- `view/tablegeometry.ts`, `view/pocketgeometry.ts` (pure geometry data
  despite the `view/` path)
- `utils/utils.ts`, `utils/three-utils.ts`

## Local modifications (headless use, physics untouched)

- `model/ball.ts`: removed `BallMesh`/`BallAppearance` rendering code.
- `model/table.ts`: removed `Cue`, `ProximityIndicator`, mesh/trace/scene
  helpers, serialisation and `AimEvent` (game/network layer).
- `utils/utils.ts`: removed `isFirstShot()` (game-event layer).
- Added provenance headers; added TS parameter types where the originals
  relied on implicit `any` (our tsconfig is strict).

Do not edit physics equations here. To update: re-copy from upstream at a
newer commit and re-apply the strips above.

## Geometry convention (upstream)

Table frame: origin = table center, x = long axis, y = short axis, z = up.
Everything scales with ball radius `R` (`setR()` in `model/physics/constants.ts`):
playing surface (cushion nose to nose) = `88R × 44R` (2:1, like real tables).
Ball centers bounce at `|x| = 43R`, `|y| = 21R`. So `setR(L / 88)` yields an
exact L × L/2 playing surface in meters. Fixed physics timestep upstream is
`0.001953125 s` (512 Hz).
