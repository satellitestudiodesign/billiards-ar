/**
 * PnP table-pose registration — replacement for the AR-plane back-projection
 * in `projectToPlane.ts`.
 *
 * Given the 4 detected rail corners (from `detectQuadCv`/`railLines`, image
 * pixels, order [TL, TR, BR, BL]) and the capture-time camera intrinsics, solve
 * the full 6-DoF table pose with OpenCV `SOLVEPNP_IPPE` (the planar-4-point
 * solver) against the known 2:1 playing-surface model. NO AR plane / hit-test
 * is used — this is the whole reason it can beat the drifty plane approach.
 *
 * Output is a `RectFit` (same as manual taps), so it feeds the existing anchor
 * / render / drill pipeline unchanged.
 *
 * ⚠️ TWO on-device calibration risks (verify on a real table, see VERIFY):
 *  1. INTRINSICS: `intrinsicsFromProjection` derives fx/fy/cx/cy from the
 *     XRView projection matrix + the raw-camera image size. If WebXR's raw
 *     camera image reports a different FOV/aspect than the render view (the
 *     same caveat `projectToPlane.ts` and `captureFrame.ts` already flag),
 *     these intrinsics are biased and the pose skews. If corners reproject
 *     biased along one axis, this is why. Upgrade: use real XRView camera
 *     intrinsics if/when the platform exposes them.
 *  2. FRAME FLIP: OpenCV camera frame is +x right, +y DOWN, +z FORWARD; the
 *     WebXR/three camera frame is +y UP, +z BACKWARD. `poseToWorld` applies
 *     diag(1,-1,-1). If the overlay lands mirrored / upside down, this flip is
 *     the suspect (same class of bug flagged in the native repo's TablePose).
 */
import { Matrix4, Quaternion, Vector3 } from 'three'
import type { PixelPoint } from './detectQuad'
import { PLAYING_LENGTH, type RectFit, type SizeClass } from '../fitRectangle'

/** Pinhole intrinsics in OpenCV pixel convention (origin top-left, +y down). */
export interface Intrinsics {
  fx: number
  fy: number
  cx: number
  cy: number
}

export interface PnpFit extends RectFit {
  /** Reprojection RMS of the 4 corners, PIXELS — the real quality gate here.
   *  (RectFit.rms is an approximate metric-space conversion for the shared
   *  ambiguity check; trust reprojRmsPx for accuracy.) */
  reprojRmsPx: number
}

/**
 * Derive OpenCV intrinsics from a GL/WebXR column-major projection matrix and
 * the image size the corners were detected in.
 *
 * Standard symmetric-ish GL perspective:
 *   m0 = 2·fx/W,  m5 = 2·fy/H,  m8 = (r+l)/(r-l),  m9 = (t+b)/(t-b)
 * Image y is flipped vs GL y-up, hence the +m9 in cy. Centered frustum
 * (m8=m9=0) gives cx=W/2, cy=H/2.
 */
export function intrinsicsFromProjection(
  projection: number[],
  width: number,
  height: number,
): Intrinsics {
  const m0 = projection[0]
  const m5 = projection[5]
  const m8 = projection[8]
  const m9 = projection[9]
  return {
    fx: (m0 * width) / 2,
    fy: (m5 * height) / 2,
    cx: ((1 - m8) * width) / 2,
    cy: ((1 + m9) * height) / 2,
  }
}

const FLIP = new Matrix4().makeScale(1, -1, -1) // OpenCV cam frame -> GL cam frame

/**
 * Convert a solvePnP result (object->camera, OpenCV frame) plus the capture's
 * camera-to-world matrix into a world-space table pose.
 *
 * @param rot9  Rodrigues 3x3 rotation object->cv-camera, ROW-MAJOR (cv.Mat data order).
 * @param tvec  translation object->cv-camera, meters.
 * @param view  XRView pose = camera-to-world, COLUMN-MAJOR 16 (cap.view).
 */
export function poseToWorld(
  rot9: ArrayLike<number>,
  tvec: [number, number, number],
  view: number[],
): { quaternion: Quaternion; center: Vector3; rotation: Matrix4 } {
  // object->cv-camera as a 4x4 (three.js Matrix4.set is ROW-MAJOR args).
  const objToCam = new Matrix4().set(
    rot9[0], rot9[1], rot9[2], tvec[0],
    rot9[3], rot9[4], rot9[5], tvec[1],
    rot9[6], rot9[7], rot9[8], tvec[2],
    0, 0, 0, 1,
  )
  const camToWorld = new Matrix4().fromArray(view) // fromArray = column-major
  // table->world = camToWorld · FLIP · objToCam
  const tableToWorld = new Matrix4().multiplyMatrices(camToWorld, FLIP).multiply(objToCam)

  const center = new Vector3()
  const quaternion = new Quaternion()
  const scale = new Vector3()
  tableToWorld.decompose(center, quaternion, scale)
  return { quaternion, center, rotation: tableToWorld }
}

/** Rectangle corners in table-local frame (+X long, +Y up, +Z short), on the
 *  plane y=0. `insetM` grows every edge outward by that much: 0 gives the
 *  cushion-nose playing surface (the model fitRectangle uses); the cushion
 *  inset gives the CLOTH-edge rectangle the felt detector actually sees.
 *  Winding is clockwise seen from above so it matches the image [TL,TR,BR,BL]
 *  winding; the 4 cyclic rotations tried in solveTablePose cover which
 *  physical corner is "TL". */
function modelCorners(sizeClass: SizeClass, insetM = 0): Vector3[] {
  const hl = PLAYING_LENGTH[sizeClass] / 2 + insetM
  const hw = PLAYING_LENGTH[sizeClass] / 4 + insetM // nose surface is 2:1; inset adds to both
  return [
    new Vector3(hl, 0, hw),
    new Vector3(hl, 0, -hw),
    new Vector3(-hl, 0, -hw),
    new Vector3(-hl, 0, hw),
  ]
}

function rotate<T>(arr: T[], by: number): T[] {
  return arr.map((_, i) => arr[(i + by) % arr.length])
}

const SIZE_CLASSES: SizeClass[] = ['7ft', '8ft', '9ft']

export interface CapturePose {
  /** XRView projection matrix, column-major 16. */
  projection: number[]
  /** XRView pose = camera-to-world, column-major 16. */
  view: number[]
  /** Raw camera image size the corners were detected in. */
  width: number
  height: number
}

/**
 * Solve the table pose from 4 detected rail corners. Tries every size class ×
 * every cyclic corner assignment, keeps the lowest reprojection RMS whose
 * table normal points up in world space (cheap gravity check — WebXR world is
 * y-up, a real table is horizontal, so a solution tilted away is the spurious
 * IPPE twin). Returns the best fit + all fits sorted, or null if none is sane.
 *
 * @param cv        loaded OpenCV.js module (await loadOpenCv()).
 * @param cornersPx 4 image corners, order [TL,TR,BR,BL] (detectQuadCv output).
 */
export function solveTablePose(
  cv: any,
  cornersPx: PixelPoint[],
  cap: CapturePose,
  opts: {
    maxReprojRmsPx?: number
    insetM?: number
    intrinsics?: Intrinsics
    /** Skip the "table normal points world-up" gravity filter. Needed when
     *  there is NO real world frame (a still photo solved with an identity
     *  view): the two IPPE planar twins differ only in out-of-plane normal and
     *  reproject the 4 corners + coplanar model IDENTICALLY, so a 2D overlay is
     *  unaffected, but the gravity check would reject both and yield no pose.
     *  Never set on the live AR path — there gravity disambiguates the twin. */
    skipGravityCheck?: boolean
  } = {},
): { best: PnpFit; all: PnpFit[] } | null {
  if (cornersPx.length !== 4) return null
  const maxRms = opts.maxReprojRmsPx ?? 8
  // The felt detector sees the CLOTH edge, ~insetM outside the cushion nose.
  // Solve pose against the cloth-sized model so the correspondence is honest;
  // report the nose-sized playing surface at the same pose (concentric).
  const insetM = opts.insetM ?? 0
  // Prefer explicit (self-calibrated) intrinsics over the projection-matrix
  // guess — the guess's focal bias is the dominant on-screen error (see
  // calibrateIntrinsics + the pose bench).
  const K = opts.intrinsics ?? intrinsicsFromProjection(cap.projection, cap.width, cap.height)

  const cameraMatrix = cv.matFromArray(3, 3, cv.CV_64F, [K.fx, 0, K.cx, 0, K.fy, K.cy, 0, 0, 1])
  const distCoeffs = cv.Mat.zeros(4, 1, cv.CV_64F)
  const imagePoints = cv.matFromArray(4, 2, cv.CV_64F, cornersPx.flatMap((p) => [p.x, p.y]))

  const fits: PnpFit[] = []
  const rvec = new cv.Mat()
  const tvec = new cv.Mat()
  const rot = new cv.Mat()
  const projected = new cv.Mat()
  const jac = new cv.Mat()

  try {
    for (const sizeClass of SIZE_CLASSES) {
      const model = modelCorners(sizeClass, insetM) // cloth-edge rectangle (what's detected)
      for (let r = 0; r < 4; r++) {
        // Assign image [TL,TR,BR,BL] to a cyclic rotation of the model corners.
        const obj = rotate(model, r)
        const objMat = cv.matFromArray(4, 3, cv.CV_64F, obj.flatMap((v) => [v.x, v.y, v.z]))
        let ok = false
        try {
          ok = cv.solvePnP(objMat, imagePoints, cameraMatrix, distCoeffs, rvec, tvec, false, cv.SOLVEPNP_IPPE)
        } catch {
          ok = false
        }
        if (!ok) {
          objMat.delete()
          continue
        }
        cv.Rodrigues(rvec, rot)
        const rot9 = Array.from({ length: 9 }, (_, i) => rot.doubleAt(Math.floor(i / 3), i % 3))
        const t: [number, number, number] = [tvec.doubleAt(0, 0), tvec.doubleAt(1, 0), tvec.doubleAt(2, 0)]

        // Reprojection RMS (pixels).
        cv.projectPoints(objMat, rvec, tvec, cameraMatrix, distCoeffs, projected, jac)
        let sq = 0
        for (let i = 0; i < 4; i++) {
          const dx = projected.doubleAt(i, 0) - cornersPx[i].x
          const dy = projected.doubleAt(i, 1) - cornersPx[i].y
          sq += dx * dx + dy * dy
        }
        const reprojRmsPx = Math.sqrt(sq / 4)
        objMat.delete()

        const { quaternion, center } = poseToWorld(rot9, t, cap.view)
        // Gravity sanity: table normal (local +Y) must point up in world.
        // Skipped when there is no real world frame (still-photo debug).
        if (!opts.skipGravityCheck) {
          const worldNormal = new Vector3(0, 1, 0).applyQuaternion(quaternion)
          if (worldNormal.y <= 0) continue
        }
        if (reprojRmsPx > maxRms) continue

        // Report the NOSE-line playing surface (inset 0) at the solved pose —
        // same corner order (rotation r) as the cloth model we solved with.
        const nose = rotate(modelCorners(sizeClass, 0), r)
        const corners = nose.map((v) => v.clone().applyQuaternion(quaternion).add(center)) as [
          Vector3, Vector3, Vector3, Vector3,
        ]
        // Approx metric residual for the shared ambiguity check: px error scaled
        // by the table's metric-per-pixel footprint. ponytail: rough; the real
        // gate is reprojRmsPx.
        const perimPx =
          cornersPx.reduce(
            (s, p, i) => s + Math.hypot(p.x - cornersPx[(i + 1) % 4].x, p.y - cornersPx[(i + 1) % 4].y),
            0,
          ) || 1
        const perimM = 3 * PLAYING_LENGTH[sizeClass] // 2·(L + L/2)
        const rms = reprojRmsPx * (perimM / perimPx)

        fits.push({ sizeClass, rms, center, quaternion, corners, reprojRmsPx })
      }
    }
  } finally {
    cameraMatrix.delete()
    distCoeffs.delete()
    imagePoints.delete()
    rvec.delete()
    tvec.delete()
    rot.delete()
    projected.delete()
    jac.delete()
  }

  if (fits.length === 0) return null
  fits.sort((a, b) => a.reprojRmsPx - b.reprojRmsPx)
  return { best: fits[0], all: fits }
}
