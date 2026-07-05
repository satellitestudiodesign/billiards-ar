import { useRef, useState } from 'react'
import { detectQuadCv } from './registration/cv/detectQuadCv'
import { detectQuad, type PixelPoint } from './registration/cv/detectQuad'

/**
 * ?detect — desktop CV tuning route. Load a table photo, run the same
 * detectQuadCv the phone runs, and see the detected quad drawn on top. Lets
 * you iterate hue/saturation/morphology thresholds without a phone or AR.
 * Only the projection/FOV step still needs a device.
 *
 * Green = OpenCV contour detector. Orange dashed = heuristic fallback.
 */
export function DetectDebug() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [info, setInfo] = useState('Pick a table photo to detect.')

  async function onFile(file: File) {
    const bitmap = await createImageBitmap(file)
    // Cap size so big photos stay fast; detection scales fine.
    const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height))
    const w = Math.round(bitmap.width * scale)
    const h = Math.round(bitmap.height * scale)
    const canvas = canvasRef.current!
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(bitmap, 0, 0, w, h)
    const image = ctx.getImageData(0, 0, w, h)

    const cv = await detectQuadCv(image)
    const heuristic = detectQuad(image)

    ctx.putImageData(image, 0, 0)
    if (heuristic) drawQuad(ctx, heuristic, '#ff8800', true)
    if (cv) drawQuad(ctx, cv.corners, '#00ff66', false)

    setInfo(
      [
        cv
          ? `OpenCV: coverage ${(cv.coverage * 100).toFixed(1)}%, corners ${fmt(cv.corners)}`
          : 'OpenCV: no felt found',
        heuristic ? `Heuristic: corners ${fmt(heuristic)}` : 'Heuristic: no felt found',
        `Image ${w}×${h}`,
      ].join('  •  '),
    )
  }

  return (
    <div style={{ fontFamily: 'system-ui', padding: 16, color: '#eee', background: '#15151c', minHeight: '100vh' }}>
      <h2 style={{ marginTop: 0 }}>Felt detector tuning (?detect)</h2>
      <input
        type="file"
        accept="image/*"
        onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
      />
      <p style={{ fontSize: 14, opacity: 0.85 }}>{info}</p>
      <canvas ref={canvasRef} style={{ maxWidth: '100%', border: '1px solid #333' }} />
    </div>
  )
}

const fmt = (q: PixelPoint[]) => q.map((p) => `(${Math.round(p.x)},${Math.round(p.y)})`).join(' ')

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
