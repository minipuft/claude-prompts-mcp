import {DitherDefs} from '../library/Dither';

/**
 * Human muse variants (D55, C19). All three share: skin/shadow pigments via --skin/--skin-shadow, garment roles via the five role vars,
 * a pale contour one step behind, a stipple form shadow, and a `lift` parameter for the lid pose. Only construction differs.
 */
type P = {lift?: number};
const contour = (d: string, fill: string, extra = '') => (
  <>
    <path d={d} fill="var(--light)" stroke="var(--light)" strokeWidth="9" strokeLinejoin="round" />
    <path d={d} fill={fill} stroke="var(--outline)" strokeWidth="3" strokeLinejoin="round" {...(extra ? {} : {})} />
  </>
);

/** A · Stalk: body as one tapered swoop, long neck, flag-shaped hair mass. Seuss no-one-youer + cat-stairway. */
export const HumanStalk: React.FC<P> = ({lift = 0}) => (
  <svg width="200" height="330" viewBox="-40 -30 200 330" style={{overflow: 'visible'}}>
    <DitherDefs id="hs-d" seed={31} shadow="var(--skin-shadow)" cool="var(--shadow)" />
    <ellipse cx="60" cy="296" rx="52" ry="9" fill="url(#hs-d-cast)" filter="url(#hs-d)" />
    {/* swoop body: hip wide, tapering up to the neck, leaning */}
    {contour('M30 290 C10 230 34 160 46 120 C52 98 58 86 60 70 C62 86 70 98 76 120 C92 160 110 230 94 290 Z', 'var(--main2)')}
    {/* layered shirt as a band on the swoop */}
    {contour('M44 150 C52 140 70 140 80 150 L90 206 C76 214 50 214 36 206 Z', 'var(--main1)')}
    <path d="M62 150 L80 150 L90 206 C82 210 72 212 62 212 Z" fill="url(#hs-d-ramp-x)" filter="url(#hs-d)" stroke="none" />
    <path d="M44 150 C56 180 62 190 62 212" fill="none" stroke="var(--light)" strokeWidth="2" />
    {/* noodle arms: quadratic curves whose control point rises with lift */}
    <path d={`M46 160 Q ${10 - lift * 40} ${200 - lift * 160} ${4 + lift * 10} ${236 - lift * 190}`} fill="none" stroke="var(--light)" strokeWidth="11" strokeLinecap="round" />
    <path d={`M46 160 Q ${10 - lift * 40} ${200 - lift * 160} ${4 + lift * 10} ${236 - lift * 190}`} fill="none" stroke="var(--skin)" strokeWidth="7" strokeLinecap="round" />
    <path d={`M80 160 Q ${116 + lift * 40} ${200 - lift * 160} ${122 - lift * 10} ${236 - lift * 190}`} fill="none" stroke="var(--light)" strokeWidth="11" strokeLinecap="round" />
    <path d={`M80 160 Q ${116 + lift * 40} ${200 - lift * 160} ${122 - lift * 10} ${236 - lift * 190}`} fill="none" stroke="var(--skin)" strokeWidth="7" strokeLinecap="round" />
    {/* long neck and small head */}
    {contour('M54 72 L66 72 L64 40 L56 40 Z', 'var(--skin)')}
    {contour('M40 36 C40 6 82 2 84 32 C86 48 76 58 60 58 C44 58 38 50 40 36 Z', 'var(--skin)')}
    <path d="M60 58 C76 58 86 48 84 32 L84 40 C80 52 70 58 60 58 Z" fill="url(#hs-d-ramp-x)" filter="url(#hs-d)" stroke="none" />
    <ellipse cx="52" cy="34" rx="2.6" ry="3.6" fill="var(--outline)" /><ellipse cx="72" cy="34" rx="2.6" ry="3.6" fill="var(--outline)" />
    <path d="M58 46 q4 -2 8 0" stroke="var(--skin-shadow)" strokeWidth="2.2" fill="none" strokeLinecap="round" />
    {/* flag-shaped hair mass sweeping back like a leaf */}
    {contour('M38 30 C30 4 70 -20 112 -10 C140 -4 150 10 134 16 C110 6 92 10 82 18 C74 10 60 10 54 22 C48 18 42 24 38 30 Z', 'var(--main2)')}
  </svg>
);

/** B · Blob: tiny round head on a tall soft body, noodle limbs, dot eyes. Midnight Gospel junkyard + hallway. */
export const HumanBlob: React.FC<P> = ({lift = 0}) => (
  <svg width="200" height="330" viewBox="-40 -30 200 330" style={{overflow: 'visible'}}>
    <DitherDefs id="hb-d" seed={37} shadow="var(--skin-shadow)" cool="var(--shadow)" />
    <ellipse cx="60" cy="296" rx="60" ry="10" fill="url(#hb-d-cast)" filter="url(#hb-d)" />
    {/* soft blob body: wide, settles at the base */}
    {contour('M14 290 C0 230 10 150 30 110 C42 86 78 86 90 110 C110 150 120 230 106 290 Z', 'var(--main2)')}
    {/* layered shirt as the upper panel of the blob */}
    {contour('M30 112 C44 96 76 96 90 112 L98 180 C76 192 44 192 22 180 Z', 'var(--main1)')}
    <path d="M60 110 L90 112 L98 180 C86 186 72 190 60 190 Z" fill="url(#hb-d-ramp-x)" filter="url(#hb-d)" stroke="none" />
    <path d="M30 112 C50 150 60 160 60 190" fill="none" stroke="var(--light)" strokeWidth="2" />
    {/* noodle limbs with no joints */}
    <path d={`M28 140 Q ${-4 - lift * 30} ${190 - lift * 150} ${0 + lift * 16} ${250 - lift * 210}`} fill="none" stroke="var(--light)" strokeWidth="12" strokeLinecap="round" />
    <path d={`M28 140 Q ${-4 - lift * 30} ${190 - lift * 150} ${0 + lift * 16} ${250 - lift * 210}`} fill="none" stroke="var(--skin)" strokeWidth="8" strokeLinecap="round" />
    <path d={`M92 140 Q ${124 + lift * 30} ${190 - lift * 150} ${120 - lift * 16} ${250 - lift * 210}`} fill="none" stroke="var(--light)" strokeWidth="12" strokeLinecap="round" />
    <path d={`M92 140 Q ${124 + lift * 30} ${190 - lift * 150} ${120 - lift * 16} ${250 - lift * 210}`} fill="none" stroke="var(--skin)" strokeWidth="8" strokeLinecap="round" />
    {/* tiny round head on a short neck, dot eyes, hair as a soft cap with one tuft */}
    {contour('M54 92 L66 92 L64 78 L56 78 Z', 'var(--skin)')}
    {contour('M40 58 C40 36 80 36 80 58 C80 72 70 82 60 82 C50 82 40 72 40 58 Z', 'var(--skin)')}
    <path d="M60 82 C70 82 80 72 80 58 L80 64 C78 74 70 82 60 82 Z" fill="url(#hb-d-ramp-x)" filter="url(#hb-d)" stroke="none" />
    <circle cx="53" cy="60" r="2.6" fill="var(--outline)" /><circle cx="67" cy="60" r="2.6" fill="var(--outline)" />
    <path d="M57 70 q3 2 6 0" stroke="var(--skin-shadow)" strokeWidth="2" fill="none" strokeLinecap="round" />
    {contour('M38 56 C36 30 84 30 82 56 C74 48 66 44 60 44 C52 44 44 48 38 56 Z', 'var(--main2)')}
    {contour('M60 42 C62 26 78 24 84 32 C74 32 68 36 64 44 Z', 'var(--main2)')}
  </svg>
);

/** C · Block: the frozen compact face on a squarish torso with articulated stub legs. Clawd's block + frozen sheet + cat-stairway contour. */
export const HumanBlock: React.FC<P> = ({lift = 0}) => (
  <svg width="200" height="330" viewBox="-40 -30 200 330" style={{overflow: 'visible'}}>
    <DitherDefs id="hk-d" seed={41} shadow="var(--skin-shadow)" cool="var(--shadow)" />
    <ellipse cx="60" cy="296" rx="58" ry="10" fill="url(#hk-d-cast)" filter="url(#hk-d)" />
    {/* stub legs, articulated at the hip */}
    {contour('M28 230 L52 230 L50 288 L26 288 Z', 'var(--main2)')}
    {contour('M68 230 L92 230 L94 288 L70 288 Z', 'var(--main2)')}
    {contour('M22 288 C18 296 24 300 34 300 L52 300 L52 288 Z', 'var(--light)')}
    {contour('M68 288 L68 300 L88 300 C98 300 102 296 98 288 Z', 'var(--light)')}
    {/* squarish torso block with the layered shirt as block-and-panel */}
    {contour('M22 132 L98 132 L104 234 L16 234 Z', 'var(--light)')}
    {contour('M28 128 C44 136 76 136 92 128 L98 206 C80 214 40 216 22 206 Z', 'var(--main1)')}
    <path d="M60 130 L92 128 L98 206 C86 212 72 214 60 214 Z" fill="url(#hk-d-ramp-x)" filter="url(#hk-d)" stroke="none" />
    <path d="M28 128 C48 164 60 176 60 214" fill="none" stroke="var(--light)" strokeWidth="2" />
    {/* arms: sleeved, pivot at the shoulder */}
    <g transform={`rotate(${lift * 110} 24 138)`}>{contour('M24 134 C8 146 2 170 4 194 L18 194 C18 176 22 158 32 146 Z', 'var(--light)')}<ellipse cx="10" cy="198" rx="8" ry="9" fill="var(--skin)" stroke="var(--outline)" strokeWidth="3" /></g>
    <g transform={`rotate(${-lift * 110} 96 138)`}>{contour('M96 134 C112 146 118 170 116 194 L102 194 C102 176 98 158 88 146 Z', 'var(--light)')}<ellipse cx="110" cy="198" rx="8" ry="9" fill="var(--skin)" stroke="var(--outline)" strokeWidth="3" /></g>
    {/* neck and the frozen compact face: large forehead, wide-set eyes, small nose, tiny full lips */}
    {contour('M52 112 L68 112 L66 96 L54 96 Z', 'var(--skin)')}
    {contour('M26 58 C26 18 94 12 96 58 C98 86 86 108 60 110 C34 108 24 86 26 58 Z', 'var(--skin)')}
    <path d="M60 110 C86 108 98 86 96 58 L96 76 C92 96 80 108 60 110 Z" fill="url(#hk-d-ramp-x)" filter="url(#hk-d)" stroke="none" />
    <ellipse cx="44" cy="70" rx="3.6" ry="5" fill="var(--outline)" /><ellipse cx="78" cy="70" rx="3.6" ry="5" fill="var(--outline)" />
    <path d="M61 80 l-2 6 l4 0" fill="none" stroke="var(--outline)" strokeWidth="2" />
    <path d="M55 94 q5 -3 10 0 q-5 4 -10 0 Z" fill="var(--skin-shadow)" stroke="var(--outline)" strokeWidth="2" />
    {contour('M22 62 C12 30 40 2 70 8 C100 2 118 30 104 54 C100 40 86 30 70 32 C58 20 40 28 38 44 C32 40 26 48 22 62 Z', 'var(--main2)')}
    {contour('M58 10 C76 -6 112 -2 120 20 C106 14 86 14 74 24 Z', 'var(--main2)')}
  </svg>
);
