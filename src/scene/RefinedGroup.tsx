/**
 * Continuous registration refinement: while the table sits anchored, keep
 * re-detecting the felt in the camera image every few seconds, re-fit the
 * known-size rectangle, and low-pass a small pose correction into a wrapper
 * group. XR anchors drift by ~cm as you walk; this quietly pulls the overlay
 * back onto the real rails for the whole session.
 *
 * Deliberately conservative: corrections are gated (small translation/yaw
 * only, matching size class, low fit RMS) and EMA-smoothed, so a bad
 * detection can never yank the table. Runs only in the `ready` phase — never
 * mid-shot. Silent no-op wherever CV is unavailable (desktop, no
 * camera-access), because detectTableCorners fails cleanly.
 */
import { useRef, type ReactNode } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Matrix4, Plane, Quaternion, Vector3, type Group } from 'three'
import { useAppStore } from '../appStore'
import { fitTableRectangle, type RectFit } from '../registration/fitRectangle'
import { detectTableCorners } from '../registration/cv/detectTable'

/** How often to attempt a refinement detection (ms). */
const PERIOD_MS = 3000
/** Reject detections farther than this from the current pose. */
const MAX_POS = 0.08 // m
const MAX_YAW = (8 * Math.PI) / 180
/** Reject sloppy fits outright. */
const MAX_RMS = 0.04 // m
/** EMA weight per accepted measurement — several agreeing detections converge. */
const ALPHA = 0.25

const worldPos = new Vector3()
const worldQuat = new Quaternion()
const desiredWorld = new Matrix4()
const parentInv = new Matrix4()
const desiredLocal = new Matrix4()
const localPos = new Vector3()
const localQuat = new Quaternion()
const localScale = new Vector3()
const xAxis = new Vector3()
const curX = new Vector3()
const yFlip = new Quaternion()

export function RefinedGroup({ fit, children }: { fit: RectFit; children: ReactNode }) {
  const group = useRef<Group>(null)
  const gl = useThree((s) => s.gl)
  const nextRun = useRef(0)
  const busy = useRef(false)

  useFrame(() => {
    const g = group.current
    if (!g || !g.parent) return
    if (busy.current) return
    const now = performance.now()
    if (now < nextRun.current) return
    if (useAppStore.getState().phase.name !== 'ready') return
    nextRun.current = now + PERIOD_MS
    busy.current = true

    const parent = g.parent
    g.getWorldPosition(worldPos)
    g.getWorldQuaternion(worldQuat)
    const normal = new Vector3(0, 1, 0).applyQuaternion(worldQuat)
    const plane = new Plane().setFromNormalAndCoplanarPoint(normal, worldPos.clone())
    const curPos = worldPos.clone()
    const curQuat = worldQuat.clone()

    ;(async () => {
      const corners = await detectTableCorners(gl, plane)
      if (typeof corners === 'string') return
      let det: RectFit | undefined
      try {
        // Size class is settled at registration — refinement only ever
        // nudges pose, never re-decides the table size.
        det = fitTableRectangle(corners).all.find((f) => f.sizeClass === fit.sizeClass)
      } catch {
        return
      }
      if (!det || det.rms > MAX_RMS) return

      // The table is 180°-symmetric: align the detected long axis with the
      // current one before comparing yaw.
      xAxis.set(1, 0, 0).applyQuaternion(det.quaternion)
      curX.set(1, 0, 0).applyQuaternion(curQuat)
      const detQuat = det.quaternion.clone()
      if (xAxis.dot(curX) < 0) {
        yFlip.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI)
        detQuat.multiply(yFlip)
      }

      // Gates: a detection that disagrees wildly with the current pose is a
      // bad detection, not a huge drift — drop it.
      if (det.center.distanceTo(curPos) > MAX_POS) return
      if (curQuat.angleTo(detQuat) > MAX_YAW) return

      // Desired world pose → this group's local frame, then EMA toward it.
      const gg = group.current
      if (!gg || gg.parent !== parent) return
      desiredWorld.compose(det.center, detQuat, new Vector3(1, 1, 1))
      parentInv.copy(parent.matrixWorld).invert()
      desiredLocal.multiplyMatrices(parentInv, desiredWorld)
      desiredLocal.decompose(localPos, localQuat, localScale)
      gg.position.lerp(localPos, ALPHA)
      gg.quaternion.slerp(localQuat, ALPHA)
    })().finally(() => {
      busy.current = false
    })
  })

  return <group ref={group}>{children}</group>
}
