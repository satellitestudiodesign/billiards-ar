/**
 * Lazy OpenCV.js (wasm) loader.
 *
 * opencv.js is ~9 MB and initialises its wasm heap asynchronously, so we load
 * it once, on demand, and hand every caller the same ready `cv` object. The
 * three-branch dance below is straight from @techstark/opencv-js's README:
 * depending on build, the default export is a Promise, an already-initialised
 * module, or a module that fires `onRuntimeInitialized` when the wasm is up.
 *
 * ponytail: single module-level promise = one download, deduped concurrent
 * callers. Kick it off early with `preloadOpenCv()` so the first Auto-detect
 * isn't stalled behind the wasm download.
 */
import type cvModule from '@techstark/opencv-js'

// The typings export the cv namespace's members; the runtime value is the
// module object. `Mat` presence is the "already initialised" signal.
type Cv = typeof cvModule

let readyPromise: Promise<Cv> | null = null

export function loadOpenCv(): Promise<Cv> {
  if (readyPromise) return readyPromise
  readyPromise = (async () => {
    // Dynamic import so the ~9 MB wasm-in-js lands in its own chunk, fetched
    // on demand — NOT bundled into the main app entry.
    const mod = (await import('@techstark/opencv-js')).default as unknown as
      | Promise<Cv>
      | (Cv & { onRuntimeInitialized?: () => void })
    if (mod instanceof Promise) return mod
    if (mod.Mat) return mod
    await new Promise<void>((resolve) => {
      mod.onRuntimeInitialized = resolve
    })
    return mod
  })()
  return readyPromise
}

/** Fire-and-forget: start the wasm download without blocking. */
export function preloadOpenCv(): void {
  void loadOpenCv().catch(() => {
    /* swallow — detectQuadCv falls back to the heuristic detector */
  })
}
