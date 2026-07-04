import { useRef } from 'react'
import { Matrix4, type Group } from 'three'
import { useFrame } from '@react-three/fiber'
import { useXRHitTest, useXRInputSourceEvent } from '@react-three/xr'
import { useAppStore } from '../appStore'
import { reticle } from '../xr/reticleState'

const scratchMatrix = new Matrix4()

/**
 * Corner-tapping flow: a viewer hit-test reticle at screen center; each
 * screen tap confirms the (jitter-averaged) reticle position as one corner.
 */
export function RegistrationScene() {
  const phase = useAppStore((s) => s.phase)
  const addCorner = useAppStore((s) => s.addCorner)
  const reticleRef = useRef<Group>(null)

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
  })

  const corners = phase.name === 'registering' ? phase.corners : []

  return (
    <>
      <group ref={reticleRef} visible={false}>
        <mesh rotation-x={-Math.PI / 2}>
          <ringGeometry args={[0.04, 0.05, 32]} />
          <meshBasicMaterial color="white" />
        </mesh>
        <mesh rotation-x={-Math.PI / 2}>
          <circleGeometry args={[0.008, 16]} />
          <meshBasicMaterial color="white" />
        </mesh>
      </group>
      {corners.map((c, i) => (
        <mesh key={i} position={c}>
          <sphereGeometry args={[0.02, 16, 16]} />
          <meshBasicMaterial color="#ffcc00" />
        </mesh>
      ))}
    </>
  )
}
