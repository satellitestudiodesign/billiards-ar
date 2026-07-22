/**
 * Camera-focal self-calibration from the pool table itself.
 *
 * WebXR gives no true camera intrinsics — `intrinsicsFromProjection` guesses
 * fx/fy from the XRView render frustum, which need not match the raw camera's
 * FOV. The pose bench showed a few-% focal error becomes ~10 cm of on-screen
 * overlay error, the single biggest error source. But the playing surface is a
 * known 2:1 rectangle, i.e. a Zhang calibration target, so we can recover the
 * focal from a handful of table views taken at different orientations — no
 * chessboard, no user step.
 *
 * Method (Zhang, reduced to the one dominant unknown): each view gives a
 * homography H from a canonical 2:1 model plane to the image. With the true K,
 * the K⁻¹-mapped first two columns of H are a rotation's first two columns, so
 * they are orthogonal and equal-length. A wrong focal breaks that. We minimise
 * the total orthonormality violation over all views w.r.t. a single focal scalar
 * (cx,cy held at the projection guess; fx=fy). ONLY the model's ASPECT RATIO
 * matters — absolute size and the unknown table size-class cancel in the
 * scale-invariant residual — so calibration needs no size-class decision.
 *
 * Needs orientation VARIETY across views (Zhang degenerates on parallel views),
 * so the accumulator rejects near-duplicate views and only reports intrinsics
 * once enough distinct orientations are collected.
 */
import type { Cv } from './opencv'
import type { PixelPoint } from './detectQuad'
import type { Intrinsics } from './tablePose'

/** Canonical 2:1 playing-surface model on its own plane (units arbitrary — only
 *  the 2:1 aspect matters). Order [TL,TR,BR,BL] to match detector corner order. */
const MODEL_2x1: [number, number][] = [
  [1, 0.5],
  [1, -0.5],
  [-1, -0.5],
  [-1, 0.5],
]

/** Homography (row-major 9) mapping the 2:1 model plane → image px, from 4
 *  image corners in [TL,TR,BR,BL] order. Null on a degenerate/failed solve. */
export function homographyFromCorners(cv: Cv, cornersPx: PixelPoint[]): number[] | null {
  if (cornersPx.length !== 4) return null
  const src = cv.matFromArray(4, 2, cv.CV_64F, MODEL_2x1.flat())
  const dst = cv.matFromArray(4, 2, cv.CV_64F, cornersPx.flatMap((p) => [p.x, p.y]))
  let H: number[] | null = null
  try {
    const Hm = cv.findHomography(src, dst, 0)
    if (Hm.rows === 3 && Hm.cols === 3) {
      H = Array.from({ length: 9 }, (_, i) => Hm.doubleAt(Math.floor(i / 3), i % 3))
    }
    Hm.delete()
  } catch {
    H = null
  }
  src.delete()
  dst.delete()
  if (H && H.every((v) => Number.isFinite(v))) return H
  return null
}

/** K⁻¹ applied to a homography column (h = [h0,h1,h2]), for K = {fx,fy,cx,cy}. */
function backproject(h: [number, number, number], k: Intrinsics): [number, number, number] {
  return [(h[0] - k.cx * h[2]) / k.fx, (h[1] - k.cy * h[2]) / k.fy, h[2]]
}

/** Zhang orthonormality residual of one homography at focal f (cx,cy fixed). */
function residual(H: number[], f: number, cx: number, cy: number): number {
  const K: Intrinsics = { fx: f, fy: f, cx, cy }
  const h1 = backproject([H[0], H[3], H[6]], K)
  const h2 = backproject([H[1], H[4], H[7]], K)
  const n1 = Math.hypot(h1[0], h1[1], h1[2])
  const n2 = Math.hypot(h2[0], h2[1], h2[2])
  if (n1 < 1e-9 || n2 < 1e-9) return 0
  const dot = h1[0] * h2[0] + h1[1] * h2[1] + h1[2] * h2[2]
  const e1 = dot / (n1 * n2) // orthogonality
  const e2 = (n1 * n1 - n2 * n2) / (n1 * n2) // equal length
  return e1 * e1 + e2 * e2
}

/**
 * Recover the focal (fx=fy) minimising the summed orthonormality residual over
 * all homographies. Golden-section search over [lo,hi] — the residual is smooth
 * and unimodal near the true focal.
 */
export function estimateFocal(homs: number[][], cx: number, cy: number, lo: number, hi: number): number {
  const cost = (f: number) => homs.reduce((s, H) => s + residual(H, f, cx, cy), 0)
  const g = (Math.sqrt(5) - 1) / 2
  let a = lo
  let b = hi
  let c = b - g * (b - a)
  let d = a + g * (b - a)
  let fc = cost(c)
  let fd = cost(d)
  for (let i = 0; i < 60; i++) {
    if (fc < fd) {
      b = d
      d = c
      fd = fc
      c = b - g * (b - a)
      fc = cost(c)
    } else {
      a = c
      c = d
      fc = fd
      d = a + g * (b - a)
      fd = cost(d)
    }
  }
  return (a + b) / 2
}

/** Unit table-plane normal implied by a homography at intrinsics K — the third
 *  rotation column r3 = r1×r2 of the recovered pose. Used to gauge how much a
 *  new view's orientation differs from those already collected. */
function viewNormal(H: number[], k: Intrinsics): [number, number, number] {
  const r1 = backproject([H[0], H[3], H[6]], k)
  const r2 = backproject([H[1], H[4], H[7]], k)
  const s = 1 / (Math.hypot(...r1) || 1)
  const a: [number, number, number] = [r1[0] * s, r1[1] * s, r1[2] * s]
  const b: [number, number, number] = [r2[0] * s, r2[1] * s, r2[2] * s]
  const n: [number, number, number] = [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
  const nl = Math.hypot(...n) || 1
  return [n[0] / nl, n[1] / nl, n[2] / nl]
}

/**
 * Session focal calibrator. Feed it the detected table corners from successive
 * frames; it keeps only orientation-distinct views and, once enough are
 * gathered, reports a calibrated focal (as full Intrinsics reusing the guess's
 * principal point). Feed the projection-derived guess as the focal search seed.
 */
export class IntrinsicsCalibrator {
  private homs: number[][] = []
  private normals: [number, number, number][] = []
  private guess: Intrinsics | null = null
  private cached: Intrinsics | null = null

  constructor(
    /** Min orientation-distinct views before a calibration is reported. */
    private minViews = 5,
    /** Reject a view whose normal is within this angle (rad) of a kept one. */
    private minAngleRad = (10 * Math.PI) / 180,
  ) {}

  get ready(): boolean {
    return this.homs.length >= this.minViews
  }

  get views(): number {
    return this.homs.length
  }

  /** Add one frame's detected corners. `guessK` = projection-derived intrinsics
   *  (principal point + focal search seed). No-op on a failed homography or a
   *  near-duplicate orientation. Invalidates the cached focal when it accepts. */
  addView(cv: Cv, cornersPx: PixelPoint[], guessK: Intrinsics): void {
    const H = homographyFromCorners(cv, cornersPx)
    if (!H) return
    this.guess = guessK
    const n = viewNormal(H, guessK)
    for (const m of this.normals) {
      const dot = Math.min(1, Math.max(-1, n[0] * m[0] + n[1] * m[1] + n[2] * m[2]))
      if (Math.acos(Math.abs(dot)) < this.minAngleRad) return // too similar — skip
    }
    this.homs.push(H)
    this.normals.push(n)
    this.cached = null
  }

  /** Calibrated intrinsics once `ready`, else null. Cached until a new view is
   *  accepted. Focal searched in [0.4,2.5]× the guess. */
  intrinsics(): Intrinsics | null {
    if (!this.ready || !this.guess) return null
    if (this.cached) return this.cached
    const g = this.guess
    const f = estimateFocal(this.homs, g.cx, g.cy, g.fx * 0.4, g.fx * 2.5)
    this.cached = { fx: f, fy: f, cx: g.cx, cy: g.cy }
    return this.cached
  }
}
