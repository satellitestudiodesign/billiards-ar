import { useEffect, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { IfInSessionMode, XR } from '@react-three/xr'
import { xrStore } from './xr/xrStore'
import { ARScene } from './scene/ARScene'
import { Overlay } from './ui/Overlay'
import { DebugApp } from './DebugApp'

export function App() {
  // ?debug — desktop route: table + drills + playback in a normal canvas
  if (new URLSearchParams(location.search).has('debug')) return <DebugApp />
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
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          textAlign: 'center',
          padding: 24,
          zIndex: 1,
        }}
      >
        <h1 style={{ margin: 0, fontSize: 28 }}>AR Billiards Trainer</h1>
        <p style={{ maxWidth: 420, opacity: 0.8 }}>
          Point your phone at a pool table, tap its four corners, and watch training drills play
          out on the real table.
        </p>
        <button
          onClick={() => xrStore.enterAR()}
          style={{
            padding: '14px 28px',
            fontSize: 18,
            borderRadius: 12,
            border: 'none',
            background: '#2b6bff',
            color: '#fff',
          }}
        >
          Enter AR
        </button>
        {supported === false && (
          <p style={{ color: '#ff8866', maxWidth: 420 }}>
            WebXR AR is not available in this browser. Use Chrome on Android. (iOS Safari has no
            WebXR yet.)
          </p>
        )}
        <p style={{ opacity: 0.5, fontSize: 13 }}>
          Desktop? Try the <a href="?debug" style={{ color: '#7db4ff' }}>debug table view</a>.
        </p>
      </div>
      <Canvas style={{ position: 'absolute', inset: 0 }}>
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
