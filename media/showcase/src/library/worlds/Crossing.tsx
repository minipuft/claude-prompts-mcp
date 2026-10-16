import {interpolateColors} from 'remotion';
import type {Blocking} from '../animation/blocking';
import type {Emitter} from '../Radiance';
import {jointParents, restPose} from '../cast/humanPose';
import {onTwos, poseAt, type PoseChart} from '../motion';
import type {RoleMap} from '../tokens';
import {clamp01} from './contract';
import {contracts} from './contracts';
import {worlds} from './index';
import type {PropsPart, WorldId} from './types';

type Props = {
  from: WorldId;
  to: WorldId;
  frame: number;
  /** First frame of the crossing and its length in frames. */
  start: number;
  length: number;
  /** The human's keys; omitted = the rest pose. */
  chart?: PoseChart;
  /** The move's leading line (D64) as a vector in screen pixels: the contours slide along it while nothing is filled. */
  lead: [number, number];
  /** Frames of [reduce, pure line, refill]; default is thirds of `length`. */
  phases?: [number, number, number];
  /** Narrows every world's drawn parts to this list (a measurement drops `floor`); omitted = each world's own. */
  parts?: PropsPart[];
  /** Where everything stands; omitted = the test scene. */
  blocking?: Blocking;
  /** The join's light, given to whichever world is drawing; omitted = each world's own. */
  emitter?: Emitter;
  /** The roles the beat's props are filled with, given to whichever world is drawing. */
  actorRoles?: RoleMap;
};

const smooth = (t: number): number => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};

/** Fills under 8 % or over 92 % are dropped to 0 or 1: at that strength the stipple is speckle, not a fill. */
const settle = (r: number): number => (r < 0.08 ? 0 : r > 0.92 ? 1 : r);

/**
 * The line-world operator (D78): every crossing between worlds goes through the line world. `from` reduces to its contour lines (fills fade
 * out, lines stay), the lines hold alone while they slide along the leading line, then `to` refills around them. There is only ever one
 * render at a time (the `from` world reducing, the line world, the `to` world refilling): fills go out and come in, lines are never dissolved
 * against a second copy of themselves. Everything steps on twos (the drawn layer), so the crossing reads as drawn, not tweened.
 */
export const Crossing: React.FC<Props> = ({from, to, frame, start, length, chart, lead, phases, parts, blocking, emitter, actorRoles}) => {
  const f = onTwos(frame);
  const [reduceLen, holdLen, refillLen] = phases ?? [length / 3, length / 3, length / 3];
  const t = f - start;
  const pose = chart ? poseAt(chart, frame, jointParents) : restPose;
  const line = contracts.line;

  if (t < reduceLen) {
    const r = settle(smooth(t / reduceLen));
    const World = worlds[from];
    const field = r > 0 ? interpolateColors(r, [0, 1], [World.contract.field, line.field]) : undefined;
    return <World.Scene frame={frame} pose={pose} reduce={t <= 0 ? 0 : r} field={field} parts={parts} blocking={blocking} emitter={emitter} actorRoles={actorRoles} />;
  }
  if (t < reduceLen + holdLen) {
    const e = smooth((t - reduceLen) / holdLen);
    const Line = worlds.line;
    return <Line.Scene frame={frame} pose={pose} shift={[lead[0] * e, lead[1] * e]} parts={parts} blocking={blocking} emitter={emitter} actorRoles={actorRoles} />;
  }
  const u = settle(smooth((t - reduceLen - holdLen) / refillLen));
  const World = worlds[to];
  if (u >= 1) return <World.Scene frame={frame} pose={pose} parts={parts} blocking={blocking} emitter={emitter} actorRoles={actorRoles} />;
  const field = interpolateColors(u, [0, 1], [line.field, World.contract.field]);
  return <World.Scene frame={frame} pose={pose} reduce={1 - u} shift={[lead[0] * (1 - u), lead[1] * (1 - u)]} field={field} parts={parts} blocking={blocking} emitter={emitter} actorRoles={actorRoles} />;
};
