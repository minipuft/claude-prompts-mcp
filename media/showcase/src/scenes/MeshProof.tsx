import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {settled} from '../library/tokens';
import {MeshFigure} from '../library/cast/MeshFigure';
import {jointParents, liftChart} from '../library/cast/humanPose';
import {poseAt} from '../library/motion';

/**
 * Mesh proof (D73): the 90-frame lift of PuppetProof, driven through the ARAP mesh instead of nested cutouts. Three keys in
 * `liftChart` (rest held to 24, the raise with overshoot at 36, the settle at 50); poseAt steps them on twos with breakdowns at 1/3 and 2/3.
 * Same scale and position as PuppetProof (0.68 at x 420, y 40), black field, companions absent.
 */
export const MeshProof: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{background: settled.field}}>
      <MeshFigure pose={poseAt(liftChart, frame, jointParents)} scale={0.68} x={420} y={40} />
    </AbsoluteFill>
  );
};
