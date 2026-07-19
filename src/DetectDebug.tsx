import { useEffect, useRef, useState } from 'react'
import { Heading, Text } from '@chakra-ui/react'
import { Vector3 } from 'three'
import { detectQuadCv } from './registration/cv/detectQuadCv'
import { detectQuad, type PixelPoint } from './registration/cv/detectQuad'
import type { FittedLine } from './registration/cv/railLines'
import { loadOpenCv } from './registration/cv/opencv'
import { solveTablePose, type PnpFit } from './registration/cv/tablePose'
import { CUSHION_INSET_M } from './registration/cv/detectTable'
import { exportPairs } from './registration/cv/datasetExport'
import { PLAYING_LENGTH, type SizeClass } from './registration/fitRectangle'
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
  /** Include in the exported training set. Auto-seeded from the clean-detection
   *  gate (rail-refined, not clipped); user overrides per cell. */
  accept: boolean
}

export function DetectDebug() {
  const [results, setResults] = useState<Result[]>([])
  const [showMask, setShowMask] = useState(true)
  const [showPose, setShowPose] = useState(true)
  const [fov, setFov] = useState(65) // assumed horizontal FOV, degrees
  // PnP fit per image name, lifted up so the caption can show it.
  const [poses, setPoses] = useState<Record<string, PnpFit | null>>({})
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
          <input
            type="checkbox"
            checked={showPose}
            onChange={(e) => setShowPose(e.target.checked)}
          />{' '}
          PnP pose overlay (cyan)
        </label>
        <label>
          FOV {fov}°{' '}
          <input
            type="range"
            min={40}
            max={90}
            step={1}
            value={fov}
            onChange={(e) => setFov(Number(e.target.value))}
          />
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
        <button
          type="button"
          disabled={!results.some((r) => r.accept && r.cv)}
          onClick={() => exportDataset(results).then(setStatus)}
        >
          Export dataset ({results.filter((r) => r.accept && r.cv).length})
        </button>
      </div>
      <Text fontSize="sm" opacity={0.85} my={3}>
        {status}
      </Text>
      {showPose && (
        <Text fontSize="sm" color="#ffcc00" mb={3}>
          ⚠️ PnP pose uses an ASSUMED {fov}° FOV — a photo carries no real camera
          intrinsics. The cyan overlay + size class + residual are INDICATIVE only;
          4 coplanar corners reproject near-perfectly at almost any FOV/scale, so
          trust these only on-device with real intrinsics. The normal post (cyan
          vertical) is the most FOV-sensitive cue — tune FOV until it looks upright.
        </Text>
      )}
      <div className={styles.grid}>
        {results.map((r) => (
          <figure key={r.name} className={styles.cell}>
            <ResultCanvas
              result={r}
              showMask={showMask}
              showPose={showPose}
              fov={fov}
              onSample={(s) => resample(r.name, s)}
              onPose={(p) => setPoses((prev) => ({ ...prev, [r.name]: p }))}
            />
            <figcaption className={styles.caption}>
              <label title="Include in exported training set">
                <input
                  type="checkbox"
                  checked={r.accept}
                  disabled={!r.cv}
                  onChange={(e) =>
                    setResults((prev) =>
                      prev.map((x) => (x.name === r.name ? { ...x, accept: e.target.checked } : x)),
                    )
                  }
                />{' '}
              </label>
              {r.cv ? '🟢' : '⚪'} {r.name}
              {r.cv &&
                ` — cov ${(r.cv.coverage * 100).toFixed(0)}%, hue ${Math.round(r.cv.hue ?? 0)}, ${
                  r.cv.refined ? 'rail-refined' : 'rough only'
                }${r.cv.clipped ? ', clipped' : ''}${
                  r.cv.railReason ? ` — ✗ ${r.cv.railReason}` : ''
                }`}
              {showPose &&
                (poses[r.name]
                  ? ` — pose≈${poses[r.name]!.sizeClass}, reproj ${poses[r.name]!.reprojRmsPx.toFixed(2)}px (indicative)`
                  : ' — pose: none')}
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
  showPose,
  fov,
  onSample,
  onPose,
}: {
  result: Result
  showMask: boolean
  showPose: boolean
  fov: number
  onSample: (s: { x: number; y: number }) => void
  onPose: (p: PnpFit | null) => void
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [pose, setPose] = useState<PnpFit | null>(null)

  // Solve the table pose by PnP from the detected corners + an ASSUMED FOV.
  // Re-runs when the image or the FOV slider changes. See the ?detect banner:
  // with no real intrinsics this is indicative only.
  useEffect(() => {
    let alive = true
    const corners = result.cv?.corners ?? result.heuristic
    if (!showPose || !corners || corners.length !== 4) {
      setPose(null)
      onPose(null)
      return
    }
    const { projection } = stillCamera(fov, result.w, result.h)
    loadOpenCv()
      .then((cv) => {
        if (!alive) return
        const fit = solveTablePose(
          cv,
          corners,
          { projection, view: IDENTITY16, width: result.w, height: result.h },
          { insetM: CUSHION_INSET_M },
        )
        const best = fit?.best ?? null
        setPose(best)
        onPose(best)
      })
      .catch(() => {
        if (alive) {
          setPose(null)
          onPose(null)
        }
      })
    return () => {
      alive = false
    }
    // onPose identity changes every render; deliberately excluded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, showPose, fov])

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
      if (showPose && pose) drawPose(ctx, pose, fov, result.w, result.h)
      drawSampleMark(ctx, result.sample.x * result.w, result.sample.y * result.h)
    }
    img.src = result.url
  }, [result, showMask, showPose, pose, fov])
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
  // Auto-accept clean detections only: rail-line fit succeeded and the felt
  // isn't frame-clipped. reprojRmsPx is NOT a usable gate here — a still has no
  // real intrinsics, so 4 coplanar corners reproject near-perfectly at any FOV.
  const accept = !!(cv && cv.refined && !cv.clipped)
  return { name: file.name, url: URL.createObjectURL(file), w, h, image, sample, cv, heuristic, accept }
}

/** Map accepted detections → dataset samples and write them (accumulating). */
function exportDataset(results: Result[]): Promise<string> {
  return exportPairs(
    results
      .filter((r) => r.accept && r.cv)
      .map((r) => ({
        name: r.name,
        image: r.image,
        corners: r.cv!.corners,
        meta: { coverage: r.cv!.coverage, hue: r.cv!.hue, sample: r.sample },
      })),
  )
}

/** Column-major identity: still photos have no camera pose, so world == the
 *  gl-camera frame and poseToWorld returns the pose directly in camera space. */
const IDENTITY16 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

/** Synthetic pinhole for a still: horizontal FOV + image size → intrinsics and
 *  a GL projection. No real intrinsics exist for a photo — this is a guess. */
function stillCamera(fovXdeg: number, w: number, h: number) {
  const fx = w / 2 / Math.tan((fovXdeg * Math.PI) / 180 / 2)
  const fy = fx // assume square pixels
  const cx = w / 2
  const cy = h / 2
  const projection = new Array(16).fill(0)
  projection[0] = (2 * fx) / w
  projection[5] = (2 * fy) / h
  projection[10] = -1
  projection[11] = -1
  return { fx, fy, cx, cy, projection }
}

/** Nose-line playing surface + pockets + spots in table-local meters
 *  (+X long, +Y up, +Z short) for drawing the solved pose. */
function tableModel(sizeClass: SizeClass) {
  const hl = PLAYING_LENGTH[sizeClass] / 2
  const hw = hl / 2 // 2:1 surface
  const corners = [
    new Vector3(hl, 0, hw),
    new Vector3(hl, 0, -hw),
    new Vector3(-hl, 0, -hw),
    new Vector3(-hl, 0, hw),
  ]
  const pockets = [...corners, new Vector3(0, 0, hw), new Vector3(0, 0, -hw)]
  const spots = [new Vector3(-hl / 2, 0, 0), new Vector3(0, 0, 0), new Vector3(hl / 2, 0, 0)]
  return { corners, pockets, spots }
}

/**
 * Draw the PnP-solved table pose over the photo (cyan): playing-surface
 * rectangle, pocket dots, the 3 spots, and a 0.3 m normal post at table centre
 * (the most FOV-sensitive cue — a wrong FOV tips it off-vertical). Uses the
 * pose in camera space (view=identity), a plain pinhole projection.
 */
function drawPose(ctx: CanvasRenderingContext2D, pose: PnpFit, fov: number, w: number, h: number) {
  const { fx, fy, cx, cy } = stillCamera(fov, w, h)
  const project = (p: Vector3): PixelPoint | null => {
    // view=identity ⇒ world coords ARE gl-camera coords; flip to OpenCV frame.
    const wp = p.clone().applyQuaternion(pose.quaternion).add(pose.center)
    const z = -wp.z // OpenCV +z forward = -(gl +z, which points back)
    if (z <= 1e-3) return null
    return { x: (fx * wp.x) / z + cx, y: (fy * -wp.y) / z + cy }
  }
  const { corners, pockets, spots } = tableModel(pose.sizeClass)
  const cyan = '#00e5ff'

  // Playing-surface rectangle.
  const cp = corners.map(project)
  if (cp.every((p): p is PixelPoint => p !== null)) drawQuad(ctx, cp, cyan, false)

  ctx.save()
  ctx.fillStyle = cyan
  ctx.strokeStyle = cyan
  ctx.lineWidth = 2
  for (const pk of pockets) {
    const p = project(pk)
    if (p) {
      ctx.beginPath()
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  for (const s of spots) {
    const p = project(s)
    if (p) {
      ctx.beginPath()
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2)
      ctx.stroke()
    }
  }
  // Normal post: table centre → 0.3 m up (table-local +Y).
  const base = project(new Vector3(0, 0, 0))
  const top = project(new Vector3(0, 0.3, 0))
  if (base && top) {
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(base.x, base.y)
    ctx.lineTo(top.x, top.y)
    ctx.stroke()
  }
  ctx.restore()
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
