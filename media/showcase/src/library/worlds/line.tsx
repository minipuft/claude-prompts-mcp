import {STAGE, partsOf} from './contract';
import {contracts} from './contracts';
import {Radiance} from '../Radiance';
import {FlatFigure, PropsStack, Stage, reducedLine, type PropsLook} from './parts';
import type {SceneProps} from './types';

/**
 * The line world: contour only. The figure is read off its own drawing (silhouette band plus colour-region edges), the props are redrawn
 * as strokes at the contract's width with their fills cleared and their stipple hidden, radiance off, and the arch, the gates and the floor are
 * strokes too (StageStrokes). No fill is drawn anywhere. The world has no light of its own; its contract's `radiance.on` is what lets the beat carry an emitter at all, and the world draws it only for a piece the beat's blocking lights (an actor with `lit`, the stalk
 * the human carries in the crossing, sp-6.1): its lines are the brightest thing in the picture, so the eye (C29) finds the piece and not the grid, and that light is drawn here, on the emitter the beat names, confined
 * to a box around it so it never reaches the figure's own lines.
 */
const native: PropsLook = {fill: false, ink: null, lw: null, shading: false};

export const LineScene: React.FC<SceneProps> = ({frame, pose, shift, field, parts, blocking = STAGE, emitter}) => {
  const c = contracts.line;
  const litPiece = emitter?.lit !== undefined;
  return (
    <Stage field={field ?? c.field} shift={shift}>
      {litPiece && (
        <div style={{position: 'absolute', inset: 0}}>
          <Radiance emitter={emitter} motes={0} grain={0} mask={{x: emitter.x - 0.6 * emitter.radius, y: emitter.y - 0.5 * emitter.radius, width: 1.2 * emitter.radius, height: emitter.radius}} seed={4} />
        </div>
      )}
      <PropsStack contract={c} lineWorld={c} reduce={1} native={native} frame={frame} parts={partsOf('line', parts)} blocking={blocking} />
      <FlatFigure pose={pose} fill={0} line={reducedLine(c, c, 1, blocking)} blocking={blocking} />
    </Stage>
  );
};
