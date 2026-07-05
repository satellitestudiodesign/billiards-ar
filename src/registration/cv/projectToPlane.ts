/**
 * Back-project image-space quad corners onto the table plane in world space.
 *
 * Given the camera pose+projection at capture time and the felt plane (from a
 * hit-test), each detected pixel becomes a world ray; intersecting that ray
 * with the plane gives the world corner. Output feeds straight into
 * `fitTableRectangle` — the same 4 Vector3 the manual taps produce.
 *
 * ⚠️ Calibration knob (VERIFY on-device): this assumes the raw camera image
 * shares the render camera's frustum. If WebXR raw-camera-access reports a
 * different FOV/aspect than the rendered view, the NDC mapping is off and
 * corners will be biased. If so, build the ray from the XRView camera
 * intrinsics instead of the render camera's projectionMatrix.
 */
import { Plane, Raycaster, Vector2, Vector3, type Camera } from 'three'
import type { PixelPoint } from './detectQuad'

const raycaster = new Raycaster()

/** Image pixel (origin top-left, +y down) → NDC (origin center, +y up). */
export function pixelToNdc(p: PixelPoint, width: number, height: number): Vector2 {
  return new Vector2((p.x / width) * 2 - 1, -((p.y / height) * 2 - 1))
}

/**
 * @param corners  detected quad corners, image pixels
 * @param width    camera image width in pixels
 * @param height   camera image height in pixels
 * @param camera   render camera snapshot at capture time (matrixWorld + projection current)
 * @param plane    felt plane in world space
 * @returns 4 world points, or null if any ray misses the plane (camera not
 *          facing the table).
 */
export function projectToPlane(
  corners: PixelPoint[],
  width: number,
  height: number,
  camera: Camera,
  plane: Plane,
): Vector3[] | null {
  const out: Vector3[] = []
  for (const c of corners) {
    raycaster.setFromCamera(pixelToNdc(c, width, height), camera)
    const hit = new Vector3()
    if (!raycaster.ray.intersectPlane(plane, hit)) return null
    out.push(hit)
  }
  return out
}

/** Build the table plane from a hit-test pose (point on plane + up normal). */
export function planeFromPose(point: Vector3, normal: Vector3): Plane {
  return new Plane().setFromNormalAndCoplanarPoint(normal.clone().normalize(), point)
}
