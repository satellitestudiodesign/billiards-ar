import { useEffect, useState } from 'react'
import { Button, Heading, Link, Text } from '@chakra-ui/react'
import { Canvas } from '@react-three/fiber'
import { IfInSessionMode, XR } from '@react-three/xr'
import { xrStore } from './xr/xrStore'
import { ARScene } from './scene/ARScene'
import { Overlay } from './ui/Overlay'
import { DebugApp } from './DebugApp'
import { DetectDebug } from './DetectDebug'
import styles from './App.module.css'

export function App() {
  const params = new URLSearchParams(location.search)
  // ?detect — desktop route: run the felt detector on a picked photo
  if (params.has('detect')) return <DetectDebug />
  // ?debug — desktop route: table + drills + playback in a normal canvas
  if (params.has('debug')) return <DebugApp />
  return <ARApp />
}

function ARApp() {
  const [supported, setSupported] = useState<boolean | null>(null)
  useEffect(() => {
    if (!navigator.xr) {
      setSupported(false)
      return
    }
    navigator.xr
      .isSessionSupported('immersive-ar')
      .then(setSupported)
      .catch(() => setSupported(false))
  }, [])

  return (
    <>
      <div className={styles.intro}>
        <Heading size="2xl">AR Billiards Trainer</Heading>
        <Text maxW="420px" opacity={0.8}>
          Point your phone at a pool table, tap its four corners, and watch training drills play
          out on the real table.
        </Text>
        <Button size="lg" onClick={() => xrStore.enterAR()}>
          Enter AR
        </Button>
        {supported === false && (
          <Text maxW="420px" color="orange.300">
            WebXR AR is not available in this browser. Use Chrome on Android. (iOS Safari has no
            WebXR yet.)
          </Text>
        )}
        <Text fontSize="sm" opacity={0.5}>
          Desktop? Try the{' '}
          <Link href="?debug" colorPalette="blue">
            debug table view
          </Link>
          .
        </Text>
      </div>
      <Canvas className={styles.canvas}>
        <XR store={xrStore}>
          <IfInSessionMode allow="immersive-ar">
            <ambientLight intensity={1} />
            <ARScene />
            <Overlay />
          </IfInSessionMode>
        </XR>
      </Canvas>
    </>
  )
}
