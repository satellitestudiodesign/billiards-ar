import { describe, expect, it } from 'vitest'
import { PerspectiveCamera, Plane, Vector3 } from 'three'
import { pixelToNdc, planeFromPose, projectToPlane } from './projectToPlane'
import type { PixelPoint } from './detectQuad'

const W = 640
const H = 480

/** Camera above the y=0 plane, looking straight down at it. */
function overheadCamera(): PerspectiveCamera {
  const cam = new PerspectiveCamera(60, W / H, 0.1, 100)
  cam.position.set(0, 2, 0)
  cam.lookAt(0, 0, 0)
  cam.updateMatrixWorld(true)
  cam.updateProjectionMatrix()
  return cam
}

/** Project a world point to image pixels using the same camera. */
function worldToPixel(cam: PerspectiveCamera, p: Vector3): PixelPoint {
  const ndc = p.clone().project(cam)
  return { x: ((ndc.x + 1) / 2) * W, y: ((1 - ndc.y) / 2) * H }
}

describe('projectToPlane', () => {
  it('round-trips world → pixel → world on the plane', () => {
    const cam = overheadCamera()
    const plane = new Plane(new Vector3(0, 1, 0), 0) // y = 0
    const worldCorners = [
      new Vector3(-0.5, 0, -0.3),
      new Vector3(0.5, 0, -0.3),
      new Vector3(0.5, 0, 0.3),
      new Vector3(-0.5, 0, 0.3),
    ]
    const pixels = worldCorners.map((p) => worldToPixel(cam, p))
    const recovered = projectToPlane(pixels, W, H, cam, plane)
    expect(recovered).not.toBeNull()
    recovered!.forEach((r, i) => {
      expect(r.distanceTo(worldCorners[i])).toBeLessThan(1e-3)
    })
  })

  it('returns null when a ray misses the plane (camera facing away)', () => {
    const cam = new PerspectiveCamera(60, W / H, 0.1, 100)
    cam.position.set(0, 2, 0)
    cam.lookAt(0, 5, 0) // looking up, away from y=0
    cam.updateMatrixWorld(true)
    const plane = new Plane(new Vector3(0, 1, 0), 0)
    const center: PixelPoint[] = [{ x: W / 2, y: H / 2 }]
    expect(projectToPlane(center, W, H, cam, plane)).toBeNull()
  })

  it('pixelToNdc maps corners correctly', () => {
    expect(pixelToNdc({ x: 0, y: 0 }, W, H)).toMatchObject({ x: -1, y: 1 })
    expect(pixelToNdc({ x: W, y: H }, W, H)).toMatchObject({ x: 1, y: -1 })
  })

  it('planeFromPose normalizes the normal', () => {
    const plane = planeFromPose(new Vector3(0, 1, 0), new Vector3(0, 5, 0))
    expect(plane.normal.length()).toBeCloseTo(1)
    // Point (0,1,0) lies on the plane.
    expect(plane.distanceToPoint(new Vector3(0, 1, 0))).toBeCloseTo(0)
  })
})
