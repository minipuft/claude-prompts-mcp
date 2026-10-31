import {AbsoluteFill} from 'remotion';
import {fonts} from '../design';
import {listBreakdowns, type KeySheet} from '../library/animation/keys';
import {settled} from '../library/tokens';
import {STAGE} from '../library/worlds/contract';
import {FlatFigure} from '../library/worlds/parts';

const MODEL_SCALE = 0.36;
const COLUMN = 410;

/**
 * Pose sheet (row 1.5): a shot's named keys side by side at model scale, in the home world's figure renderer (the flat mesh, untouched), each
 * labelled with its name, frame and hold, with the breakdowns the chart plays printed beneath (authored ones and the automatic thirds).
 */
export const PoseSheet: React.FC<{sheet: KeySheet}> = ({sheet}) => {
  const ink = settled.kit.light;
  const breakdowns = listBreakdowns(sheet);
  return (
    <AbsoluteFill style={{background: settled.field, fontFamily: fonts.mono, color: ink}}>
      <div style={{position: 'absolute', left: 40, top: 24, fontSize: 22, fontFamily: fonts.sans, fontWeight: 600}}>
        Pose sheet · {sheet.shot} · {sheet.actor} {sheet.provisional ? '· provisional (placeholder keys)' : ''}
      </div>
      {sheet.keys.map((k, i) => (
        <div key={k.name}>
          <FlatFigure pose={k.joints} fill={1} line={null} blocking={{...STAGE, figure: {scale: MODEL_SCALE, x: 90 + i * COLUMN, y: 195}}} />
          <div style={{position: 'absolute', left: 60 + i * COLUMN, top: 80, fontSize: 20, fontWeight: 700}}>{k.name}</div>
          <div style={{position: 'absolute', left: 60 + i * COLUMN, top: 108, fontSize: 14, color: settled.kit.main2}}>
            frame {k.frame} · hold {k.hold ?? 0}
          </div>
        </div>
      ))}
      <div style={{position: 'absolute', left: 40, right: 40, bottom: 16, fontSize: 13, lineHeight: 1.5, color: settled.kit.main2}}>
        {breakdowns.length
          ? breakdowns.map((b) => `${b.between[0]} > ${b.between[1]}: breakdown on frame ${b.frame} favouring ${b.favour.toFixed(2)} (${b.authored ? 'authored' : 'automatic'})`).join('   ·   ')
          : 'no breakdowns'}
      </div>
    </AbsoluteFill>
  );
};
