/**
 * One full detection pass: camera frame → felt quad → world corners of the
 * playing surface, via PnP pose (SOLVEPNP_IPPE) against the known 2:1 model.
 * No AR plane / hit-test is involved — this replaced the drifty plane
 * back-projection. Shared by the registration lock-on loop and the post-anchor
 * continuous refinement.
 *
 * Failure is a reason string (not an exception) so callers can distinguish
 * "this device can't do CV at all" (stop trying) from a transient miss (keep
 * sampling).
 */
import type { WebGLRenderer } from 'three'
import { Vector3 } from 'three'
import { captureCameraFrame } from './captureFrame'
import { detectQuad } from './detectQuad'
import { detectQuadCv } from './detectQuadCv'
import { loadOpenCv } from './opencv'
import { solveTablePose } from './tablePose'

export type DetectFailure = 'no-camera' | 'no-quad' | 'no-pose'

/**
 * Cushion-nose inset. The colour detector segments the FELT CLOTH, whose edge
 * is the top of the cushion where cloth meets the wood rail — ~this far OUTSIDE
 * the cushion nose (the ball-contact line, which is what `fitRectangle`'s
 * PLAYING_LENGTH model expects). Insetting each felt edge inward by this much
 * moves the detected quad onto the nose line, so the fitted table isn't
 * systematically oversized and the size-class RMS stays clean. Fed to
 * `solveTablePose` as the cloth-vs-nose model offset.
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
): Promise<Vector3[] | DetectFailure> {
  const cap = await captureCameraFrame(renderer)
  if (!cap) return 'no-camera'
  const image = downscaleImage(cap.image, MAX_DETECT_WIDTH)

  // Advanced OpenCV detector first; heuristic fallback if it found nothing.
  const cvDet = await detectQuadCv(image)
  const quad = cvDet?.corners ?? detectQuad(image)
  if (!quad) return 'no-quad'

  // PnP needs the OpenCV module for solvePnP; no module ⇒ no CV at all here.
  const cv = await loadOpenCv().catch(() => null)
  if (!cv) return 'no-camera'

  // Intrinsics come from the XRView projection scaled to the DOWNSCALED image
  // the corners are in, so width/height must be the downscaled dimensions.
  const fit = solveTablePose(
    cv,
    quad,
    { projection: cap.projection, view: cap.view, width: image.width, height: image.height },
    { insetM: CUSHION_INSET_M },
  )
  if (!fit) return 'no-pose'
  return fit.best.corners
}
