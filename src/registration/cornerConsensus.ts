/**
 * Multi-frame corner consensus: accumulate per-frame table detections (4 world
 * corners each) and converge on a robust estimate.
 *
 * One-shot detection is fragile — a single glare frame, a ball on the rail, or
 * one biased back-projection ruins registration. Instead the auto-detect loop
 * feeds every frame's detection in here; the component-wise MEDIAN of each
 * corner across frames rejects outlier frames, and the spread tells the caller
 * when the estimate has "locked" (small spread = frames agree).
 *
 * Correspondence: detectors label corners in image space (TL/TR/BR/BL), which
 * flips as the phone moves. Each incoming sample is aligned to the running
 * medians over the 8 possible relabelings of a quad (4 cyclic shifts × 2
 * directions) before being stored.
 *
 * Pure math (three's Vector3 only) — unit-testable without XR or OpenCV.
 */
import { Vector3 } from 'three'

/** All 8 relabelings of a quad: 4 cyclic shifts, each also reversed. */
const MAPPINGS: number[][] = []
for (let s = 0; s < 4; s++) {
  MAPPINGS.push([0, 1, 2, 3].map((i) => (i + s) % 4))
  MAPPINGS.push([0, 1, 2, 3].map((i) => (s - i + 4) % 4))
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export class CornerConsensus {
  /** Aligned samples: samples[k][i] corresponds to reference corner i. */
  private samples: Vector3[][] = []

  get count(): number {
    return this.samples.length
  }

  /** Add one detection (4 world corners, any consistent cyclic labeling). */
  add(corners: Vector3[]): void {
    if (corners.length !== 4) return
    if (this.samples.length === 0) {
      this.samples.push(corners.map((c) => c.clone()))
      return
    }
    const ref = this.medians()
    let best = MAPPINGS[0]
    let bestCost = Infinity
    for (const m of MAPPINGS) {
      let cost = 0
      for (let i = 0; i < 4; i++) cost += ref[i].distanceToSquared(corners[m[i]])
      if (cost < bestCost) {
        bestCost = cost
        best = m
      }
    }
    this.samples.push(best.map((j) => corners[j].clone()))
  }

  /** Component-wise median of each corner across all samples. */
  medians(): Vector3[] {
    return [0, 1, 2, 3].map(
      (i) =>
        new Vector3(
          median(this.samples.map((s) => s[i].x)),
          median(this.samples.map((s) => s[i].y)),
          median(this.samples.map((s) => s[i].z)),
        ),
    )
  }

  /** Max over corners of the mean distance to that corner's median, meters. */
  spread(): number {
    const med = this.medians()
    let worst = 0
    for (let i = 0; i < 4; i++) {
      let sum = 0
      for (const s of this.samples) sum += s[i].distanceTo(med[i])
      worst = Math.max(worst, sum / this.samples.length)
    }
    return worst
  }
}
