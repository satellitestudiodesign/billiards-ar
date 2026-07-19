import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Heading, Text } from '@chakra-ui/react'
import { detectQuadCv } from './registration/cv/detectQuadCv'
import { detectQuad, type PixelPoint } from './registration/cv/detectQuad'
import { exportPairs, type LabelSample } from './registration/cv/datasetExport'
import styles from './DetectDebug.module.css'

/**
 * ?label — hand-correction tool for felt-mask training labels. Load images,
 * step through one at a time, drag the 4 proposed corners onto the true rail
 * line, Save to add the corrected quad to the export batch, then Export writes
 * the whole batch (image + filled-quad mask + manifest) via ?detect's shared
 * exporter. The proposal comes from the same detectQuadCv the phone runs, so
 * most frames need only a nudge; hard frames (glare, clutter) get fixed by hand
 * — the labels that actually teach the net beyond the HSV detector.
 */
interface Frame {
  name: string
  image: ImageData
  w: number
  h: number
}

const MAX_W = 1280
const HANDLE_R = 16 // hit/draw radius, display px
const PAD_FRAC = 0.18 // canvas margin (fraction of max dim) for off-frame corners

/** Padding in image px around a frame's canvas, so reconstructed off-frame
 *  corners stay visible and draggable. */
function padOf(f: { w: number; h: number }): number {
  return Math.round(PAD_FRAC * Math.max(f.w, f.h))
}

/** Decode a file to a size-capped ImageData + object URL. */
async function loadFrame(file: File): Promise<Frame> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_W / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)
  const off = new OffscreenCanvas(w, h)
  const ctx = off.getContext('2d')!
  ctx.drawImage(bitmap, 0, 0, w, h)
  return { name: file.name, image: ctx.getImageData(0, 0, w, h), w, h }
}

/** Fallback quad when detection finds nothing: a centred 70%-inset rectangle. */
function defaultQuad(w: number, h: number): PixelPoint[] {
  const ix = w * 0.15
  const iy = h * 0.15
  return [
    { x: ix, y: iy },
    { x: w - ix, y: iy },
    { x: w - ix, y: h - iy },
    { x: ix, y: h - iy },
  ]
}

/** Propose corners for a frame: detectQuadCv → heuristic → default rectangle. */
async function proposeQuad(f: Frame): Promise<PixelPoint[]> {
  const cv = await detectQuadCv(f.image).catch(() => null)
  return cv?.corners ?? detectQuad(f.image) ?? defaultQuad(f.w, f.h)
}

export function LabelDebug() {
  const [frames, setFrames] = useState<Frame[]>([])
  const [idx, setIdx] = useState(0)
  const [corners, setCorners] = useState<PixelPoint[]>([])
  const [batch, setBatch] = useState<LabelSample[]>([])
  const [status, setStatus] = useState('Pick images to start labelling.')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragging = useRef<number | null>(null)

  const frame = frames[idx] as Frame | undefined

  async function onFiles(files: FileList) {
    const imgs = Array.from(files).filter((f) => f.type.startsWith('image/'))
    setStatus(`Loading ${imgs.length} image(s)…`)
    const loaded = await Promise.all(imgs.map(loadFrame))
    setFrames(loaded)
    setBatch([])
    setIdx(0)
    if (loaded[0]) setCorners(await proposeQuad(loaded[0]))
    setStatus(`${loaded.length} image(s) loaded.`)
  }

  // Re-propose corners whenever we land on a new frame (unless it's already in
  // the batch — then show the saved corners so a re-visit keeps the correction).
  const goto = useCallback(
    async (next: number, list = frames, saved = batch) => {
      const f = list[next]
      if (!f) return
      setIdx(next)
      const prior = saved.find((s) => s.name === f.name)
      setCorners(prior ? prior.corners : await proposeQuad(f))
    },
    [frames, batch],
  )

  function save() {
    if (!frame) return
    const sample: LabelSample = { name: frame.name, image: frame.image, corners }
    // Replace any prior correction for this frame, else append.
    const nextBatch = [...batch.filter((s) => s.name !== frame.name), sample]
    setBatch(nextBatch)
    if (idx + 1 < frames.length) void goto(idx + 1, frames, nextBatch)
    else setStatus(`Saved. ${nextBatch.length} in batch — last image.`)
  }

  // Redraw: image + quad + numbered handles — SYNCHRONOUS (putImageData from the
  // ImageData we already hold). No async new Image()/onload: reloading on every
  // drag blanked the canvas mid-gesture and made it feel non-interactive.
  //
  // The canvas is PADDED by `pad` on every side: detectQuadCv reconstructs
  // off-frame corners (rails that run past the image edge), so a canvas sized
  // exactly to the image leaves those handles unreachable. The image is drawn
  // inset by `pad`; corner coords stay in IMAGE space (may be negative or > w).
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !frame) return
    const pad = padOf(frame)
    const cw = frame.w + 2 * pad
    const ch = frame.h + 2 * pad
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw
      canvas.height = ch
    }
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#1a1a1a' // pad margin: distinct from the photo, shows off-frame room
    ctx.fillRect(0, 0, cw, ch)
    ctx.putImageData(frame.image, pad, pad)
    if (corners.length === 4) {
      ctx.save()
      ctx.translate(pad, pad) // draw in image space; pad offset handled here
      ctx.strokeStyle = 'rgba(0, 255, 102, 0.45)'
      ctx.lineWidth = 3
      ctx.beginPath()
      corners.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
      ctx.closePath()
      ctx.stroke()
      // Handles scale with the on-screen size so they stay grabbable.
      const s = canvas.width / (canvas.getBoundingClientRect().width || canvas.width)
      ctx.fillStyle = '#00ff66'
      ctx.font = `${14 * s}px sans-serif`
      corners.forEach((p, i) => {
        ctx.beginPath()
        ctx.arc(p.x, p.y, HANDLE_R * s, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillText(String(i + 1), p.x + HANDLE_R * s, p.y - HANDLE_R * s)
      })
      ctx.restore()
    }
  }, [frame, corners])

  // Pointer → IMAGE coords (subtract the pad offset). Grab nearest corner
  // within HANDLE_R (display px).
  function toImage(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const sx = e.currentTarget.width / rect.width
    const sy = e.currentTarget.height / rect.height
    const pad = frame ? padOf(frame) : 0
    return { x: (e.clientX - rect.left) * sx - pad, y: (e.clientY - rect.top) * sy - pad, sx }
  }
  function onDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const { x, y, sx } = toImage(e)
    let best = -1
    let bestD = (HANDLE_R * sx) ** 2
    corners.forEach((p, i) => {
      const d = (p.x - x) ** 2 + (p.y - y) ** 2
      if (d < bestD) {
        bestD = d
        best = i
      }
    })
    if (best >= 0) {
      dragging.current = best
      e.currentTarget.setPointerCapture(e.pointerId)
    }
  }
  function onMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (dragging.current === null || !frame) return
    const { x, y } = toImage(e)
    const i = dragging.current
    // Clamp to the padded canvas (image + margin), so off-frame corners are
    // allowed but a handle can't be dragged out of reach.
    const pad = padOf(frame)
    const cx = Math.max(-pad, Math.min(frame.w + pad, x))
    const cy = Math.max(-pad, Math.min(frame.h + pad, y))
    setCorners((prev) => prev.map((p, j) => (j === i ? { x: cx, y: cy } : p)))
  }
  function onUp() {
    dragging.current = null
  }

  const inBatch = frame && batch.some((s) => s.name === frame.name)

  return (
    <div className={styles.root}>
      <Heading size="lg" mb={4}>
        Felt label tool (?label)
      </Heading>
      <div className={styles.controls}>
        <label>
          Images:{' '}
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => e.target.files?.length && onFiles(e.target.files)}
          />
        </label>
        <label>
          Folder:{' '}
          <input
            type="file"
            // @ts-expect-error non-standard but supported in Chrome/Edge/Safari
            webkitdirectory=""
            directory=""
            onChange={(e) => e.target.files?.length && onFiles(e.target.files)}
          />
        </label>
        <Button
          size="sm"
          disabled={!batch.length}
          onClick={() => exportPairs(batch).then(setStatus)}
        >
          Export batch ({batch.length})
        </Button>
      </div>

      <Text fontSize="sm" opacity={0.85} my={3}>
        {frame
          ? `Image ${idx + 1} / ${frames.length}: ${frame.name}${inBatch ? ' ✓ saved' : ''} — ${status}`
          : status}
      </Text>

      {frame && (
        <>
          <canvas
            ref={canvasRef}
            className={styles.canvas}
            style={{ maxWidth: '100%', touchAction: 'none', cursor: 'crosshair' }}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
          />
          <div className={styles.controls} style={{ marginTop: 12 }}>
            <Button size="sm" variant="outline" disabled={idx === 0} onClick={() => void goto(idx - 1)}>
              ← Prev
            </Button>
            <Button size="sm" variant="outline" onClick={() => void goto(idx + 1)}>
              Skip →
            </Button>
            <Button size="sm" colorPalette="green" onClick={save}>
              Save {inBatch ? '(update)' : ''} → batch
            </Button>
          </div>
          <Text fontSize="sm" opacity={0.6} mt={2}>
            Drag the numbered corners onto the cushion-nose rail line. Save adds
            this quad to the batch; Export writes all saved pairs + manifest.
          </Text>
        </>
      )}
    </div>
  )
}
