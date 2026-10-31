import {DitherDefs} from '../Dither';

/**
 * The gadget (D43, D50): a hybrid machine in the Seuss silhouette grammar, familiar parts in an impossible whole.
 * Stacked blobby lobes like a clock-stalk, a crooked funnel, a curled antenna with a flag leaf, a dial, four stub legs.
 * Flat five-role fills with a pale contour; its light lives in the Radiance layer, not here. `glow` 0..1 opens the dial.
 */
export const Gadget: React.FC<{glow?: number}> = ({glow = 0}) => (
  <svg width="200" height="260" viewBox="-20 -20 200 260" style={{overflow: 'visible'}}>
    <DitherDefs id="gadget-dither" seed={21} />
    <ellipse cx="90" cy="236" rx="78" ry="12" fill="url(#gadget-dither-cast)" filter="url(#gadget-dither)" />
    {/* pale contour: the whole silhouette once more, slightly fatter, behind */}
    <g fill="var(--light)" stroke="var(--light)" strokeWidth="9" strokeLinejoin="round">
      <path d="M60 220 C30 210 28 160 52 140 C30 120 42 84 70 78 C58 50 78 24 104 30 C128 36 134 66 118 84 C148 92 150 130 126 146 C156 164 146 214 112 222 Z" />
      <path d="M118 84 C150 72 172 66 192 44" fill="none" />
    </g>
    {/* body lobes */}
    <g stroke="var(--outline)" strokeWidth="3" strokeLinejoin="round">
      <path d="M60 220 C30 210 28 160 52 140 C36 124 42 98 66 90 C40 70 70 36 104 34 C126 38 132 66 118 84 C146 92 148 130 126 146 C154 164 146 214 112 222 Z" fill="var(--main1)" />
      {/* lobe seams, thin contour lines in the light role */}
      <path d="M54 140 C80 150 110 150 126 146" fill="none" stroke="var(--light)" strokeWidth="2" />
      <path d="M68 90 C90 98 108 96 118 84" fill="none" stroke="var(--light)" strokeWidth="2" />
      {/* form shadow: right side and under each lobe, stippled with hue shift */}
      <clipPath id="gadget-body"><path d="M60 220 C30 210 28 160 52 140 C36 124 42 98 66 90 C40 70 70 36 104 34 C126 38 132 66 118 84 C146 92 148 130 126 146 C154 164 146 214 112 222 Z" /></clipPath>
      <g clipPath="url(#gadget-body)"><rect x="70" y="30" width="90" height="200" fill="url(#gadget-dither-ramp-x)" filter="url(#gadget-dither)" stroke="none" /></g>
      {/* crooked funnel */}
      <path d="M118 84 C136 78 150 80 158 70 C166 60 180 50 192 44 C186 62 182 78 170 88 C156 100 134 100 122 96 Z" fill="var(--main2)" />
      <path d="M192 44 C184 52 180 62 178 70" fill="none" stroke="var(--light)" strokeWidth="2" />
      {/* dial: opens with glow */}
      <circle cx="88" cy="170" r="22" fill="var(--shadow)" />
      <circle cx="88" cy="170" r={6 + glow * 12} fill="var(--accent)" stroke="none" />
      <path d="M88 170 L88 154" stroke="var(--light)" strokeWidth="3" />
      {/* porthole */}
      <ellipse cx="84" cy="112" rx="12" ry="9" fill="var(--shadow)" />
      <ellipse cx="81" cy="110" rx="5" ry="3" fill="var(--accent)" stroke="none" />
      {/* antenna with flag leaf */}
      <path d="M100 34 C96 10 118 0 128 10 C136 18 126 30 116 24" fill="none" stroke="var(--main2)" strokeWidth="4" />
      <path d="M128 10 C142 2 156 8 160 2 C154 16 142 22 130 16 Z" fill="var(--accent)" />
      {/* legs */}
      <rect x="54" y="220" width="12" height="18" rx="3" fill="var(--main2)" />
      <rect x="78" y="222" width="12" height="16" rx="3" fill="var(--main2)" />
      <rect x="100" y="222" width="12" height="16" rx="3" fill="var(--main2)" />
      <rect x="122" y="218" width="12" height="20" rx="3" fill="var(--main2)" />
    </g>
  </svg>
);
