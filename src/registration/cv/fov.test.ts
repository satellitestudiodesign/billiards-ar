import { describe, it, expect } from 'vitest'
import { fovFromFocalEquiv, focalEquivFromHFov, intrinsicsFromHFov } from './fov'

describe('fov conversions', () => {
  it('50mm equiv is the ~40° "normal" lens; 24mm is wide', () => {
    expect(fovFromFocalEquiv(50).diag).toBeCloseTo(46.8, 0)
    expect(fovFromFocalEquiv(24).h).toBeCloseTo(73.7, 0) // typical phone main cam
  })

  it('focalEquiv <-> hFov round-trips', () => {
    const f = focalEquivFromHFov(fovFromFocalEquiv(26).h)
    expect(f).toBeCloseTo(26, 5)
  })

  it('intrinsics seed: fx gives back the requested hFov, centred pp', () => {
    const k = intrinsicsFromHFov(70, 1920, 1080)
    expect(2 * Math.atan(1920 / 2 / k.fx) * (180 / Math.PI)).toBeCloseTo(70, 5)
    expect(k.cx).toBe(960)
    expect(k.cy).toBe(540)
    expect(k.fx).toBe(k.fy)
  })
})
