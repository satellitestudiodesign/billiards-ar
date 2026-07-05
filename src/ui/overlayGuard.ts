/**
 * Fallback for `beforexrselect` not suppressing XR `select` on some Android
 * builds: taps on the DOM overlay UI also fire a WebXR `select`, which would
 * place a table corner. We record the timestamp of the last overlay tap and
 * have the corner handler ignore any `select` that lands within GUARD_MS of it.
 *
 * Corner taps happen on the camera area (outside the overlay panel), so they
 * never record a timestamp and are never suppressed.
 */
const GUARD_MS = 500

let lastOverlayTap = -Infinity

/** Call from the overlay panel's pointerdown. */
export function markOverlayTap(): void {
  lastOverlayTap = performance.now()
}

/** True if an overlay tap happened within the guard window. */
export function overlayTappedRecently(): boolean {
  return performance.now() - lastOverlayTap < GUARD_MS
}
