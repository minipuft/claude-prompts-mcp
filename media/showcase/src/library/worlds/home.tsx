import {settled} from '../tokens';
import {STAGE, clamp01, partsOf} from './contract';
import {contracts} from './contracts';
import {FlatFigure, JoinGlow, PropsStack, Stage, reducedLine, type PropsLook} from './parts';
import type {SceneProps} from './types';

/** Today's look, unchanged: flat roles, the radiance under, the pale contour of the drawing. With `reduce` > 0 the fills go and the contour stays. */
const native: PropsLook = {fill: true, ink: settled.outline, lw: null, shading: true};

export const HomeScene: React.FC<SceneProps> = ({frame, pose, emitter, reduce = 0, shift, field, parts, blocking = STAGE}) => {
  const c = contracts.home;
  const r = clamp01(reduce);
  return (
    <Stage field={field ?? c.field} shift={shift}>
      <JoinGlow contract={c} emitter={emitter} opacity={1 - r} blocking={blocking} />
      <PropsStack contract={c} lineWorld={contracts.line} reduce={r} native={native} frame={frame} parts={partsOf('home', parts)} blocking={blocking} />
      <FlatFigure pose={pose} fill={1 - r} line={r > 0 ? reducedLine(c, contracts.line, r, blocking) : null} blocking={blocking} />
    </Stage>
  );
};
