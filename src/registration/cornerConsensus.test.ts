import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { CornerConsensus } from './cornerConsensus'

// A 2:1 table's corners on the y=0 plane.
const TRUE = [
  new Vector3(-1.27, 0, -0.635),
  new Vector3(1.27, 0, -0.635),
  new Vector3(1.27, 0, 0.635),
  new Vector3(-1.27, 0, 0.635),
]

/** Deterministic small noise (no Math.random — repeatable). */
function noisy(seed: number): Vector3[] {
  return TRUE.map(
    (c, i) =>
      new Vector3(
        c.x + 0.008 * Math.sin(seed * 7 + i),
        c.y + 0.003 * Math.cos(seed * 5 + i),
        c.z + 0.008 * Math.sin(seed * 3 + i * 2),
      ),
  )
}

const shift = (pts: Vector3[], s: number) => pts.map((_, i) => pts[(i + s) % 4])
const reverse = (pts: Vector3[]) => [...pts].reverse()

describe('CornerConsensus', () => {
  it('aligns samples whose labeling is shifted or reversed', () => {
    const c = new CornerConsensus()
    c.add(noisy(1))
    c.add(shift(noisy(2), 1))
    c.add(shift(noisy(3), 3))
    c.add(reverse(noisy(4)))
    const med = c.medians()
    med.forEach((m, i) => expect(m.distanceTo(TRUE[i])).toBeLessThan(0.02))
    expect(c.spread()).toBeLessThan(0.02)
  })

  it('median rejects a wild outlier frame', () => {
    const c = new CornerConsensus()
    for (let k = 0; k < 6; k++) c.add(noisy(k))
    // One garbage detection (glare frame): everything off by half a meter.
    c.add(TRUE.map((p) => p.clone().addScalar(0.5)))
    const med = c.medians()
    med.forEach((m, i) => expect(m.distanceTo(TRUE[i])).toBeLessThan(0.02))
  })

  it('spread stays at noise level for consistent samples', () => {
    const c = new CornerConsensus()
    for (let k = 0; k < 12; k++) c.add(noisy(k))
    expect(c.count).toBe(12)
    // Noise amplitude is ~8 mm per axis → mean deviation well under 2 cm.
    expect(c.spread()).toBeLessThan(0.02)
    expect(c.spread()).toBeGreaterThan(0)
  })
})
