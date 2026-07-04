/**
 * Table registration: fit a known-size rectangle to 4 noisy tapped corners.
 *
 * The user taps the 4 playing-surface corners (where the cushion noses meet)
 * in order around the table. Pool playing surfaces are standardized and
 * exactly 2:1, so fitting position + orientation of a known rectangle is far
 * more robust than trusting the raw taps.
 *
 * Math: project taps onto their best plane, order CCW, then closed-form 2D
 * Kabsch (rotation + translation, no scale) against each size-class model
 * rectangle; pick the size class with lowest RMS.
 */
import { Matrix4, Quaternion, Vector2, Vector3 } from 'three'

export type SizeClass = '7ft' | '8ft' | '9ft'

/** Playing surface length (cushion nose to nose), meters. Width is exactly L/2.
 *  WPA/BCA nominal: 7ft 78x39in, 8ft 88x44in, 9ft 100x50in. // VERIFY vs WPA specs */
export const PLAYING_LENGTH: Record<SizeClass, number> = {
  '7ft': 1.9812,
  '8ft': 2.2352,
  '9ft': 2.54,
}

export interface RectFit {
  sizeClass: SizeClass
  /** Root-mean-square corner residual, meters. Warn above ~0.03. */
  rms: number
  /** Playing-surface center on the fitted plane, world coords. */
  center: Vector3
  /** Table frame: +X long axis, +Y plane normal (up), +Z short axis. */
  quaternion: Quaternion
  /** Fitted ideal corners, world coords, same order as the (reordered) taps. */
  corners: [Vector3, Vector3, Vector3, Vector3]
}

export interface FitResult {
  best: RectFit
  /** All size classes sorted by ascending rms (best first). */
  all: RectFit[]
  /** True when the two best classes are within 25mm RMS — ask the user. */
  ambiguous: boolean
}

/** Rejects tap sets that cannot be a table: too-short edges or wild aspect. */
export function validateQuad(taps: Vector3[]): string | null {
  if (taps.length !== 4) return 'need exactly 4 corners'
  for (let i = 0; i < 4; i++) {
    const d = taps[i].distanceTo(taps[(i + 1) % 4])
    if (d < 0.3) return 'corners too close together'
  }
  const e0 = taps[0].distanceTo(taps[1])
  const e1 = taps[1].distanceTo(taps[2])
  const e2 = taps[2].distanceTo(taps[3])
  const e3 = taps[3].distanceTo(taps[0])
  if (Math.max(e0, e2) / Math.min(e0, e2) > 1.5) return 'opposite edges differ too much'
  if (Math.max(e1, e3) / Math.min(e1, e3) > 1.5) return 'opposite edges differ too much'
  return null
}

interface Plane2D {
  origin: Vector3
  u: Vector3
  v: Vector3
  normal: Vector3
  points: Vector2[]
}

/** Plane through the 4 taps (normal from the diagonals), with in-plane basis. */
function projectToPlane(taps: Vector3[]): Plane2D {
  const origin = new Vector3()
  for (const p of taps) origin.addScaledVector(p, 1 / 4)
  const d1 = new Vector3().subVectors(taps[2], taps[0])
  const d2 = new Vector3().subVectors(taps[3], taps[1])
  const normal = new Vector3().crossVectors(d1, d2).normalize()
  if (normal.y < 0) normal.negate() // table normal points up in world space
  const u = new Vector3()
    .subVectors(taps[1], taps[0])
    .addScaledVector(normal, -new Vector3().subVectors(taps[1], taps[0]).dot(normal))
    .normalize()
  const v = new Vector3().crossVectors(normal, u)
  const points = taps.map((p) => {
    const d = new Vector3().subVectors(p, origin)
    return new Vector2(d.dot(u), d.dot(v))
  })
  return { origin, u, v, normal, points }
}

/** Reorder indices 0..3 CCW (in the u,v plane) starting from the first tap. */
function orderCCW(points: Vector2[]): number[] {
  const idx = [0, 1, 2, 3].sort(
    (a, b) => Math.atan2(points[a].y, points[a].x) - Math.atan2(points[b].y, points[b].x),
  )
  const start = idx.indexOf(0)
  return [0, 1, 2, 3].map((i) => idx[(start + i) % 4])
}

/**
 * Closed-form 2D Kabsch: rotation theta + translation t minimizing
 * sum |q_i - R m_i - t|^2 for corresponding model/measured points.
 */
function kabsch2D(model: Vector2[], measured: Vector2[]) {
  const mc = new Vector2()
  const qc = new Vector2()
  for (let i = 0; i < model.length; i++) {
    mc.addScaledVector(model[i], 1 / model.length)
    qc.addScaledVector(measured[i], 1 / model.length)
  }
  let sin = 0
  let cos = 0
  for (let i = 0; i < model.length; i++) {
    const m = new Vector2().subVectors(model[i], mc)
    const q = new Vector2().subVectors(measured[i], qc)
    cos += m.x * q.x + m.y * q.y
    sin += m.x * q.y - m.y * q.x
  }
  const theta = Math.atan2(sin, cos)
  const rot = (p: Vector2) =>
    new Vector2(
      p.x * Math.cos(theta) - p.y * Math.sin(theta),
      p.x * Math.sin(theta) + p.y * Math.cos(theta),
    )
  const t = new Vector2().subVectors(qc, rot(mc))
  let sq = 0
  const fitted = model.map((m, i) => {
    const f = rot(m).add(t)
    sq += f.distanceToSquared(measured[i])
    return f
  })
  return { theta, t, rms: Math.sqrt(sq / model.length), fitted }
}

function fitClass(plane: Plane2D, order: number[], sizeClass: SizeClass): RectFit {
  const L = PLAYING_LENGTH[sizeClass]
  const W = L / 2
  // CCW model corners; two cyclic starts cover long-axis-first vs short-axis-first
  const base: Vector2[] = [
    new Vector2(-L / 2, -W / 2),
    new Vector2(L / 2, -W / 2),
    new Vector2(L / 2, W / 2),
    new Vector2(-L / 2, W / 2),
  ]
  const measured = order.map((i) => plane.points[i])
  let best: { theta: number; t: Vector2; rms: number; fitted: Vector2[] } | null = null
  for (let shift = 0; shift < 4; shift++) {
    const model = base.map((_, i) => base[(i + shift) % 4])
    const fit = kabsch2D(model, measured)
    if (!best || fit.rms < best.rms) best = fit
  }
  const { theta, t, rms, fitted } = best!
  const to3D = (p: Vector2) =>
    new Vector3()
      .copy(plane.origin)
      .addScaledVector(plane.u, p.x)
      .addScaledVector(plane.v, p.y)
  const center = to3D(t)
  // world direction of the model +x (long) axis after rotation by theta
  const xAxis = new Vector3()
    .addScaledVector(plane.u, Math.cos(theta))
    .addScaledVector(plane.v, Math.sin(theta))
  const yAxis = plane.normal.clone()
  const zAxis = new Vector3().crossVectors(xAxis, yAxis).normalize()
  const quaternion = new Quaternion().setFromRotationMatrix(
    new Matrix4().makeBasis(xAxis, yAxis, zAxis),
  )
  const corners = fitted.map(to3D) as RectFit['corners']
  return { sizeClass, rms, center, quaternion, corners }
}

/**
 * Fit all size classes to 4 tapped world-space corners.
 * Throws with a user-readable message when the taps are not a plausible quad.
 */
export function fitTableRectangle(taps: Vector3[]): FitResult {
  const invalid = validateQuad(taps)
  if (invalid) throw new Error(invalid)
  const plane = projectToPlane(taps)
  const order = orderCCW(plane.points)
  const all = (Object.keys(PLAYING_LENGTH) as SizeClass[])
    .map((s) => fitClass(plane, order, s))
    .sort((a, b) => a.rms - b.rms)
  return { best: all[0], all, ambiguous: all[1].rms - all[0].rms < 0.025 }
}
