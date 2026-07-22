/**
 * Felt-segmentation guard — the missing REAL-PIXEL detection test. Runs the
 * actual `hsvFeltMask` on the real train-dataset photos and scores each mask by
 * IoU against the hand-labelled felt (the `.mask.png`). This is what the corner/
 * pose/calibration benches can't see: they start from a clean quad, so a leaking
 * colour segmentation (the 5sez21 failure) is invisible to them.
 *
 * Guards the adaptive S/V floors: asserts the current segmentation isn't worse
 * on average than the old fixed-floor behaviour, and clears a mean-IoU bar.
 *
 * Decoding without an image dep: macOS `sips` → BMP → decoded in JS. So this is
 * a local dev guard (skips cleanly where sips or the dataset are absent — it is
 * not a portable CI gate). Sample point = the felt centroid from the label,
 * standing in for the on-device reticle sitting on the cloth.
 *
 * Run:  npx vitest run feltMask.bench
 */
import { createRequire } from 'module'
import { execFileSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { beforeAll, describe, expect, it } from 'vitest'
import { hsvFeltMask } from './detectQuadCv'

const DATASET = fileURLToPath(new URL('../../../train-dataset/', import.meta.url))
const LABELS_PATH = DATASET + 'labels.json'
const HAVE_SIPS = existsSync('/usr/bin/sips')
const HAVE_DATA = existsSync(LABELS_PATH)

interface Label {
  id: string
  w: number
  h: number
}
const LABELS: Label[] = HAVE_DATA ? JSON.parse(readFileSync(LABELS_PATH, 'utf8')) : []

/** Decode a PNG to RGBA ImageData-shaped object via sips→BMP (BGRA, may be
 *  top-down or bottom-up). */
function decode(png: string): ImageData {
  const out = '/tmp/_feltbench.bmp'
  execFileSync('sips', ['-s', 'format', 'bmp', png, '--out', out], { stdio: 'ignore' })
  const b = readFileSync(out)
  const off = b.readUInt32LE(10)
  const w = b.readInt32LE(18)
  const h = b.readInt32LE(22)
  const bpp = b.readUInt16LE(28)
  const H = Math.abs(h)
  const ch = bpp / 8
  const rb = ((bpp * w + 31) >> 5) << 2 // rows padded to 4 bytes
  const rgba = new Uint8ClampedArray(w * H * 4)
  for (let y = 0; y < H; y++) {
    const sy = h > 0 ? H - 1 - y : y // positive height = bottom-up
    for (let x = 0; x < w; x++) {
      const si = off + sy * rb + x * ch
      const di = (y * w + x) * 4
      rgba[di] = b[si + 2] // B,G,R,A → R,G,B,A
      rgba[di + 1] = b[si + 1]
      rgba[di + 2] = b[si]
      rgba[di + 3] = 255
    }
  }
  return { data: rgba, width: w, height: H, colorSpace: 'srgb' } as ImageData
}

describe.skipIf(!HAVE_SIPS || !HAVE_DATA)('felt segmentation IoU on real photos', () => {
  let cv: any
  beforeAll(async () => {
    cv = await createRequire(import.meta.url)('@techstark/opencv-js')
  }, 60000)

  it('adaptive S/V floors are not worse than fixed floors (prints)', () => {
    const rows: { id: string; oldIoU: number; newIoU: number }[] = []

    for (const L of LABELS) {
      const src = decode(DATASET + L.id + '.png')
      const lab = decode(DATASET + L.id + '.mask.png')
      const n = src.width * src.height
      // Skip if the label and source somehow differ in size (shouldn't).
      if (lab.width !== src.width || lab.height !== src.height) continue

      const labWhite = new Uint8Array(n)
      let labCount = 0
      let sx = 0
      let sy = 0
      for (let i = 0; i < n; i++) {
        if (lab.data[i * 4] > 127) {
          labWhite[i] = 1
          labCount++
          sx += i % src.width
          sy += (i / src.width) | 0
        }
      }
      if (labCount < 100) continue
      const sample = { x: sx / labCount / src.width, y: sy / labCount / src.height }

      const iouWith = (opts: object): number => {
        const r = hsvFeltMask(cv, src, { sample, ...opts })
        if (!r) return 0
        const d = r.mask.data
        let inter = 0
        let mask = 0
        for (let i = 0; i < n; i++) {
          const on = d[i] > 0
          if (on) mask++
          if (on && labWhite[i]) inter++
        }
        r.mask.delete()
        return inter / (mask + labCount - inter)
      }

      rows.push({
        id: L.id,
        oldIoU: iouWith({ satFloorFrac: 0, valFloorFrac: 0 }), // fixed floor 40 (old)
        newIoU: iouWith({}), // adaptive defaults
      })
    }

    const mean = (f: (r: (typeof rows)[0]) => number) =>
      rows.reduce((s, r) => s + f(r), 0) / rows.length
    const oldMean = mean((r) => r.oldIoU)
    const newMean = mean((r) => r.newIoU)

    const worst = [...rows].sort((a, b) => a.newIoU - b.newIoU).slice(0, 5)
    const lines = [
      `\n  felt IoU vs label over ${rows.length} real photos`,
      `  mean IoU   OLD fixed-floor: ${oldMean.toFixed(3)}   NEW adaptive: ${newMean.toFixed(3)}`,
      `  worst 5 (new):`,
      ...worst.map((r) => `    ${r.id.slice(0, 40).padEnd(42)} old ${r.oldIoU.toFixed(3)}  new ${r.newIoU.toFixed(3)}`),
    ]
    console.log(lines.join('\n'))

    // Guard: adaptive floors must not regress the set-mean IoU, and the set must
    // segment reasonably on average. Thresholds set from observed values with
    // margin — tighten as segmentation improves.
    expect(rows.length).toBeGreaterThanOrEqual(20)
    expect(newMean).toBeGreaterThanOrEqual(oldMean - 0.01)
    expect(newMean).toBeGreaterThan(0.6)
  }, 120000)
})
