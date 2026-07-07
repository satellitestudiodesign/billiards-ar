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

/** Area of a convex polygon whose vertices are given in angular order. */
function polyArea(pts: PixelPoint[]): number {
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    const q = pts[(i + 1) % pts.length]
    a += p.x * q.y - q.x * p.y
  }
  return Math.abs(a) / 2
}

/** Angular sort about the centroid (cyclic convex order). */
function sortAngular(pts: PixelPoint[]): PixelPoint[] {
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length
  return [...pts].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx))
}

/**
 * Pick the 4 vertices that form the largest-area quadrilateral. A felt hull
 * carries the 4 true corners PLUS pocket-lip protrusions; approxPolyDP tends to
 * keep the sharp pocket lips and drop shallow (perspective-flattened) corners.
 * The 4 true corners maximise enclosed area, so max-area selection recovers
 * them regardless of corner sharpness. Brute force over C(n,4) — n is tiny
 * (hull after approxPolyDP is ~4-12 points).
 */
export function largestQuad(pts: PixelPoint[]): PixelPoint[] | null {
  if (pts.length < 4) return null
  if (pts.length === 4) return sortAngular(pts)
  let best: PixelPoint[] | null = null
  let bestArea = -1
  const n = pts.length
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      for (let k = j + 1; k < n; k++)
        for (let l = k + 1; l < n; l++) {
          const quad = sortAngular([pts[i], pts[j], pts[k], pts[l]])
          const area = polyArea(quad)
          if (area > bestArea) {
            bestArea = area
            best = quad
          }
        }
  return best
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

/** Deterministic LCG — a seeded PRNG so RANSAC gives the SAME result every run
 *  (a detector that flickers frame-to-frame from RNG jitter is worse than one
 *  that's merely wrong). Numerical Recipes constants. */
function makeRng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 0x100000000
  }
}

export interface RailFitOptions {
  /** Inlier band around a candidate line, fraction of image diagonal. */
  inlierFrac?: number
  /** RANSAC iterations per rail. */
  iters?: number
  /** Min inliers to accept a rail. */
  minInliers?: number
  /** Min inlier extent ALONG the rail, fraction of diagonal (see lineSpan). */
  minSpanFrac?: number
  /** Px band at the image edge dropped as frame-clip (not a cushion). */
  borderMargin?: number
  /** How far off-frame a reconstructed corner may sit, fraction of w/h. */
  offFrameFrac?: number
  /** Debug sink: fitted rail lines. */
  out?: { lines?: FittedLine[]; reason?: string }
}

const RAIL_DEFAULTS = {
  inlierFrac: 0.008,
  iters: 400,
  minInliers: 25,
  minSpanFrac: 0.12,
  offFrameFrac: 0.5,
}

/** One RANSAC line: the 2-point model covering the most inliers within `eps`. */
function ransacLine(pts: PixelPoint[], eps: number, iters: number, rng: () => number): PixelPoint[] {
  let bestInliers: PixelPoint[] = []
  const n = pts.length
  if (n < 2) return bestInliers
  for (let it = 0; it < iters; it++) {
    const i = Math.floor(rng() * n)
    let j = Math.floor(rng() * n)
    if (j === i) j = (j + 1) % n
    const a = pts[i]
    const b = pts[j]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.hypot(dx, dy)
    if (len < 1e-6) continue
    const vx = dx / len
    const vy = dy / len
    const inliers: PixelPoint[] = []
    for (const p of pts) {
      // perpendicular distance to the line through a with dir (vx,vy)
      if (Math.abs((p.x - a.x) * vy - (p.y - a.y) * vx) <= eps) inliers.push(p)
    }
    if (inliers.length > bestInliers.length) bestInliers = inliers
  }
  return bestInliers
}

/**
 * Extract the felt quad by fitting its 4 rail LINES directly from the mask
 * boundary — no rough-corner seed. Sequential RANSAC pulls out the 4 dominant
 * straight lines (each rail is hundreds of boundary points; pockets, ball/rack
 * bumps and occlusion are a minority and get ignored), then adjacent rails are
 * intersected to give the 4 corners — which may sit off-frame when a corner is
 * out of view, and back-project fine.
 *
 * This replaces the fragile "find 4 rough corners then assign points to them"
 * approach: it needs no seed and doesn't care which boundary points are corners.
 *
 * @param contour dense felt-mask contour points
 * @returns 4 corners in image-space clockwise order (TL,TR,BR,BL), or null when
 *          fewer than 4 confident rails are visible (caller keeps sampling).
 */
export function fitQuadFromMask(
  contour: PixelPoint[],
  width: number,
  height: number,
  opts: RailFitOptions = {},
): PixelPoint[] | null {
  const o = { ...RAIL_DEFAULTS, ...opts }
  const diag = Math.hypot(width, height)
  const margin = o.borderMargin ?? Math.max(1, Math.round(Math.min(width, height) / 500))
  const eps = diag * o.inlierFrac
  const fail = (why: string): null => {
    if (o.out) o.out.reason = why
    return null
  }

  const interior = contour.filter((p) => !isBorderPoint(p, width, height, margin))
  if (interior.length < o.minInliers * 4) return fail(`too few interior pts (${interior.length})`)

  // Sequential RANSAC: extract 4 rails, removing each rail's inliers before the
  // next so we don't refit the same rail twice.
  const rng = makeRng(0x9e3779b9)
  const lines: FittedLine[] = []
  let remaining = interior
  for (let r = 0; r < 4; r++) {
    if (remaining.length < o.minInliers) return fail(`rail ${r}: only ${remaining.length} pts left`)
    const inliers = ransacLine(remaining, eps, o.iters, rng)
    if (inliers.length < o.minInliers) return fail(`rail ${r}: ${inliers.length} inliers`)

    // Re-collect from ALL interior points (recovers a rail partly stolen by an
    // earlier rail's band), then ITERATIVELY TIGHTEN: refit from a shrinking
    // band so pocket-cutout arcs near the rail ends — which bend away from the
    // straight cushion — get shed. A stray arc point skews the line's ANGLE,
    // and that error is amplified at the far corner, so a clean angle matters.
    let line = fitLineTLS(inliers)
    let band = interior.filter((p) => distToLine(p, line) <= eps)
    line = fitLineTLS(band)
    for (const f of [0.5, 0.3]) {
      const core = interior.filter((p) => distToLine(p, line) <= eps * f)
      if (core.length < o.minInliers) break
      band = core
      line = fitLineTLS(core)
    }
    if (lineSpan(band, line) < diag * o.minSpanFrac) return fail(`rail ${r}: span too short`)
    lines.push(line)
    remaining = remaining.filter((p) => distToLine(p, line) > eps)
  }
  if (o.out) o.out.lines = lines

  // Pair the 4 lines into two opposite-rail sets: opposite rails have the
  // closest directions (both ~parallel even under perspective). Try all 3
  // pairings, pick the one minimising within-pair direction difference.
  const ang = (l: FittedLine) => {
    let a = Math.atan2(l.vy, l.vx)
    if (a < 0) a += Math.PI // fold to [0,π): direction is undirected
    return a
  }
  const angDiff = (i: number, j: number) => {
    const d = Math.abs(ang(lines[i]) - ang(lines[j]))
    return Math.min(d, Math.PI - d)
  }
  const pairings: [[number, number], [number, number]][] = [
    [[0, 1], [2, 3]],
    [[0, 2], [1, 3]],
    [[0, 3], [1, 2]],
  ]
  let bestPairing = pairings[0]
  let bestCost = Infinity
  for (const pr of pairings) {
    const cost = angDiff(pr[0][0], pr[0][1]) + angDiff(pr[1][0], pr[1][1])
    if (cost < bestCost) {
      bestCost = cost
      bestPairing = pr
    }
  }
  const [grpA, grpB] = bestPairing

  // Corners = cross-group intersections (rail from A × rail from B). Each set is
  // the two opposite rails; a corner is where one A-rail meets one B-rail.
  const offX = o.offFrameFrac * width
  const offY = o.offFrameFrac * height
  const corners: PixelPoint[] = []
  for (const ia of grpA) {
    for (const ib of grpB) {
      const c = intersectLines(lines[ia], lines[ib])
      if (!c) return fail('rails parallel')
      if (c.x < -offX || c.x > width + offX || c.y < -offY || c.y > height + offY)
        return fail(`corner off-frame (${c.x.toFixed(0)},${c.y.toFixed(0)})`)
      corners.push(c)
    }
  }
  return orderCornersLocal(corners)
}

/** Centroid-angle clockwise order (TL,TR,BR,BL); local copy to avoid a cycle
 *  with detectQuad — same algorithm as orderCorners there. */
function orderCornersLocal(pts: PixelPoint[]): PixelPoint[] {
  const cx = (pts[0].x + pts[1].x + pts[2].x + pts[3].x) / 4
  const cy = (pts[0].y + pts[1].y + pts[2].y + pts[3].y) / 4
  const cyclic = [...pts].sort(
    (a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx),
  )
  let start = 0
  for (let i = 1; i < 4; i++) {
    if (cyclic[i].x + cyclic[i].y < cyclic[start].x + cyclic[start].y) start = i
  }
  const ordered = [...cyclic.slice(start), ...cyclic.slice(0, start)]
  let area = 0
  for (let i = 0; i < 4; i++) {
    const p = ordered[i]
    const q = ordered[(i + 1) % 4]
    area += p.x * q.y - q.x * p.y
  }
  return area < 0 ? [ordered[0], ordered[3], ordered[2], ordered[1]] : ordered
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
  /** Px band at the image edge treated as frame-clip (not cushion) and dropped
   *  before fitting. Defaults to ~min(w,h)/100 (matches the morphology kernel). */
  borderMargin?: number
  /** Min supporting-point extent ALONG a rail, fraction of image diagonal. A
   *  dense-but-short cluster gives a badly-determined direction; span forces
   *  geometrically-long evidence before we trust the rail's angle. */
  minSpanFrac?: number
  /** How far a reconstructed corner may sit outside the frame, as a fraction of
   *  width/height. Off-frame corners are legit (a table edge left the view) and
   *  back-project fine, but a near-parallel-rail blow-up lands absurdly far out. */
  offFrameFrac?: number
  /** Min |sin(angle)| between adjacent rails. Table corners meet near-square
   *  even in perspective; a tiny angle means an ill-conditioned intersection. */
  minAdjSin?: number
  /** Debug sink: when provided, the final fitted rail lines and (on failure)
   *  a reason string are written here for the ?detect overlay. Not used by the
   *  detection result itself. */
  out?: { lines?: FittedLine[]; reason?: string }
}

const REFINE_DEFAULTS = {
  cornerSkip: 0.12,
  looseDistFrac: 0.03,
  tightDistFrac: 0.01,
  minPoints: 20,
  minSpanFrac: 0.1,
  offFrameFrac: 0.5,
  minAdjSin: 0.15,
}

/** Perpendicular distance from point to infinite line. */
function distToLine(p: PixelPoint, l: FittedLine): number {
  return Math.abs((p.x - l.x) * l.vy - (p.y - l.y) * l.vx)
}

/** True if a point sits within `margin` px of any image edge — i.e. it lies on
 *  a frame-clip run, not a cushion, so it must not feed a rail-line fit. */
export function isBorderPoint(
  p: PixelPoint,
  width: number,
  height: number,
  margin: number,
): boolean {
  return (
    p.x <= margin || p.x >= width - 1 - margin || p.y <= margin || p.y >= height - 1 - margin
  )
}

/** Extent of points projected onto a line's unit direction — how long the
 *  supporting evidence runs along the rail (pins down the rail's angle). */
function lineSpan(pts: PixelPoint[], l: FittedLine): number {
  let lo = Infinity
  let hi = -Infinity
  for (const p of pts) {
    const t = (p.x - l.x) * l.vx + (p.y - l.y) * l.vy
    if (t < lo) lo = t
    if (t > hi) hi = t
  }
  return hi - lo
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
 * Refine a rough quad using the full felt contour — the PRIMARY corner source.
 *
 * @param contour dense contour points (CHAIN_APPROX_NONE order not required)
 * @param rough   4 rough corners in cyclic order (approxPolyDP / boxPoints output)
 * @returns 4 corners in the same cyclic order (some may sit OUTSIDE the image
 *          when a table corner is off-frame — that's legitimate and back-projects
 *          fine), or null when the contour doesn't support a confident 4-line
 *          fit (a whole rail off-frame, too little evidence, or a blow-up).
 *
 * Frame-clip aware. When the table is partly cut off, the mask boundary runs
 * along the image edge; those points are NOT cushion evidence, so they're
 * dropped up front. The rough quad is only a SEED for rail orientation and the
 * along-edge windows — its corners may sit on the frame clip, but its edge
 * DIRECTIONS still point along the true (possibly clipped) rails.
 *
 * Two passes. Pass 1: bucket interior points to the nearest rough edge (middle
 * span only — pocket ends excluded) within a LOOSE gate, TLS-fit a line per
 * rail. Pass 2: re-bucket with a TIGHT gate against the pass-1 lines and refit
 * — sheds side-pocket cuts, ball/rack bumps, glare notches, rough-quad bias.
 * Each rail must have enough points AND enough span. Intersect adjacent rails
 * (corner may be off-frame), then validate angle / off-frame ceiling / edge
 * degeneracy / convexity.
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
  const margin = o.borderMargin ?? Math.max(3, Math.round(Math.min(width, height) / 100))
  const minSpan = diag * o.minSpanFrac

  // Drop frame-clip points: a boundary running along the image edge is where
  // the table left the view, not a cushion. Fitting a rail through it is
  // garbage and biases the true rail. Feed the interior to both passes.
  const interior = contour.filter((p) => !isBorderPoint(p, width, height, margin))

  const fail = (why: string): null => {
    if (o.out) o.out.reason = why
    return null
  }

  // Fit one rail per edge with a count + span gate; null if any rail is too
  // sparse or too short to trust (e.g. a whole rail clipped away, or a sliver).
  const fitRails = (pass: string, maxDist: number, ref?: FittedLine[]): FittedLine[] | null => {
    const groups = assignToEdges(interior, rough, o.cornerSkip, maxDist, ref)
    const lines: FittedLine[] = []
    for (let e = 0; e < 4; e++) {
      if (groups[e].length < o.minPoints) return fail(`${pass}: rail ${e} only ${groups[e].length} pts`)
      const line = fitLineTLS(groups[e])
      const span = lineSpan(groups[e], line)
      if (span < minSpan) return fail(`${pass}: rail ${e} span ${span.toFixed(0)}<${minSpan.toFixed(0)}`)
      lines.push(line)
    }
    return lines
  }

  const coarse = fitRails('p1', diag * o.looseDistFrac)
  if (!coarse) return null
  const lines = fitRails('p2', diag * o.tightDistFrac, coarse)
  if (!lines) return null
  if (o.out) o.out.lines = lines

  // Corner i sits between edge (i-1) and edge i (edge e runs rough[e]→rough[e+1]).
  const offX = o.offFrameFrac * width
  const offY = o.offFrameFrac * height
  const cx = width / 2
  const cy = height / 2
  const refined: PixelPoint[] = []
  for (let i = 0; i < 4; i++) {
    const a = lines[(i + 3) % 4]
    const b = lines[i]
    // Adjacent rails meet near-square even in perspective; a shallow angle is
    // an ill-conditioned intersection that flies off to infinity.
    if (Math.abs(a.vx * b.vy - a.vy * b.vx) < o.minAdjSin) return fail(`corner ${i}: rails near-parallel`)
    const c = intersectLines(a, b)
    if (!c) return fail(`corner ${i}: no intersection`)
    // Off-frame ceiling: a corner may leave the frame, but not absurdly far —
    // that's a blow-up, and a ray that far out grazes/misses the felt plane.
    if (c.x < -offX || c.x > width + offX || c.y < -offY || c.y > height + offY)
      return fail(`corner ${i}: off-frame (${c.x.toFixed(0)},${c.y.toFixed(0)})`)
    if (Math.hypot(c.x - cx, c.y - cy) > 1.5 * diag) return fail(`corner ${i}: too far`)
    refined.push(c)
  }

  // Degeneracy: two corners nearly coincident = collapsed quad (still convex).
  for (let i = 0; i < 4; i++) {
    const a = refined[i]
    const b = refined[(i + 1) % 4]
    if (Math.hypot(b.x - a.x, b.y - a.y) < 10) return fail(`edge ${i} collapsed`)
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
    else if (s !== sign) return fail('non-convex')
  }
  return refined
}
