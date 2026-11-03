import {Img, staticFile} from 'remotion';
import type {CSSProperties} from 'react';

/**
 * Cutout puppet (D65/D68): generated parts, moved programmatically. A part is a PNG cut by scripts/cutout.py and listed in
 * parts.json with its bbox and pivot in plate space. The puppet places every part at its bbox, rotates and offsets it about its
 * pivot from a pose, and never draws anything itself. Motion comes from motion.ts (on twos); boil swaps the plate variant.
 * Parts are served from public/assets/<asset>/, so staticFile() resolves them under the Remotion public dir.
 */
export type PuppetPart = {id: string; png: string; bbox: [number, number, number, number]; pivot: [number, number]; parent?: string; z?: number};
export type PartPose = {rot?: number; dx?: number; dy?: number; scale?: number; opacity?: number};
export type Pose = Record<string, PartPose>;

type Props = {asset: string; parts: PuppetPart[]; pose?: Pose; plateSize: [number, number]; scale?: number; x?: number; y?: number; style?: CSSProperties; blend?: CSSProperties['mixBlendMode']};

const partStyle = (p: PuppetPart, pose: PartPose | undefined): CSSProperties => {
  const [x0, y0, x1, y1] = p.bbox;
  const [px, py] = p.pivot;
  return {
    position: 'absolute', left: x0, top: y0, width: x1 - x0, height: y1 - y0,
    transformOrigin: `${px - x0}px ${py - y0}px`,
    transform: `translate(${pose?.dx ?? 0}px, ${pose?.dy ?? 0}px) rotate(${pose?.rot ?? 0}deg) scale(${pose?.scale ?? 1})`,
    opacity: pose?.opacity ?? 1,
    imageRendering: 'auto',
  };
};

export const Puppet: React.FC<Props> = ({asset, parts, pose = {}, plateSize, scale = 1, x = 0, y = 0, style, blend}) => (
  <div style={{position: 'absolute', left: x, top: y, width: plateSize[0], height: plateSize[1], transform: `scale(${scale})`, transformOrigin: 'top left', mixBlendMode: blend, ...style}}>
    {[...parts].sort((a, b) => (a.z ?? 0) - (b.z ?? 0)).map((p) => (
      <Img key={p.id} src={staticFile(`assets/${asset}/${p.png}`)} style={partStyle(p, pose[p.id])} />
    ))}
  </div>
);

/** Reads a cutout manifest (parts.json) into puppet parts; `parent` and `z` are added by hand in a rig file, never by the cutter. */
export const partsFromManifest = (manifest: {parts: Array<{id: string; png: string; bbox: number[]; pivot: number[]}>}, rig: Record<string, {parent?: string; z?: number}> = {}): PuppetPart[] =>
  manifest.parts.map((p) => ({id: p.id, png: p.png, bbox: [p.bbox[0] ?? 0, p.bbox[1] ?? 0, p.bbox[2] ?? 0, p.bbox[3] ?? 0], pivot: [p.pivot[0] ?? 0, p.pivot[1] ?? 0], ...rig[p.id]}));
