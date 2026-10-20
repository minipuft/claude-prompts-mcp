import {AbsoluteFill, useCurrentFrame} from 'remotion';
import keysFile from '../../v3/keys/s01-arrival-overwhelm.json';
import {STAGE} from '../library/worlds/contract';
import {FlatFigure} from '../library/worlds/parts';
import {applyOrder, type PartName} from '../library/motion/partsRig';
import type {Joints} from '../library/motion';
import {describeFrame} from '../library/animation/keys';
import {partsOrderAt, sheet} from './shotS01Plan';

/**
 * The film rig's figure alone, one key per frame, for the plate-versus-film measure of scripts/animation/measure-keys.py: the key's joints through `FlatFigure` (the component the film draws the human with)
 * in the order the film draws that key in (`partsOrderAt` of the key's own frame), on no background, at `KEY_FILM.scale` with the camera at identity. Frame k is key k + 1; the frame after the
 * last key is the measure's control: key 1 with its right hand and its left upper leg exchanging their places in the draw order (the hand goes behind the leg it hangs in front of) (`SWAP`).
 * `measure-keys.py` maps the picture back to mask space with the same numbers (canvas = 1.069414 x (mask - [31, 30]) + [10.065, 20], then `scale` and the offset below).
 */
export const KEY_FILM = {size: [1800, 1500] as const, scale: 0.9, x: 450, y: 420};
export const SWAP: {key: number; parts: PartName[]} = {key: 1, parts: ['upperLegL', 'handR']};
const keys = keysFile.keys as unknown as {name: string; frame: number; joints: Joints}[];
/** One frame per key of the sheet and the control after the last: the composition's length follows the sheet, so a key added to it is measured (it was a literal 9 and measured the first 8 keys of 11). */
export const KEY_FILM_FRAMES = keys.length + 1;

export const KeyFilmS01: React.FC = () => {
  const frame = useCurrentFrame();
  const index = frame >= keys.length ? SWAP.key - 1 : frame;
  const key = keys[index]!;
  const info = describeFrame(sheet, key.frame);
  const base = partsOrderAt(key.joints, info);
  const order = frame === keys.length ? applyOrder(base, SWAP.parts) : base;
  return (
    <AbsoluteFill>
      <FlatFigure pose={key.joints} fill={1} line={null} blocking={{...STAGE, figure: {scale: KEY_FILM.scale, x: KEY_FILM.x, y: KEY_FILM.y}}} order={order} />
    </AbsoluteFill>
  );
};
