import { useMemo } from 'react'
import { Line } from '@react-three/drei'
import { tableLayout } from '../physics'
import type { SizeClass } from '../registration/fitRectangle'

/**
 * Table-local overlay: felt, playing-surface outline, pockets, spots, and rail
 * sight diamonds. Physics point (x, y) renders at three.js table-local
 * (x, 0, y); +y up. Deliberately low-fi — registration accuracy matters.
 */
export function TableContents({
  sizeClass,
  showRails = false,
}: {
  sizeClass: SizeClass
  showRails?: boolean
}) {
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

  // Standard sight diamonds: 6 per long rail (¼/½/¾ each side of the side
  // pocket), 3 per short rail (¼/½/¾), sitting just outside the cushion line.
  const sights = useMemo(() => {
    const m = 0.035 // outward offset from the nose line
    const lx = [1, 2, 3].flatMap((k) => [(k / 4) * hl, -(k / 4) * hl])
    const sy = [-hw / 2, 0, hw / 2]
    const pts: [number, number][] = []
    lx.forEach((x) => pts.push([x, hw + m], [x, -(hw + m)]))
    sy.forEach((y) => pts.push([hl + m, y], [-(hl + m), y]))
    return pts
  }, [hl, hw])

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

      {/* circleGeometry with 4 segments laid flat = a diamond sight */}
      {showRails &&
        sights.map(([x, z], i) => (
          <mesh key={i} position={[x, 0.002, z]} rotation-x={-Math.PI / 2}>
            <circleGeometry args={[0.015, 4]} />
            <meshBasicMaterial color="#ffffff" />
          </mesh>
        ))}

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
