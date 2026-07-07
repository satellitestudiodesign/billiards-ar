import { describe, expect, it } from 'vitest'
import { detectQuad, orderCorners, type PixelPoint } from './detectQuad'

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

  it('orders arbitrary corners as TL, TR, BR, BL', () => {
    // Shuffled input; expect image-space TL, TR, BR, BL out.
    const tl = { x: 12, y: 10 }
    const tr = { x: 190, y: 14 }
    const br = { x: 185, y: 150 }
    const bl = { x: 8, y: 145 }
    const [a, b, c, d] = orderCorners([br, tl, bl, tr])
    expect(a).toEqual(tl)
    expect(b).toEqual(tr)
    expect(c).toEqual(br)
    expect(d).toEqual(bl)
  })

  it('does not collapse a strongly-tilted quad (one vertex wins two extremes)', () => {
    // Perspective/rotated quad where the far-left vertex minimises BOTH x+y and
    // x−y — the old extreme-sum/diff ordering duplicated it into a degenerate
    // line. Expect 4 distinct corners, TL first, clockwise.
    const a = { x: 10, y: 100 } // far left (min sum AND min diff)
    const b = { x: 200, y: 10 } // top
    const c = { x: 400, y: 120 } // right
    const d = { x: 210, y: 220 } // bottom
    const out = orderCorners([c, a, d, b]) // shuffled in
    expect(out).toEqual([a, b, c, d])
    expect(new Set(out.map((p) => `${p.x},${p.y}`)).size).toBe(4) // no duplicates
  })

  it('orders a quad with an off-frame (negative-coordinate) corner', () => {
    // Rail-line reconstruction can put a corner outside the image; ordering
    // must still work (centroid-angle sort handles negatives).
    const tl = { x: -40, y: 20 } // off the left edge
    const tr = { x: 300, y: 15 }
    const br = { x: 290, y: 220 }
    const bl = { x: -30, y: 210 }
    const [a, b, c, d] = orderCorners([bl, tr, tl, br])
    expect(a).toEqual(tl)
    expect(b).toEqual(tr)
    expect(c).toEqual(br)
    expect(d).toEqual(bl)
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

import { pointInContour } from './detectQuadCv'

describe('pointInContour', () => {
  // 10x10 box contour (int xy pairs, as OpenCV data32S)
  const box = new Int32Array([0, 0, 10, 0, 10, 10, 0, 10])
  it('inside vs outside', () => {
    expect(pointInContour(box, 5, 5)).toBe(true)
    expect(pointInContour(box, 15, 5)).toBe(false)
    expect(pointInContour(box, -1, 5)).toBe(false)
  })
})
