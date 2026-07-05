import { useEffect, useRef } from 'react'
import { Matrix4, PerspectiveCamera, Vector3, type Group } from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { Billboard, Text } from '@react-three/drei'
import { useXRHitTest, useXRInputSourceEvent } from '@react-three/xr'
import { useAppStore } from '../appStore'
import { reticle } from '../xr/reticleState'
import { captureCameraFrame } from '../registration/cv/captureFrame'
import { detectQuad } from '../registration/cv/detectQuad'
import { planeFromPose, projectToPlane } from '../registration/cv/projectToPlane'

const scratchMatrix = new Matrix4()

const TRACK_LOST = 'Move the phone slowly over the felt — no surface detected'
/** How long the reticle must miss before the tracking-lost toast shows (ms). */
const TRACK_LOST_DELAY = 1200

/**
 * Corner-tapping flow: a viewer hit-test reticle at screen center; each
 * screen tap confirms the (jitter-averaged) reticle position as one corner.
 */
export function RegistrationScene() {
  const phase = useAppStore((s) => s.phase)
  const addCorner = useAppStore((s) => s.addCorner)
  const autoNonce = useAppStore((s) => s.autoNonce)
  const reticleRef = useRef<Group>(null)
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)

  // CV auto-registration: on each requestAutoDetect() (autoNonce bump), grab a
  // camera frame, detect the felt quad, back-project onto the reticle's plane,
  // and submit the 4 world corners. Any failure falls back to manual tapping.
  useEffect(() => {
    if (autoNonce === 0) return
    let cancelled = false
    const fail = (msg: string) => {
      if (!cancelled) useAppStore.setState({ message: msg })
    }
    ;(async () => {
      if (!reticle.visible) return fail('Point the ring at the felt first, then Auto-detect')
      // Snapshot camera pose+projection now; the async capture lets it drift.
      const snap = new PerspectiveCamera()
      snap.matrixWorld.copy(camera.matrixWorld)
      snap.matrixWorldInverse.copy(camera.matrixWorld).invert()
      snap.projectionMatrix.copy(camera.projectionMatrix)
      snap.projectionMatrixInverse.copy(camera.projectionMatrix).invert()
      const normal = new Vector3(0, 1, 0).applyQuaternion(reticle.quaternion)
      const plane = planeFromPose(reticle.position, normal)

      const cap = await captureCameraFrame(gl)
      if (cancelled) return
      if (!cap) return fail('Auto-detect unavailable on this device — tap the 4 corners')
      const quad = detectQuad(cap.image)
      if (!quad) return fail("Couldn't find the felt — aim at the whole table or tap the 4 corners")
      const world = projectToPlane(quad, cap.width, cap.height, snap, plane)
      if (!world) return fail('Table not in view — tap the 4 corners')
      if (!cancelled) useAppStore.getState().submitCorners(world)
    })()
    return () => {
      cancelled = true
    }
  }, [autoNonce, gl, camera])
  // Tracking-lost toast: track when the reticle first started missing and
  // whether we've already shown the toast, so the store is written only on
  // transitions (not every frame).
  const missSince = useRef<number | null>(null)
  const toastShown = useRef(false)

  useXRHitTest((results, getWorldMatrix) => {
    if (results.length > 0 && getWorldMatrix(scratchMatrix, results[0])) {
      reticle.update(scratchMatrix)
    } else {
      reticle.miss()
    }
  }, 'viewer')

  useXRInputSourceEvent(
    'all',
    'select',
    () => {
      if (phase.name === 'registering' && reticle.visible) {
        addCorner(reticle.position)
      }
    },
    [phase.name, addCorner],
  )

  useFrame(() => {
    const g = reticleRef.current
    if (!g) return
    g.visible = reticle.visible
    g.position.copy(reticle.position)
    g.quaternion.copy(reticle.quaternion)

    const now = performance.now()
    if (reticle.visible) {
      missSince.current = null
      if (toastShown.current) {
        toastShown.current = false
        if (useAppStore.getState().message === TRACK_LOST) useAppStore.setState({ message: null })
      }
    } else {
      if (missSince.current === null) missSince.current = now
      else if (now - missSince.current > TRACK_LOST_DELAY && !toastShown.current) {
        toastShown.current = true
        useAppStore.setState({ message: TRACK_LOST })
      }
    }
  })

  const corners = phase.name === 'registering' ? phase.corners : []

  return (
    <>
      {/* Pocket-shaped reticle: line the dark "hole" up with the real corner
          pocket. Sized to a corner-pocket mouth (~11 cm across → ~0.055 m
          radius). Crosshair marks the exact tap point (cushion-nose meet). */}
      <group ref={reticleRef} visible={false}>
        <mesh rotation-x={-Math.PI / 2} renderOrder={0}>
          <circleGeometry args={[0.055, 40]} />
          <meshBasicMaterial color="#050505" transparent opacity={0.72} />
        </mesh>
        <mesh rotation-x={-Math.PI / 2} renderOrder={1}>
          <ringGeometry args={[0.055, 0.066, 40]} />
          <meshBasicMaterial color="#ffcc00" />
        </mesh>
        <mesh rotation-x={-Math.PI / 2} renderOrder={2}>
          <ringGeometry args={[0.001, 0.004, 16]} />
          <meshBasicMaterial color="#ffffff" />
        </mesh>
      </group>
      {corners.map((c, i) => (
        <group key={i} position={c}>
          <mesh>
            <sphereGeometry args={[0.02, 16, 16]} />
            <meshBasicMaterial color="#ffcc00" />
          </mesh>
          <Billboard position={[0, 0.045, 0]}>
            <Text fontSize={0.035} color="#ffcc00" anchorX="center" anchorY="middle" outlineWidth={0.004} outlineColor="#000">
              {i + 1}
            </Text>
          </Billboard>
        </group>
      ))}
    </>
  )
}
