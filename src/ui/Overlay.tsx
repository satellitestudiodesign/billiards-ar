import { useEffect, useRef, type ReactNode } from 'react'
import { Button, ChakraProvider } from '@chakra-ui/react'
import { XRDomOverlay, useXRStore } from '@react-three/xr'
import { useAppStore } from '../appStore'
import { useDrillText, useT } from '../i18n'
import { DRILLS } from '../drills/drills'
import { PLAYING_LENGTH, type SizeClass } from '../registration/fitRectangle'
import { system } from '../system'
import { markOverlayTap } from './overlayGuard'
import styles from './Overlay.module.css'

/**
 * XRDomOverlay portals its children out of the r3f Canvas into real DOM, but the
 * portal still reconciles inside the Canvas's separate renderer — app-level
 * React context (ChakraProvider) doesn't cross that boundary. Re-provide it here
 * so Chakra components inside the overlay get their theme system.
 */
function OverlayRoot({ children }: { children: ReactNode }) {
  return (
    <XRDomOverlay>
      <ChakraProvider value={system}>{children}</ChakraProvider>
    </XRDomOverlay>
  )
}

function Hint({ children }: { children: ReactNode }) {
  return <div className={styles.hint}>{children}</div>
}

/** 2D HTML UI composited over the camera feed via WebXR DOM overlay. */
export function Overlay() {
  const t = useT()
  const drillText = useDrillText()
  const phase = useAppStore((s) => s.phase)
  const message = useAppStore((s) => s.message)
  const store = useAppStore()
  const xrStore = useXRStore()
  const rootRef = useRef<HTMLDivElement>(null)
  const endSession = () => xrStore.getState().session?.end()

  // Prevent overlay taps from also firing XR 'select' (i.e. placing corners).
  // WebXR DOM overlay spec: cancel via beforexrselect. No React synthetic
  // event exists for it. VERIFY on-device; fallback = timestamp guard.
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const cancel = (e: Event) => e.preventDefault()
    el.addEventListener('beforexrselect', cancel)
    return () => el.removeEventListener('beforexrselect', cancel)
  }, [])

  if (phase.name === 'registering') {
    return (
      <OverlayRoot>
        <div ref={rootRef} onPointerDownCapture={markOverlayTap}>
          <div className={styles.topbar}>
            <div className={styles.title}>{t('detectTable')}</div>
            <Button variant="ghost" size="lg" boxSize="48px" aria-label={t('close')} onClick={endSession}>
              ✕
            </Button>
          </div>

          <div className={styles.panel}>
            {store.manual ? (
              <>
                <Hint>
                  {message ?? t('manualHint').replace('{n}', String(phase.corners.length + 1))}
                </Hint>
                {phase.corners.length > 0 && (
                  <div className={styles.row}>
                    <Button variant="outline" size="sm" onClick={store.undoCorner}>
                      {t('undoCorner')}
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <>
                <Hint>{message ?? t('autoHint')}</Hint>
                <div className={styles.row}>
                  <Button variant="outline" size="sm" onClick={() => store.setManual(true)}>
                    {t('enterManually')}
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      </OverlayRoot>
    )
  }

  return (
    <OverlayRoot>
      <div ref={rootRef} className={styles.panel} onPointerDownCapture={markOverlayTap}>
        {message && <Hint>⚠️ {message}</Hint>}

        {phase.name === 'confirming' && (
          <>
            <Hint>
              {t('fit')
                .replace('{size}', phase.chosen)
                .replace('{cm}', (currentRms(phase) * 100).toFixed(1))}
              {currentRms(phase) > 0.03 && t('fitHigh')}
            </Hint>
            <div className={styles.row}>
              {(Object.keys(PLAYING_LENGTH) as SizeClass[]).map((sz) => (
                <Button
                  key={sz}
                  size="sm"
                  variant={sz === phase.chosen ? 'solid' : 'outline'}
                  onClick={() => store.chooseSize(sz)}
                >
                  {sz}
                </Button>
              ))}
            </div>
            <div className={styles.row}>
              <Button size="sm" onClick={store.acceptFit}>
                {t('looksRight')}
              </Button>
              <Button size="sm" variant="outline" onClick={store.redoRegistration}>
                {t('redoCorners')}
              </Button>
            </div>
          </>
        )}

        {(phase.name === 'ready' || phase.name === 'animating') && (
          <>
            <div className={styles.row}>
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
            </div>
            <Hint>
              {(() => {
                const d = DRILLS.find((d) => d.id === phase.drillId)
                return d ? drillText(d.id).description : ''
              })()}
            </Hint>
            <div className={styles.row}>
              <Button size="sm" onClick={store.play}>
                {phase.name === 'animating' ? t('replay') : t('play')}
              </Button>
              {phase.name === 'animating' && (
                <Button size="sm" variant="outline" onClick={store.stopAnimation}>
                  {t('resetBalls')}
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={store.redoRegistration}>
                {t('reRegister')}
              </Button>
              <Button size="sm" variant="outline" onClick={endSession}>
                {t('exitAR')}
              </Button>
            </div>
          </>
        )}
      </div>
    </OverlayRoot>
  )
}

function currentRms(phase: { result: { all: { sizeClass: string; rms: number }[] }; chosen: string }) {
  return phase.result.all.find((f) => f.sizeClass === phase.chosen)?.rms ?? 0
}
