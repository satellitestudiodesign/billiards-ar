import { describe, expect, it } from 'vitest'
import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import { intrinsicsFromProjection, poseToWorld } from './tablePose'

describe('intrinsicsFromProjection', () => {
  it('inverts a hand-built GL projection back to fx/fy/cx/cy', () => {
    const W = 1280
    const H = 720
    const fx = 900
    const fy = 905
    const cx = 640
    const cy = 360
    // Invert the formulas in intrinsicsFromProjection to build the projection.
    const proj = new Array(16).fill(0)
    proj[0] = (2 * fx) / W
    proj[5] = (2 * fy) / H
    proj[8] = 1 - (2 * cx) / W
    proj[9] = (2 * cy) / H - 1
    const K = intrinsicsFromProjection(proj, W, H)
    expect(K.fx).toBeCloseTo(fx, 6)
    expect(K.fy).toBeCloseTo(fy, 6)
    expect(K.cx).toBeCloseTo(cx, 6)
    expect(K.cy).toBeCloseTo(cy, 6)
  })

  it('gives a centered principal point for a symmetric frustum', () => {
    const K = intrinsicsFromProjection([1.5, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, -1, 0, 0, 0, 0], 800, 600)
    expect(K.cx).toBeCloseTo(400, 6)
    expect(K.cy).toBeCloseTo(300, 6)
  })
})

const FLIP = new Matrix4().makeScale(1, -1, -1)

/** Row-major 3x3 rotation + translation of a Matrix4, in the order poseToWorld wants. */
function rot9AndT(m: Matrix4): { rot9: number[]; t: [number, number, number] } {
  const e = m.elements // column-major: e[col*4 + row]
  const at = (row: number, col: number) => e[col * 4 + row]
  return {
    rot9: [at(0, 0), at(0, 1), at(0, 2), at(1, 0), at(1, 1), at(1, 2), at(2, 0), at(2, 1), at(2, 2)],
    t: [at(0, 3), at(1, 3), at(2, 3)],
  }
}

describe('poseToWorld round trip', () => {
  it('recovers a known world table pose through the cv frame flip', () => {
    // Desired answer: table sitting in the world with some yaw + offset.
    const qWorld = new Quaternion().setFromEuler(new Euler(0, 0.7, 0))
    const cWorld = new Vector3(0.3, -0.1, -1.2)
    const tableToWorld = new Matrix4().compose(cWorld, qWorld, new Vector3(1, 1, 1))

    // An arbitrary camera-to-world pose (phone held above, looking down-ish).
    const qCam = new Quaternion().setFromEuler(new Euler(-1.1, 0.2, 0.05))
    const camToWorld = new Matrix4().compose(new Vector3(0.1, 1.4, 0.2), qCam, new Vector3(1, 1, 1))

    // Build the solvePnP inputs that MUST produce tableToWorld:
    //   tableToWorld = camToWorld · FLIP · objToCam
    // => objToCam = FLIP · worldToCam · tableToWorld   (FLIP is involutory)
    const worldToCam = camToWorld.clone().invert()
    const objToCam = FLIP.clone().multiply(worldToCam).multiply(tableToWorld)
    const { rot9, t } = rot9AndT(objToCam)

    const out = poseToWorld(rot9, t, camToWorld.elements as unknown as number[])

    expect(out.center.distanceTo(cWorld)).toBeLessThan(1e-6)
    expect(out.quaternion.angleTo(qWorld)).toBeLessThan(1e-6)
    // Table normal ends up pointing world-up (+Y stays +Y under a yaw-only pose).
    const n = new Vector3(0, 1, 0).applyQuaternion(out.quaternion)
    expect(n.y).toBeGreaterThan(0.99)
  })
})
