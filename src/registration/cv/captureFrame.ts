/**
 * Grab one frame from the WebXR raw camera as CPU-readable RGBA pixels.
 *
 * DEVICE-ONLY and untestable in the emulator. Returns null on any failure —
 * feature unsupported, permission denied, readback error — so the caller
 * always has manual tapping to fall back on. This is the highest-risk file in
 * the CV pipeline; keep the failure path clean.
 *
 * VERIFY on-device (Android Chrome): (1) `raw-camera-access` must be an enabled
 * optional feature on the session; (2) three.js issue #33404 — camera texture
 * readback crashes on some driver/version combos; (3) the image frustum may not
 * match the render camera (see projectToPlane's calibration note).
 */
import type { WebGLRenderer } from 'three'

// @types/webxr ships the base WebXR types but not the camera-access module.
// Augment just the members this file touches.
declare global {
  interface XRView {
    readonly camera?: XRCamera
  }
  interface XRCamera {
    readonly width: number
    readonly height: number
  }
  interface XRWebGLBinding {
    getCameraImage(camera: XRCamera): WebGLTexture | null
  }
}

export interface CameraCapture {
  image: ImageData
  width: number
  height: number
}

/** Wait for one XRFrame, or null if none arrives within `timeoutMs`. */
function nextFrame(session: XRSession, timeoutMs = 500): Promise<XRFrame | null> {
  return new Promise((resolve) => {
    let done = false
    const finish = (f: XRFrame | null) => {
      if (done) return
      done = true
      resolve(f)
    }
    session.requestAnimationFrame((_t, f) => finish(f))
    setTimeout(() => finish(null), timeoutMs)
  })
}

export async function captureCameraFrame(renderer: WebGLRenderer): Promise<CameraCapture | null> {
  const session = renderer.xr.getSession()
  const refSpace = renderer.xr.getReferenceSpace()
  if (!session || !refSpace) return null
  const gl = renderer.getContext() as WebGL2RenderingContext

  const frame = await nextFrame(session)
  if (!frame) return null

  try {
    const view = frame.getViewerPose(refSpace)?.views[0]
    const xrCamera = view?.camera
    if (!xrCamera) return null // raw-camera-access not granted/supported

    const binding = new XRWebGLBinding(session, gl)
    const texture = binding.getCameraImage(xrCamera)
    if (!texture) return null
    const { width, height } = xrCamera

    // Read the camera texture back to CPU through an offscreen framebuffer.
    const fbo = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.deleteFramebuffer(fbo)
      return null
    }
    const raw = new Uint8Array(width * height * 4)
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, raw)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.deleteFramebuffer(fbo)

    // readPixels origin is bottom-left; ImageData is top-left. Flip rows.
    const flipped = new Uint8ClampedArray(width * height * 4)
    const rowBytes = width * 4
    for (let y = 0; y < height; y++) {
      const src = (height - 1 - y) * rowBytes
      flipped.set(raw.subarray(src, src + rowBytes), y * rowBytes)
    }
    return { image: new ImageData(flipped, width, height), width, height }
  } catch {
    return null
  }
}
