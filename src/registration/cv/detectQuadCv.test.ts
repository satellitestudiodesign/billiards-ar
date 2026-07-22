import { describe, expect, it } from 'vitest'
import { circularMedianHue, dominantHue } from './detectQuadCv'

describe('dominantHue', () => {
  it('picks the coherent felt hue over scattered high-sat clutter (61G)', () => {
    // Felt: 40 blue pixels (hue 120), moderate saturation. Clutter: a rack of
    // balls, each a few high-sat pixels spread across warm hues. Median/mean
    // would drift toward the clutter; the histogram peak stays on the felt.
    const hs: number[] = []
    const ss: number[] = []
    for (let i = 0; i < 40; i++) {
      hs.push(120)
      ss.push(70)
    }
    for (const ballHue of [2, 5, 8, 12, 18, 25, 30, 45, 60, 90]) {
      hs.push(ballHue)
      ss.push(220)
    }
    expect(dominantHue(hs, ss)).toBe(120)
  })

  it('returns -1 when nothing clears the saturation floor', () => {
    expect(dominantHue([100, 110, 120], [10, 15, 20], 40)).toBe(-1)
  })
})

describe('circularMedianHue', () => {
  it('medians a normal cluster like a plain median', () => {
    expect(circularMedianHue([100, 101, 102, 103, 104])).toBeCloseTo(102, 0)
  })

  it('handles red straddling the 0/180 wrap (the 00707 failure)', () => {
    // Red felt hues sit near 0 AND 180. A linear median collapses to ~90 (cyan);
    // the circular median must land back near red (0/180), not the middle.
    const reds = [1, 2, 3, 177, 178, 179, 180]
    const h = circularMedianHue(reds)
    const distToRed = Math.min(h, 180 - h) // angular distance to 0/180
    expect(distToRed).toBeLessThan(10)
    expect(h).not.toBeCloseTo(90, 0) // NOT the linear-median artefact
  })

  it('returns 0 on empty input', () => {
    expect(circularMedianHue([])).toBe(0)
  })
})
