import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Mesh } from 'three'
import { useAppStore } from '../appStore'
import { DRILLS } from '../drills/drills'
import { tableLayout } from '../physics'
import { PLAYING_LENGTH } from '../registration/fitRectangle'

const BALL_COLORS = ['#f5f5f5', '#ffd11a', '#2b6bff', '#ff4136']

/**
 * Ghost balls at the drill's start layout; during playback the same meshes
 * are driven each frame from Simulation.stateAt — no React state per frame.
 */
export function DrillBalls() {
  const phase = useAppStore((s) => s.phase)
  const meshRefs = useRef<(Mesh | null)[]>([])

  const active = phase.name === 'ready' || phase.name === 'animating'
  const drill = active ? (DRILLS.find((d) => d.id === phase.drillId) ?? DRILLS[0]) : null
  const sizeClass = active ? phase.fit.sizeClass : null

  const layout = useMemo(() => (sizeClass ? tableLayout() : null), [sizeClass])

  const startPositions = useMemo(() => {
    if (!drill || !sizeClass) return []
    const L = PLAYING_LENGTH[sizeClass]
    return drill.balls.map(([fx, fy]) => ({ x: fx * L, y: fy * (L / 2) }))
  }, [drill, sizeClass])

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
        m.visible = b.visible
      })
    } else {
      startPositions.forEach((b, i) => {
        const m = meshRefs.current[i]
        if (!m) return
        m.position.set(b.x, r, b.y)
        m.visible = true
      })
    }
  })

  if (!drill || !layout) return null
  const playing = phase.name === 'animating'

  return (
    <group>
      {startPositions.map((_, i) => (
        <mesh key={`${drill.id}-${i}`} ref={(m) => void (meshRefs.current[i] = m)}>
          <sphereGeometry args={[layout.ballRadius, 24, 24]} />
          <meshBasicMaterial
            color={BALL_COLORS[i % BALL_COLORS.length]}
            transparent
            opacity={playing ? 0.95 : 0.55}
          />
        </mesh>
      ))}
    </group>
  )
}
