/**
 * Shared felt-mask dataset export: turn (image, quad-corners) samples into
 * paired `<id>.png` / `<id>.mask.png` files + an accumulating `manifest.json`,
 * written into a user-picked folder via the File System Access API (native,
 * no zip dep). Used by both the ?detect batch exporter and the ?label
 * hand-correction tool. Chrome/Edge only (showDirectoryPicker).
 */
import type { PixelPoint } from './detectQuad'

export interface LabelSample {
  /** Source filename (may include a folder path from a directory picker). */
  name: string
  /** The frame to save as `<id>.png`. */
  image: ImageData
  /** 4 corners [TL,TR,BR,BL] in image px — filled white as the label mask. */
  corners: PixelPoint[]
  /** Extra fields to record in the manifest entry. */
  meta?: Record<string, unknown>
}

/** Source frame → PNG blob. */
function imageToPng(image: ImageData): Promise<Blob> {
  const c = new OffscreenCanvas(image.width, image.height)
  c.getContext('2d')!.putImageData(image, 0, 0)
  return c.convertToBlob({ type: 'image/png' })
}

/** Binary label mask → PNG blob: white = felt (inside the quad), black = not.
 *  Filling the corrected/detected QUAD gives a crisp, leak-free label. */
export function quadMaskPng(corners: PixelPoint[], w: number, h: number): Promise<Blob> {
  const c = new OffscreenCanvas(w, h)
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = '#fff'
  ctx.beginPath()
  corners.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
  ctx.closePath()
  ctx.fill()
  return c.convertToBlob({ type: 'image/png' })
}

/**
 * Write the samples as (image, mask) PNG pairs + a merged manifest into a
 * user-picked folder. Files are named after the SOURCE photo (`<base>.png`,
 * `<base>.mask.png`), so re-exporting is idempotent: the same photo overwrites
 * its own pair, and no stale reindexed frame can linger. The manifest
 * ACCUMULATES — the folder's existing entries are merged by id, same id
 * overwritten, others kept. Corrupt/absent manifest → starts fresh.
 *
 * Returns a human status string; no throw on the unsupported-browser path.
 */
export async function exportPairs(samples: LabelSample[]): Promise<string> {
  const picker = (window as unknown as { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> })
    .showDirectoryPicker
  if (!picker) return 'Export needs Chrome/Edge (File System Access API).'
  if (!samples.length) return 'Nothing to export.'
  const dir = await picker()
  const write = async (name: string, blob: Blob) => {
    const fh = await dir.getFileHandle(name, { create: true })
    const ws = await fh.createWritable()
    await ws.write(blob)
    await ws.close()
  }
  // Stable slug from the source name (folder picker gives paths → strip dir +
  // extension, sanitise). Dedupe collisions so two photos never overwrite one.
  const seen = new Set<string>()
  const slug = (name: string) => {
    const base = name.replace(/^.*[/\\]/, '').replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_')
    let s = base || 'frame'
    for (let n = 2; seen.has(s); n++) s = `${base}_${n}`
    seen.add(s)
    return s
  }
  // Accumulate: load the folder's existing manifest keyed by id, so re-exports
  // merge instead of clobber.
  const entries = new Map<string, { id: string; [k: string]: unknown }>()
  try {
    const fh = await dir.getFileHandle('manifest.json')
    const prior = JSON.parse(await (await fh.getFile()).text())
    if (Array.isArray(prior)) for (const e of prior) if (e?.id) entries.set(e.id, e)
  } catch {
    /* no manifest yet, or unreadable — start fresh */
  }
  for (const s of samples) {
    const id = slug(s.name)
    await write(`${id}.png`, await imageToPng(s.image))
    await write(`${id}.mask.png`, await quadMaskPng(s.corners, s.image.width, s.image.height))
    entries.set(id, { id, source: s.name, w: s.image.width, h: s.image.height, ...s.meta })
  }
  const manifest = [...entries.values()]
  await write('manifest.json', new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }))
  return `Exported ${samples.length} pair(s); manifest now ${manifest.length} total.`
}
