import {DitherDefs} from '../Dither';

/**
 * The lid with its hinge on the BACK edge (the old `hinge="front"` rotation pivots at the front plane's top-right corner and swings the lid down across
 * the front of the box: v3/studies/beat1-12-f110.png). The lid is the parallelogram whose back edge is (60,30)-(190,30) and whose depth vector is
 * (-40, 20); opened by `angle` about the back edge the depth vector becomes D cos(a) + (0, -L) sin(a): the front edge rises, passes over the back edge
 * at 90 degrees (the lid shows its underside, `shadow`) and leans back beyond it.
 */
const BACK_DEPTH: [number, number] = [-40, 20];
const LID_LENGTH = 62;
/** How far the back-hinged lid opens at `lid` 1 (degrees): about as far as the hinge lets the lid lean back. */
export const LID_OPEN_DEG = 105;
/** The lid's front edge, mid-point, in the box's own coordinates when it is opened by `deg` about the back edge (closed: (85, 50), the top of the front plane). */
export const lidFrontEdge = (deg: number): [number, number] => {
  const a = (deg * Math.PI) / 180;
  return [125 + BACK_DEPTH[0] * Math.cos(a), 30 + BACK_DEPTH[1] * Math.cos(a) - LID_LENGTH * Math.sin(a)];
};
/** The opening angle (degrees, 0 to LID_OPEN_DEG) whose front edge stands at `y` in the box's own coordinates: the front edge only rises as the lid opens, so the angle is found by bisection. */
export const lidAngleAtFrontY = (y: number): number => {
  let lo = 0, hi = LID_OPEN_DEG;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (lidFrontEdge(mid)[1] > y) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
};
const BackHingeLid: React.FC<{angle: number}> = ({angle}) => {
  const a = (angle * Math.PI) / 180;
  const dx = BACK_DEPTH[0] * Math.cos(a), dy = BACK_DEPTH[1] * Math.cos(a) - LID_LENGTH * Math.sin(a);
  const fl: [number, number] = [60 + dx, 30 + dy], fr: [number, number] = [190 + dx, 30 + dy];
  const top = `60,30 190,30 ${fr[0]},${fr[1]} ${fl[0]},${fl[1]}`;
  const under = angle > 90;
  return (
    <g>
      <polygon points={top} fill={under ? 'var(--shadow)' : 'var(--light)'} />
      {/* the near edge's thickness, drawn along the front edge */}
      <polygon points={`${fl[0]},${fl[1]} ${fr[0]},${fr[1]} ${fr[0]},${fr[1] + 8} ${fl[0]},${fl[1] + 8}`} fill="var(--main2)" />
    </g>
  );
};

/**
 * The box (beat 1): plain, flat, ordinary. `lid` 0..1 lifts the lid (`hinge` 'front' is the original rotation, 'back' hinges on the back edge and opens to
 * about 105 degrees); `leak` 0..1 widens the light seam, drawn in the Radiance layer, not here.
 */
export const Box: React.FC<{lid?: number; variant?: number; hinge?: 'front' | 'back'; withLid?: boolean}> = ({lid = 0, variant = 0, hinge = 'front', withLid = true}) => (
  <svg width="220" height="170" viewBox="-10 -30 220 170" style={{overflow: 'visible'}}>
    <DitherDefs id="box-dither" seed={9} />
    <ellipse cx="100" cy="134" rx="104" ry="12" fill="url(#box-dither-cast)" filter="url(#box-dither)" />
    <g stroke="var(--outline)" strokeWidth="4" strokeLinejoin="round" transform={`translate(${[0, 1.5, -1.2][variant] ?? 0} ${[0, -0.8, 1.0][variant] ?? 0})`}>
      {/* body: front and side planes */}
      <polygon points="20,50 150,50 150,130 20,130" fill="var(--main1)" />
      <polygon points="150,50 190,30 190,110 150,130" fill="var(--main2)" />
      <polygon points="150,96 190,78 190,110 150,130" fill="url(#box-dither-ramp)" filter="url(#box-dither)" stroke="none" />
      {!withLid ? null : hinge === 'back' ? (
        <BackHingeLid angle={lid * LID_OPEN_DEG} />
      ) : (
        <g transform={`rotate(${-lid * 70} 150 50)`}>
          {/* lid thickness: the near edge, then the top */}
          <polygon points="20,50 150,50 150,58 20,58" fill="var(--main2)" />
          <polygon points="150,50 190,30 190,38 150,58" fill="var(--shadow)" />
          <polygon points="20,50 150,50 190,30 60,30" fill="var(--light)" />
        </g>
      )}
      {/* a tape strip, the accent */}
      <rect x="78" y="50" width="14" height="80" fill="var(--accent)" stroke="none" opacity="0.85" />
    </g>
  </svg>
);

/**
 * The back-hinged lid on its own (the `lid` actor of the animatic: a prop with position keys, so it opens on the frames its keys say), drawn about its FRONT EDGE's mid-point, which is the anchor
 * (0, 0) of the svg: the part the hands lift. `angle` is the opening in degrees.
 */
export const Lid: React.FC<{angle: number}> = ({angle}) => {
  const [fx, fy] = lidFrontEdge(angle);
  return (
    <svg width="1" height="1" style={{overflow: 'visible', position: 'absolute', left: 0, top: 0}}>
      <g stroke="var(--outline)" strokeWidth="4" strokeLinejoin="round" transform={`translate(${-fx} ${-fy})`}>
        <BackHingeLid angle={angle} />
      </g>
    </svg>
  );
};
