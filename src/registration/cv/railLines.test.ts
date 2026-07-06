import { describe, expect, it } from 'vitest'
import { fitLineTLS, intersectLines, refineRailCorners } from './railLines'
import type { PixelPoint } from './detectQuad'

const W = 640
const H = 480

/** Rotate a point about the image centre. */
function rot(p: PixelPoint, deg: number): PixelPoint {
  const a = (deg * Math.PI) / 180
  const cx = W / 2
  const cy = H / 2
  const dx = p.x - cx
  const dy = p.y - cy
  return {
    x: cx + dx * Math.cos(a) - dy * Math.sin(a),
    y: cy + dx * Math.sin(a) + dy * Math.cos(a),
  }
}

/**
 * Synthetic felt contour for a rectangle with pocket cutouts: dense boundary
 * points along each edge, except near corners where points are pulled INWARD
 * (the pocket arc a real mask produces). This is exactly the failure mode
 * rail-line fitting must survive.
 */
function pocketContour(corners: PixelPoint[], pocketPx: number, deg = 0): PixelPoint[] {
  const pts: PixelPoint[] = []
  for (let e = 0; e < 4; e++) {
    const a = corners[e]
    const b = corners[(e + 1) % 4]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    const n = Math.round(len)
    // Inward normal (corners given clockwise in image space).
    const nx = -(b.y - a.y) / len
    const ny = (b.x - a.x) / len
    for (let i = 0; i <= n; i++) {
      const t = i / n
      const d = t * len
      // Pocket arc: within pocketPx of either corner, pull inward.
      const edgeDist = Math.min(d, len - d)
      const inward = edgeDist < pocketPx ? (pocketPx - edgeDist) * 0.8 : 0
      pts.push(
        rot(
          {
            x: a.x + (b.x - a.x) * t + nx * inward,
            y: a.y + (b.y - a.y) * t + ny * inward,
          },
          deg,
        ),
      )
    }
  }
  return pts
}

// Clockwise in image coords (+y down) so the inward normal above is correct.
const TRUE_CORNERS: PixelPoint[] = [
  { x: 60, y: 40 },
  { x: 560, y: 40 },
  { x: 560, y: 300 },
  { x: 60, y: 300 },
]

/** Rough quad the way approxPolyDP sees a pocket-cut mask: corners pulled inward. */
function roughFrom(corners: PixelPoint[], biasPx: number): PixelPoint[] {
  const cx = corners.reduce((s, p) => s + p.x, 0) / 4
  const cy = corners.reduce((s, p) => s + p.y, 0) / 4
  return corners.map((p) => {
    const d = Math.hypot(p.x - cx, p.y - cy)
    return { x: p.x + ((cx - p.x) / d) * biasPx, y: p.y + ((cy - p.y) / d) * biasPx }
  })
}

describe('fitLineTLS / intersectLines', () => {
  it('fits an exact line and intersects at right angles', () => {
    const horiz = fitLineTLS([...Array(50)].map((_, i) => ({ x: i * 10, y: 100 })))
    const vert = fitLineTLS([...Array(50)].map((_, i) => ({ x: 200, y: i * 8 })))
    const c = intersectLines(horiz, vert)!
    expect(c.x).toBeCloseTo(200, 6)
    expect(c.y).toBeCloseTo(100, 6)
  })

  it('returns null for parallel lines', () => {
    const a = { x: 0, y: 0, vx: 1, vy: 0 }
    const b = { x: 0, y: 10, vx: 1, vy: 0 }
    expect(intersectLines(a, b)).toBeNull()
  })
})

describe('refineRailCorners', () => {
  it('recovers true corners despite pocket cutouts and a biased rough quad', () => {
    const contour = pocketContour(TRUE_CORNERS, 30)
    const rough = roughFrom(TRUE_CORNERS, 20)
    const refined = refineRailCorners(contour, rough, W, H)!
    expect(refined).not.toBeNull()
    refined.forEach((c, i) => {
      expect(Math.abs(c.x - TRUE_CORNERS[i].x)).toBeLessThan(1.5)
      expect(Math.abs(c.y - TRUE_CORNERS[i].y)).toBeLessThan(1.5)
    })
  })

  it('works on a rotated table (extreme-point ordering would fail here)', () => {
    const deg = 30
    const contour = pocketContour(TRUE_CORNERS, 30, deg)
    const rough = roughFrom(TRUE_CORNERS, 20).map((p) => rot(p, deg))
    const truth = TRUE_CORNERS.map((p) => rot(p, deg))
    const refined = refineRailCorners(contour, rough, W, H)!
    expect(refined).not.toBeNull()
    refined.forEach((c, i) => {
      expect(Math.abs(c.x - truth[i].x)).toBeLessThan(1.5)
      expect(Math.abs(c.y - truth[i].y)).toBeLessThan(1.5)
    })
  })

  it('returns null when an edge has too few supporting points', () => {
    // Contour covering only 2 edges.
    const partial = pocketContour(TRUE_CORNERS, 30).filter((p) => p.y < 100)
    expect(refineRailCorners(partial, roughFrom(TRUE_CORNERS, 20), W, H)).toBeNull()
  })
})
