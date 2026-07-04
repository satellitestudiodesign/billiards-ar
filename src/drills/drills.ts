import { tableLayout, type ShotParams } from '../physics'

/**
 * Drill definitions in fractional table coordinates so one drill scales to
 * any table size: fx in [-0.5, 0.5] along the long axis (+ = foot end),
 * fy in [-0.5, 0.5] along the short axis. balls[0] is the cue ball.
 */
export interface Drill {
  id: string
  name: string
  description: string
  /** balls[0] is the cue (no num); object balls carry their number (1..15). */
  balls: Array<{ x: number; y: number; num?: number }>
  shot: { speed: number; side: number; vertical: number } & (
    | { aim: 'angle'; angle: number }
    | { aim: 'pocket'; pocketIndex: number }
  )
}

export const DRILLS: Drill[] = [
  {
    id: 'stop',
    name: 'Stop shot',
    description: 'Pot the 1 in the corner; the cue ball should stop dead on contact.',
    // On the centre→NE-corner diagonal (fx = fy lies on that line), so the
    // head-on hit sends the 1 into the corner and shows the cue action.
    balls: [
      { x: -0.2, y: -0.2 },
      { x: 0.25, y: 0.25, num: 1 },
    ],
    shot: { aim: 'pocket', pocketIndex: 4 /* NE corner */, speed: 2.6, side: 0, vertical: -0.3 },
  },
  {
    id: 'draw',
    name: 'Draw shot',
    description: 'Pot the 1 in the corner; heavy backspin draws the cue ball back.',
    balls: [
      { x: -0.2, y: -0.2 },
      { x: 0.25, y: 0.25, num: 1 },
    ],
    shot: { aim: 'pocket', pocketIndex: 4 /* NE corner */, speed: 2.4, side: 0, vertical: -0.75 },
  },
  {
    id: 'cut-corner',
    name: 'Cut to corner',
    description: 'Cut the object ball into the far corner pocket.',
    balls: [
      { x: -0.2, y: -0.15 },
      { x: 0.15, y: 0.1, num: 1 },
    ],
    shot: { aim: 'pocket', pocketIndex: 4 /* NE corner (+x, +y) */, speed: 2.0, side: -0.1, vertical: 0 },
  },
  {
    id: '9ball-break',
    name: '9-ball break',
    description: 'Full-speed break into a diamond rack from the head string.',
    // Diamond rack (1,2,3,2,1). 9-ball convention: the diamond centre (the
    // 9) sits on the foot spot (fx 0.25); the apex 1-ball is higher, toward
    // the cue. balls[1] is the apex 1-ball. Spacing is baked at 9ft with a
    // ~1.2% gap — as tight as the solver allows: a fully-touching rack (and
    // anything under ~1% gap) throws "Depth exceeded resolving collisions"
    // (all contacts fire in one step). ponytail: tuned for 9ft/speed 6.
    // Apex = 1, centre = 9 (fixed by the rules); 2..8 fill the rest.
    balls: [
      { x: -0.25, y: 0.43 }, // cue: head string, one ball off the side rail — where most break from
      { x: 0.2105, y: 0, num: 1 }, // apex
      { x: 0.2303, y: 0.0228, num: 5 },
      { x: 0.2303, y: -0.0228, num: 7 },
      { x: 0.25, y: 0, num: 9 }, // diamond centre, on the foot spot
      { x: 0.25, y: 0.0455, num: 4 },
      { x: 0.25, y: -0.0455, num: 2 },
      { x: 0.2697, y: 0.0228, num: 6 },
      { x: 0.2697, y: -0.0228, num: 8 },
      { x: 0.2895, y: 0, num: 3 },
    ],
    // Aimed from the rail-side cue at the apex 1-ball (≈ -25°).
    shot: { aim: 'angle', angle: -0.426, speed: 8, side: 0, vertical: -0.2 },
  },
  {
    id: '9ball-break-other',
    name: '9-ball break (other side)',
    description: 'Same break from one ball off the opposite side rail (mirrored in y).',
    // Rack is symmetric about y=0, so the mirror just flips the cue and aim.
    balls: [
      { x: -0.25, y: -0.43 }, // cue: one ball off the far side rail
      { x: 0.2105, y: 0, num: 1 }, // apex
      { x: 0.2303, y: 0.0228, num: 5 },
      { x: 0.2303, y: -0.0228, num: 7 },
      { x: 0.25, y: 0, num: 9 }, // diamond centre, on the foot spot
      { x: 0.25, y: 0.0455, num: 4 },
      { x: 0.25, y: -0.0455, num: 2 },
      { x: 0.2697, y: 0.0228, num: 6 },
      { x: 0.2697, y: -0.0228, num: 8 },
      { x: 0.2895, y: 0, num: 3 },
    ],
    shot: { aim: 'angle', angle: 0.426, speed: 8, side: 0, vertical: -0.2 },
  },
]

/**
 * Resolve a drill's shot to physics ShotParams. Pocket aims use ghost-ball
 * aiming: aim the cue at the point 2R behind the object ball on the
 * object-to-pocket line. configureTableSize() must have been called.
 */
export function resolveShot(drill: Drill, balls: Array<{ x: number; y: number }>): ShotParams {
  const { shot } = drill
  if (shot.aim === 'angle') {
    return { angle: shot.angle, speed: shot.speed, side: shot.side, vertical: shot.vertical }
  }
  const layout = tableLayout()
  const pocket = layout.pockets[shot.pocketIndex]
  const cue = balls[0]
  const obj = balls[1]
  const toPocket = Math.hypot(pocket.x - obj.x, pocket.y - obj.y)
  const ghost = {
    x: obj.x - ((pocket.x - obj.x) / toPocket) * 2 * layout.ballRadius,
    y: obj.y - ((pocket.y - obj.y) / toPocket) * 2 * layout.ballRadius,
  }
  return {
    angle: Math.atan2(ghost.y - cue.y, ghost.x - cue.x),
    speed: shot.speed,
    side: shot.side,
    vertical: shot.vertical,
  }
}
