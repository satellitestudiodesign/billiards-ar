import { describe, expect, it } from 'vitest'
import { downscaleImage } from './detectTable'

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
