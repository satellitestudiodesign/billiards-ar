import { useEffect } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { debugRegisterTable, useAppStore } from './appStore'
import { TableContents } from './scene/TableContents'
import { DrillBalls } from './scene/DrillBalls'
import { DRILLS } from './drills/drills'

/**
 * Desktop route (?debug): renders the table-local content in a plain canvas
 * with orbit controls so drills and playback can be iterated without a phone.
 */
export function DebugApp() {
  const phase = useAppStore((s) => s.phase)
  const store = useAppStore()

  useEffect(() => {
    if (phase.name === 'registering') debugRegisterTable('9ft')
  }, [phase.name])

  if (phase.name !== 'ready' && phase.name !== 'animating') return null

  return (
    <>
      <Canvas
        style={{ position: 'absolute', inset: 0 }}
        camera={{ position: [0, 2.2, 2], fov: 50 }}
      >
        <color attach="background" args={['#15151c']} />
        <ambientLight intensity={1} />
        <gridHelper args={[6, 24, '#333', '#222']} />
        <TableContents sizeClass={phase.fit.sizeClass} showRails />
        <DrillBalls />
        <OrbitControls target={[0, 0, 0]} />
      </Canvas>
      <div
        style={{
          position: 'absolute',
          bottom: 12,
          left: 12,
          right: 12,
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
          fontFamily: 'system-ui',
        }}
      >
        {DRILLS.map((d) => (
          <button
            key={d.id}
            onClick={() => store.selectDrill(d.id)}
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              border: 'none',
              background: d.id === phase.drillId ? '#2b6bff' : '#333',
              color: '#fff',
            }}
          >
            {d.name}
          </button>
        ))}
        <button
          onClick={store.play}
          style={{
            padding: '8px 16px',
            borderRadius: 8,
            border: 'none',
            background: '#1db954',
            color: '#fff',
          }}
        >
          {phase.name === 'animating' ? '↺ Replay' : '▶ Play shot'}
        </button>
        {phase.name === 'animating' && (
          <button
            onClick={store.stopAnimation}
            style={{ padding: '8px 12px', borderRadius: 8, border: 'none', background: '#555', color: '#fff' }}
          >
            Reset
          </button>
        )}
      </div>
    </>
  )
}
