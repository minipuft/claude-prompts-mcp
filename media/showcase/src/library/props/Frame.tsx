export type Pt = [number, number];
/** The frame's two rings as points (outer, inner), in the Frame's own pixel space: worlds that rebuild the frame in 3D extrude exactly these. */
export const frameRings = (w: number, h: number, bar = 14): {outer: Pt[]; inner: Pt[]} => ({
  outer: [[-4, 2], [w + 3, -3], [w - 2, h + 4], [1, h - 1]],
  inner: [[bar + 2, bar - 1], [w - bar - 1, bar + 3], [w - bar + 2, h - bar - 2], [bar - 2, h - bar + 1]],
});
const ringPath = (pts: Pt[]): string => `${pts.map(([x, y], i) => `${i ? 'L' : 'M'} ${x} ${y}`).join(' ')} Z`;

/**
 * The tool (D42, D50): a hand-drawn frame in the Seuss contour language. Uneven bars, a pale contour outside a darker bar,
 * corners that overshoot a little. The interior is left empty so the glass pass shows through.
 */
export const Frame: React.FC<{width: number; height: number}> = ({width, height}) => {
  const w = width;
  const h = height;
  const bar = 14;
  // outer and inner edges wobble by a few pixels per corner, so no two bars are parallel
  const rings = frameRings(w, h, bar);
  const outer = ringPath(rings.outer);
  const inner = ringPath(rings.inner);
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{overflow: 'visible'}}>
      <path d={`${outer} ${inner}`} fillRule="evenodd" fill="var(--main1)" stroke="var(--light)" strokeWidth="5" strokeLinejoin="round" />
      <path d={`${outer} ${inner}`} fillRule="evenodd" fill="none" stroke="var(--outline)" strokeWidth="1.5" strokeLinejoin="round" />
      {/* a single lighter stroke along the top bar, the Seuss highlight sweep */}
      <path d={`M ${bar + 10} ${bar / 2 + 1} L ${w - bar - 20} ${bar / 2 - 1}`} stroke="var(--light)" strokeWidth="2.5" strokeLinecap="round" />
      {/* corner overshoots */}
      <path d={`M ${-6} ${-4} L ${bar + 6} ${-2}`} stroke="var(--light)" strokeWidth="3" strokeLinecap="round" />
      <path d={`M ${w + 6} ${h + 6} L ${w - bar - 8} ${h + 4}`} stroke="var(--light)" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
};
