import {DitherDefs} from '../Dither';

/**
 * The lid with its hinge on the BACK edge (the old `hinge="front"` rotation pivots at the front plane's top-right corner and swings the lid down across
 * the front of the box: v3/studies/beat1-12-f110.png). The lid is the parallelogram whose back edge is (60,30)-(190,30) and whose depth vector is
 * (-40, 20); opened by `angle` about the back edge the depth vector becomes D cos(a) + (0, -L) sin(a): the front edge rises, passes over the back edge
 * at 90 degrees (the lid shows its underside, `shadow`) and leans back beyond it.
 */
const BACK_DEPTH: [number, number] = [-40, 20];
const LID_LENGTH = 62;
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
export const Box: React.FC<{lid?: number; variant?: number; hinge?: 'front' | 'back'}> = ({lid = 0, variant = 0, hinge = 'front'}) => (
  <svg width="220" height="170" viewBox="-10 -30 220 170" style={{overflow: 'visible'}}>
    <DitherDefs id="box-dither" seed={9} />
    <ellipse cx="100" cy="134" rx="104" ry="12" fill="url(#box-dither-cast)" filter="url(#box-dither)" />
    <g stroke="var(--outline)" strokeWidth="4" strokeLinejoin="round" transform={`translate(${[0, 1.5, -1.2][variant] ?? 0} ${[0, -0.8, 1.0][variant] ?? 0})`}>
      {/* body: front and side planes */}
      <polygon points="20,50 150,50 150,130 20,130" fill="var(--main1)" />
      <polygon points="150,50 190,30 190,110 150,130" fill="var(--main2)" />
      <polygon points="150,96 190,78 190,110 150,130" fill="url(#box-dither-ramp)" filter="url(#box-dither)" stroke="none" />
      {hinge === 'back' ? (
        <BackHingeLid angle={lid * 105} />
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
