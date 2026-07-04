import { createXRStore } from '@react-three/xr'

/**
 * Module singleton, like the pmndrs examples. hitTest/anchors/domOverlay are
 * the three WebXR features this app needs; screen-input taps work by default
 * in handheld AR. On localhost without native WebXR the store injects the
 * IWER emulator, so the flow is smoke-testable on desktop.
 */
export const xrStore = createXRStore({
  hitTest: true,
  anchors: true,
  domOverlay: true,
})
