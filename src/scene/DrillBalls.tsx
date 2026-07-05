import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useTexture } from '@react-three/drei'
import { Euler, Quaternion, type Mesh } from 'three'
import { useAppStore } from '../appStore'
import { DRILLS } from '../drills/drills'
import { tableLayout } from '../physics'
import { PLAYING_LENGTH } from '../registration/fitRectangle'

// All ball face textures keyed by basename ('cue', '1'..'15').
const BALL_TEXTURE_URLS = Object.fromEntries(
  Object.entries(
    import.meta.glob('../assets/textures/balls/*.png', {
      eager: true,
      import: 'default',
    }) as Record<string, string>,
  ).map(([path, url]) => [path.split('/').pop()!.replace('.png', ''), url]),
)

// Scratch quat for composing physics spin over a ball's random rack orientation.
const spinQ = new Quaternion()
const rand = () => Math.random() * Math.PI * 2

/**
 * Ghost balls at the drill's start layout; during playback the same meshes
 * are driven each frame from Simulation.stateAt — no React state per frame.
 */
export function DrillBalls() {
  const phase = useAppStore((s) => s.phase)
  const meshRefs = useRef<(Mesh | null)[]>([])
  const textures = useTexture(BALL_TEXTURE_URLS)


  const active = phase.name === 'ready' || phase.name === 'animating'
  const drill = active ? (DRILLS.find((d) => d.id === phase.drillId) ?? DRILLS[0]) : null
  const sizeClass = active ? phase.fit.sizeClass : null

  const layout = useMemo(() => (sizeClass ? tableLayout() : null), [sizeClass])

  const startPositions = useMemo(() => {
    if (!drill || !sizeClass) return []
    const L = PLAYING_LENGTH[sizeClass]
    return drill.balls.map((b) => ({ x: b.x * L, y: b.y * (L / 2) }))
  }, [drill, sizeClass])

  // Random rack orientation per ball, fresh each rack. Display-only — physics
  // spin (snapshot.rot) is composed on top of it, so numbers face every way.
  const rackRot = useMemo(
    () =>
      drill?.balls.map(
        () => new Quaternion().setFromEuler(new Euler(rand(), rand(), rand())),
      ) ?? [],
    [drill?.id],
  )

  useFrame(() => {
    if (!layout) return
    const r = layout.ballRadius
    if (phase.name === 'animating') {
      const t = performance.now() / 1000 - phase.startedAt
      const snap = phase.sim.stateAt(t)
      snap.forEach((b, i) => {
        const m = meshRefs.current[i]
        if (!m) return
        m.position.set(b.x, r + Math.min(0, b.z), b.y)
        spinQ.set(b.rot[0], b.rot[1], b.rot[2], b.rot[3])
        m.quaternion.multiplyQuaternions(spinQ, rackRot[i])
        m.visible = b.visible
      })
    } else {
      startPositions.forEach((b, i) => {
        const m = meshRefs.current[i]
        if (!m) return
        m.position.set(b.x, r, b.y)
        m.quaternion.copy(rackRot[i])
        m.visible = true
      })
    }
  })

  if (!drill || !layout) return null
  const playing = phase.name === 'animating'

  return (
    <group>
      {startPositions.map((_, i) => {
        const num = drill.balls[i].num !== undefined ? drill.balls[i].num?.toString() : 'cue'
        return (
          <mesh key={`${drill.id}-${i}`} ref={(m) => void (meshRefs.current[i] = m)}>
            <sphereGeometry args={[layout.ballRadius, 24, 24]} />
            <meshBasicMaterial
              map={textures[num]}
              color={'#ffffff'}
              transparent
              opacity={playing ? 0.95 : 0.55}
            />
          </mesh>
        )
      })}
    </group>
  )
}
