/**
 * Dither/stipple shadow gradient (D48, Midnight Gospel references): an SVG filter that turns a shape's smooth alpha
 * into stipple at two scales, fine speckle plus sparse coarse splatter. The shape's own fill supplies the hue shift
 * (a gradient from the shadow role toward a cooler tint), so the filter only decides WHERE ink lands, never its color.
 * Seeded per asset: the dots are fixed and never shimmer between frames.
 */
export const DitherDefs: React.FC<{id?: string; seed?: number; fine?: number; coarse?: number; shadow?: string; cool?: string}> = ({
  id = 'dither',
  seed = 7,
  fine = 0.5,
  coarse = 0.045,
  shadow = 'var(--shadow)',
  cool = 'var(--cool, #4a2a7a)',
}) => (
  <defs>
    <filter id={id} x="-15%" y="-15%" width="130%" height="130%" colorInterpolationFilters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency={fine} numOctaves={1} seed={seed} result="fineNoise" />
      <feTurbulence type="turbulence" baseFrequency={coarse} numOctaves={2} seed={seed + 11} result="coarseNoise" />
      {/* blend the two noise fields; coarse adds the splatter clusters */}
      <feComposite in="fineNoise" in2="coarseNoise" operator="arithmetic" k1="0" k2="0.65" k3="0.55" k4="0" result="noise" />
      {/* keep ink where the shape's alpha (density) exceeds the noise */}
      <feComposite in="SourceAlpha" in2="noise" operator="arithmetic" k1="0" k2="1.15" k3="-1" k4="0.02" result="density" />
      <feComponentTransfer in="density" result="mask">
        <feFuncA type="discrete" tableValues="0 1" />
      </feComponentTransfer>
      <feComposite in="SourceGraphic" in2="mask" operator="in" />
    </filter>
    <linearGradient id={`${id}-ramp`} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stopColor={shadow} stopOpacity="0" />
      <stop offset="0.55" stopColor={shadow} stopOpacity="0.9" />
      <stop offset="1" stopColor={cool} stopOpacity="1" />
    </linearGradient>
    <linearGradient id={`${id}-ramp-x`} x1="1" y1="0" x2="0" y2="0">
      <stop offset="0" stopColor={cool} stopOpacity="1" />
      <stop offset="0.5" stopColor={shadow} stopOpacity="0.8" />
      <stop offset="1" stopColor={shadow} stopOpacity="0" />
    </linearGradient>
    <radialGradient id={`${id}-cast`} cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stopColor={cool} stopOpacity="1" />
      <stop offset="0.6" stopColor={shadow} stopOpacity="0.7" />
      <stop offset="1" stopColor={shadow} stopOpacity="0" />
    </radialGradient>
  </defs>
);
