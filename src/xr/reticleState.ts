import { Matrix4, Quaternion, Vector3 } from 'three'

/**
 * Per-frame hit-test result shared between the hit-test callback, the reticle
 * mesh and the tap handler. Deliberately NOT React state (updates every XR
 * frame). Position is a rolling average of the last few hit-test frames to
 * damp jitter before a corner is confirmed.
 */
const WINDOW = 5

class ReticleState {
  visible = false
  readonly position = new Vector3()
  readonly quaternion = new Quaternion()
  private readonly buffer: Vector3[] = []
  private readonly scratch = new Vector3()
  private readonly scratchScale = new Vector3()

  update(matrix: Matrix4) {
    matrix.decompose(this.scratch, this.quaternion, this.scratchScale)
    this.buffer.push(this.scratch.clone())
    if (this.buffer.length > WINDOW) this.buffer.shift()
    this.position.set(0, 0, 0)
    for (const p of this.buffer) this.position.addScaledVector(p, 1 / this.buffer.length)
    this.visible = true
  }

  miss() {
    this.visible = false
    this.buffer.length = 0
  }
}

export const reticle = new ReticleState()
