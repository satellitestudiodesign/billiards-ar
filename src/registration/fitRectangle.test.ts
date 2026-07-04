import { describe, expect, it } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { fitTableRectangle, PLAYING_LENGTH, type SizeClass } from './fitRectangle'

/** Build the 4 world corners of a table with the given pose, plus noise. */
function makeCorners(
  sizeClass: SizeClass,
  center: Vector3,
  yawRad: number,
  noise = 0,
  seedBase = 1,
): Vector3[] {
  const L = PLAYING_LENGTH[sizeClass]
  const W = L / 2
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yawRad)
  // deterministic pseudo-noise
  const rnd = (i: number) => Math.sin(seedBase * 78.233 + i * 12.9898) * noise
  return [
    [-L / 2, -W / 2],
    [L / 2, -W / 2],
    [L / 2, W / 2],
    [-L / 2, W / 2],
  ].map(([x, z], i) =>
    new Vector3(x + rnd(i * 3), rnd(i * 3 + 1) * 0.3, z + rnd(i * 3 + 2))
      .applyQuaternion(q)
      .add(center),
  )
}

const X = new Vector3(1, 0, 0)

describe('fitTableRectangle', () => {
  it('recovers pose and size exactly from clean corners', () => {
    const center = new Vector3(0.5, 0.8, -2)
    const corners = makeCorners('9ft', center, 0.7)
    const { best, ambiguous } = fitTableRectangle(corners)
    expect(best.sizeClass).toBe('9ft')
    expect(best.rms).toBeLessThan(1e-9)
    expect(best.center.distanceTo(center)).toBeLessThan(1e-9)
    expect(ambiguous).toBe(false)
    // long axis aligned with the yaw (mod 180deg)
    const xAxis = X.clone().applyQuaternion(best.quaternion)
    const expected = X.clone().applyQuaternion(
      new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.7),
    )
    expect(Math.abs(xAxis.dot(expected))).toBeGreaterThan(0.9999)
  })

  it.each([
    [0.005, 0.02],
    [0.02, 0.05],
  ])('is robust to %fm noise (center within %fm)', (noise, tol) => {
    for (let seed = 1; seed <= 10; seed++) {
      const center = new Vector3(seed * 0.1, 1, -1.5)
      const corners = makeCorners('8ft', center, seed * 0.4, noise, seed)
      const { best } = fitTableRectangle(corners)
      expect(best.sizeClass).toBe('8ft')
      expect(best.center.distanceTo(center)).toBeLessThan(tol)
    }
  })

  it('accepts corners tapped in any rotation direction and starting corner', () => {
    const center = new Vector3(0, 1, 0)
    const corners = makeCorners('7ft', center, 1.1)
    const cw = [corners[0], corners[3], corners[2], corners[1]] // reversed = CW
    const shifted = [corners[2], corners[3], corners[0], corners[1]]
    for (const taps of [cw, shifted]) {
      const { best } = fitTableRectangle(taps)
      expect(best.sizeClass).toBe('7ft')
      expect(best.rms).toBeLessThan(1e-9)
      expect(best.center.distanceTo(center)).toBeLessThan(1e-9)
    }
  })

  it('distinguishes 7ft from 8ft with realistic noise', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const corners = makeCorners('7ft', new Vector3(0, 1, 0), 0.3, 0.01, seed)
      expect(fitTableRectangle(corners).best.sizeClass).toBe('7ft')
    }
  })

  it('rejects degenerate quads', () => {
    const p = new Vector3(0, 1, 0)
    expect(() =>
      fitTableRectangle([p, p.clone(), new Vector3(1, 1, 0), new Vector3(1, 1, 1)]),
    ).toThrow(/too close/)
    expect(() => fitTableRectangle([p, new Vector3(2, 1, 0)])).toThrow(/4 corners/)
  })
})
