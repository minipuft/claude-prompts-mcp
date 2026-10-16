import {STAGE, partsOf} from './contract';
import {contracts} from './contracts';
import {FlatFigure, PropsStack, Stage, reducedLine, type PropsLook} from './parts';
import type {SceneProps} from './types';

/**
 * The line world: contour only. The figure is read off its own drawing (silhouette band plus colour-region edges), the props are redrawn
 * as strokes at the contract's width with their fills cleared and their stipple hidden, radiance off, and the arch, the gates and the floor are
 * strokes too (StageStrokes). No fill is drawn anywhere.
 */
const native: PropsLook = {fill: false, ink: null, lw: null, shading: false};

export const LineScene: React.FC<SceneProps> = ({frame, pose, shift, field, parts, blocking = STAGE}) => {
  const c = contracts.line;
  return (
    <Stage field={field ?? c.field} shift={shift}>
      <PropsStack contract={c} lineWorld={c} reduce={1} native={native} frame={frame} parts={partsOf('line', parts)} blocking={blocking} />
      <FlatFigure pose={pose} fill={0} line={reducedLine(c, c, 1, blocking)} blocking={blocking} />
    </Stage>
  );
};
