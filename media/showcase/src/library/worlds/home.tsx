import {settled} from '../tokens';
import {STAGE, clamp01, partsOf} from './contract';
import {contracts} from './contracts';
import {FlatFigure, JoinGlow, PropsStack, Stage, reducedLine, type PropsLook} from './parts';
import type {SceneProps} from './types';

/** Today's look, unchanged: flat roles, the radiance under, the pale contour of the drawing. With `reduce` > 0 the fills go and the contour stays. */
const native: PropsLook = {fill: true, ink: settled.outline, lw: null, shading: true};

export const HomeScene: React.FC<SceneProps> = ({frame, pose, emitter, reduce = 0, shift, field, parts, blocking = STAGE, actorRoles}) => {
  const c = contracts.home;
  const r = clamp01(reduce);
  // the props stand once the world is whole: while a crossing reduces or refills it they are not drawn (the line phase holds the lines alone)
  const has = r === 0 && partsOf('home', parts).includes('actors') && Object.keys(blocking.actors ?? {}).length > 0;
  return (
    <Stage field={field ?? c.field} shift={shift}>
      <JoinGlow contract={c} emitter={emitter} opacity={1 - r} blocking={blocking} />
      <PropsStack contract={c} lineWorld={contracts.line} reduce={r} native={native} frame={frame} parts={partsOf('home', parts).filter((p) => p !== 'actors')} blocking={blocking} />
      {/* the props the beat's blocking names stand over the kit, and the light they hold (the box's seam, the gadget's dial) is drawn over them: under them they hid the emitter's core and the eye trace (C29) read a lit prop's edge as the light */}
      {has && <PropsStack contract={c} lineWorld={contracts.line} reduce={r} native={native} frame={frame} parts={['actors']} blocking={blocking} actorRoles={actorRoles} />}
      {has && <JoinGlow contract={c} emitter={emitter} opacity={1 - r} blocking={blocking} />}
      <FlatFigure pose={pose} fill={1 - r} line={r > 0 ? reducedLine(c, contracts.line, r, blocking) : null} blocking={blocking} />
    </Stage>
  );
};
