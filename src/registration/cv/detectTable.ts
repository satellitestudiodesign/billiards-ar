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
import { Plane, Vector3 } from 'three'
import { captureCameraFrame } from './captureFrame'
import { detectQuad } from './detectQuad'
import { detectQuadCv } from './detectQuadCv'
import { cameraFromCapture, projectToPlane } from './projectToPlane'

export type DetectFailure = 'no-camera' | 'no-quad' | 'off-plane'

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
  return world ?? 'off-plane'
}
