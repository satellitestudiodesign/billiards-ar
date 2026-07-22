/**
 * Pose-stage precision bench — the one that reaches the <1 cm on-screen target.
 * Exercises the REAL `solveTablePose` (OpenCV `SOLVEPNP_IPPE`), which the
 * rail-fit bench could not: OpenCV.js resolves fine in node once you await its
 * default export (it's a thenable), so no browser runner is needed.
 *
 * Closed loop: place a known table at a known world pose, view it with a known
 * camera + intrinsics, project the model corners to ground-truth pixels,
 * DEGRADE them (corner noise from the felt fit + a deliberate intrinsics error
 * standing in for WebXR's projection-matrix guess), solve, then measure:
 *   • world corner RMS (mm)          — metric-space table error
 *   • on-screen reprojection (px→mm) — what the user actually sees off the rail
 *   • centre depth error (mm)        — the range axis PnP is weakest on
 *
 * This is the harness that tells us which downstream fix (intrinsics, view
 * angle, inset) buys the most cm. Deterministic: seeded LCG, no Date/random.
 *
 * Run:  npx vitest run tablePose.bench   (prints a table; asserts a ceiling).
 */
import { createRequire } from 'module'
import { beforeAll, describe, expect, it } from 'vitest'
import { Matrix4, Quaternion, Vector3 } from 'three'
import type { Cv } from './opencv'
import { solveTablePose, type CapturePose } from './tablePose'
import { estimateFocal, homographyFromCorners } from './calibrateIntrinsics'
import { PLAYING_LENGTH, type SizeClass } from '../fitRectangle'
import type { PixelPoint } from './detectQuad'

const W = 640
const H = 480
const FLIP = new Matrix4().makeScale(1, -1, -1) // cv-cam ↔ gl-cam

interface Intr {
  fx: number
  fy: number
  cx: number
  cy: number
}
const TRUE_K: Intr = { fx: 480, fy: 480, cx: W / 2, cy: H / 2 }

/** Seeded LCG → uniform, then Box–Muller normal. */
function makeRng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 0x100000000
  }
}
function gauss(rng: () => number): number {
  const u = Math.max(1e-12, rng())
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng())
}

/** GL/WebXR column-major projection matrix from intrinsics (inverse of
 *  intrinsicsFromProjection — same formulas as tablePose.test builds). */
function projFromIntr(k: Intr): number[] {
  const p = new Array(16).fill(0)
  p[0] = (2 * k.fx) / W
  p[5] = (2 * k.fy) / H
  p[8] = 1 - (2 * k.cx) / W
  p[9] = (2 * k.cy) / H - 1
  p[11] = -1
  return p
}

/** Nose-line model corners (table-local, y=0 plane), matching modelCorners. */
function modelCorners(size: SizeClass): Vector3[] {
  const hl = PLAYING_LENGTH[size] / 2
  const hw = PLAYING_LENGTH[size] / 4
  return [
    new Vector3(hl, 0, hw),
    new Vector3(hl, 0, -hw),
    new Vector3(-hl, 0, -hw),
    new Vector3(-hl, 0, hw),
  ]
}

/** camToWorld (GL frame) for a phone at `eye` looking at `target`, up = +Y. */
function cameraGl(eye: Vector3, target: Vector3): Matrix4 {
  const m = new Matrix4().lookAt(eye, target, new Vector3(0, 1, 0))
  m.setPosition(eye)
  return m
}

/** Project a WORLD point to pixels through (camToWorld GL, intrinsics). Mirrors
 *  the code's convention: X_cvcam = FLIP · worldToCam · X_world. */
function projectWorld(p: Vector3, camToWorld: Matrix4, k: Intr): PixelPoint | null {
  const worldToCam = camToWorld.clone().invert()
  const x = p.clone().applyMatrix4(worldToCam).applyMatrix4(FLIP) // cv-cam frame
  if (x.z <= 1e-6) return null
  return { x: (k.fx * x.x) / x.z + k.cx, y: (k.fy * x.y) / x.z + k.cy }
}

/** Best-cyclic-aligned RMS distance between two 4-corner sets (any units). */
function alignedRms(a: Vector3[], b: Vector3[]): number {
  let best = Infinity
  for (let r = 0; r < 4; r++) {
    let sq = 0
    for (let i = 0; i < 4; i++) sq += a[i].distanceToSquared(b[(i + r) % 4])
    best = Math.min(best, Math.sqrt(sq / 4))
  }
  return best
}

interface Scene {
  size: SizeClass
  /** Table world pose. */
  tableToWorld: Matrix4
  trueCorners: Vector3[]
  camToWorld: Matrix4
}

/** Build a scene: table on the world y=0 plane with a yaw; camera at a given
 *  height/back-distance (→ view angle). */
function scene(size: SizeClass, yaw: number, camHeight: number, camBack: number): Scene {
  const tableToWorld = new Matrix4().compose(
    new Vector3(0, 0, 0),
    new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw),
    new Vector3(1, 1, 1),
  )
  const trueCorners = modelCorners(size).map((v) => v.clone().applyMatrix4(tableToWorld))
  const camToWorld = cameraGl(new Vector3(0, camHeight, camBack), new Vector3(0, 0, 0))
  return { size, tableToWorld, trueCorners, camToWorld }
}

interface Degrade {
  /** Corner-pixel Gaussian noise σ (from the rail-fit bench: ~0.3 realistic). */
  noisePx: number
  /** Multiplicative focal-length error given to the solver (WebXR K guess). */
  fxScaleErr: number
  /** Principal-point offset error given to the solver, px. */
  cxErr: number
}

let cv: Cv
beforeAll(async () => {
  // opencv.js resolves to the ready module when awaited, BUT under vite/vitest a
  // dynamic `import()` awaits the module namespace — whose exported `then` is a
  // Module receiver and throws. `require` returns a plain-object thenable whose
  // `then` is safely callable. (The app's loadOpenCv uses a browser-only init
  // path that never fires in node.)
  const require = createRequire(import.meta.url)
  cv = (await require('@techstark/opencv-js')) as unknown as Cv
}, 60000)

/** One trial: project truth, degrade pixels, solve with a possibly-biased K,
 *  return world-mm / on-screen-mm / depth-mm errors, or null on solve failure. */
function trial(sc: Scene, d: Degrade, rng: () => number) {
  const truePx = sc.trueCorners.map((c) => projectWorld(c, sc.camToWorld, TRUE_K))
  if (truePx.some((p) => !p)) return null
  const px = (truePx as PixelPoint[]).map((p) => ({
    x: p.x + gauss(rng) * d.noisePx,
    y: p.y + gauss(rng) * d.noisePx,
  }))

  // The solver only knows the (biased) projection matrix, as on-device.
  const biasedK: Intr = {
    fx: TRUE_K.fx * d.fxScaleErr,
    fy: TRUE_K.fy * d.fxScaleErr,
    cx: TRUE_K.cx + d.cxErr,
    cy: TRUE_K.cy,
  }
  const cap: CapturePose = {
    projection: projFromIntr(biasedK),
    view: sc.camToWorld.elements as unknown as number[],
    width: W,
    height: H,
  }
  const res = solveTablePose(cv, px, cap, { maxReprojRmsPx: 50 })
  if (!res) return null
  const got = res.best.corners // solver's actual pick — drives on-screen error

  // World / depth precision conditioned on the CORRECT size class (the app locks
  // size at registration, so pose precision post-lock is the honest question).
  // res.best.sizeClass may differ — badSize% below reports that ambiguity.
  const sized = res.all.find((f) => f.sizeClass === sc.size) ?? res.best
  const worldMm = alignedRms(sc.trueCorners, sized.corners) * 1000

  // On-screen overlay error: reproject recovered corners through the TRUE render
  // camera, compare to where the true corners land. px → mm via the true long edge.
  const gotPx = got.map((c) => projectWorld(c, sc.camToWorld, TRUE_K))
  let screenPx = NaN
  if (gotPx.every((p) => p)) {
    let best = Infinity
    for (let r = 0; r < 4; r++) {
      let sq = 0
      for (let i = 0; i < 4; i++) {
        const g = gotPx[(i + r) % 4] as PixelPoint
        const t = truePx[i] as PixelPoint
        sq += (g.x - t.x) ** 2 + (g.y - t.y) ** 2
      }
      best = Math.min(best, Math.sqrt(sq / 4))
    }
    screenPx = best
  }
  const edgePx =
    ((truePx[1] as PixelPoint).x - (truePx[0] as PixelPoint).x) ** 2 +
    ((truePx[1] as PixelPoint).y - (truePx[0] as PixelPoint).y) ** 2
  const mmPerPx = (PLAYING_LENGTH[sc.size] * 1000) / Math.sqrt(edgePx)
  const screenMm = screenPx * mmPerPx

  // Depth (range) error at the correct size class: distance camera→table centre.
  const camPos = new Vector3().setFromMatrixPosition(sc.camToWorld)
  const trueC = new Vector3().setFromMatrixPosition(sc.tableToWorld)
  const depthMm = Math.abs(camPos.distanceTo(sized.center) - camPos.distanceTo(trueC)) * 1000

  return { worldMm, screenMm, depthMm, ok: res.best.sizeClass === sc.size }
}

function measure(sc: Scene, d: Degrade, seeds = 30) {
  const w: number[] = []
  const s: number[] = []
  const dp: number[] = []
  let fails = 0
  let wrongSize = 0
  for (let i = 0; i < seeds; i++) {
    const r = trial(sc, d, makeRng(0xabcd + i * 2654435761))
    if (!r) {
      fails++
      continue
    }
    if (!r.ok) wrongSize++
    w.push(r.worldMm)
    s.push(r.screenMm)
    dp.push(r.depthMm)
  }
  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN)
  return {
    worldMm: mean(w),
    screenMm: mean(s),
    depthMm: mean(dp),
    failFrac: fails / seeds,
    wrongSizeFrac: wrongSize / seeds,
  }
}

// A steep near-top-down view and a shallow oblique view of a 9ft table.
const STEEP = scene('9ft', 0.3, 1.7, 1.2) // ~55° down
const SHALLOW = scene('9ft', 0.3, 0.9, 2.4) // ~20° down

const CASES: { name: string; sc: Scene; d: Degrade }[] = [
  { name: 'steep, clean K', sc: STEEP, d: { noisePx: 0.3, fxScaleErr: 1.0, cxErr: 0 } },
  { name: 'steep, K +3% focal', sc: STEEP, d: { noisePx: 0.3, fxScaleErr: 1.03, cxErr: 0 } },
  { name: 'steep, K +8% focal', sc: STEEP, d: { noisePx: 0.3, fxScaleErr: 1.08, cxErr: 0 } },
  { name: 'steep, cx off 15px', sc: STEEP, d: { noisePx: 0.3, fxScaleErr: 1.0, cxErr: 15 } },
  { name: 'shallow, clean K', sc: SHALLOW, d: { noisePx: 0.3, fxScaleErr: 1.0, cxErr: 0 } },
  { name: 'shallow, K +3% focal', sc: SHALLOW, d: { noisePx: 0.3, fxScaleErr: 1.03, cxErr: 0 } },
  { name: 'shallow, noise σ=1px', sc: SHALLOW, d: { noisePx: 1.0, fxScaleErr: 1.0, cxErr: 0 } },
]

describe('tablePose precision bench', () => {
  it('tabulates world / on-screen / depth error vs intrinsics & view (prints)', () => {
    const pad = (s: string, n: number) => s.padEnd(n)
    const num = (v: number) => (Number.isNaN(v) ? '  n/a' : v.toFixed(1))
    const lines: string[] = []
    lines.push(
      `\n  ${pad('case', 24)}${pad('world mm', 10)}${pad('screen mm', 11)}${pad('depth mm', 10)}${pad('fail%', 7)}${pad('badSize%', 9)}`,
    )
    for (const { name, sc, d } of CASES) {
      const r = measure(sc, d)
      lines.push(
        `  ${pad(name, 24)}${pad(num(r.worldMm), 10)}${pad(num(r.screenMm), 11)}${pad(num(r.depthMm), 10)}${pad(
          (r.failFrac * 100).toFixed(0),
          7,
        )}${pad((r.wrongSizeFrac * 100).toFixed(0), 9)}`,
      )
    }
    console.log(lines.join('\n'))

    // Regression guard: clean intrinsics + steep view must recover < 1 cm on
    // screen. If this breaks, the pose chain regressed.
    const clean = measure(STEEP, CASES[0].d)
    expect(clean.screenMm).toBeLessThan(10)
    expect(clean.failFrac).toBe(0)
  }, 120000)
})

// ── Intrinsics self-calibration prototype ─────────────────────────────────────
// The bench above proved a focal error (WebXR's FOV-ratio guess) dominates the
// on-screen error. The table is a known 2:1 metric rectangle, so it IS a Zhang
// calibration target: from N table views at varied orientation, per-frame
// homographies constrain the camera focal via the rotation-orthonormality
// identity — no chessboard, no user step. This prototype recovers the focal and
// shows the on-screen error collapse back toward the clean-K floor. cx,cy held
// at image centre (their true value here); extend to a 3-D search if a device
// shows real principal-point offset.

/** camToWorld for a phone on an arc around the table: azimuth (rad, 0 = +Z),
 *  radius (m), height (m), always looking at the table centre. */
function arcCamera(azimuth: number, radius: number, height: number): Matrix4 {
  return cameraGl(
    new Vector3(radius * Math.sin(azimuth), height, radius * Math.cos(azimuth)),
    new Vector3(0, 0, 0),
  )
}

// Homography + focal recovery come from the production module
// (calibrateIntrinsics) — this bench measures the REAL code, not a copy.
// `homographyFromCorners` uses a canonical 2:1 model internally (only aspect
// matters), so no model argument is threaded here.

/** On-screen reprojection error (px) of the solved table using intrinsics K,
 *  measured against the ground-truth pixel corners. null on solve failure. */
function onScreenPx(sc: Scene, px: PixelPoint[], truePx: PixelPoint[], k: Intr): number | null {
  const cap: CapturePose = {
    projection: projFromIntr(k),
    view: sc.camToWorld.elements as unknown as number[],
    width: W,
    height: H,
  }
  const res = solveTablePose(cv, px, cap, { maxReprojRmsPx: 500 })
  if (!res) return null
  const gotPx = res.best.corners.map((c) => projectWorld(c, sc.camToWorld, TRUE_K))
  if (!gotPx.every((p) => p)) return null
  let best = Infinity
  for (let r = 0; r < 4; r++) {
    let sq = 0
    for (let i = 0; i < 4; i++) {
      const gp = gotPx[(i + r) % 4] as PixelPoint
      sq += (gp.x - truePx[i].x) ** 2 + (gp.y - truePx[i].y) ** 2
    }
    best = Math.min(best, Math.sqrt(sq / 4))
  }
  return best
}

describe('intrinsics self-calibration prototype', () => {
  it('recovers focal from N table views; on-screen error collapses (prints)', () => {
    const SIZE: SizeClass = '9ft'
    const model = modelCorners(SIZE)
    const NOISE = 0.3 // px, realistic corner noise (rail-fit bench)
    const N_FRAMES = 6
    const BIAS = 1.06 // the device projection matrix over-reports focal by 6%

    // A single fixed table, viewed from an arc of camera poses (orientation
    // variety is what makes Zhang non-degenerate).
    const tableToWorld = new Matrix4().compose(
      new Vector3(0, 0, 0),
      new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.3),
      new Vector3(1, 1, 1),
    )
    const trueCorners = model.map((v) => v.clone().applyMatrix4(tableToWorld))

    const focalErr: number[] = []
    let biasedSum = 0
    let calibSum = 0
    let biasedN = 0
    let calibN = 0

    const TRIALS = 20
    for (let t = 0; t < TRIALS; t++) {
      const rng = makeRng(0x5eed + t * 2654435761)
      const homs: number[][] = []
      const frames: { sc: Scene; px: PixelPoint[]; truePx: PixelPoint[] }[] = []
      for (let i = 0; i < N_FRAMES; i++) {
        const az = -0.7 + (1.4 * i) / (N_FRAMES - 1) // -40°..+40°
        const camToWorld = arcCamera(az, 2.5, 1.3 + 0.25 * Math.sin(i))
        const sc: Scene = { size: SIZE, tableToWorld, trueCorners, camToWorld }
        const truePx = trueCorners.map((c) => projectWorld(c, camToWorld, TRUE_K))
        if (truePx.some((p) => !p)) continue
        const tp = truePx as PixelPoint[]
        const px = tp.map((p) => ({ x: p.x + gauss(rng) * NOISE, y: p.y + gauss(rng) * NOISE }))
        const Hh = homographyFromCorners(cv, px)
        if (Hh) homs.push(Hh)
        frames.push({ sc, px, truePx: tp })
      }
      if (homs.length < 3) continue

      const fEst = estimateFocal(homs, W / 2, H / 2, TRUE_K.fx * 0.4, TRUE_K.fx * 2.5)
      focalErr.push((100 * (fEst - TRUE_K.fx)) / TRUE_K.fx)

      const biasedK: Intr = { fx: TRUE_K.fx * BIAS, fy: TRUE_K.fy * BIAS, cx: W / 2, cy: H / 2 }
      const calibK: Intr = { fx: fEst, fy: fEst, cx: W / 2, cy: H / 2 }
      for (const fr of frames) {
        const b = onScreenPx(fr.sc, fr.px, fr.truePx, biasedK)
        const c = onScreenPx(fr.sc, fr.px, fr.truePx, calibK)
        if (b != null) {
          biasedSum += b
          biasedN++
        }
        if (c != null) {
          calibSum += c
          calibN++
        }
      }
    }

    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length
    const meanAbs = (a: number[]) => mean(a.map(Math.abs))
    const mmPerPx = (() => {
      // long-edge scale at a mid arc view, for px→mm reporting
      const cam = arcCamera(0, 2.5, 1.4)
      const p0 = projectWorld(trueCorners[0], cam, TRUE_K) as PixelPoint
      const p1 = projectWorld(trueCorners[1], cam, TRUE_K) as PixelPoint
      return (PLAYING_LENGTH[SIZE] * 1000) / Math.hypot(p1.x - p0.x, p1.y - p0.y)
    })()

    const biasedPx = biasedSum / biasedN
    const calibPx = calibSum / calibN
    console.log(
      [
        `\n  focal: true ${TRUE_K.fx}px, device-guess +${((BIAS - 1) * 100).toFixed(0)}% = ${(TRUE_K.fx * BIAS).toFixed(0)}px`,
        `  recovered focal error: mean|Δ| ${meanAbs(focalErr).toFixed(2)}%  (${N_FRAMES} views, σ=${NOISE}px, ${focalErr.length} trials)`,
        `\n  on-screen error (mean over views):`,
        `    device-guess K (+6%):  ${biasedPx.toFixed(1)} px  ≈ ${(biasedPx * mmPerPx).toFixed(1)} mm`,
        `    self-calibrated K:     ${calibPx.toFixed(1)} px  ≈ ${(calibPx * mmPerPx).toFixed(1)} mm`,
        `    improvement:           ${(biasedPx / calibPx).toFixed(1)}×`,
      ].join('\n'),
    )

    // The point of the prototype: calibration recovers focal to a few % and cuts
    // on-screen error well below the biased baseline.
    expect(meanAbs(focalErr)).toBeLessThan(3)
    expect(calibPx).toBeLessThan(biasedPx * 0.5)
  }, 120000)
})
