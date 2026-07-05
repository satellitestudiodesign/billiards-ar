/**
 * Detect the pool-table playing surface as a quad in a camera image.
 *
 * Pure function, no WebGL/DOM: takes raw RGBA pixels, returns the 4 corner
 * pixel coordinates (or null if no confident felt region). Deliberately
 * dependency-free — the felt is a large, saturated, uniform region, so a
 * colour threshold + extreme-point corner finder is enough for a first cut.
 *
 * ponytail: this is the swappable detector. Interface is `DetectQuad`; if this
 * heuristic proves too fragile on real tables (odd felt colours, glare,
 * heavy ball clutter), drop in an OpenCV.js implementation behind the same
 * signature — the rest of the pipeline (projection, fit) does not change.
 */

/** A point in image pixel coordinates (origin top-left, +y down). */
export interface PixelPoint {
  x: number
  y: number
}

export interface DetectOptions {
  /** Min fraction of pixels that must be felt to accept a detection. */
  minCoverage?: number
  /** Hue window(s) in degrees [0,360) counted as felt. Default: green + blue. */
  hueRanges?: Array<[number, number]>
  /** Min saturation (0..1) and value (0..1) to count as felt (reject grey/dark). */
  minSaturation?: number
  minValue?: number
}

export type DetectQuad = (image: ImageData, opts?: DetectOptions) => PixelPoint[] | null

const DEFAULTS = {
  minCoverage: 0.06,
  // Cloth is typically tournament blue or green. Wide windows on purpose.
  hueRanges: [
    [80, 170], // green
    [170, 260], // blue
  ] as Array<[number, number]>,
  minSaturation: 0.25,
  minValue: 0.12,
}

function hueInRanges(h: number, ranges: Array<[number, number]>): boolean {
  for (const [lo, hi] of ranges) if (h >= lo && h <= hi) return true
  return false
}

/** RGB (0..255) → hue degrees [0,360), sat/val in 0..1. */
function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  const s = max === 0 ? 0 : d / max
  return [h, s, max]
}

/**
 * Find the 4 corners of the largest felt region via extreme sums/differences:
 * a convex quad's corners are the points minimising/maximising x+y and x−y.
 * Order returned: top-left, top-right, bottom-right, bottom-left (image space).
 */
export const detectQuad: DetectQuad = (image, opts = {}) => {
  const o = { ...DEFAULTS, ...opts }
  const { data, width, height } = image

  let count = 0
  // Extremes seeded to opposite infinities.
  let tl = { s: Infinity, p: { x: 0, y: 0 } } // min x+y
  let br = { s: -Infinity, p: { x: 0, y: 0 } } // max x+y
  let tr = { s: -Infinity, p: { x: 0, y: 0 } } // max x−y
  let bl = { s: Infinity, p: { x: 0, y: 0 } } // min x−y

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const [h, s, v] = rgbToHsv(data[i], data[i + 1], data[i + 2])
      if (s < o.minSaturation || v < o.minValue || !hueInRanges(h, o.hueRanges)) continue
      count++
      const sum = x + y
      const diff = x - y
      if (sum < tl.s) tl = { s: sum, p: { x, y } }
      if (sum > br.s) br = { s: sum, p: { x, y } }
      if (diff > tr.s) tr = { s: diff, p: { x, y } }
      if (diff < bl.s) bl = { s: diff, p: { x, y } }
    }
  }

  if (count / (width * height) < o.minCoverage) return null
  return [tl.p, tr.p, br.p, bl.p]
}
