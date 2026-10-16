import {DitherDefs} from '../Dither';

/**
 * Claude Code Clawd: coral block, two dark slit eyes, four small legs. Identity cues from the official demo; five-role flat SVG.
 * Shadows per D47/D48: a form shadow following the silhouette, graded by two-scale stipple with a cool hue shift toward contact,
 * plus a cast shadow on the field. Light comes from the upper left, so the right side and the underside carry the shadow.
 */
/** `lean` 0..1 tips the body forward over its planted legs (the body shifts and turns about the leg tops, the legs stay); `squash` 0..1 presses the block down. At 0 and 0 the drawing is the original. */
export const Clawd: React.FC<{raise?: number; variant?: number; lean?: number; squash?: number}> = ({raise = 0, variant = 0, lean = 0, squash = 0}) => (
  <svg width="160" height="130" viewBox="-20 0 160 130" style={{overflow: 'visible'}}>
    <DitherDefs id="clawd-dither" seed={3} />
    {/* cast shadow on the field: offset ellipse, stippled toward its edge */}
    <ellipse cx="70" cy="106" rx="64" ry="11" fill="url(#clawd-dither-cast)" filter="url(#clawd-dither)" />
    <g stroke="var(--outline)" strokeWidth="4" strokeLinejoin="round" transform={`translate(${[0, 2.2, -1.8][variant] ?? 0} ${[0, -1.4, 1.6][variant] ?? 0}) rotate(${[0, 1.1, -0.9][variant] ?? 0} 60 55) scale(${[1, 1.012, 0.99][variant] ?? 1})`}>
      <g transform={lean || squash ? `translate(${lean * -10} ${squash * 4}) rotate(${lean * -6} 60 82) scale(1 ${1 - squash * 0.06})` : undefined} style={lean || squash ? {transformOrigin: '60px 82px'} : undefined}>
      <rect x="14" y="20" width="92" height="62" rx="8" fill="var(--main1)" />
      {/* light plane: top sliver */}
      <path d="M22 20 h76 a8 8 0 0 1 8 8 v4 h-92 v-4 a8 8 0 0 1 8 -8 z" fill="var(--light)" stroke="none" />
      {/* form shadow, underside: density grows toward the legs */}
      <path d="M14 52 h92 v22 a8 8 0 0 1 -8 8 h-76 a8 8 0 0 1 -8 -8 z" fill="url(#clawd-dither-ramp)" filter="url(#clawd-dither)" stroke="none" />
      {/* form shadow, right side away from the light: density grows toward the right edge */}
      <path d="M70 20 h28 a8 8 0 0 1 8 8 v46 a8 8 0 0 1 -8 8 h-28 z" fill="url(#clawd-dither-ramp-x)" filter="url(#clawd-dither)" stroke="none" />
      {/* eyes */}
      <rect x="40" y="38" width="8" height="18" fill="var(--accent)" stroke="none" />
      <rect x="72" y="38" width="8" height="18" fill="var(--accent)" stroke="none" />
      </g>
      {/* legs */}
      <rect x="22" y="82" width="12" height="16" fill="var(--main2)" />
      <rect x="44" y="82" width="12" height="16" fill="var(--main2)" />
      <rect x="64" y="82" width="12" height="16" fill="var(--main2)" />
      <rect x="86" y="82" width="12" height="16" fill="var(--main2)" />
      {/* raised arm holding the frame: pivots at the shoulder, stays inside the body's column */}
      <g transform={`rotate(${-10 - raise * 95} 96 46)`}>
        <rect x="94" y="40" width="30" height="12" rx="6" fill="var(--main2)" />
      </g>
    </g>
  </svg>
);
