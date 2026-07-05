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
 * won't reduce cleanly to four vertices.
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

export interface CvDetection {
  corners: PixelPoint[]
  /** Detected felt area as a fraction of the image (for diagnostics/tuning). */
  coverage: number
}

export interface CvDetectOptions {
  /** Min contour area / image area to accept. */
  minCoverage?: number
  /** Hue half-window (OpenCV H is 0..180) around the sampled felt hue. */
  hueTol?: number
  /** Min saturation (0..255) — reject washed-out glare/grey. */
  minSat?: number
}

const CV_DEFAULTS = { minCoverage: 0.06, hueTol: 25, minSat: 40 }

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

    // Sample felt colour from a central 20% box — the reticle sits here.
    const bw = Math.max(1, Math.round(width * 0.2))
    const bh = Math.max(1, Math.round(height * 0.2))
    const roiRect = new cv.Rect(
      Math.round((width - bw) / 2),
      Math.round((height - bh) / 2),
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
    const kernel = keep(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(k, k)))
    cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, kernel)
    cv.morphologyEx(mask, mask, cv.MORPH_OPEN, kernel)

    const contours = keep(new cv.MatVector())
    const hierarchy = keep(new cv.Mat())
    cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)

    // Largest contour by area = the felt.
    let bestCnt: Mat | null = null
    let bestArea = 0
    for (let i = 0; i < contours.size(); i++) {
      const cnt = contours.get(i)
      const area = cv.contourArea(cnt)
      if (!bestCnt || area > bestArea) {
        if (bestCnt) bestCnt.delete()
        bestCnt = keep(cnt)
        bestArea = area
      } else {
        cnt.delete()
      }
    }
    if (!bestCnt) return null
    const coverage = bestArea / (width * height)
    if (coverage < o.minCoverage) return null

    // Reduce to 4 vertices. approxPolyDP first; if it won't land on 4, fall
    // back to the min-area rotated rectangle (always 4 points).
    const approx = keep(new cv.Mat())
    const peri = cv.arcLength(bestCnt, true)
    cv.approxPolyDP(bestCnt, approx, 0.02 * peri, true)

    let pts: PixelPoint[]
    if (approx.rows === 4) {
      const d = approx.data32S
      pts = [0, 1, 2, 3].map((i) => ({ x: d[i * 2], y: d[i * 2 + 1] }))
    } else {
      pts = cv.boxPoints(cv.minAreaRect(bestCnt)).map((p) => ({ x: p.x, y: p.y }))
    }

    return { corners: orderCorners(pts), coverage }
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
