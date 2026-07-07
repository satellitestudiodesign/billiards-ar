import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { downscaleImage, insetToNoseLine } from './detectTable'

function solidImage(w: number, h: number, rgb: [number, number, number]): ImageData {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = rgb[0]
    data[i * 4 + 1] = rgb[1]
    data[i * 4 + 2] = rgb[2]
    data[i * 4 + 3] = 255
  }
  return { data, width: w, height: h, colorSpace: 'srgb' } as ImageData
}

describe('downscaleImage', () => {
  it('preserves aspect ratio and colour', () => {
    const img = solidImage(1280, 720, [30, 160, 60])
    const out = downscaleImage(img, 640)
    expect(out.width).toBe(640)
    expect(out.height).toBe(360)
    // Spot-check pixels incl. last one (no out-of-bounds sampling).
    const last = (out.width * out.height - 1) * 4
    expect([out.data[0], out.data[1], out.data[2]]).toEqual([30, 160, 60])
    expect([out.data[last], out.data[last + 1], out.data[last + 2]]).toEqual([30, 160, 60])
    expect(out.data[last + 3]).toBe(255)
  })

  it('returns the input untouched when already small enough', () => {
    const img = solidImage(320, 240, [10, 20, 30])
    expect(downscaleImage(img, 640)).toBe(img)
  })
})

describe('insetToNoseLine', () => {
  const normal = new Vector3(0, 1, 0) // felt plane = world XZ

  it('shrinks an axis-aligned rectangle inward by d on every edge', () => {
    // 2.0 × 1.0 rectangle on the XZ plane, clockwise.
    const corners = [
      new Vector3(-1, 0, -0.5),
      new Vector3(1, 0, -0.5),
      new Vector3(1, 0, 0.5),
      new Vector3(-1, 0, 0.5),
    ]
    const d = 0.037
    const out = insetToNoseLine(corners, normal, d)
    // Each edge moves inward by d → half-extents shrink by exactly d.
    out.forEach((p, i) => {
      expect(Math.abs(p.x) - (1 - d)).toBeLessThan(1e-6)
      expect(Math.abs(p.z) - (0.5 - d)).toBeLessThan(1e-6)
      expect(p.y).toBeCloseTo(0, 6) // stays in-plane
      // sign preserved (didn't flip to the opposite corner)
      expect(Math.sign(p.x)).toBe(Math.sign(corners[i].x))
      expect(Math.sign(p.z)).toBe(Math.sign(corners[i].z))
    })
  })

  it('insets a rotated rectangle correctly (edge offset, not centroid pull)', () => {
    // 45°-rotated 2×1 rect: an equal edge inset must keep it a rectangle.
    const a = Math.PI / 4
    const rot = (x: number, z: number) =>
      new Vector3(x * Math.cos(a) - z * Math.sin(a), 0, x * Math.sin(a) + z * Math.cos(a))
    const corners = [rot(-1, -0.5), rot(1, -0.5), rot(1, 0.5), rot(-1, 0.5)]
    const out = insetToNoseLine(corners, normal, 0.037)
    // Opposite edges of the inset quad stay equal length (still a rectangle).
    const e0 = out[0].distanceTo(out[1])
    const e2 = out[2].distanceTo(out[3])
    expect(Math.abs(e0 - e2)).toBeLessThan(1e-6)
    expect(e0).toBeCloseTo(2 - 2 * 0.037, 6) // long edges shrink by 2d total
  })

  it('returns the input unchanged for zero/negative inset', () => {
    const corners = [
      new Vector3(0, 0, 0),
      new Vector3(1, 0, 0),
      new Vector3(1, 0, 1),
      new Vector3(0, 0, 1),
    ]
    expect(insetToNoseLine(corners, normal, 0)).toBe(corners)
  })
})
