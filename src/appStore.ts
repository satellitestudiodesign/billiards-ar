import { create } from 'zustand'
import { Quaternion, Vector3 } from 'three'
import {
  fitTableRectangle,
  PLAYING_LENGTH,
  type FitResult,
  type RectFit,
  type SizeClass,
} from './registration/fitRectangle'
import { configureTableSize, simulate, type Simulation } from './physics'
import { DRILLS, resolveShot } from './drills/drills'

export type Phase =
  | { name: 'registering'; corners: Vector3[] }
  | { name: 'confirming'; result: FitResult; chosen: SizeClass }
  | { name: 'ready'; fit: RectFit; drillId: string }
  | {
      name: 'animating'
      fit: RectFit
      drillId: string
      sim: Simulation
      /** performance.now()/1000 at playback start. */
      startedAt: number
    }

interface AppState {
  phase: Phase
  /** Transient user-facing hint/error shown in the overlay. */
  message: string | null
  addCorner(p: Vector3): void
  undoCorner(): void
  chooseSize(s: SizeClass): void
  acceptFit(): void
  redoRegistration(): void
  selectDrill(id: string): void
  play(): void
  stopAnimation(): void
}

const chosenFit = (result: FitResult, chosen: SizeClass): RectFit =>
  result.all.find((f) => f.sizeClass === chosen) ?? result.best

export const useAppStore = create<AppState>((set, get) => ({
  phase: { name: 'registering', corners: [] },
  message: null,

  addCorner(p) {
    const { phase } = get()
    if (phase.name !== 'registering') return
    const corners = [...phase.corners, p.clone()]
    if (corners.length < 4) {
      set({ phase: { name: 'registering', corners }, message: null })
      return
    }
    try {
      const result = fitTableRectangle(corners)
      set({
        phase: { name: 'confirming', result, chosen: result.best.sizeClass },
        message: result.ambiguous ? 'Similar fit for two sizes — pick your table size' : null,
      })
    } catch (e) {
      set({
        phase: { name: 'registering', corners: [] },
        message: `That doesn't look like a table (${(e as Error).message}) — tap the 4 corners again`,
      })
    }
  },

  undoCorner() {
    const { phase } = get()
    if (phase.name !== 'registering') return
    set({ phase: { name: 'registering', corners: phase.corners.slice(0, -1) } })
  },

  chooseSize(s) {
    const { phase } = get()
    if (phase.name !== 'confirming') return
    set({ phase: { ...phase, chosen: s }, message: null })
  },

  acceptFit() {
    const { phase } = get()
    if (phase.name !== 'confirming') return
    const fit = chosenFit(phase.result, phase.chosen)
    configureTableSize(PLAYING_LENGTH[fit.sizeClass])
    set({ phase: { name: 'ready', fit, drillId: DRILLS[0].id }, message: null })
  },

  redoRegistration() {
    set({ phase: { name: 'registering', corners: [] }, message: null })
  },

  selectDrill(id) {
    const { phase } = get()
    if (phase.name === 'ready' || phase.name === 'animating') {
      set({ phase: { name: 'ready', fit: phase.fit, drillId: id } })
    }
  },

  play() {
    const { phase } = get()
    if (phase.name !== 'ready' && phase.name !== 'animating') return
    const drill = DRILLS.find((d) => d.id === phase.drillId) ?? DRILLS[0]
    const L = PLAYING_LENGTH[phase.fit.sizeClass]
    configureTableSize(L)
    const balls = drill.balls.map(([fx, fy]) => ({ x: fx * L, y: fy * (L / 2) }))
    const sim = simulate(balls, resolveShot(drill, balls))
    set({
      phase: {
        name: 'animating',
        fit: phase.fit,
        drillId: drill.id,
        sim,
        startedAt: performance.now() / 1000,
      },
    })
  },

  stopAnimation() {
    const { phase } = get()
    if (phase.name !== 'animating') return
    set({ phase: { name: 'ready', fit: phase.fit, drillId: phase.drillId } })
  },
}))

/** Debug/desktop entry: jump straight to `ready` with an identity table pose. */
export function debugRegisterTable(sizeClass: SizeClass = '9ft') {
  configureTableSize(PLAYING_LENGTH[sizeClass])
  useAppStore.setState({
    phase: {
      name: 'ready',
      drillId: DRILLS[0].id,
      fit: {
        sizeClass,
        rms: 0,
        center: new Vector3(),
        quaternion: new Quaternion(),
        corners: [new Vector3(), new Vector3(), new Vector3(), new Vector3()],
      },
    },
  })
}
