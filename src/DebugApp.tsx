import { useEffect } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { debugRegisterTable, useAppStore } from './appStore'
import { TableContents } from './scene/TableContents'
import { DrillBalls } from './scene/DrillBalls'
import { Button } from '@chakra-ui/react'
import { DRILLS } from './drills/drills'
import { useDrillText } from './i18n'
import styles from './DebugApp.module.css'

/**
 * Desktop route (?debug): renders the table-local content in a plain canvas
 * with orbit controls so drills and playback can be iterated without a phone.
 */
export function DebugApp() {
  const phase = useAppStore((s) => s.phase)
  const store = useAppStore()
  const drillText = useDrillText()

  useEffect(() => {
    if (phase.name === 'registering') debugRegisterTable('9ft')
  }, [phase.name])

  if (phase.name !== 'ready' && phase.name !== 'animating') return null

  return (
    <>
      <Canvas className={styles.canvas} camera={{ position: [0, 2.2, 2], fov: 50 }}>
        <color attach="background" args={['#15151c']} />
        <ambientLight intensity={1} />
        <gridHelper args={[6, 24, '#333', '#222']} />
        <TableContents sizeClass={phase.fit.sizeClass} showRails />
        <DrillBalls />
        <OrbitControls target={[0, 0, 0]} />
      </Canvas>
      <div className={styles.bar}>
        {DRILLS.map((d) => (
          <Button
            key={d.id}
            size="sm"
            variant={d.id === phase.drillId ? 'solid' : 'outline'}
            onClick={() => store.selectDrill(d.id)}
          >
            {drillText(d.id).name}
          </Button>
        ))}
        <Button size="sm" colorPalette="green" onClick={store.play}>
          {phase.name === 'animating' ? '↺ Replay' : '▶ Play shot'}
        </Button>
        {phase.name === 'animating' && (
          <Button size="sm" variant="outline" onClick={store.stopAnimation}>
            Reset
          </Button>
        )}
      </div>
    </>
  )
}
