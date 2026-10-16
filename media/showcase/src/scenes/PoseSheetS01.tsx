import {AbsoluteFill, Img, staticFile} from 'remotion';
import {fonts} from '../design';
import type {KeySheet} from '../library/animation/keys';
import type {PartName} from '../library/motion/partsRig';
import {settled} from '../library/tokens';
import {STAGE} from '../library/worlds/contract';
import {FlatFigure} from '../library/worlds/parts';

/**
 * Pose sheet of the human's keys in shot s01 (D85): each key's plate, built in the project from the pose sheet's solved joints through its plate family's parts rig
 * (`npm run plates`, assets/<actor>/keys/<shot>/K<n>.png), beside the rig's pose of the same key (the parts rig the film draws, in the key's draw order), both stood on one baseline at one scale.
 * The curve the spine fit reads back from the key's joints (the line of action `probe-poses.py` measures, a cubic from root to head) is drawn over both, with the joints as dots.
 * A key no family mesh holds has no plate: its tile says NEEDS FAMILY and the family and silhouette it needs, and shows only the rig, warped, as the film draws it.
 */
const TILE_W = 600, TILE_H = 560, S = 0.44, FLOOR = 480, HEIGHT_PX = 922;
const MASK_TO_CANVAS = 1.069414, ORIGIN_MASK = [31, 30] as const, ORIGIN_CANVAS = [10.065, 20] as const;
/** Plate pixels to rig screen pixels: a plate is `scale` plate px per mask px, the rig is 1.0694 canvas px per mask px, times S. */
const plateToScreen = (scale: number): number => (MASK_TO_CANVAS / scale) * S;

export type PlateInfo = {key: string; name?: string; plate?: string | null; family?: string | null; cropPx: [number, number]; baselineInCrop: number; scale: number; originMask?: [number, number]};
type Measured = {c31?: {read?: {class: string; bow: number; sign: number}}; verdict?: string; c20?: {headCount?: number; worstDevPct?: number}; c22?: {contourPx: number; vsModelPct: number}};
type Render = {order?: PartName[]; worstParts?: Record<string, string | null>; hold?: Record<string, number>; jointFill?: Record<string, {fill: number; fade: number; depth?: number; pass: boolean}>};
type WithMeasure = {measured?: Measured; render?: Render; needsFamily?: {family: string; silhouette: string}; family?: string; source?: string};

const cBasis = (t: number): number => 4 * t * (1 - t);
const sBasis = (t: number): number => (t * (1 - t) * (1 - 2 * t)) / 0.0962249;
type Pt = [number, number];

/** The spine curve the fit reads: the cubic through root and head whose deviation from the chord is alpha C(t) + beta S(t) (src/library/animation/pose.ts `spineFit`), as polyline points in key (mask) space. */
const fitCurve = (j: Record<string, Pt>): Pt[] => {
  const root = j.root!, head = j.head!, chord: Pt = [head[0] - root[0], head[1] - root[1]], norm = Math.hypot(chord[0], chord[1]), n: Pt = [-chord[1] / norm, chord[0] / norm];
  const mid: Pt[] = [[(j.shoulderL![0] + j.shoulderR![0]) / 2, (j.shoulderL![1] + j.shoulderR![1]) / 2], j.torso!, j.neck!];
  let [cc, cs, ss, cd, sd] = [0, 0, 0, 0, 0];
  for (const p of mid) {
    const d: Pt = [p[0] - root[0], p[1] - root[1]], t = (d[0] * chord[0] + d[1] * chord[1]) / (norm * norm), off = (d[0] * n[0] + d[1] * n[1]) / HEIGHT_PX;
    cc += cBasis(t) ** 2; cs += cBasis(t) * sBasis(t); ss += sBasis(t) ** 2; cd += cBasis(t) * off; sd += sBasis(t) * off;
  }
  ss += 0.05;
  const det = cc * ss - cs * cs, alpha = (cd * ss - cs * sd) / det, beta = (cc * sd - cs * cd) / det;
  return Array.from({length: 41}, (_, i): Pt => {
    const t = i / 40, dev = (alpha * cBasis(t) + beta * sBasis(t)) * HEIGHT_PX;
    return [root[0] + chord[0] * t + n[0] * dev, root[1] + chord[1] * t + n[1] * dev];
  });
};

const Overlay: React.FC<{joints: Record<string, Pt>; at: (p: Pt) => Pt; width: number; height: number; colour: string}> = ({joints, at, width, height, colour}) => {
  const curve = fitCurve(joints).map(at);
  return (
    <svg width={width} height={height} style={{position: 'absolute', left: 0, top: 0, overflow: 'visible'}}>
      <polyline points={curve.map((p) => p.join(',')).join(' ')} fill="none" stroke={colour} strokeWidth={3} strokeLinecap="round" />
      {Object.entries(joints).map(([n, p]) => {
        const [x, y] = at(p);
        return <circle key={n} cx={x} cy={y} r={n === 'root' || n === 'head' ? 4.5 : 3} fill="none" stroke={colour} strokeWidth={1.5} />;
      })}
    </svg>
  );
};

export const PoseSheetS01: React.FC<{sheet: KeySheet; plates: PlateInfo[]; shot?: string}> = ({sheet, plates, shot = 's01-arrival-overwhelm'}) => (
  <AbsoluteFill style={{background: settled.field, fontFamily: fonts.mono, color: settled.kit.light}}>
    <div style={{position: 'absolute', left: 30, top: 12, fontSize: 22, fontFamily: fonts.sans, fontWeight: 600}}>
      Pose sheet · {sheet.shot} · {sheet.actor} · plate built from the solved joints through the parts rig left, the parts rig the film draws right · the line of action the spine fit reads drawn over both
    </div>
    {sheet.keys.map((k, i) => {
      const info = plates[i]!, extra = k as unknown as WithMeasure, m = extra.measured;
      const left = (i % 4) * TILE_W, top = 50 + Math.floor(i / 4) * TILE_H, hasPlate = Boolean(info.plate) && info.cropPx[0] > 0, ps = hasPlate ? plateToScreen(info.scale) : 0;
      const joints = k.joints as Record<string, Pt>;
      const rigX0 = 450 - 333.6 * S, rigY0 = FLOOR - 1005 * S;
      const rig = ([x, y]: Pt): Pt => [rigX0 + S * (MASK_TO_CANVAS * (x - ORIGIN_MASK[0]) + ORIGIN_CANVAS[0]), rigY0 + S * (MASK_TO_CANVAS * (y - ORIGIN_MASK[1]) + ORIGIN_CANVAS[1])];
      const plateTop = FLOOR - info.baselineInCrop * ps, plateAt = ([x, y]: Pt): Pt => [16 + (x - (info.originMask?.[0] ?? 0)) * info.scale * ps, plateTop + (y - (info.originMask?.[1] ?? 0)) * info.scale * ps];
      const r = m?.c31?.read, c20 = m?.c20, c22 = m?.c22;
      return (
        <div key={k.name} style={{position: 'absolute', left, top, width: TILE_W, height: TILE_H}}>
          <div style={{position: 'absolute', left: 16, top: 0, fontSize: 20, fontWeight: 700}}>K{i + 1} · {k.name}</div>
          <div style={{position: 'absolute', left: 16, top: 26, fontSize: 13, color: settled.kit.main2}}>frame {k.frame} · hold {k.hold ?? 0} · {hasPlate ? `family ${extra.family ?? info.family}` : `NEEDS FAMILY ${extra.needsFamily?.family ?? ''} (${extra.needsFamily?.silhouette ?? ''})`}</div>
          {hasPlate && <Img src={staticFile(`assets/human/keys/${shot}/K${i + 1}.png`)} style={{position: 'absolute', left: 16, top: plateTop, width: info.cropPx[0] * ps, height: info.cropPx[1] * ps}} />}
          <FlatFigure pose={k.joints} fill={1} line={null} blocking={{...STAGE, figure: {scale: S, x: rigX0, y: rigY0}}} order={extra.render?.order} />
          <Overlay joints={joints} at={rig} width={TILE_W} height={TILE_H} colour="#ffd166" />
          {hasPlate && <Overlay joints={joints} at={plateAt} width={TILE_W} height={TILE_H} colour="#ffd166" />}
          <div style={{position: 'absolute', left: 16, top: FLOOR + 14, width: TILE_W - 28, fontSize: 12, lineHeight: 1.4, color: settled.kit.main2}}>
            {r ? `spine reads ${r.class} ${r.bow.toFixed(3)} sign ${r.sign > 0 ? '+1' : '-1'}` : ''}{c20?.headCount ? ` · ${c20.headCount.toFixed(2)} heads, worst limb ${c20.worstDevPct}%` : ''}{c22 ? ` · contour ${c22.contourPx.toFixed(2)} px (${c22.vsModelPct > 0 ? '+' : ''}${c22.vsModelPct}%)` : ''}
            <br />{extra.render?.order ? `front ${extra.render.order.slice(0, 4).join(' > ')} · worst part: inverted ${((extra.render.hold?.inverted ?? 0) * 100).toFixed(1)}% (${extra.render.worstParts?.inverted ?? '-'}), strained ${((extra.render.hold?.strained ?? 0) * 100).toFixed(1)}% (${extra.render.worstParts?.strained ?? '-'}), overlap ${((extra.render.hold?.overlap ?? 0) * 100).toFixed(1)}%` : ''}
            <br />{extra.render?.jointFill ? `joints: fill ${Math.min(...Object.values(extra.render.jointFill).map((j) => j.fill)).toFixed(2)}, overlap ${Math.min(...Object.values(extra.render.jointFill).map((j) => Math.max(j.fade, j.depth ?? 0))).toFixed(1)} contour widths · ` : ''}{m?.verdict ?? ''}
          </div>
        </div>
      );
    })}
  </AbsoluteFill>
);
