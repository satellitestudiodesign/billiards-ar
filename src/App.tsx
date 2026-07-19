import { useEffect, useState } from 'react'
import { Button, Heading, Link, Text } from '@chakra-ui/react'
import { Canvas } from '@react-three/fiber'
import { IfInSessionMode, XR } from '@react-three/xr'
import { useI18n, useT, type Lang } from './i18n'
import { xrStore } from './xr/xrStore'
import { ARScene } from './scene/ARScene'
import { Overlay } from './ui/Overlay'
import { DebugApp } from './DebugApp'
import { DetectDebug } from './DetectDebug'
import { LabelDebug } from './LabelDebug'
import styles from './App.module.css'

export function App() {
  const params = new URLSearchParams(location.search)
  // ?detect — desktop route: run the felt detector on a picked photo
  if (params.has('detect')) return <DetectDebug />
  // ?label — desktop route: hand-correct felt-mask training labels
  if (params.has('label')) return <LabelDebug />
  // ?debug — desktop route: table + drills + playback in a normal canvas
  if (params.has('debug')) return <DebugApp />
  return <ARApp />
}

function LangSelector() {
  const lang = useI18n((s) => s.lang)
  const setLang = useI18n((s) => s.setLang)
  return (
    <div style={{ position: 'fixed', top: 16, right: 16, display: 'flex', gap: 8, zIndex: 10 }}>
      {(['en', 'es'] as Lang[]).map((l) => (
        <Button
          key={l}
          size="sm"
          variant={l === lang ? 'solid' : 'outline'}
          onClick={() => setLang(l)}
        >
          {l.toUpperCase()}
        </Button>
      ))}
    </div>
  )
}

function ARApp() {
  const t = useT()
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
        <LangSelector />
        <Heading size="2xl">{t('title')}</Heading>
        <Text maxW="420px" opacity={0.8}>
          {t('intro')}
        </Text>
        <Button size="lg" onClick={() => xrStore.enterAR()}>
          {t('enterAR')}
        </Button>
        {supported === false && (
          <Text maxW="420px" color="orange.300">
            {t('notSupported')}
          </Text>
        )}
        <Text fontSize="sm" opacity={0.5}>
          {t('desktopPrefix')}
          <Link href="?debug" colorPalette="blue">
            {t('debugLink')}
          </Link>
          {' · '}
          <Link href="?detect" colorPalette="blue">
            {t('detectLink')}
          </Link>
          {' · '}
          <Link href="?label" colorPalette="blue">
            label
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
