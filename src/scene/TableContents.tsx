import { useMemo } from 'react'
import { Line } from '@react-three/drei'
import { tableLayout } from '../physics'
import type { SizeClass } from '../registration/fitRectangle'

/**
 * Table-local overlay: felt, playing-surface outline, pockets, spots.
 * Physics point (x, y) renders at three.js table-local (x, 0, y); +y up.
 * Deliberately low-fi — registration accuracy matters, visuals don't.
 */
export function TableContents({ sizeClass }: { sizeClass: SizeClass }) {
  const layout = useMemo(() => tableLayout(), [sizeClass])
  const { halfLength: hl, halfWidth: hw } = layout

  const outline = useMemo(
    () =>
      [
        [-hl, 0.002, -hw],
        [hl, 0.002, -hw],
        [hl, 0.002, hw],
        [-hl, 0.002, hw],
        [-hl, 0.002, -hw],
      ] as [number, number, number][],
    [hl, hw],
  )

  const circle = (r: number) =>
    Array.from({ length: 33 }, (_, i) => {
      const a = (i / 32) * Math.PI * 2
      return [Math.cos(a) * r, 0, Math.sin(a) * r] as [number, number, number]
    })

  return (
    <group>
      <mesh rotation-x={-Math.PI / 2}>
        <planeGeometry args={[hl * 2, hw * 2]} />
        <meshBasicMaterial color="#0a5c36" transparent opacity={0.25} depthWrite={false} />
      </mesh>
      <Line points={outline} color="#7dffb0" lineWidth={2} />
      {layout.pockets.map((p, i) => (
        <group key={i} position={[p.x, 0.002, p.y]}>
          <Line points={circle(p.radius)} color="#ff8844" lineWidth={2} />
        </group>
      ))}
      {Object.entries(layout.spots).map(([k, [x, y]]) => (
        <mesh key={k} position={[x, 0.002, y]} rotation-x={-Math.PI / 2}>
          <circleGeometry args={[0.012, 16]} />
          <meshBasicMaterial color="#ffffff" />
        </mesh>
      ))}
    </group>
  )
}
