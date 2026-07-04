import { Line } from '@react-three/drei'
import { useAppStore } from '../appStore'
import { RegistrationScene } from './RegistrationScene'
import { AnchoredTable } from './AnchoredTable'

/** Routes the 3D scene by app phase. Lives inside <XR> in an AR session. */
export function ARScene() {
  const phase = useAppStore((s) => s.phase)

  if (phase.name === 'registering') return <RegistrationScene />

  if (phase.name === 'confirming') {
    const fit = phase.result.all.find((f) => f.sizeClass === phase.chosen) ?? phase.result.best
    const pts = [...fit.corners, fit.corners[0]].map(
      (c) => [c.x, c.y + 0.002, c.z] as [number, number, number],
    )
    return <Line points={pts} color="#7dffb0" lineWidth={3} />
  }

  return <AnchoredTable fit={phase.fit} />
}
