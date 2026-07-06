import { useEffect, useRef } from 'react'
import { XRSpace, useXRAnchor } from '@react-three/xr'
import type { RectFit } from '../registration/fitRectangle'
import { TableContents } from './TableContents'
import { DrillBalls } from './DrillBalls'
import { RefinedGroup } from './RefinedGroup'

/**
 * Creates one XR anchor at the fitted table pose and renders all table-local
 * content in the anchor's space. Until the anchor resolves (or if anchors are
 * unsupported, e.g. desktop emulator) it falls back to rendering at the
 * fitted world pose directly.
 */
export function AnchoredTable({ fit }: { fit: RectFit }) {
  const [anchor, requestAnchor] = useXRAnchor()
  const requested = useRef<RectFit | null>(null)

  useEffect(() => {
    if (requested.current === fit) return
    requested.current = fit
    requestAnchor({
      relativeTo: 'world',
      worldPosition: fit.center,
      worldQuaternion: fit.quaternion,
    })
  }, [fit, requestAnchor])

  // RefinedGroup continuously re-detects the felt and low-passes small pose
  // corrections, cancelling anchor drift and residual registration bias.
  const contents = (
    <RefinedGroup fit={fit}>
      <TableContents sizeClass={fit.sizeClass} />
      <DrillBalls />
    </RefinedGroup>
  )

  if (anchor) {
    return <XRSpace space={anchor.anchorSpace}>{contents}</XRSpace>
  }
  return (
    <group position={fit.center} quaternion={fit.quaternion}>
      {contents}
    </group>
  )
}
