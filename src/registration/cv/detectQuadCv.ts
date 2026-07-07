/**
 * OpenCV.js felt-quad detector — the "advanced" detector for hard conditions
 * (glare, ball clutter, odd felt colour, uneven light) where the pure-JS
 * colour+extreme-point `detectQuad` gives up.
 *
 * Pipeline: sample the felt colour from the image centre (the reticle is
 * centred over the table, so the middle pixels are almost always cloth) →
 * HSV `inRange` mask around that colour → morphological close/open to fill
 * ball/glare holes and drop specks → largest external contour →
 * `approxPolyDP` to a 4-gon, with a `minAreaRect` fallback when the contour
 * won't reduce cleanly to four vertices → rail-line refinement: fit the 4
 * rail edge lines through the dense contour and intersect them, recovering
 * sub-pixel corners even where pockets/balls occlude the physical corner
 * (see railLines.ts; falls back to the rough 4-gon when unsupported).
 *
 * Async because the wasm loads on demand. Returns null on any failure (wasm
 * unavailable, no confident region) so the caller can fall back to the
 * heuristic detector and ultimately to manual corner tapping.
 *
 * Sampling the centre means we're colour-agnostic: it works on green OR blue
 * OR anything, as long as the table centre is felt. If the centre is a ball or
 * glare, detection degrades — that's the documented ceiling.
 */
import type { Mat } from '@techstark/opencv-js'
import { loadOpenCv } from './opencv'
import { orderCorners, type PixelPoint } from './detectQuad'
import {
  fitQuadFromMask,
  isBorderPoint,
  largestQuad,
  refineRailCorners,
  type FittedLine,
} from './railLines'

export interface CvDetection {
  corners: PixelPoint[]
  /** Detected felt area as a fraction of the image (for diagnostics/tuning). */
  coverage: number
  /** Debug-only extras, populated when opts.debug is set (?detect view). */
  rough?: PixelPoint[]
  refined?: boolean
  /** Felt mask as RGBA ImageData (white = felt), for overlaying in debug. */
  mask?: ImageData
  /** Sampled felt hue (OpenCV H, 0..180). */
  hue?: number
  /** Whether the felt is cut off by the image frame (rough vertex or a
   *  meaningful contour fraction on the border). */
  clipped?: boolean
  /** Fitted rail lines from refinement, for the debug overlay. */
  railLines?: FittedLine[]
  /** Why rail refinement failed (debug), if it did. */
  railReason?: string
  /** Raw felt-mask contour (downsampled), for the debug overlay. */
  contour?: PixelPoint[]
}

export interface CvDetectOptions {
  /** Min contour area / image area to accept. */
  minCoverage?: number
  /** Hue half-window (OpenCV H is 0..180) around the sampled felt hue. */
  hueTol?: number
  /** Min saturation (0..255) — reject washed-out glare/grey. */
  minSat?: number
  /** Populate the debug fields on the result (mask, rough quad, hue). */
  debug?: boolean
  /** Felt-colour sample point, fractional 0..1 of image (default centre —
   *  the on-device reticle sits there). Debug view overrides it for photos
   *  where the table isn't centred. */
  sample?: { x: number; y: number }
}

const CV_DEFAULTS = { minCoverage: 0.06, hueTol: 25, minSat: 40, sample: { x: 0.5, y: 0.5 } }

/** Single-channel mask Mat → RGBA overlay for debug. DIMS everything OUTSIDE
 *  the felt (felt shows through, non-felt darkened) — so the mask shape is
 *  visible whatever colour the felt is (a red tint over red felt is invisible). */
function maskToImageData(mask: Mat): ImageData {
  const { rows, cols } = mask
  const src = mask.data // Uint8Array, 1 byte/px
  const out = new Uint8ClampedArray(cols * rows * 4)
  for (let i = 0; i < cols * rows; i++) {
    if (src[i] > 0) {
      out[i * 4 + 3] = 0 // felt → transparent (show the photo)
    } else {
      out[i * 4 + 3] = 165 // non-felt → dim to black
    }
  }
  // Real ImageData (not a duck-typed object): the debug view feeds this to
  // canvas putImageData, which rejects plain objects. Debug path is browser-only.
  return new ImageData(out, cols, rows)
}

export async function detectQuadCv(
  image: ImageData,
  opts: CvDetectOptions = {},
): Promise<CvDetection | null> {
  const o = { ...CV_DEFAULTS, ...opts }
  let cv
  try {
    cv = await loadOpenCv()
  } catch {
    return null
  }

  const { width, height } = image
  // Every allocated Mat goes here so a single finally frees them (opencv.js
  // has no GC — undeleted Mats leak the wasm heap frame after frame).
  const trash: unknown[] = []
  const keep = <T,>(m: T): T => {
    trash.push(m)
    return m
  }

  try {
    const rgba = keep(cv.matFromImageData(image))
    const rgb = keep(new cv.Mat())
    cv.cvtColor(rgba, rgb, cv.COLOR_RGBA2RGB)
    const hsv = keep(new cv.Mat())
    cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV)

    // Sample felt colour from a 20% box around the sample point (centre by
    // default — the reticle sits there on-device). Clamped so the box stays
    // in-frame even when the sample point is near an edge.
    const bw = Math.max(1, Math.round(width * 0.2))
    const bh = Math.max(1, Math.round(height * 0.2))
    const roiRect = new cv.Rect(
      Math.min(width - bw, Math.max(0, Math.round(o.sample.x * width - bw / 2))),
      Math.min(height - bh, Math.max(0, Math.round(o.sample.y * height - bh / 2))),
      bw,
      bh,
    )
    const roi = keep(hsv.roi(roiRect))
    const mean = cv.mean(roi) // [H, S, V, _]
    const hue = mean[0]

    // inRange bounds as full-size scalar Mats (opencv.js wants Mats, not JS
    // arrays). Saturation floored so glare (low-sat near-white) is rejected.
    const low = keep(
      new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [
        Math.max(0, hue - o.hueTol),
        o.minSat,
        40,
        0,
      ]),
    )
    const high = keep(
      new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [
        Math.min(180, hue + o.hueTol),
        255,
        255,
        255,
      ]),
    )
    const mask = keep(new cv.Mat())
    cv.inRange(hsv, low, high, mask)

    // Close ball/glare holes, then open to kill isolated specks. Kernel scales
    // with image size so it behaves the same at any capture resolution.
    const k = Math.max(3, Math.round(Math.min(width, height) / 100))
    // Frame-clip margin: a real clip run sits essentially ON the image edge, so
    // keep this tiny (just the literal border + morphology/AA slop). Too large
    // (e.g. the morphology kernel k) eats rails that merely run CLOSE to the
    // frame — a table can legitimately fill the view to within a few px without
    // being cut off.
    const clipMargin = Math.max(1, Math.round(Math.min(width, height) / 500))
    const kernel = keep(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(k, k)))
    cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, kernel)
    cv.morphologyEx(mask, mask, cv.MORPH_OPEN, kernel)

    const contours = keep(new cv.MatVector())
    const hierarchy = keep(new cv.Mat())
    // CHAIN_APPROX_NONE: rail-line refinement below wants every boundary
    // pixel, not just segment endpoints.
    cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_NONE)

    // Largest contour by area = the felt. Every cnt goes into the trash (never
    // delete inline — a Mat both hand-deleted and in the trash gets a second
    // delete() on the wasm heap in `finally`).
    let bestCnt: Mat | null = null
    let bestArea = 0
    for (let i = 0; i < contours.size(); i++) {
      const cnt = keep(contours.get(i))
      const area = cv.contourArea(cnt)
      if (!bestCnt || area > bestArea) {
        bestCnt = cnt
        bestArea = area
      }
    }
    if (!bestCnt) return null
    const coverage = bestArea / (width * height)
    if (coverage < o.minCoverage) return null

    // Dense contour points, and the INTERIOR subset (drop frame-clip runs). `k`
    // (morphology kernel) doubles as the frame-clip border margin.
    const cd = bestCnt.data32S
    const contourPts: PixelPoint[] = []
    for (let i = 0; i < bestCnt.rows; i++) contourPts.push({ x: cd[i * 2], y: cd[i * 2 + 1] })
    const interiorPts = contourPts.filter((p) => !isBorderPoint(p, width, height, clipMargin))

    // Rough quad (rail-orientation SEED). CONVEX HULL first — every pocket is a
    // concave notch, so the hull bridges them. Hull the INTERIOR points, not the
    // raw contour: a frame-clip run would add hull vertices ON the image border
    // and collapse the corner labeling; bridging the clip gap keeps the rail
    // directions right. Fall back to the full contour if too little survives.
    const hullSrc =
      interiorPts.length >= 8
        ? keep(cv.matFromArray(interiorPts.length, 1, cv.CV_32SC2, interiorPts.flatMap((p) => [Math.round(p.x), Math.round(p.y)])))
        : bestCnt
    const hull = keep(new cv.Mat())
    cv.convexHull(hullSrc, hull, false, true)
    // Simplify the hull a little, then take the 4 vertices maximising area.
    // approxPolyDP alone drops shallow (perspective-flattened) corners before
    // sharp pocket-lip protrusions, so its "first 4" can be a pocket lip + only
    // 3 real corners; max-area selection recovers the true 4 regardless of
    // corner sharpness. minAreaRect (overshoots a tilted felt) is last resort.
    const approx = keep(new cv.Mat())
    const peri = cv.arcLength(hull, true)
    cv.approxPolyDP(hull, approx, 0.015 * peri, true)
    const ad = approx.data32S
    const polyPts: PixelPoint[] = []
    for (let i = 0; i < approx.rows; i++) polyPts.push({ x: ad[i * 2], y: ad[i * 2 + 1] })
    let pts = largestQuad(polyPts)
    if (!pts) pts = cv.boxPoints(cv.minAreaRect(bestCnt)).map((p) => ({ x: p.x, y: p.y }))

    // PRIMARY: fit the 4 rail lines directly from the mask boundary (seed-free
    // sequential RANSAC) and intersect them. Robust to pockets, ball/rack bumps,
    // occlusion and partial clipping; reconstructs off-frame corners. Falls back
    // to the seeded refine (rough quad → assign → fit) only if RANSAC can't find
    // 4 confident rails.
    const railOut: { lines?: FittedLine[]; reason?: string } = {}
    const quad = fitQuadFromMask(contourPts, width, height, {
      borderMargin: clipMargin,
      out: o.debug ? railOut : undefined,
    })
    const refined = quad ?? refineRailCorners(contourPts, pts, width, height, { borderMargin: clipMargin })

    // Is the felt cut off by the frame? Either a rough vertex sits on the
    // border, or a meaningful slice of the contour runs along it.
    const borderPts = contourPts.filter((p) => isBorderPoint(p, width, height, clipMargin)).length
    const clipped =
      borderPts / contourPts.length > 0.02 ||
      pts.some((p) => isBorderPoint(p, width, height, clipMargin))

    // Corner decision:
    //  - rail fit succeeded → use it (may include off-frame corners).
    //  - failed AND clipped → the rough quad is a frame-clip artefact, not the
    //    table; drop the frame (null) so the caller keeps sampling / user pans.
    //    (In debug we keep the rough quad so ?detect can show WHY it dropped.)
    //  - failed AND not clipped → safe in-frame rough fallback.
    let corners: PixelPoint[]
    if (refined) corners = orderCorners(refined)
    else if (clipped && !o.debug) return null
    else corners = orderCorners(pts)

    const dbg = o.debug
      ? {
          rough: orderCorners(pts),
          refined: !!refined,
          mask: maskToImageData(mask),
          hue,
          clipped,
          railLines: railOut.lines,
          railReason: railOut.reason,
          contour: contourPts.filter((_, i) => i % 2 === 0),
        }
      : {}
    return { corners, coverage, ...dbg }
  } catch {
    return null
  } finally {
    for (const m of trash) {
      try {
        ;(m as { delete(): void }).delete()
      } catch {
        /* already freed */
      }
    }
  }
}
