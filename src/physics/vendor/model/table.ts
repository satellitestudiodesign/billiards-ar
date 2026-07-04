// @ts-nocheck — vendored code (tailuge/billiards), not held to this project tsconfig
// Vendored from tailuge/billiards (GPL-3.0), commit 19532e3.
// MODIFIED for headless use: removed Cue, ProximityIndicator, ball meshes,
// serialisation and scene helpers (view/network layer). The simulation loop
// (advance / prepareAdvanceAll / collision handling) is unchanged.
// See ../README.md.
import { Cushion } from "./physics/cushion"
import { Collision } from "./physics/collision"
import { Knuckle } from "./physics/knuckle"
import { Pocket } from "./physics/pocket"
import { Ball } from "./ball"
import { TableGeometry } from "../view/tablegeometry"
import { Outcome } from "./outcome"
import { PocketGeometry } from "../view/pocketgeometry"
import { bounceHanBlend } from "./physics/physics"
import { R } from "./physics/constants"

interface Pair {
  a: Ball
  b: Ball
}

export class Table {
  balls: Ball[]
  pairs: Pair[]
  outcome: Outcome[] = []
  time = 0
  cueball: Ball
  cushionModel = bounceHanBlend

  constructor(balls: Ball[]) {
    this.cueball = balls[0]
    this.initialiseBalls(balls)
  }

  initialiseBalls(balls: Ball[]) {
    this.balls = balls
    this.pairs = []
    for (let a = 0; a < balls.length; a++) {
      for (let b = 0; b < balls.length; b++) {
        if (a < b) {
          this.pairs.push({ a: balls[a], b: balls[b] })
        }
      }
    }
  }

  advance(t: number) {
    this.time += t * 1000
    let depth = 0
    while (!this.prepareAdvanceAll(t)) {
      if (depth++ > 100) {
        throw new Error("Depth exceeded resolving collisions")
      }
    }
    this.balls.forEach((a) => {
      a.update(t)
      a.fround()
    })
  }

  /**
   * Returns true if all balls can advance by t without collision
   *
   */
  prepareAdvanceAll(t: number) {
    return (
      this.pairs.every((pair) => this.prepareAdvancePair(pair.a, pair.b, t)) &&
      this.balls.every((ball) => this.prepareAdvanceToCushions(ball, t))
    )
  }

  /**
   * Returns true if a pair of balls can advance by t without any collision.
   * If there is a collision, adjust velocity appropriately.
   *
   */
  private prepareAdvancePair(a: Ball, b: Ball, t: number) {
    if (Collision.willCollide(a, b, t)) {
      const incidentSpeed = Collision.collide(a, b)
      this.outcome.push(Outcome.collision(a, b, incidentSpeed, this.time))
      return false
    }
    return true
  }

  /**
   * Returns true if ball can advance by t without hitting cushion, knuckle or pocket.
   * If there is a collision, adjust velocity appropriately.
   *
   */
  private prepareAdvanceToCushions(a: Ball, t: number): boolean {
    if (!a.onTable()) {
      return true
    }
    const futurePosition = a.futurePosition(t)
    if (
      Math.abs(futurePosition.y) < TableGeometry.tableY &&
      Math.abs(futurePosition.x) < TableGeometry.tableX
    ) {
      return true
    }

    const incidentSpeed = Cushion.bounceAny(
      a,
      t,
      TableGeometry.hasPockets,
      this.cushionModel
    )
    if (incidentSpeed) {
      this.outcome.push(Outcome.cushion(a, incidentSpeed, this.time))
      return false
    }

    if (TableGeometry.hasPockets) {
      const k = Knuckle.findBouncing(a, t)
      if (k) {
        const knuckleIncidentSpeed = k.bounce(a)
        this.outcome.push(Outcome.cushion(a, knuckleIncidentSpeed, this.time))
        return false
      }
      const p = Pocket.findPocket(PocketGeometry.pocketCenters, a, t)
      if (p) {
        const pocketIncidentSpeed = p.fall(a, t)
        this.outcome.push(Outcome.pot(a, pocketIncidentSpeed, this.time))
        return false
      }
    }

    return true
  }

  allStationary() {
    return this.balls.every((b) => !b.inMotion())
  }

  inPockets(): number {
    return this.balls.reduce((acc, b) => (b.onTable() ? acc : acc + 1), 0)
  }

  halt() {
    this.balls.forEach((b) => {
      b.setStationary()
    })
  }

  overlapsAny(pos: Ball["pos"], excluding = this.cueball) {
    return this.balls
      .filter((b) => b !== excluding)
      .some((b) => b.pos.distanceTo(pos) < 2 * R)
  }
}