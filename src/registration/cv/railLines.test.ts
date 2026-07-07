import { describe, expect, it } from 'vitest'
import {
  fitLineTLS,
  fitQuadFromMask,
  intersectLines,
  isBorderPoint,
  largestQuad,
  refineRailCorners,
} from './railLines'
import type { PixelPoint } from './detectQuad'

const W = 640
const H = 480

/** Dense (~1px) point run from a to b, inclusive. */
function seg(a: PixelPoint, b: PixelPoint): PixelPoint[] {
  const n = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y)))
  const out: PixelPoint[] = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
  }
  return out
}

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

describe('largestQuad', () => {
  const key = (p: PixelPoint) => `${p.x},${p.y}`
  it('picks the 4 corners over pocket-lip protrusions', () => {
    const corners = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 60 },
      { x: 0, y: 60 },
    ]
    // Two pocket lips protruding slightly outside edge midpoints.
    const lips = [
      { x: 50, y: -5 },
      { x: 105, y: 30 },
    ]
    const got = largestQuad([...corners, ...lips])!
    expect(new Set(got.map(key))).toEqual(new Set(corners.map(key)))
  })

  it('returns the 4 points as-is when given exactly 4, null when fewer', () => {
    const four = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]
    expect(new Set(largestQuad(four)!.map(key))).toEqual(new Set(four.map(key)))
    expect(largestQuad(four.slice(0, 3))).toBeNull()
  })
})

describe('isBorderPoint', () => {
  it('flags points within the margin of any image edge', () => {
    expect(isBorderPoint({ x: 3, y: 200 }, W, H, 5)).toBe(true) // left
    expect(isBorderPoint({ x: W - 2, y: 200 }, W, H, 5)).toBe(true) // right
    expect(isBorderPoint({ x: 200, y: 4 }, W, H, 5)).toBe(true) // top
    expect(isBorderPoint({ x: 200, y: H - 1 }, W, H, 5)).toBe(true) // bottom
    expect(isBorderPoint({ x: 200, y: 200 }, W, H, 5)).toBe(false) // interior
  })
})

describe('fitQuadFromMask — seed-free rail extraction', () => {
  it('reconstructs a full quad, ignoring a side-pocket notch and an off-frame corner', () => {
    const TL = { x: 100, y: 60 }
    const TR = { x: 560, y: 60 }
    const BR = { x: 560, y: 400 }
    const BL = { x: -40, y: 400 } // off-frame
    const leftCross = { x: 0, y: BL.y + (TL.y - BL.y) * ((0 - BL.x) / (TL.x - BL.x)) }
    const nearMid = { x: 280, y: 392 } // side-pocket notch pulling the near rail inward
    const contour = [
      ...seg(TL, TR),
      ...seg(TR, BR),
      ...seg(BR, { x: 280, y: 400 }),
      ...seg({ x: 280, y: 400 }, nearMid),
      ...seg(nearMid, { x: 281, y: 400 }),
      ...seg({ x: 281, y: 400 }, { x: 0, y: 400 }),
      ...seg({ x: 0, y: 400 }, leftCross), // frame clip
      ...seg(leftCross, TL),
    ]
    const q = fitQuadFromMask(contour, W, H)!
    expect(q).not.toBeNull()
    const truth = [TL, TR, BR, BL]
    q.forEach((c, i) => {
      expect(Math.abs(c.x - truth[i].x)).toBeLessThan(3)
      expect(Math.abs(c.y - truth[i].y)).toBeLessThan(3)
    })
    expect(q[3].x).toBeLessThan(0) // BL reconstructed off-frame
  })

  it('returns null when fewer than 4 rails are present', () => {
    // Only 3 sides (top, right, bottom) — left rail absent.
    const contour = [
      ...seg({ x: 60, y: 40 }, { x: 560, y: 40 }),
      ...seg({ x: 560, y: 40 }, { x: 560, y: 300 }),
      ...seg({ x: 560, y: 300 }, { x: 60, y: 300 }),
    ]
    expect(fitQuadFromMask(contour, W, H)).toBeNull()
  })
})

describe('refineRailCorners — frame-clipped tables', () => {
  // A table whose bottom-LEFT corner is off-frame (x<0). The visible felt
  // boundary runs: top rail, right rail, bottom rail (to x=0), a vertical
  // FRAME-CLIP run down the left border, then the visible part of the left
  // rail up to the top-left corner. The rough quad clamps the off-frame corner
  // to the frame edge (0,400), as convexHull/approxPolyDP would.
  const TL = { x: 100, y: 60 }
  const TR = { x: 560, y: 60 }
  const BR = { x: 560, y: 400 }
  const BL = { x: -40, y: 400 } // off-frame
  const leftCross = { x: 0, y: BL.y + (TL.y - BL.y) * ((0 - BL.x) / (TL.x - BL.x)) }
  const ROUGH = [TL, TR, BR, { x: 0, y: 400 }]

  function clippedContour(leftVisible: PixelPoint[]): PixelPoint[] {
    return [
      ...seg(TL, TR), // top rail
      ...seg(TR, BR), // right rail
      ...seg(BR, { x: 0, y: 400 }), // bottom rail, visible part
      ...seg({ x: 0, y: 400 }, leftCross), // FRAME CLIP along x=0 (must be ignored)
      ...leftVisible, // visible part of the left rail
    ]
  }

  it('reconstructs the off-frame corner by intersecting the visible rails', () => {
    const refined = refineRailCorners(clippedContour(seg(leftCross, TL)), ROUGH, W, H)!
    expect(refined).not.toBeNull()
    // The frame-clip run must NOT bias the fit: BL comes back off-frame near true.
    expect(refined[3].x).toBeLessThan(0)
    expect(Math.abs(refined[3].x - BL.x)).toBeLessThan(3)
    expect(Math.abs(refined[3].y - BL.y)).toBeLessThan(3)
    // In-frame corners stay put.
    expect(Math.abs(refined[0].x - TL.x)).toBeLessThan(2)
    expect(Math.abs(refined[2].x - BR.x)).toBeLessThan(2)
  })

  it('returns null when a whole rail is off-frame (only 3 rails visible)', () => {
    // No visible left rail at all — clip run covers the entire left border.
    const contour = [
      ...seg(TL, TR),
      ...seg(TR, BR),
      ...seg(BR, { x: 0, y: 400 }),
      ...seg({ x: 0, y: 400 }, { x: 0, y: 60 }),
      ...seg({ x: 0, y: 60 }, TL),
    ]
    expect(refineRailCorners(contour, ROUGH, W, H)).toBeNull()
  })

  it('returns null when a rail is only a short sliver (span gate)', () => {
    // Left rail present but only ~15px visible — direction is under-constrained.
    const sliver = seg(leftCross, TL).slice(-15)
    expect(refineRailCorners(clippedContour(sliver), ROUGH, W, H)).toBeNull()
  })
})
