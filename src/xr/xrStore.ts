import { createXRStore } from '@react-three/xr'

/**
 * Module singleton, like the pmndrs examples. hitTest/anchors/domOverlay are
 * the WebXR features the manual flow needs; screen-input taps work by default
 * in handheld AR. On localhost without native WebXR the store injects the
 * IWER emulator, so the flow is smoke-testable on desktop.
 *
 * `camera-access` (optional) enables CV auto-registration (raw camera frames →
 * table detection). It's optional: if the browser/device denies it the session
 * still starts and auto-detect degrades to manual corner tapping.
 *
 * ponytail: @react-three/xr 6.6 has no passthrough for extra optional features,
 * and `customSessionInit` *replaces* the auto-built init (including the
 * dom-overlay root). So we own the whole init here and share one overlay root
 * element. Revisit if the lib later exposes an `optionalFeatures` option.
 */
const domOverlayRoot = typeof document !== 'undefined' ? document.createElement('div') : undefined

export const xrStore = createXRStore({
  hitTest: true,
  anchors: true,
  domOverlay: domOverlayRoot,
  customSessionInit: {
    requiredFeatures: ['local-floor'],
    optionalFeatures: ['anchors', 'hit-test', 'dom-overlay', 'camera-access'],
    ...(domOverlayRoot ? { domOverlay: { root: domOverlayRoot } } : {}),
  },
})
