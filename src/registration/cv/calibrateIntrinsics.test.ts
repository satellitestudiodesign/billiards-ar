import { createRequire } from 'module'
import { beforeAll, describe, expect, it } from 'vitest'
import { estimateFocal, homographyFromCorners, IntrinsicsCalibrator } from './calibrateIntrinsics'
import type { Intrinsics } from './tablePose'
import type { PixelPoint } from './detectQuad'

// Same 2:1 model the module uses internally, to synthesise views.
const MODEL: [number, number][] = [
  [1, 0.5],
  [1, -0.5],
  [-1, -0.5],
  [-1, 0.5],
]

/** 3x3 rotation from yaw (about Y) then pitch (about X), row-major. */
function rot(yaw: number, pitch: number): number[] {
  const cy = Math.cos(yaw)
  const sy = Math.sin(yaw)
  const cx = Math.cos(pitch)
  const sx = Math.sin(pitch)
  // Ry(yaw) · Rx(pitch)
  return [
    cy, sy * sx, sy * cx,
    0, cx, -sx,
    -sy, cy * sx, cy * cx,
  ]
}

/** Homography H = K·[r1 r2 t] (row-major 9) for a plane view. */
function buildH(k: Intrinsics, yaw: number, pitch: number, t: [number, number, number]): number[] {
  const R = rot(yaw, pitch)
  const r1 = [R[0], R[3], R[6]]
  const r2 = [R[1], R[4], R[7]]
  // M = [r1 r2 t] (3x3, columns), then K·M.
  const M = [
    r1[0], r2[0], t[0],
    r1[1], r2[1], t[1],
    r1[2], r2[2], t[2],
  ]
  const K = [k.fx, 0, k.cx, 0, k.fy, k.cy, 0, 0, 1]
  const H = new Array(9).fill(0)
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      for (let n = 0; n < 3; n++) H[i * 3 + j] += K[i * 3 + n] * M[n * 3 + j]
  return H
}

/** Project the 2:1 model corners through H → image pixels. */
function cornersThrough(H: number[]): PixelPoint[] {
  return MODEL.map(([x, y]) => {
    const w = H[6] * x + H[7] * y + H[8]
    return { x: (H[0] * x + H[1] * y + H[2]) / w, y: (H[3] * x + H[4] * y + H[5]) / w }
  })
}

const TRUE: Intrinsics = { fx: 500, fy: 500, cx: 320, cy: 240 }
// A spread of orientations (Zhang needs orientation variety).
const VIEWS: { yaw: number; pitch: number; t: [number, number, number] }[] = [
  { yaw: -0.5, pitch: 0.9, t: [0.2, 0.1, 5] },
  { yaw: -0.2, pitch: 1.1, t: [-0.1, 0.0, 6] },
  { yaw: 0.1, pitch: 0.8, t: [0.0, 0.2, 5.5] },
  { yaw: 0.4, pitch: 1.0, t: [0.15, -0.1, 5.2] },
  { yaw: 0.7, pitch: 0.7, t: [-0.2, 0.1, 6.5] },
  { yaw: 0.0, pitch: 1.2, t: [0.0, 0.0, 4.8] },
]

describe('estimateFocal', () => {
  it('recovers the true focal from varied planar views (exact input)', () => {
    const homs = VIEWS.map((v) => buildH(TRUE, v.yaw, v.pitch, v.t))
    const f = estimateFocal(homs, TRUE.cx, TRUE.cy, 200, 1000)
    expect(f).toBeCloseTo(TRUE.fx, -0.5) // within ~1%
    expect(Math.abs(f - TRUE.fx) / TRUE.fx).toBeLessThan(0.01)
  })
})

describe('IntrinsicsCalibrator', () => {
  let cv: any
  beforeAll(async () => {
    const require = createRequire(import.meta.url)
    cv = await require('@techstark/opencv-js')
  }, 60000)

  it('round-trips a homography from corners', () => {
    const H = buildH(TRUE, 0.3, 0.9, [0.1, 0.0, 5])
    const corners = cornersThrough(H)
    const Hr = homographyFromCorners(cv, corners)
    expect(Hr).not.toBeNull()
    // Homographies are up to scale — compare after normalising by H[8].
    const norm = (m: number[]) => m.map((v) => v / m[8])
    const a = norm(H)
    const b = norm(Hr as number[])
    for (let i = 0; i < 9; i++) expect(b[i]).toBeCloseTo(a[i], 3)
  })

  it('rejects near-duplicate views and calibrates once distinct views arrive', () => {
    const cal = new IntrinsicsCalibrator(5, (10 * Math.PI) / 180)
    // A biased focal guess (the projection-matrix guess), +12%.
    const guess: Intrinsics = { fx: TRUE.fx * 1.12, fy: TRUE.fy * 1.12, cx: TRUE.cx, cy: TRUE.cy }

    const first = cornersThrough(buildH(TRUE, VIEWS[0].yaw, VIEWS[0].pitch, VIEWS[0].t))
    cal.addView(cv, first, guess)
    cal.addView(cv, first, guess) // identical orientation → rejected
    expect(cal.views).toBe(1)
    expect(cal.ready).toBe(false)
    expect(cal.intrinsics()).toBeNull()

    for (let i = 1; i < VIEWS.length; i++) {
      const c = cornersThrough(buildH(TRUE, VIEWS[i].yaw, VIEWS[i].pitch, VIEWS[i].t))
      cal.addView(cv, c, guess)
    }
    expect(cal.ready).toBe(true)
    const k = cal.intrinsics()
    expect(k).not.toBeNull()
    // Calibration recovers the true focal despite the +12% guess.
    expect(Math.abs((k as Intrinsics).fx - TRUE.fx) / TRUE.fx).toBeLessThan(0.02)
    expect((k as Intrinsics).cx).toBe(guess.cx) // principal point kept from guess
  })
})
