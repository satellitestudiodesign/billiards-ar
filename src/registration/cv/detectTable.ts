/**
 * One full detection pass: camera frame → felt quad → world corners on the
 * table plane. Shared by the registration lock-on loop and the post-anchor
 * continuous refinement.
 *
 * Failure is a reason string (not an exception) so callers can distinguish
 * "this device can't do CV at all" (stop trying) from a transient miss (keep
 * sampling).
 */
import type { WebGLRenderer } from 'three'
import { Plane, Vector2, Vector3 } from 'three'
import { captureCameraFrame } from './captureFrame'
import { detectQuad } from './detectQuad'
import { detectQuadCv } from './detectQuadCv'
import { cameraFromCapture, projectToPlane } from './projectToPlane'

export type DetectFailure = 'no-camera' | 'no-quad' | 'off-plane'

/**
 * Cushion-nose inset. The colour detector segments the FELT CLOTH, whose edge
 * is the top of the cushion where cloth meets the wood rail — ~this far OUTSIDE
 * the cushion nose (the ball-contact line, which is what `fitRectangle`'s
 * PLAYING_LENGTH model expects). Insetting each felt edge inward by this much
 * moves the detected quad onto the nose line, so the fitted table isn't
 * systematically oversized and the size-class RMS stays clean.
 *
 * Physical constant — a real cushion's cloth-edge-to-nose distance. Tune on
 * device against a known table. // VERIFY vs measured cushion geometry
 */
export const CUSHION_INSET_M = 0.037

/**
 * Detection resolution cap. Full camera frames (~2280×1080 on a Pixel) cost
 * ~60 MB of transient OpenCV Mats per pass — at lock-on frame rates that
 * churn OOM-crashed the tab on-device ("Aw, Snap!"). Colour segmentation and
 * rail-line fitting are perfectly happy at VGA-ish, and the multi-frame
 * consensus recovers the precision. NDC back-projection is resolution-
 * independent (aspect is preserved), so no coordinate scale-back is needed.
 */
const MAX_DETECT_WIDTH = 640

/** Nearest-neighbour downscale to `maxW` wide. Plain object duck-typed as
 *  ImageData so it works in node tests too (detectors/OpenCV only read
 *  data/width/height). */
export function downscaleImage(img: ImageData, maxW: number): ImageData {
  if (img.width <= maxW) return img
  const scale = maxW / img.width
  const w = maxW
  const h = Math.round(img.height * scale)
  const out = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    const sy = Math.min(img.height - 1, Math.round(y / scale))
    for (let x = 0; x < w; x++) {
      const sx = Math.min(img.width - 1, Math.round(x / scale))
      const si = (sy * img.width + sx) * 4
      const di = (y * w + x) * 4
      out[di] = img.data[si]
      out[di + 1] = img.data[si + 1]
      out[di + 2] = img.data[si + 2]
      out[di + 3] = 255
    }
  }
  return { data: out, width: w, height: h, colorSpace: 'srgb' } as ImageData
}

export async function detectTableCorners(
  renderer: WebGLRenderer,
  plane: Plane,
): Promise<Vector3[] | DetectFailure> {
  const cap = await captureCameraFrame(renderer)
  if (!cap) return 'no-camera'
  const image = downscaleImage(cap.image, MAX_DETECT_WIDTH)

  // Advanced OpenCV detector first; heuristic fallback if the wasm didn't
  // load or found nothing.
  const cv = await detectQuadCv(image)
  const quad = cv?.corners ?? detectQuad(image)
  if (!quad) return 'no-quad'

  // Back-project through the exact XRView frustum the image was captured
  // through (fixes the FOV-mismatch bias). Corner pixels are in the
  // downscaled image's coordinates, so pass ITS dimensions for NDC mapping.
  const world = projectToPlane(quad, image.width, image.height, cameraFromCapture(cap), plane)
  if (!world) return 'off-plane'
  // Cloth edge → cushion-nose line, so fitRectangle's playing-surface model lands right.
  return insetToNoseLine(world, plane.normal, CUSHION_INSET_M)
}

/**
 * Move each edge of a coplanar quad inward by `d` (metres) along its in-plane
 * inward normal, re-intersecting adjacent offset edges to get the new corners.
 * Proper polygon inset (not a naive pull-toward-centroid), so it's correct for
 * a non-square perspective quad. Returns the input unchanged if the geometry is
 * degenerate (edges would cross — inset too large for the quad).
 */
export function insetToNoseLine(corners: Vector3[], normal: Vector3, d: number): Vector3[] {
  if (d <= 0) return corners
  // In-plane 2D basis centred on the quad centroid.
  const c = new Vector3()
  for (const p of corners) c.addScaledVector(p, 1 / 4)
  const u = new Vector3().subVectors(corners[1], corners[0]).normalize()
  const v = new Vector3().crossVectors(normal, u).normalize()
  const to2 = (p: Vector3) => {
    const w = new Vector3().subVectors(p, c)
    return new Vector2(w.dot(u), w.dot(v))
  }
  const p2 = corners.map(to2)

  // Inward-offset line per edge i (corners[i] → corners[i+1]).
  const offset = p2.map((a, i) => {
    const b = p2[(i + 1) % 4]
    const dir = new Vector2().subVectors(b, a)
    if (dir.lengthSq() < 1e-9) return null
    dir.normalize()
    const n = new Vector2(-dir.y, dir.x)
    const mid = new Vector2().addVectors(a, b).multiplyScalar(0.5)
    if (n.dot(mid) > 0) n.negate() // point toward the centroid (origin here)
    return { pt: new Vector2().addVectors(a, n.multiplyScalar(d)), dir }
  })
  if (offset.some((o) => !o)) return corners

  // New corner i = intersection of offset edge (i-1) and offset edge i.
  const cross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx
  const out2: Vector2[] = []
  for (let i = 0; i < 4; i++) {
    const l1 = offset[(i + 3) % 4]!
    const l2 = offset[i]!
    const denom = cross(l1.dir.x, l1.dir.y, l2.dir.x, l2.dir.y)
    if (Math.abs(denom) < 1e-6) return corners // parallel adjacent edges — bail
    const dp = new Vector2().subVectors(l2.pt, l1.pt)
    const t = cross(dp.x, dp.y, l2.dir.x, l2.dir.y) / denom
    out2.push(new Vector2().addVectors(l1.pt, l1.dir.clone().multiplyScalar(t)))
  }
  // Sanity: inset must shrink the quad, not invert it.
  if (out2.some((q) => !Number.isFinite(q.x) || !Number.isFinite(q.y))) return corners

  return out2.map((q) => new Vector3().copy(c).addScaledVector(u, q.x).addScaledVector(v, q.y))
}
