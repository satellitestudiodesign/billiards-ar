import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import { XRDomOverlay, useXRStore } from '@react-three/xr'
import { useAppStore } from '../appStore'
import { DRILLS } from '../drills/drills'
import { PLAYING_LENGTH, type SizeClass } from '../registration/fitRectangle'

const panel: CSSProperties = {
  position: 'absolute',
  left: 0,
  right: 0,
  bottom: 0,
  padding: '12px 16px calc(12px + env(safe-area-inset-bottom))',
  background: 'rgba(10, 10, 20, 0.72)',
  color: '#fff',
  fontFamily: 'system-ui, sans-serif',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
}

const btn: CSSProperties = {
  padding: '10px 14px',
  borderRadius: 10,
  border: '1px solid rgba(255,255,255,0.3)',
  background: 'rgba(255,255,255,0.12)',
  color: '#fff',
  fontSize: 15,
}

const btnPrimary: CSSProperties = { ...btn, background: '#2b6bff', border: 'none' }
const row: CSSProperties = { display: 'flex', gap: 8, flexWrap: 'wrap' }

function Hint({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 14, lineHeight: 1.35 }}>{children}</div>
}

/** 2D HTML UI composited over the camera feed via WebXR DOM overlay. */
export function Overlay() {
  const phase = useAppStore((s) => s.phase)
  const message = useAppStore((s) => s.message)
  const store = useAppStore()
  const xrStore = useXRStore()
  const rootRef = useRef<HTMLDivElement>(null)

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

  return (
    <XRDomOverlay>
      <div ref={rootRef} style={panel}>
        {message && <Hint>⚠️ {message}</Hint>}

        {phase.name === 'registering' && (
          <>
            <Hint>
              Aim the ring at corner <b>{phase.corners.length + 1} of 4</b> of the playing surface
              (where the cushion noses meet) and tap the screen. Go around the table in order.
            </Hint>
            <div style={row}>
              {phase.corners.length === 0 && (
                <button style={btnPrimary} onClick={store.requestAutoDetect}>
                  ✨ Auto-detect
                </button>
              )}
              {phase.corners.length > 0 && (
                <button style={btn} onClick={store.undoCorner}>
                  Undo corner
                </button>
              )}
              <ExitButton />
            </div>
          </>
        )}

        {phase.name === 'confirming' && (
          <>
            <Hint>
              Fit: <b>{phase.chosen}</b> table, corner error{' '}
              <b>{(currentRms(phase) * 100).toFixed(1)} cm</b>
              {currentRms(phase) > 0.03 && ' — high, consider redoing'}
            </Hint>
            <div style={row}>
              {(Object.keys(PLAYING_LENGTH) as SizeClass[]).map((s) => (
                <button
                  key={s}
                  style={s === phase.chosen ? btnPrimary : btn}
                  onClick={() => store.chooseSize(s)}
                >
                  {s}
                </button>
              ))}
            </div>
            <div style={row}>
              <button style={btnPrimary} onClick={store.acceptFit}>
                Looks right
              </button>
              <button style={btn} onClick={store.redoRegistration}>
                Redo corners
              </button>
            </div>
          </>
        )}

        {(phase.name === 'ready' || phase.name === 'animating') && (
          <>
            <div style={row}>
              {DRILLS.map((d) => (
                <button
                  key={d.id}
                  style={d.id === phase.drillId ? btnPrimary : btn}
                  onClick={() => store.selectDrill(d.id)}
                >
                  {d.name}
                </button>
              ))}
            </div>
            <Hint>{DRILLS.find((d) => d.id === phase.drillId)?.description}</Hint>
            <div style={row}>
              <button style={btnPrimary} onClick={store.play}>
                {phase.name === 'animating' ? '↺ Replay' : '▶ Play shot'}
              </button>
              {phase.name === 'animating' && (
                <button style={btn} onClick={store.stopAnimation}>
                  Reset balls
                </button>
              )}
              <button style={btn} onClick={store.redoRegistration}>
                Re-register
              </button>
              <ExitButton />
            </div>
          </>
        )}
      </div>
    </XRDomOverlay>
  )

  function ExitButton() {
    return (
      <button style={btn} onClick={() => xrStore.getState().session?.end()}>
        Exit AR
      </button>
    )
  }
}

function currentRms(phase: { result: { all: { sizeClass: string; rms: number }[] }; chosen: string }) {
  return phase.result.all.find((f) => f.sizeClass === phase.chosen)?.rms ?? 0
}
