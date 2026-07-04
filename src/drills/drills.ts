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
  balls: Array<[number, number]>
  shot: { speed: number; side: number; vertical: number } & (
    | { aim: 'angle'; angle: number }
    | { aim: 'pocket'; pocketIndex: number }
  )
}

export const DRILLS: Drill[] = [
  {
    id: 'stop',
    name: 'Stop shot',
    description: 'Straight shot, slight draw: the cue ball should stop dead on contact.',
    balls: [
      [-0.25, 0],
      [0.25, 0],
    ],
    shot: { aim: 'angle', angle: 0, speed: 2.2, side: 0, vertical: -0.2 },
  },
  {
    id: 'draw',
    name: 'Draw shot',
    description: 'Straight shot with heavy backspin: the cue ball returns toward you.',
    balls: [
      [-0.25, 0],
      [0.25, 0],
    ],
    shot: { aim: 'angle', angle: 0, speed: 2.4, side: 0, vertical: -0.45 },
  },
  {
    id: 'cut-corner',
    name: 'Cut to corner',
    description: 'Cut the object ball into the far corner pocket.',
    balls: [
      [-0.2, -0.15],
      [0.15, 0.1],
    ],
    shot: { aim: 'pocket', pocketIndex: 4 /* NE corner (+x, +y) */, speed: 2.0, side: 0, vertical: 0 },
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
