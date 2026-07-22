/**
 * Rail-fit precision bench — quantifies the corner-recovery error of the
 * `railLines` stage, which is where the documented precision loss lives (640px
 * downscale grid, pocket-arc angle bias, occlusion). It is the A/B harness for
 * detection improvements: run it before and after a change and read the delta.
 *
 * Why corner-PIXEL error and not world-cm? The PnP solver (OpenCV wasm) won't
 * initialise in node, so the pose half can't run here. But on-screen overlay
 * error is monotone in corner-pixel error for a fixed pose, so corner-px RMS is
 * a faithful, wasm-free proxy for the <1 cm on-screen target. We also print an
 * approximate mm figure using the table's known metres-per-pixel at its plane,
 * so the numbers read against that 1 cm goal.
 *
 * Fully deterministic: a seeded LCG drives all noise (no Date/Math.random), so
 * the printed table and the regression assert are stable run-to-run.
 *
 * Run:  npx vitest run railLines.bench   (the console table prints regardless).
 */
import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'
import { fitQuadFromMask, refineRailCorners } from './railLines'
import type { PixelPoint } from './detectQuad'

const W = 640
const H = 480

/** Deterministic LCG (Numerical Recipes) → uniform [0,1). */
function makeRng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 0x100000000
  }
}

/** Box–Muller standard normal from a uniform rng. */
function gauss(rng: () => number): number {
  const u = Math.max(1e-12, rng())
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng())
}

/**
 * A realistic perspective view of a 2:1 table: a trapezoid whose near (bottom)
 * edge is wider than the far (top) edge, tilted slightly off-axis. These are
 * the ground-truth playing-surface corners in image pixels, order [TL,TR,BR,BL]
 * clockwise (+y down), which is what the detectors output and refine.
 */
const TRUE: PixelPoint[] = [
  { x: 175, y: 95 }, // TL (far-left)
  { x: 470, y: 88 }, // TR (far-right)
  { x: 590, y: 395 }, // BR (near-right)
  { x: 60, y: 405 }, // BL (near-left)
]

/** Approx metres-per-pixel at the table plane: real 9ft long rail = 2.54 m,
 *  averaged over the two long edges' pixel lengths. Lets us print mm. */
const LONG_M = 2.54
const mmPerPx = (() => {
  const top = Math.hypot(TRUE[1].x - TRUE[0].x, TRUE[1].y - TRUE[0].y)
  const bot = Math.hypot(TRUE[2].x - TRUE[3].x, TRUE[2].y - TRUE[3].y)
  return (LONG_M * 1000) / ((top + bot) / 2)
})()

/** Rough approxPolyDP-style seed: corners pulled inward toward centroid
 *  (a pocket-cut mask's vertices land inside the true corner). */
function roughSeedFor(corners: PixelPoint[], biasPx: number): PixelPoint[] {
  const cx = corners.reduce((s, p) => s + p.x, 0) / 4
  const cy = corners.reduce((s, p) => s + p.y, 0) / 4
  return corners.map((p) => {
    const d = Math.hypot(p.x - cx, p.y - cy) || 1
    return { x: p.x + ((cx - p.x) / d) * biasPx, y: p.y + ((cy - p.y) / d) * biasPx }
  })
}
const roughSeed = (biasPx: number) => roughSeedFor(TRUE, biasPx)

interface Degrade {
  /** Perpendicular Gaussian noise on boundary points, px sigma. */
  noise: number
  /** Round boundary points to an integer grid (the raster/downscale cap). */
  quantize: boolean
  /** Pocket cutout: pull the boundary inward within this many px of a corner. */
  pocketPx: number
  /** Occlude this leading fraction of ONE rail (e.g. a ball / arm on the rail). */
  occludeFrac: number
}

/**
 * Build a synthetic felt-mask contour for TRUE under a degradation. Dense (~1px)
 * boundary points per edge, with pocket arcs near corners, perpendicular noise,
 * optional integer quantization, and an occlusion gap on edge 0.
 */
function contourFor(
  corners: PixelPoint[],
  d: Degrade,
  rng: () => number,
): PixelPoint[] {
  const pts: PixelPoint[] = []
  for (let e = 0; e < 4; e++) {
    const a = corners[e]
    const b = corners[(e + 1) % 4]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    const n = Math.round(len)
    const nx = -(b.y - a.y) / len // inward normal (clockwise, +y down)
    const ny = (b.x - a.x) / len
    for (let i = 0; i <= n; i++) {
      const t = i / n
      if (e === 0 && t < d.occludeFrac) continue // occluded stretch of one rail
      const along = t * len
      const edgeDist = Math.min(along, len - along)
      const inward = edgeDist < d.pocketPx ? (d.pocketPx - edgeDist) * 0.8 : 0
      const nrm = d.noise ? gauss(rng) * d.noise : 0
      let x = a.x + (b.x - a.x) * t + nx * (inward + nrm)
      let y = a.y + (b.y - a.y) * t + ny * (inward + nrm)
      if (d.quantize) {
        x = Math.round(x)
        y = Math.round(y)
      }
      pts.push({ x, y })
    }
  }
  return pts
}

const contour = (d: Degrade, rng: () => number) => contourFor(TRUE, d, rng)

/** RMS of the 4 corner distances to a reference quad, after matching the
 *  recovered quad over all 4 cyclic rotations (label origin can differ). */
function cornerRmsTo(got: PixelPoint[], ref: PixelPoint[]): number {
  let best = Infinity
  for (let r = 0; r < 4; r++) {
    let sq = 0
    for (let i = 0; i < 4; i++) {
      const g = got[(i + r) % 4]
      sq += (g.x - ref[i].x) ** 2 + (g.y - ref[i].y) ** 2
    }
    best = Math.min(best, Math.sqrt(sq / 4))
  }
  return best
}
const cornerRms = (got: PixelPoint[]) => cornerRmsTo(got, TRUE)

const RUNNER = {
  refine: (d: Degrade, rng: () => number) =>
    refineRailCorners(contour(d, rng), roughSeed(12), W, H),
  seedless: (d: Degrade, rng: () => number) => fitQuadFromMask(contour(d, rng), W, H),
} as const

/** Aggregate cornerRms over N seeds for one (runner, degradation). */
function measure(runner: keyof typeof RUNNER, d: Degrade, seeds = 40) {
  const errs: number[] = []
  let fails = 0
  for (let s = 0; s < seeds; s++) {
    const got = RUNNER[runner](d, makeRng(0x1234 + s * 2654435761))
    if (!got) {
      fails++
      continue
    }
    errs.push(cornerRms(got))
  }
  errs.sort((a, b) => a - b)
  const mean = errs.length ? errs.reduce((a, b) => a + b, 0) / errs.length : NaN
  const p95 = errs.length ? errs[Math.min(errs.length - 1, Math.floor(errs.length * 0.95))] : NaN
  return { mean, p95, failFrac: fails / seeds, n: errs.length }
}

const SCENARIOS: { name: string; d: Degrade }[] = [
  { name: 'ideal (no noise, subpx)', d: { noise: 0, quantize: false, pocketPx: 0, occludeFrac: 0 } },
  { name: 'quantized only (640 grid)', d: { noise: 0, quantize: true, pocketPx: 0, occludeFrac: 0 } },
  { name: 'pockets only', d: { noise: 0, quantize: true, pocketPx: 22, occludeFrac: 0 } },
  { name: 'noise σ=1px', d: { noise: 1, quantize: true, pocketPx: 22, occludeFrac: 0 } },
  { name: 'noise σ=2px', d: { noise: 2, quantize: true, pocketPx: 22, occludeFrac: 0 } },
  { name: 'realistic (σ=1,pkt,occl)', d: { noise: 1, quantize: true, pocketPx: 22, occludeFrac: 0.25 } },
]

describe('railLines precision bench', () => {
  it('tabulates corner error across degradations (prints table)', () => {
    const pad = (s: string, n: number) => s.padEnd(n)
    const num = (v: number) => (Number.isNaN(v) ? '  n/a' : v.toFixed(2))
    const lines: string[] = []
    lines.push(`\n  mm/px at table plane ≈ ${mmPerPx.toFixed(1)}  (1 cm ≈ ${(10 / mmPerPx).toFixed(1)} px)`)
    for (const runner of ['refine', 'seedless'] as const) {
      lines.push(`\n  ── ${runner === 'refine' ? 'refineRailCorners (seeded)' : 'fitQuadFromMask (seedless)'} ──`)
      lines.push(
        `  ${pad('scenario', 28)}${pad('mean px', 9)}${pad('p95 px', 9)}${pad('mean mm', 9)}${pad('fail%', 7)}`,
      )
      for (const { name, d } of SCENARIOS) {
        const r = measure(runner, d)
        lines.push(
          `  ${pad(name, 28)}${pad(num(r.mean), 9)}${pad(num(r.p95), 9)}${pad(num(r.mean * mmPerPx), 9)}${pad(
            (r.failFrac * 100).toFixed(0),
            7,
          )}`,
        )
      }
    }
    console.log(lines.join('\n'))

    // Regression guard: with sub-pixel input and no degradation, the fit must be
    // near-exact. If this ceiling breaks, the rail-fit math regressed.
    const ideal = measure('refine', SCENARIOS[0].d)
    expect(ideal.mean).toBeLessThan(0.5)
    expect(ideal.failFrac).toBe(0)
  })
})

// ── Real labelled table geometries ────────────────────────────────────────────
// The synthetic table above is ONE hand-picked trapezoid. train-dataset holds 26
// hand-labelled playing-surface quads from real photos (extracted by
// scripts/extract-labels.py → labels.json), spanning real perspective,
// foreshortening, framing and frame-clipping. This grounds rail-fit in the real
// GEOMETRY distribution. NOTE: it does NOT test the felt colour detector on real
// pixels (needs source-image decode) nor pose/calibration (the dataset has no
// intrinsics), so degradation here is still synthetic — only the quads are real.

interface Label {
  id: string
  w: number
  h: number
  coverage: number
  corners: [number, number][]
}
const LABELS: Label[] = JSON.parse(
  readFileSync(new URL('../../../train-dataset/labels.json', import.meta.url), 'utf8'),
)

describe('railLines on real labelled geometries', () => {
  it('recovers 26 real table quads under clean + realistic degradation (prints)', () => {
    // Corner error as a fraction of image diagonal → comparable across the mixed
    // resolutions (600² … 1280²) in the dataset.
    const clean: number[] = []
    const realistic: number[] = []
    let cleanFail = 0
    let realFail = 0

    for (const L of LABELS) {
      const corners = L.corners.map(([x, y]) => ({ x, y }))
      const diag = Math.hypot(L.w, L.h)
      const seed = roughSeedFor(corners, 0.02 * diag)
      const rng = makeRng(0xc0ffee)

      const cClean = contourFor(corners, { noise: 0, quantize: false, pocketPx: 0, occludeFrac: 0 }, rng)
      const gClean = refineRailCorners(cClean, seed, L.w, L.h)
      if (gClean) clean.push((100 * cornerRmsTo(gClean, corners)) / diag)
      else cleanFail++

      const cReal = contourFor(
        corners,
        { noise: 1, quantize: true, pocketPx: 0.03 * Math.min(L.w, L.h), occludeFrac: 0 },
        rng,
      )
      const gReal = refineRailCorners(cReal, seed, L.w, L.h)
      if (gReal) realistic.push((100 * cornerRmsTo(gReal, corners)) / diag)
      else realFail++
    }

    const stat = (a: number[]) => {
      if (!a.length) return { mean: NaN, p95: NaN, max: NaN }
      const s = [...a].sort((x, y) => x - y)
      return {
        mean: s.reduce((x, y) => x + y, 0) / s.length,
        p95: s[Math.min(s.length - 1, Math.floor(s.length * 0.95))],
        max: s[s.length - 1],
      }
    }
    const c = stat(clean)
    const r = stat(realistic)
    const f = (v: number) => (Number.isNaN(v) ? 'n/a' : v.toFixed(3))
    console.log(
      [
        `\n  ${LABELS.length} real labelled quads — corner error as % of image diagonal`,
        `  ${'case'.padEnd(12)}${'mean%'.padEnd(9)}${'p95%'.padEnd(9)}${'max%'.padEnd(9)}fail`,
        `  ${'clean'.padEnd(12)}${f(c.mean).padEnd(9)}${f(c.p95).padEnd(9)}${f(c.max).padEnd(9)}${cleanFail}`,
        `  ${'realistic'.padEnd(12)}${f(r.mean).padEnd(9)}${f(r.p95).padEnd(9)}${f(r.max).padEnd(9)}${realFail}`,
      ].join('\n'),
    )

    // Grounding checks: most real geometries recover, and clean recovery is tight.
    // (A few clipped/degenerate quads may legitimately fail the 4-rail fit.)
    expect(LABELS.length).toBeGreaterThanOrEqual(20)
    expect(clean.length).toBeGreaterThanOrEqual(LABELS.length - 4)
    expect(c.mean).toBeLessThan(1) // <1% of diagonal on clean real geometry
  })
})
