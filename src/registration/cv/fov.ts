/**
 * Field-of-view ↔ focal conversions.
 *
 * No per-device FOV database exists (GSMArena/DxOMark publish only the 35mm-
 * equivalent focal, and bot-block bulk scraping). FOV is a one-line function of
 * that focal, so we derive it instead of tabulating it. Two uses:
 *   - seed the pose pipeline with a sensible K before self-calibration, from a
 *     default FOV or a device's advertised focal-equiv;
 *   - report the FOV implied by a (guessed or calibrated) K for debug overlays.
 *
 * The 35mm-equivalent focal `f_equiv` is defined against the full-frame 36×24mm
 * frame, so FOV about an axis of length `dim_mm` is 2·atan(dim / (2·f_equiv)).
 * Actual horizontal/vertical FOV depends on the phone's capture aspect ratio,
 * which the equiv-focal alone can't tell you — but the diagonal is exact and the
 * H/V below assume the standard 3:2 full-frame frame (good enough for a seed).
 */
import type { Intrinsics } from './tablePose'

const FF_W = 36 // full-frame sensor width (mm)
const FF_H = 24 // full-frame sensor height (mm)
const FF_DIAG = Math.hypot(FF_W, FF_H) // ≈ 43.27mm
const DEG = 180 / Math.PI

/** FOV (degrees) about horizontal, vertical, and diagonal axes for a 35mm-
 *  equivalent focal length. Most phone main cameras are ~24-26mm → ~70-75° H. */
export function fovFromFocalEquiv(fEquivMm: number): { h: number; v: number; diag: number } {
  const fov = (dim: number) => 2 * Math.atan(dim / (2 * fEquivMm)) * DEG
  return { h: fov(FF_W), v: fov(FF_H), diag: fov(FF_DIAG) }
}

/** Inverse: the 35mm-equivalent focal that gives a given horizontal FOV. */
export function focalEquivFromHFov(hFovDeg: number): number {
  return FF_W / (2 * Math.tan((hFovDeg / DEG) / 2))
}

/** Seed intrinsics from a known horizontal FOV and image size. Square pixels
 *  (fx=fy), principal point centred — the usual assumption before calibration
 *  refines it. Feed this to IntrinsicsCalibrator as the focal search seed. */
export function intrinsicsFromHFov(hFovDeg: number, widthPx: number, heightPx: number): Intrinsics {
  const fx = widthPx / 2 / Math.tan((hFovDeg / DEG) / 2)
  return { fx, fy: fx, cx: widthPx / 2, cy: heightPx / 2 }
}
