/**
 * Thin adapter around the vendored tailuge/billiards physics (GPL-3.0, see
 * ./vendor/README.md). This is the only file the rest of the app imports
 * physics from.
 *
 * Frames: the vendored engine and this app's table-local frame agree on
 * x = long axis, y = short axis, z = up, origin = table center, meters.
 * The R3F render layer maps a physics point (x, y, z) to the three.js
 * table-local position (x, z + ballRadius, y).
 */
import { Vector3 } from 'three'
import { Ball, State } from './vendor/model/ball'
import { Table } from './vendor/model/table'
import { OutcomeType } from './vendor/model/outcome'
import { cueStrike } from './vendor/model/physics/physics'
import { R, setR } from './vendor/model/physics/constants'
import { TableGeometry } from './vendor/view/tablegeometry'
import { PocketGeometry } from './vendor/view/pocketgeometry'

/** Upstream fixed physics timestep (512 Hz). */
export const PHYSICS_STEP = 0.001953125

export interface ShotParams {
  /** Aim direction in the table plane, radians, 0 = +x (toward the foot rail). */
  angle: number
  /** Cue-ball launch speed, m/s. */
  speed: number
  /** Cue tip side offset (english), fraction of R in [-0.5, 0.5]. */
  side: number
  /** Cue tip vertical offset, fraction of R: + = follow, - = draw. */
  vertical: number
}

export interface BallSnapshot {
  /** Table-local position, meters. z < 0 while falling into a pocket. */
  x: number
  y: number
  z: number
  /** False once the ball has settled inside a pocket (hide it). */
  visible: boolean
}

export interface SimEvent {
  t: number
  type: 'collision' | 'cushion' | 'pot'
  /** Indices into the input balls array. */
  ballIndices: number[]
}

export interface Simulation {
  duration: number
  events: SimEvent[]
  stateAt(t: number): BallSnapshot[]
}

export interface TableLayout {
  ballRadius: number
  /** Playing surface (cushion nose to nose): x in [-halfLength, halfLength]. */
  halfLength: number
  halfWidth: number
  pockets: Array<{ x: number; y: number; radius: number }>
  spots: { head: [number, number]; center: [number, number]; foot: [number, number] }
}

/**
 * Configure the (global, static) vendored geometry for a playing surface of
 * the given nose-to-nose length. Real pool tables are 2:1, and the vendored
 * geometry is 88R x 44R, so setR(length/88) reproduces the surface exactly.
 * ponytail: upstream geometry is global static state, so one table size at a
 * time — fine for this app, revisit only if two tables must coexist.
 */
export function configureTableSize(playingLength: number): void {
  setR(playingLength / 88)
  TableGeometry.scaleToRadius(R)
  PocketGeometry.scaleToRadius(R)
}

export function tableLayout(): TableLayout {
  const halfLength = TableGeometry.X
  return {
    ballRadius: R,
    halfLength,
    halfWidth: TableGeometry.Y,
    pockets: PocketGeometry.pocketCenters.map((p: { pos: Vector3; radius: number }) => ({
      x: p.pos.x,
      y: p.pos.y,
      radius: p.radius,
    })),
    spots: {
      head: [-halfLength / 2, 0],
      center: [0, 0],
      foot: [halfLength / 2, 0],
    },
  }
}

const outcomeType: Partial<Record<OutcomeType, SimEvent['type']>> = {
  [OutcomeType.Collision]: 'collision',
  [OutcomeType.Cushion]: 'cushion',
  [OutcomeType.Pot]: 'pot',
}

/**
 * Run a full shot to rest. balls[0] is the cue ball. Positions are
 * table-local meters. Precomputes the whole timeline (drills last seconds).
 * Deterministic: upstream physics uses Math.fround throughout, no randomness.
 */
export function simulate(
  balls: ReadonlyArray<{ x: number; y: number }>,
  shot: ShotParams,
  maxDuration = 30,
): Simulation {
  // Upstream Ball.id is a global counter and pocket resting depth depends on
  // it; reset per simulation so identical inputs give identical timelines.
  Ball.id = 0
  const bs = balls.map((b) => new Ball(new Vector3(b.x, b.y, 0)))
  const table = new Table(bs)
  const strike = cueStrike(shot.angle, shot.speed, new Vector3(shot.side, shot.vertical, 0))
  table.cueball.vel.copy(strike.vel)
  table.cueball.rvel.copy(strike.rvel)
  table.cueball.state = State.Sliding

  // One flat snapshot per step: [x, y, z, visible] per ball.
  const frames: number[][] = []
  const record = () => {
    const f: number[] = []
    for (const b of bs) f.push(b.pos.x, b.pos.y, b.pos.z, b.state === State.InPocket ? 0 : 1)
    frames.push(f)
  }

  record()
  let t = 0
  while (!table.allStationary() && t < maxDuration) {
    table.advance(PHYSICS_STEP)
    t += PHYSICS_STEP
    record()
  }

  const events: SimEvent[] = table.outcome
    .map((o) => {
      const type = outcomeType[o.type]
      if (!type) return null
      const indices = [o.ballA, o.ballB]
        .filter((b): b is Ball => b != null)
        .map((b) => bs.indexOf(b))
      return { t: o.timestamp / 1000, type, ballIndices: [...new Set(indices)] }
    })
    .filter((e): e is SimEvent => e !== null)

  const duration = t
  const last = frames.length - 1
  return {
    duration,
    events,
    stateAt(time: number): BallSnapshot[] {
      const i = Math.min(last, Math.max(0, Math.round(time / PHYSICS_STEP)))
      const f = frames[i]
      return bs.map((_, k) => ({
        x: f[k * 4],
        y: f[k * 4 + 1],
        z: f[k * 4 + 2],
        visible: f[k * 4 + 3] === 1,
      }))
    },
  }
}
