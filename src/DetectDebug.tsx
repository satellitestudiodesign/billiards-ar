import { useEffect, useRef, useState } from 'react'
import { Heading, Text } from '@chakra-ui/react'
import { detectQuadCv } from './registration/cv/detectQuadCv'
import { detectQuad, type PixelPoint } from './registration/cv/detectQuad'
import type { FittedLine } from './registration/cv/railLines'
import styles from './DetectDebug.module.css'

/**
 * ?detect — desktop CV tuning route. Load one table photo OR a whole folder,
 * run the same detectQuadCv the phone runs, and see the detected quad drawn on
 * top of each. Lets you eyeball detection quality across many tables without a
 * phone or AR. Only the projection/FOV step still needs a device.
 *
 * Green = OpenCV contour detector. Orange dashed = heuristic fallback.
 * Pick a folder (webkitdirectory) to batch a whole test set at once.
 *
 * The felt colour is sampled at the image centre (as on-device, where the
 * reticle sits there). For photos where the table isn't centred, CLICK on the
 * felt to re-sample from that point — a yellow ✕ marks the current sample.
 */
interface Result {
  name: string
  url: string
  w: number
  h: number
  image: ImageData // kept so a click can re-detect without re-decoding
  sample: { x: number; y: number } // fractional 0..1
  cv: {
    corners: PixelPoint[]
    coverage: number
    rough?: PixelPoint[]
    refined?: boolean
    mask?: ImageData
    hue?: number
    clipped?: boolean
    railLines?: FittedLine[]
    railReason?: string
    contour?: PixelPoint[]
  } | null
  heuristic: PixelPoint[] | null
}

export function DetectDebug() {
  const [results, setResults] = useState<Result[]>([])
  const [showMask, setShowMask] = useState(true)
  const [status, setStatus] = useState('Pick a table photo — or a folder — to detect.')

  async function onFiles(files: FileList) {
    const images = Array.from(files).filter((f) => f.type.startsWith('image/'))
    setResults([])
    setStatus(`Detecting ${images.length} image(s)…`)
    const out: Result[] = []
    for (const file of images) {
      out.push(await detectOne(file))
      setResults([...out]) // stream in as each finishes
    }
    setStatus(`${out.length} image(s). ${out.filter((r) => r.cv).length} detected by OpenCV.`)
  }

  // Re-run one image sampling the felt colour at a clicked point.
  async function resample(name: string, sample: { x: number; y: number }) {
    setResults((prev) =>
      prev.map((r) => (r.name === name ? { ...r, sample } : r)),
    )
    const target = results.find((r) => r.name === name)
    if (!target) return
    const cv = await detectQuadCv(target.image, { debug: true, sample })
    setResults((prev) => prev.map((r) => (r.name === name ? { ...r, sample, cv } : r)))
  }

  return (
    <div className={styles.root}>
      <Heading size="lg" mb={4}>
        Felt detector tuning (?detect)
      </Heading>
      <div className={styles.controls}>
        <label>
          <input
            type="checkbox"
            checked={showMask}
            onChange={(e) => setShowMask(e.target.checked)}
          />{' '}
          dim non-felt (show mask)
        </label>
        <label>
          Photo(s):{' '}
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => e.target.files?.length && onFiles(e.target.files)}
          />
        </label>
        <label>
          Folder:{' '}
          {/* webkitdirectory: native folder picker, no new dep */}
          <input
            type="file"
            // @ts-expect-error non-standard but supported in Chrome/Edge/Safari
            webkitdirectory=""
            directory=""
            onChange={(e) => e.target.files?.length && onFiles(e.target.files)}
          />
        </label>
      </div>
      <Text fontSize="sm" opacity={0.85} my={3}>
        {status}
      </Text>
      <div className={styles.grid}>
        {results.map((r) => (
          <figure key={r.name} className={styles.cell}>
            <ResultCanvas
              result={r}
              showMask={showMask}
              onSample={(s) => resample(r.name, s)}
            />
            <figcaption className={styles.caption}>
              {r.cv ? '🟢' : '⚪'} {r.name}
              {r.cv &&
                ` — cov ${(r.cv.coverage * 100).toFixed(0)}%, hue ${Math.round(r.cv.hue ?? 0)}, ${
                  r.cv.refined ? 'rail-refined' : 'rough only'
                }${r.cv.clipped ? ', clipped' : ''}${
                  r.cv.railReason ? ` — ✗ ${r.cv.railReason}` : ''
                }`}
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  )
}

/**
 * Draw the source image + detected quads onto a canvas via a ref callback.
 * Green = final OpenCV corners. Blue dotted = rough quad (pre rail-refine).
 * Orange dashed = heuristic fallback. Red wash = felt mask (what OpenCV
 * actually segmented — the usual culprit when detection is wrong).
 */
function ResultCanvas({
  result,
  showMask,
  onSample,
}: {
  result: Result
  showMask: boolean
  onSample: (s: { x: number; y: number }) => void
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  // Redraw on mount AND whenever showMask toggles (a ref callback would only
  // fire on mount, so the mask checkbox would appear to do nothing).
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const img = new Image()
    img.onload = () => {
      canvas.width = result.w
      canvas.height = result.h
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, result.w, result.h)
      if (showMask && result.cv?.mask) drawMask(ctx, result.cv.mask)
      if (result.cv?.contour) drawContour(ctx, result.cv.contour)
      if (result.heuristic) drawQuad(ctx, result.heuristic, '#ff8800', true)
      if (result.cv?.railLines) drawRailLines(ctx, result.cv.railLines, result.w, result.h)
      if (result.cv?.rough) drawQuad(ctx, result.cv.rough, '#33aaff', true)
      if (result.cv) drawQuad(ctx, result.cv.corners, '#00ff66', false)
      drawSampleMark(ctx, result.sample.x * result.w, result.sample.y * result.h)
    }
    img.src = result.url
  }, [result, showMask])
  return (
    <canvas
      ref={ref}
      className={styles.canvas}
      title="Click the felt to re-sample its colour here"
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect()
        onSample({
          x: (e.clientX - rect.left) / rect.width,
          y: (e.clientY - rect.top) / rect.height,
        })
      }}
    />
  )
}

/** Draw the raw felt-mask contour (white dots) — the exact boundary the
 *  detector traces, so leaks past the cushion are visible. */
function drawContour(ctx: CanvasRenderingContext2D, pts: PixelPoint[]) {
  ctx.save()
  ctx.fillStyle = '#ffffff'
  for (const p of pts) ctx.fillRect(p.x - 0.5, p.y - 0.5, 1.5, 1.5)
  ctx.restore()
}

/** Draw each fitted rail line extended across the whole canvas (magenta), so
 *  you can see where the rail fit landed vs the actual cushion. */
function drawRailLines(ctx: CanvasRenderingContext2D, lines: FittedLine[], w: number, h: number) {
  const t = 2 * Math.max(w, h)
  ctx.save()
  ctx.strokeStyle = '#ff33cc'
  ctx.lineWidth = 1.5
  for (const l of lines) {
    ctx.beginPath()
    ctx.moveTo(l.x - t * l.vx, l.y - t * l.vy)
    ctx.lineTo(l.x + t * l.vx, l.y + t * l.vy)
    ctx.stroke()
  }
  ctx.restore()
}

/** Yellow ✕ marking the felt colour sample point. */
function drawSampleMark(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.save()
  ctx.strokeStyle = '#ffff00'
  ctx.lineWidth = 3
  const r = 10
  ctx.beginPath()
  ctx.moveTo(x - r, y - r)
  ctx.lineTo(x + r, y + r)
  ctx.moveTo(x + r, y - r)
  ctx.lineTo(x - r, y + r)
  ctx.stroke()
  ctx.restore()
}

/** Composite the red felt mask over the current canvas content. */
function drawMask(ctx: CanvasRenderingContext2D, mask: ImageData) {
  const tmp = new OffscreenCanvas(mask.width, mask.height)
  tmp.getContext('2d')!.putImageData(mask, 0, 0)
  // Mask is at detect resolution; scale to canvas.
  ctx.drawImage(tmp, 0, 0, ctx.canvas.width, ctx.canvas.height)
}

async function detectOne(file: File): Promise<Result> {
  const bitmap = await createImageBitmap(file)
  // Cap size so big photos stay fast; detection scales fine.
  const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)
  const off = new OffscreenCanvas(w, h)
  const octx = off.getContext('2d')!
  octx.drawImage(bitmap, 0, 0, w, h)
  const image = octx.getImageData(0, 0, w, h)
  const sample = { x: 0.5, y: 0.5 }
  const cv = await detectQuadCv(image, { debug: true, sample })
  const heuristic = detectQuad(image)
  return { name: file.name, url: URL.createObjectURL(file), w, h, image, sample, cv, heuristic }
}

function drawQuad(ctx: CanvasRenderingContext2D, q: PixelPoint[], color: string, dashed: boolean) {
  ctx.save()
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = 3
  ctx.setLineDash(dashed ? [8, 6] : [])
  ctx.beginPath()
  q.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
  ctx.closePath()
  ctx.stroke()
  ctx.setLineDash([])
  q.forEach((p, i) => {
    ctx.beginPath()
    ctx.arc(p.x, p.y, 5, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillText(String(i + 1), p.x + 8, p.y - 8)
  })
  ctx.restore()
}
