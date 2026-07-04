import { beforeAll, describe, expect, it } from 'vitest'
import { configureTableSize, simulate, tableLayout } from '../index'

// 9ft table: playing surface 2.54 x 1.27 m
const L = 2.54

beforeAll(() => configureTableSize(L))

const finalState = (sim: ReturnType<typeof simulate>) => sim.stateAt(sim.duration)
const firstCollisionTime = (sim: ReturnType<typeof simulate>) =>
  sim.events.find((e) => e.type === 'collision')?.t

describe('table geometry', () => {
  it('reproduces the playing surface exactly at 2:1', () => {
    const t = tableLayout()
    expect(t.halfLength).toBeCloseTo(L / 2, 6)
    expect(t.halfWidth).toBeCloseTo(L / 4, 6)
    // vendored ball radius within ~1.5% of a real 57.15mm ball
    expect(t.ballRadius).toBeCloseTo(0.028575, 3)
    expect(t.pockets).toHaveLength(6)
  })
})

describe('simulate', () => {
  it('straight center-ball shot stays on the aim line and comes to rest', () => {
    const sim = simulate([{ x: -0.6, y: 0 }], { angle: 0, speed: 1.5, side: 0, vertical: 0 })
    const [cue] = finalState(sim)
    expect(sim.duration).toBeGreaterThan(0.5)
    expect(sim.duration).toBeLessThan(30)
    expect(Math.abs(cue.y)).toBeLessThan(1e-3) // no sideways drift
    expect(cue.visible).toBe(true)
  })

  it('is deterministic', () => {
    const run = () =>
      simulate(
        [
          { x: -0.635, y: 0 },
          { x: 0.635, y: 0.02 },
        ],
        { angle: 0, speed: 3, side: 0, vertical: 0.2 },
      )
    const a = finalState(run())
    const b = finalState(run())
    expect(a).toEqual(b)
  })

  it('draw pulls the cue ball back behind the stun position after impact', () => {
    // Object ball offset in y so its rail return does not re-hit the cue ball.
    const balls = [
      { x: -0.4, y: -0.1 },
      { x: 0.2, y: -0.1 },
    ]
    const shot = { angle: 0, speed: 2, side: 0 }
    const plain = simulate(balls, { ...shot, vertical: 0 })
    const draw = simulate(balls, { ...shot, vertical: -0.45 })
    const tcPlain = firstCollisionTime(plain)
    const tcDraw = firstCollisionTime(draw)
    expect(tcPlain).toBeDefined()
    expect(tcDraw).toBeDefined()
    // sample shortly after impact: draw is moving backward relative to plain
    const xPlain = plain.stateAt(tcPlain! + 1)[0].x
    const xDraw = draw.stateAt(tcDraw! + 1)[0].x
    expect(xDraw).toBeLessThan(xPlain - 0.05)
    // and behind the contact point
    expect(xDraw).toBeLessThan(0.2)
  })

  it('follow pushes the cue ball forward past the plain-shot position after impact', () => {
    const balls = [
      { x: -0.4, y: -0.1 },
      { x: 0.2, y: -0.1 },
    ]
    const shot = { angle: 0, speed: 2, side: 0 }
    const plain = simulate(balls, { ...shot, vertical: 0 })
    const follow = simulate(balls, { ...shot, vertical: 0.45 })
    const tcPlain = firstCollisionTime(plain)!
    const tcFollow = firstCollisionTime(follow)!
    const xPlain = plain.stateAt(tcPlain + 1)[0].x
    const xFollow = follow.stateAt(tcFollow + 1)[0].x
    expect(xFollow).toBeGreaterThan(xPlain + 0.05)
  })

  it('cushion rebound: ball bounces back off the foot rail', () => {
    const sim = simulate([{ x: 0, y: 0.1 }], { angle: 0, speed: 2, side: 0, vertical: 0 })
    const [cue] = finalState(sim)
    expect(sim.events.some((e) => e.type === 'cushion')).toBe(true)
    expect(cue.x).toBeLessThan(L / 2 - 0.05) // came back off the rail
  })

  it('ball aimed straight into the corner pocket is potted', () => {
    const { pockets } = tableLayout()
    const corner = pockets.reduce((a, b) => (b.x + b.y > a.x + a.y ? b : a))
    const angle = Math.atan2(corner.y, corner.x)
    const sim = simulate([{ x: 0, y: 0 }], { angle, speed: 2.5, side: 0, vertical: 0 })
    expect(sim.events.some((e) => e.type === 'pot')).toBe(true)
    expect(finalState(sim)[0].visible).toBe(false)
  })

  it('stateAt is clamped and starts at the initial layout', () => {
    const sim = simulate([{ x: -0.3, y: 0.1 }], { angle: 0, speed: 1, side: 0, vertical: 0 })
    const s0 = sim.stateAt(-5)[0]
    expect(s0.x).toBeCloseTo(-0.3, 6)
    expect(s0.y).toBeCloseTo(0.1, 6)
    expect(sim.stateAt(9999)).toEqual(finalState(sim))
  })
})
