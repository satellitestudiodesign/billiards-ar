/**
 * Rail-line corner refinement: recover the felt quad's true corners from the
 * felt contour by fitting the 4 rail edge LINES and intersecting them.
 *
 * Why not use the contour's own corner vertices? Pockets. The physical corner
 * of the playing surface (where the cushion noses meet) sits inside a pocket
 * cutout, so `approxPolyDP`/`minAreaRect` vertices land on the pocket arc —
 * a centimetre-level bias, every time. Each rail edge, though, is hundreds of
 * clean contour pixels; a total-least-squares line through them is sub-pixel,
 * and intersecting adjacent rail lines reconstructs the occluded corner even
 * when the corner region itself is pocket, ball, or a player's arm.
 *
 * Pure math, no OpenCV — testable in vitest without the wasm.
 */
import type { PixelPoint } from './detectQuad'

/** Infinite 2D line: point (x, y) + unit direction (vx, vy). */
export interface FittedLine {
  x: number
  y: number
  vx: number
  vy: number
}

/** Total-least-squares line through points (major axis of the covariance). */
export function fitLineTLS(pts: PixelPoint[]): FittedLine {
  let mx = 0
  let my = 0
  for (const p of pts) {
    mx += p.x
    my += p.y
  }
  mx /= pts.length
  my /= pts.length
  let sxx = 0
  let sxy = 0
  let syy = 0
  for (const p of pts) {
    const dx = p.x - mx
    const dy = p.y - my
    sxx += dx * dx
    sxy += dx * dy
    syy += dy * dy
  }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy)
  return { x: mx, y: my, vx: Math.cos(theta), vy: Math.sin(theta) }
}

/** Intersection of two infinite lines, or null if near-parallel. */
export function intersectLines(a: FittedLine, b: FittedLine): PixelPoint | null {
  const det = a.vx * b.vy - a.vy * b.vx
  if (Math.abs(det) < 1e-9) return null
  const t = ((b.x - a.x) * b.vy - (b.y - a.y) * b.vx) / det
  return { x: a.x + t * a.vx, y: a.y + t * a.vy }
}

export interface RefineOptions {
  /** Fraction of each rough edge excluded at both ends (corner-pocket zones). */
  cornerSkip?: number
  /** Pass-1 gate: max point-to-ROUGH-edge distance, fraction of image diagonal.
   *  Loose — the rough quad's edges can sit noticeably off the true rails. */
  looseDistFrac?: number
  /** Pass-2 gate: max point-to-FITTED-line distance, fraction of image diagonal.
   *  Tight — re-fit only from points hugging the pass-1 line. */
  tightDistFrac?: number
  /** Min contour points per rail line to trust the fit. */
  minPoints?: number
}

const REFINE_DEFAULTS = {
  cornerSkip: 0.12,
  looseDistFrac: 0.03,
  tightDistFrac: 0.01,
  minPoints: 20,
}

/** Perpendicular distance from point to infinite line. */
function distToLine(p: PixelPoint, l: FittedLine): number {
  return Math.abs((p.x - l.x) * l.vy - (p.y - l.y) * l.vx)
}

/**
 * Bucket contour points by rail edge. The rough quad supplies the along-edge
 * window (t, excluding pocket ends); the distance gate is measured against
 * `lines` when given (pass 2), else against the rough edge itself (pass 1).
 */
function assignToEdges(
  contour: PixelPoint[],
  rough: PixelPoint[],
  cornerSkip: number,
  maxDist: number,
  lines?: FittedLine[],
): PixelPoint[][] {
  const groups: PixelPoint[][] = [[], [], [], []]
  for (const p of contour) {
    let bestEdge = -1
    let bestDist = Infinity
    for (let e = 0; e < 4; e++) {
      const a = rough[e]
      const b = rough[(e + 1) % 4]
      const ex = b.x - a.x
      const ey = b.y - a.y
      const len2 = ex * ex + ey * ey
      if (len2 === 0) continue
      const t = ((p.x - a.x) * ex + (p.y - a.y) * ey) / len2
      if (t < cornerSkip || t > 1 - cornerSkip) continue
      const dist = lines
        ? distToLine(p, lines[e])
        : Math.hypot(p.x - (a.x + t * ex), p.y - (a.y + t * ey))
      if (dist < bestDist) {
        bestDist = dist
        bestEdge = e
      }
    }
    if (bestEdge >= 0 && bestDist <= maxDist) groups[bestEdge].push(p)
  }
  return groups
}

/**
 * Refine a rough quad using the full felt contour.
 *
 * @param contour dense contour points (CHAIN_APPROX_NONE order not required)
 * @param rough   4 rough corners in cyclic order (approxPolyDP / boxPoints output)
 * @returns 4 refined corners in the same cyclic order, or null when the
 *          contour doesn't support a confident 4-line fit (caller keeps rough).
 *
 * Two passes. Pass 1: bucket contour points to the nearest rough edge (middle
 * span only — pocket ends excluded) within a LOOSE distance gate, TLS-fit a
 * line per rail. Pass 2: re-bucket with a TIGHT gate measured against the
 * pass-1 lines and refit — this sheds side-pocket cuts, occlusion bumps and
 * any bias the rough quad had. Intersect adjacent lines, sanity-check.
 */
export function refineRailCorners(
  contour: PixelPoint[],
  rough: PixelPoint[],
  width: number,
  height: number,
  opts: RefineOptions = {},
): PixelPoint[] | null {
  if (rough.length !== 4) return null
  const o = { ...REFINE_DEFAULTS, ...opts }
  const diag = Math.hypot(width, height)

  const pass1 = assignToEdges(contour, rough, o.cornerSkip, diag * o.looseDistFrac)
  const coarse: FittedLine[] = []
  for (let e = 0; e < 4; e++) {
    if (pass1[e].length < o.minPoints) return null
    coarse.push(fitLineTLS(pass1[e]))
  }

  const pass2 = assignToEdges(contour, rough, o.cornerSkip, diag * o.tightDistFrac, coarse)
  const lines: FittedLine[] = []
  for (let e = 0; e < 4; e++) {
    if (pass2[e].length < o.minPoints) return null
    lines.push(fitLineTLS(pass2[e]))
  }

  // Corner i sits between edge (i-1) and edge i (edge e runs rough[e]→rough[e+1]).
  const refined: PixelPoint[] = []
  for (let i = 0; i < 4; i++) {
    const c = intersectLines(lines[(i + 3) % 4], lines[i])
    // Blow-up guard: near-parallel lines or a wild intersection far from the
    // rough corner means the fit is untrustworthy — keep the rough quad.
    if (!c || Math.hypot(c.x - rough[i].x, c.y - rough[i].y) > diag * 0.1) return null
    refined.push(c)
  }

  // Convexity check: consistent cross-product sign around the quad.
  let sign = 0
  for (let i = 0; i < 4; i++) {
    const a = refined[i]
    const b = refined[(i + 1) % 4]
    const c = refined[(i + 2) % 4]
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
    if (cross === 0) continue
    const s = Math.sign(cross)
    if (sign === 0) sign = s
    else if (s !== sign) return null
  }
  return refined
}
