import {Img, staticFile} from 'remotion';
import rig from '../../../assets/human/rig.json';
import manifest from '../../../assets/human/parts.json';
import faces from '../../../assets/human/face/faces.json';
import {onTwos, move, lag, house} from '../motion';

/**
 * The human as a cutout puppet (D65/D68/D69): generated parts from studies/human-gen-18-parts, cut by scripts/cutout.py,
 * assembled by assets/human/rig.json. Nothing here is drawn; the component only places and rotates parts about their pivots.
 * Hierarchy is resolved by nesting: a child part lives inside its parent's rotated frame, so a shoulder turn carries the forearm and hand.
 * A child whose z is below its parent's draws behind the parent (the hair behind the head); the rest draw over it.
 * The drawn layer moves on twos (poses are sampled with onTwos); `lift` 0..1 raises both arms with a lagged forearm and hand.
 */
type RigPart = {src: string; anchor: [number, number]; pivot: [number, number]; parent: string | null; z: number};
const parts = rig.parts as unknown as Record<string, RigPart>;
const boxes = Object.fromEntries((manifest as {parts: Array<{id: string; bbox: number[]}>}).parts.map((p) => [p.id, p.bbox])) as Record<string, number[]>;

const children = (id: string | null) => Object.entries(parts).filter(([, p]) => p.parent === id).sort((a, b) => a[1].z - b[1].z);

export type FaceState = 'neutral' | 'blink' | 'mouth' | 'look';
/** Face states (D70): row 2 of studies/human-gen-17-faces, cut to assets/human/face/*.png; swapped on the head part, never redrawn. */
const faceSize = Object.fromEntries(Object.entries((faces as {states: Record<string, {size: number[]}>}).states).map(([k, v]) => [k, [v.size[0] ?? 96, v.size[1] ?? 96]])) as Record<FaceState, [number, number]>;

/**
 * Part rendering (D71): `hard` is the nearest-colour cut as the cutter wrote it; `soft` is the blurred-alpha PNG; `vector` is the
 * VTracer spline. Soft and vector draw the pale contour halo under the part. Soft and contour files carry an 8 px pad around the
 * hard crop (same centre), so they are placed at anchor − pad; the face files carry no pad.
 */
export type PartRender = 'hard' | 'soft' | 'vector';
const PAD = 8;

const Node: React.FC<{id: string; rot: Record<string, number>; face: FaceState; render: PartRender; debug?: boolean}> = ({id, rot, face, render, debug}) => {
  const p = parts[id]!;
  const b = boxes[p.src] ?? [0, 0, 0, 0];
  const w = (b[2] ?? 0) - (b[0] ?? 0), h = (b[3] ?? 0) - (b[1] ?? 0);
  const isHead = id === 'head';
  const [fw, fh] = faceSize[face];
  const body = render === 'vector' ? `${p.src}.svg` : render === 'soft' ? `${p.src}-soft.png` : `${p.src}.png`;
  const src = isHead ? `assets/human/face/${face}.png` : `assets/human/${body}`;
  const contour = isHead ? `assets/human/face/${face}-contour.png` : `assets/human/${p.src}-contour.png`;
  // the face part is taller than the parts-sheet head: scale it to the head's width and keep its bottom at the head's bottom
  const style = isHead
    ? {position: 'absolute' as const, left: p.anchor[0], top: p.anchor[1] + h - (fh * w) / fw, width: w, height: (fh * w) / fw}
    : {position: 'absolute' as const, left: p.anchor[0], top: p.anchor[1], width: w, height: h};
  const pad = isHead || render === 'hard' || render === 'vector' ? 0 : PAD;
  const bodyStyle = {...style, left: style.left - pad, top: style.top - pad, width: style.width + 2 * pad, height: style.height + 2 * pad};
  const contourPad = isHead ? 0 : PAD;
  const contourStyle = {...style, left: style.left - contourPad, top: style.top - contourPad, width: style.width + 2 * contourPad, height: style.height + 2 * contourPad};
  // place the part's top-left at its anchor; rotate the whole subtree about the pivot
  return (
    <div style={{position: 'absolute', left: 0, top: 0, width: 0, height: 0, transform: `rotate(${rot[id] ?? 0}deg)`, transformOrigin: `${p.pivot[0]}px ${p.pivot[1]}px`}}>
      {children(id).filter(([, c]) => c.z < p.z).map(([cid]) => <Node key={cid} id={cid} rot={rot} face={face} render={render} debug={debug} />)}
      {render === 'hard' ? null : <Img src={staticFile(contour)} style={contourStyle} />}
      <Img src={staticFile(src)} style={bodyStyle} />
      {debug ? (
        <>
          <div style={{position: 'absolute', left: p.pivot[0] - 6, top: p.pivot[1] - 6, width: 12, height: 12, borderRadius: 6, background: '#ff5a3c', border: '2px solid #fff', zIndex: 10}} />
          <div style={{position: 'absolute', left: p.pivot[0] + 8, top: p.pivot[1] - 8, font: '600 14px monospace', color: '#ffe9b0', zIndex: 10, whiteSpace: 'nowrap'}}>{id}</div>
          <div style={{position: 'absolute', left: style.left, top: style.top, width: style.width, height: style.height, outline: '1px dashed #56b0d4', zIndex: 9}} />
        </>
      ) : null}
      {children(id).filter(([, c]) => c.z >= p.z).map(([cid]) => <Node key={cid} id={cid} rot={rot} face={face} render={render} debug={debug} />)}
    </div>
  );
};

export const HumanPuppet: React.FC<{frame: number; liftAt?: number; scale?: number; x?: number; y?: number; face?: FaceState; render?: PartRender; debug?: boolean}> = ({frame, liftAt = 24, scale = 0.42, x = 0, y = 0, face = 'neutral', render = 'soft', debug = false}) => {
  const f = onTwos(frame);
  const lift = move(f, liftAt, 0, 1, house);                 // drawn layer: stepped poses
  const fore = lag(f, (g) => move(g, liftAt, 0, 1, house), 3); // forearms follow the shoulder with lag
  const hand = lag(f, (g) => move(g, liftAt, 0, 1, house), 5); // hands last
  // rest pose: the generated upper arms are drawn angled outward (~25°) in their own crops, so 0° is the figure's rest
  const rot: Record<string, number> = {
    armL_up: lift * 150, armR_up: -lift * 150,
    armL_lo: fore * 25, armR_lo: -fore * 25,
    handL: hand * 15, handR: -hand * 15,
    head: -lift * 6, hair: lift * 4,
  };
  const [cw, ch] = rig.canvas as [number, number];
  return (
    <div style={{position: 'absolute', left: x, top: y, width: cw, height: ch, transform: `scale(${scale})`, transformOrigin: 'top left'}}>
      {children(null).map(([id]) => <Node key={id} id={id} rot={rot} face={face} render={render} debug={debug} />)}
    </div>
  );
};
