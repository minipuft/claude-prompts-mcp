import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {settled} from '../library/tokens';
import {HumanPuppet} from '../library/cast/HumanPuppet';

/** Puppet proof: the generated human assembled and lifting both arms on twos, companions absent, black field. */
export const PuppetProof: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{background: settled.field}}>
      <HumanPuppet frame={frame} liftAt={24} scale={0.68} x={420} y={40} />
    </AbsoluteFill>
  );
};
