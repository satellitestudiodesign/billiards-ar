import { describe, expect, it } from 'vitest'
import { detectQuad, type PixelPoint } from './detectQuad'

/** Build an ImageData with a filled colour quad (rotated rect) over a grey bg. */
function makeImage(
  w: number,
  h: number,
  felt: [number, number, number],
  quad: PixelPoint[],
): ImageData {
  const data = new Uint8ClampedArray(w * h * 4)
  const inside = (px: number, py: number) => {
    // Point-in-convex-polygon via consistent cross-product sign.
    let sign = 0
    for (let i = 0; i < quad.length; i++) {
      const a = quad[i]
      const b = quad[(i + 1) % quad.length]
      const cross = (b.x - a.x) * (py - a.y) - (b.y - a.y) * (px - a.x)
      if (cross !== 0) {
        const s = Math.sign(cross)
        if (sign === 0) sign = s
        else if (s !== sign) return false
      }
    }
    return true
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const [r, g, b] = inside(x, y) ? felt : [130, 130, 130] // grey bg
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = 255
    }
  }
  return { data, width: w, height: h, colorSpace: 'srgb' } as ImageData
}

describe('detectQuad', () => {
  it('finds corners of a green felt quad', () => {
    const quad = [
      { x: 20, y: 30 },
      { x: 170, y: 20 },
      { x: 185, y: 130 },
      { x: 35, y: 150 },
    ]
    const img = makeImage(200, 160, [30, 160, 60], quad)
    const found = detectQuad(img)
    expect(found).not.toBeNull()
    // Each returned corner should be within a few px of an input corner.
    found!.forEach((f, i) => {
      expect(Math.abs(f.x - quad[i].x)).toBeLessThan(8)
      expect(Math.abs(f.y - quad[i].y)).toBeLessThan(8)
    })
  })

  it('detects blue cloth too', () => {
    const quad = [
      { x: 10, y: 10 },
      { x: 190, y: 15 },
      { x: 180, y: 150 },
      { x: 15, y: 140 },
    ]
    const img = makeImage(200, 160, [30, 80, 190], quad)
    expect(detectQuad(img)).not.toBeNull()
  })

  it('returns null when there is no felt', () => {
    const img = makeImage(200, 160, [130, 130, 130], [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ])
    expect(detectQuad(img)).toBeNull()
  })
})
