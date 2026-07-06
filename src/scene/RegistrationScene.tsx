import { useEffect, useRef } from 'react'
import { Matrix4, Vector3, type Group } from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { Billboard, Text } from '@react-three/drei'
import { useXRHitTest, useXRInputSourceEvent } from '@react-three/xr'
import { useAppStore } from '../appStore'
import { reticle } from '../xr/reticleState'
import { detectTableCorners } from '../registration/cv/detectTable'
import { preloadOpenCv } from '../registration/cv/opencv'
import { planeFromPose } from '../registration/cv/projectToPlane'
import { CornerConsensus } from '../registration/cornerConsensus'
import { overlayTappedRecently } from '../ui/overlayGuard'

const scratchMatrix = new Matrix4()

const TRACK_LOST = 'Move the phone slowly over the felt — no surface detected'
/** How long the reticle must miss before the tracking-lost toast shows (ms). */
const TRACK_LOST_DELAY = 1200

/**
 * Auto-detect lock-on tuning. One-shot detection is fragile (glare frame,
 * arm over a rail); instead we sample detections for up to `timeoutMs` and
 * accept the running median once frames agree.
 */
const LOCK = {
  timeoutMs: 4000,
  /** Pause between detection passes. Detecting at full frame rate buys
   *  nothing (consensus needs ~6 samples) and the capture+CV churn at that
   *  rate OOM-crashed the tab on-device. */
  intervalMs: 150,
  /** Samples + agreement required for a confident early lock. */
  minSamples: 6,
  maxSpread: 0.015, // m
  /** Timeout fallback: accept a looser consensus rather than fail outright. */
  minTimeoutSamples: 3,
  okSpread: 0.03, // m
}

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

  // Start the OpenCV wasm download as soon as we're in the registration scene,
  // so the first Auto-detect isn't stalled behind a ~9 MB fetch.
  useEffect(() => {
    preloadOpenCv()
  }, [])

  // Live consensus preview: the lock-on loop writes the running median corners
  // here; useFrame mirrors them onto 4 ghost markers so the user sees the
  // detection converge ("lock on") in place.
  const ghost = useRef<{ corners: Vector3[]; visible: boolean }>({ corners: [], visible: false })
  const ghostGroupRef = useRef<Group>(null)

  // CV auto-registration lock-on: on each requestAutoDetect() (autoNonce bump),
  // sample camera-frame detections for up to LOCK.timeoutMs, back-projecting
  // each onto the reticle's plane and feeding a CornerConsensus. Submit the
  // median corners once frames agree; any failure falls back to manual tapping.
  useEffect(() => {
    if (autoNonce === 0) return
    let cancelled = false
    const fail = (msg: string) => {
      if (!cancelled) useAppStore.setState({ message: msg, autoDetecting: false })
    }
    ;(async () => {
      if (!reticle.visible) return fail('Point the phone at the table')
      const consensus = new CornerConsensus()
      const deadline = performance.now() + LOCK.timeoutMs

      while (!cancelled && performance.now() < deadline) {
        await new Promise((r) => setTimeout(r, LOCK.intervalMs))
        if (cancelled || useAppStore.getState().manual) return
        // Fresh plane each pass — the jitter-averaged reticle keeps improving
        // (and keeps its last pose during brief tracking misses).
        const normal = new Vector3(0, 1, 0).applyQuaternion(reticle.quaternion)
        const plane = planeFromPose(reticle.position, normal)

        // detectTableCorners awaits an XRFrame internally, so this loop is
        // frame-paced, not a busy spin.
        const res = await detectTableCorners(gl, plane)
        if (cancelled) return
        if (res === 'no-camera') {
          ghost.current.visible = false
          return fail('Auto-detect unavailable on this device — tap the 4 corners')
        }
        if (typeof res === 'string') continue // transient miss — keep sampling

        consensus.add(res)
        ghost.current = { corners: consensus.medians(), visible: true }
        useAppStore.setState({ message: `Locking on… ${consensus.count}/${LOCK.minSamples}` })
        if (consensus.count >= LOCK.minSamples && consensus.spread() <= LOCK.maxSpread) {
          ghost.current.visible = false
          useAppStore.setState({ autoDetecting: false })
        useAppStore.getState().submitCorners(consensus.medians())
          return
        }
      }

      ghost.current.visible = false
      if (cancelled) return
      // Timed out: accept a looser consensus over failing outright.
      if (consensus.count >= LOCK.minTimeoutSamples && consensus.spread() <= LOCK.okSpread) {
        useAppStore.setState({ autoDetecting: false })
        useAppStore.getState().submitCorners(consensus.medians())
        return
      }
      // Retry: the frame-loop kick below re-triggers while still in auto mode.
      fail('Move around the table so all four corners are visible')
    })()
    return () => {
      cancelled = true
      ghost.current.visible = false
    }
  }, [autoNonce, gl])
  // Tracking-lost toast: track when the reticle first started missing and
  // whether we've already shown the toast, so the store is written only on
  // transitions (not every frame).
  const missSince = useRef<number | null>(null)
  const toastShown = useRef(false)
  // Throttle auto-detect re-kicks so a failed pass waits a beat before retrying.
  const nextAutoAt = useRef(0)

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
      // Ignore selects that are really UI taps (beforexrselect fallback).
      if (overlayTappedRecently()) return
      if (phase.name === 'registering' && reticle.visible) {
        addCorner(reticle.position)
      }
    },
    [phase.name, addCorner],
  )

  useFrame(() => {
    const gg = ghostGroupRef.current
    if (gg) {
      gg.visible = ghost.current.visible && ghost.current.corners.length === 4
      if (gg.visible) ghost.current.corners.forEach((c, i) => gg.children[i]?.position.copy(c))
    }

    const g = reticleRef.current
    if (!g) return
    g.visible = reticle.visible
    g.position.copy(reticle.position)
    g.quaternion.copy(reticle.quaternion)

    const now = performance.now()

    // Auto-start / retry detection: while in auto mode with a locked reticle and
    // no pass running, kick a detection loop. Failed passes clear autoDetecting,
    // so this retries them after the cooldown.
    const st = useAppStore.getState()
    if (phase.name === 'registering' && !st.manual && !st.autoDetecting && reticle.visible && now >= nextAutoAt.current) {
      nextAutoAt.current = now + 800
      st.requestAutoDetect()
    }

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
      {/* Lock-on ghost: running median of the auto-detect consensus. Watching
          these settle onto the real corners is the "locking on" feedback. */}
      <group ref={ghostGroupRef} visible={false}>
        {[0, 1, 2, 3].map((i) => (
          <mesh key={i}>
            <sphereGeometry args={[0.015, 12, 12]} />
            <meshBasicMaterial color="#00e5ff" transparent opacity={0.8} />
          </mesh>
        ))}
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
