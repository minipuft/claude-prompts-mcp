import {DitherDefs} from '../Dither';

/**
 * The human (D38 frozen selection, redrawn in the Seuss contour language, D50): compact figure, large forehead,
 * wide-set eyes, small nose, tiny full lips, swept careless hair; layered sleeveless outer shirt over a pale
 * narrow-sleeved inner shirt, roomy dark trousers, plain shoes. Skin is the identity pigment (D54) and is passed as
 * CSS variables --skin / --skin-shadow / --skin-light by the caller; garment roles are the five-role vars.
 * `lift` 0..1 raises both arms (lifting the lid); `variant` is the boil variant.
 */
export const Human: React.FC<{lift?: number; variant?: number; look?: number}> = ({lift = 0, variant = 0, look = 0}) => (
  <svg width="180" height="300" viewBox="-30 -20 180 300" style={{overflow: 'visible'}}>
    <DitherDefs id="human-dither" seed={17} shadow="var(--skin-shadow)" cool="var(--shadow)" />
    <ellipse cx="62" cy="268" rx="58" ry="10" fill="url(#human-dither-cast)" filter="url(#human-dither)" />
    <g stroke="var(--outline)" strokeWidth="3.5" strokeLinejoin="round" strokeLinecap="round" transform={`translate(${[0, 1.6, -1.4][variant] ?? 0} ${[0, -1.2, 1.0][variant] ?? 0}) rotate(${[0, 0.8, -0.7][variant] ?? 0} 62 150)`}>
      {/* trousers: roomy, hanging drape */}
      <path d="M30 168 C24 200 22 232 30 256 L54 256 L60 200 L66 256 L92 256 C100 230 98 198 92 168 Z" fill="var(--main2)" />
      <path d="M30 168 L92 168 L90 184 C70 190 50 190 32 184 Z" fill="var(--shadow)" stroke="none" opacity="0.8" />
      {/* shoes */}
      <path d="M26 256 C22 262 24 268 34 268 L56 268 L56 256 Z" fill="var(--light)" />
      <path d="M66 256 L66 268 L90 268 C100 268 102 262 96 256 Z" fill="var(--light)" />
      {/* inner shirt body */}
      <path d="M34 104 L90 104 L94 172 L30 172 Z" fill="var(--light)" />
      {/* layered sleeveless outer shirt: two overlapping panels, diagonal hem */}
      <path d="M38 100 C50 108 74 108 86 100 L92 160 C76 170 48 172 32 160 Z" fill="var(--main1)" />
      <path d="M62 100 L86 100 L92 160 C84 166 72 168 62 166 Z" fill="url(#human-dither-ramp-x)" filter="url(#human-dither)" stroke="none" />
      <path d="M38 100 C52 132 62 140 62 166" fill="none" stroke="var(--light)" strokeWidth="2" />
      {/* neck */}
      <rect x="54" y="88" width="16" height="18" fill="var(--skin)" />
      {/* head: large forehead, compact face */}
      <path d="M30 56 C30 20 94 14 96 56 C98 80 86 100 62 102 C38 100 28 80 30 56 Z" fill="var(--skin)" />
      {/* skin form shadow: under the hair and on the far side, stippled, hue-shifting to the mauve */}
      <path d="M62 102 C86 100 98 80 96 56 L96 72 C92 90 80 100 62 102 Z" fill="url(#human-dither-ramp-x)" filter="url(#human-dither)" stroke="none" />
      {/* face: wide-set eyes, small nose, tiny full lips */}
      <ellipse cx={46 + look * 2} cy="66" rx="3.6" ry="5" fill="var(--outline)" stroke="none" />
      <ellipse cx={80 + look * 2} cy="66" rx="3.6" ry="5" fill="var(--outline)" stroke="none" />
      <path d="M62 74 l-2 6 l4 0" fill="none" strokeWidth="2" />
      <path d="M57 88 q5 -3 10 0 q-5 4 -10 0 Z" fill="var(--skin-shadow)" strokeWidth="2" />
      {/* swept careless hair: one big uneven mass with a crest, dark */}
      <path d="M24 60 C14 30 40 4 70 10 C98 4 116 28 104 52 C100 40 86 30 70 32 C58 20 40 28 38 44 C32 40 26 48 24 60 Z" fill="var(--main2)" />
      <path d="M60 12 C76 -4 110 0 118 20 C104 14 86 14 74 24 Z" fill="var(--main2)" />
      {/* arms last so a lifted arm passes in front of the body and head */}
      {/* inner shirt sleeves + arms (lift raises them from the shoulders) */}
      <g transform={`rotate(${lift * 110} 30 112)`}>
        <path d="M30 108 C14 118 8 140 10 160 L22 160 C22 144 26 128 36 118 Z" fill="var(--light)" />
        <ellipse cx="16" cy="164" rx="8" ry="9" fill="var(--skin)" />
      </g>
      <g transform={`rotate(${-lift * 110} 94 112)`}>
        <path d="M94 108 C110 118 116 140 114 160 L102 160 C102 144 98 128 88 118 Z" fill="var(--light)" />
        <ellipse cx="108" cy="164" rx="8" ry="9" fill="var(--skin)" />
      </g>
    </g>
  </svg>
);
