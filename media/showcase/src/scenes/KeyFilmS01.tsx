import {AbsoluteFill, useCurrentFrame} from 'remotion';
import s01Keys from '../../v3/keys/s01-arrival-overwhelm.json';
import s01Poses from '../../v3/poses/s01-arrival-overwhelm.json';
import s02CantBuildKeys from '../../v3/keys/s02-cant-build.json';
import s02CantBuildPoses from '../../v3/poses/s02-cant-build.json';
import s02FrameKeys from '../../v3/keys/s02-the-frame.json';
import s02FramePoses from '../../v3/poses/s02-the-frame.json';
import s03Keys from '../../v3/keys/s03-scaffold.json';
import s03Poses from '../../v3/poses/s03-scaffold.json';
import s04Keys from '../../v3/keys/s04-settle.json';
import s04Poses from '../../v3/poses/s04-settle.json';
import partsFile from '../../assets/human/families/home/parts/parts.json';
import {STAGE} from '../library/worlds/contract';
import {FlatFigure} from '../library/worlds/parts';
import {applyOrder, defaultOrder, parseParts, type PartName} from '../library/motion/partsRig';
import {restPose} from '../library/cast/humanPose';
import {parsePoseSheet} from '../library/animation/pose';
import type {Joints} from '../library/motion';

/**
 * The film rig's figure alone, one key per frame, for the plate-versus-film measure of scripts/animation/measure-keys.py: the key's joints through `FlatFigure` (the component the film draws the human with)
 * in the order the film draws that key in (the parts rig's rule over the key's joints with its lead, under the pose sheet key's own `order`), on no background, at `KEY_FILM.scale` with the camera at identity.
 * Frame k is key k + 1 of the shot the `shot` prop names (default s01); the frame after the last key is the measure's control: for s01, key 1 with its right hand and its left upper leg exchanging their places in
 * the draw order (the hand goes behind the leg it hangs in front of) (`SWAP`); for any other shot measure-keys.py reads the picture of another key against the plate (the shot's own keys differ from each other).
 * `measure-keys.py` maps the picture back to mask space with the same numbers (canvas = 1.069414 x (mask - [31, 30]) + [10.065, 20], then `scale` and the offset below).
 */
export const KEY_FILM = {size: [1800, 1500] as const, scale: 0.9, x: 450, y: 420};
export const SWAP: {key: number; parts: PartName[]} = {key: 1, parts: ['upperLegL', 'handR']};
type KeyRow = {name: string; frame: number; joints: Joints};
const SHOTS: Record<string, {keys: KeyRow[]; poses: ReturnType<typeof parsePoseSheet>}> = Object.fromEntries(
  Object.entries({'s01-arrival-overwhelm': [s01Keys, s01Poses], 's02-cant-build': [s02CantBuildKeys, s02CantBuildPoses], 's02-the-frame': [s02FrameKeys, s02FramePoses], 's03-scaffold': [s03Keys, s03Poses], 's04-settle': [s04Keys, s04Poses]}).map(([shot, [k, p]]) => [
    shot,
    {keys: (k as unknown as {keys: KeyRow[]}).keys, poses: parsePoseSheet(structuredClone(p) as never)},
  ]),
);
const parts = parseParts(partsFile, restPose);
/** One frame per key of the shot's sheet and the control after the last (the composition's length follows the shot's sheet through `keyFilmFrames`). */
export const keyFilmFrames = (shot: string): number => {
  const s = SHOTS[shot];
  if (!s) throw new Error(`KeyFilm: no key sheet for shot "${shot}" (${Object.keys(SHOTS).join(', ')})`);
  return s.keys.length + 1;
};
export const KEY_FILM_FRAMES = keyFilmFrames('s01-arrival-overwhelm');

export const KeyFilmS01: React.FC<{shot?: string}> = ({shot = 's01-arrival-overwhelm'}) => {
  const frame = useCurrentFrame();
  const {keys, poses} = SHOTS[shot] ?? (() => { throw new Error(`KeyFilm: no key sheet for shot "${shot}"`); })();
  const index = frame >= keys.length ? SWAP.key - 1 : frame;
  const key = keys[index]!;
  const spec = poses.keys.find((k) => k.name === key.name)!;
  const base = applyOrder(defaultOrder(parts, key.joints, spec.lead, spec.weight.foot), spec.order);
  const order = frame === keys.length && shot === 's01-arrival-overwhelm' ? applyOrder(base, SWAP.parts) : base;
  return (
    <AbsoluteFill>
      <FlatFigure pose={key.joints} fill={1} line={null} blocking={{...STAGE, figure: {scale: KEY_FILM.scale, x: KEY_FILM.x, y: KEY_FILM.y}}} order={order} />
    </AbsoluteFill>
  );
};
