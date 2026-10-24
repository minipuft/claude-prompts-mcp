import {DitherDefs} from '../library/Dither';

/**
 * Human muse sheet 15 (D55/D56 clean slate, D63): three constructions from the board, same skin and garment roles, same lift pose.
 * Rule from the muse: hands are the largest skin area after the head (radius >= 0.45 of the head radius); no feature the companions lack.
 * Contour: pale light-role stroke one step behind the outline. Shadows: two-scale stipple with the mauve shift (--skin-shadow).
 */
type P = {lift?: number; variant?: number};
const contour = (d: string, fill: string) => (
  <>
    <path d={d} fill="var(--light)" stroke="var(--light)" strokeWidth="9" strokeLinejoin="round" />
    <path d={d} fill={fill} stroke="var(--outline)" strokeWidth="3" strokeLinejoin="round" />
  </>
);
const boil = (v: number) => `translate(${[0, 1.6, -1.4][v] ?? 0} ${[0, -1.2, 1.4][v] ?? 0}) rotate(${[0, 0.8, -0.7][v] ?? 0} 60 160)`;
const hand = (cx: number, cy: number, r: number) => (
  <>
    <circle cx={cx} cy={cy} r={r + 3} fill="var(--light)" />
    <circle cx={cx} cy={cy} r={r} fill="var(--skin)" stroke="var(--outline)" strokeWidth="3" />
  </>
);
const arm = (x0: number, y0: number, x1: number, y1: number, cx: number, cy: number, w = 7) => (
  <>
    <path d={`M${x0} ${y0} Q ${cx} ${cy} ${x1} ${y1}`} fill="none" stroke="var(--light)" strokeWidth={w + 4} strokeLinecap="round" />
    <path d={`M${x0} ${y0} Q ${cx} ${cy} ${x1} ${y1}`} fill="none" stroke="var(--skin)" strokeWidth={w} strokeLinecap="round" />
  </>
);
const face = (cx: number, cy: number, r: number) => (
  <>
    <circle cx={cx - r * 0.38} cy={cy - r * 0.05} r={r * 0.11} fill="var(--outline)" />
    <circle cx={cx + r * 0.38} cy={cy - r * 0.05} r={r * 0.11} fill="var(--outline)" />
    <path d={`M${cx - r * 0.18} ${cy + r * 0.42} q ${r * 0.18} ${r * 0.14} ${r * 0.36} 0`} stroke="var(--skin-shadow)" strokeWidth="2.2" fill="none" strokeLinecap="round" />
  </>
);

/** A · Bell: layered cloak bands with a rounded apex, small head in the apex, long arms with large hands. archbishop-katz + fosters + chetas. */
export const HumanBell: React.FC<P> = ({lift = 0, variant = 0}) => {
  const hx = 0 + lift * 6, hy = 236 - lift * 196; // hand travel: hip height to above the head
  return (
    <svg width="200" height="330" viewBox="-40 -30 200 330" style={{overflow: 'visible'}}>
      <DitherDefs id="hbell-d" seed={51} shadow="var(--skin-shadow)" cool="var(--shadow)" />
      <ellipse cx="60" cy="296" rx="62" ry="10" fill="url(#hbell-d-cast)" filter="url(#hbell-d)" />
      <g transform={boil(variant)}>
        {/* outer cloak: a soft bell, apex rounded so it never reads as the gate arch */}
        {contour('M6 292 C-2 220 14 140 36 96 C46 76 74 76 84 96 C106 140 122 220 114 292 Z', 'var(--main2)')}
        {/* middle band and inner band, cream and blue, as the archbishop's layered arches */}
        {contour('M20 292 C14 230 26 170 40 130 C48 112 72 112 80 130 C94 170 106 230 100 292 Z', 'var(--light)')}
        {contour('M34 292 C30 240 38 196 48 166 C52 154 68 154 72 166 C82 196 90 240 86 292 Z', 'var(--main1)')}
        {/* form shadow on the right of the bell, stippled, mauve shift at the contact edge */}
        <path d="M60 80 C74 76 84 96 84 96 C106 140 122 220 114 292 L60 292 Z" fill="url(#hbell-d-ramp-x)" filter="url(#hbell-d)" stroke="none" />
        {/* arms leave the bell at mid-height; hands are the largest skin area */}
        {arm(30, 150, hx - 6, hy, -8 - lift * 36, 200 - lift * 150)}
        {arm(90, 150, 126 - hx, hy, 128 + lift * 36, 200 - lift * 150)}
        {hand(hx - 8, hy, 12)}
        {hand(128 - hx, hy, 12)}
        {/* short neck and small round head in the apex */}
        {contour('M54 84 L66 84 L64 66 L56 66 Z', 'var(--skin)')}
        {contour('M38 46 C38 22 82 22 82 46 C82 60 72 70 60 70 C48 70 38 60 38 46 Z', 'var(--skin)')}
        <path d="M60 70 C72 70 82 60 82 46 L82 52 C80 62 70 70 60 70 Z" fill="url(#hbell-d-ramp-x)" filter="url(#hbell-d)" stroke="none" />
        {face(60, 46, 22)}
        {/* hair: one soft cap with a single curl, no more detail than Codex's lobes */}
        {contour('M36 44 C34 18 86 16 84 44 C76 34 66 30 60 30 C52 30 44 34 36 44 Z', 'var(--main2)')}
        {contour('M78 30 C86 18 100 20 102 30 C94 28 88 30 84 38 Z', 'var(--main2)')}
      </g>
    </svg>
  );
};

/** B · Kite: diamond torso, stick legs, long arms with large hands, hair as one trailing swoop. fosters + freebird + chetas. */
export const HumanKite: React.FC<P> = ({lift = 0, variant = 0}) => {
  const hx = 0 + lift * 6, hy = 236 - lift * 196;
  return (
    <svg width="200" height="330" viewBox="-40 -30 200 330" style={{overflow: 'visible'}}>
      <DitherDefs id="hkite-d" seed={53} shadow="var(--skin-shadow)" cool="var(--shadow)" />
      <ellipse cx="60" cy="296" rx="50" ry="9" fill="url(#hkite-d-cast)" filter="url(#hkite-d)" />
      <g transform={boil(variant)}>
        {/* stick legs with enlarged feet */}
        <path d="M48 222 L40 290" stroke="var(--light)" strokeWidth="12" strokeLinecap="round" /><path d="M48 222 L40 290" stroke="var(--main2)" strokeWidth="7" strokeLinecap="round" />
        <path d="M72 222 L80 290" stroke="var(--light)" strokeWidth="12" strokeLinecap="round" /><path d="M72 222 L80 290" stroke="var(--main2)" strokeWidth="7" strokeLinecap="round" />
        {contour('M22 290 C22 282 30 280 42 282 L44 294 L24 294 Z', 'var(--main1)')}
        {contour('M76 282 C88 280 96 282 98 290 L96 294 L76 294 Z', 'var(--main1)')}
        {/* diamond torso: cream inner, blue outer edge as a layered shirt */}
        {contour('M60 96 L108 160 L60 228 L12 160 Z', 'var(--main1)')}
        {contour('M60 110 L94 160 L60 212 L26 160 Z', 'var(--light)')}
        <path d="M60 96 L108 160 L60 228 Z" fill="url(#hkite-d-ramp-x)" filter="url(#hkite-d)" stroke="none" />
        {/* arms from the diamond's side points */}
        {arm(16, 158, hx - 6, hy, -14 - lift * 34, 206 - lift * 156)}
        {arm(104, 158, 126 - hx, hy, 134 + lift * 34, 206 - lift * 156)}
        {hand(hx - 8, hy, 12)}
        {hand(128 - hx, hy, 12)}
        {/* neck and small head */}
        {contour('M54 98 L66 98 L64 80 L56 80 Z', 'var(--skin)')}
        {contour('M40 58 C40 36 80 36 80 58 C80 72 70 82 60 82 C50 82 40 72 40 58 Z', 'var(--skin)')}
        <path d="M60 82 C70 82 80 72 80 58 L80 64 C78 74 70 82 60 82 Z" fill="url(#hkite-d-ramp-x)" filter="url(#hkite-d)" stroke="none" />
        {face(60, 58, 20)}
        {/* hair as one trailing swoop, Freebird's trailing line */}
        {contour('M40 56 C40 30 78 26 82 48 C74 42 66 42 60 44 C54 46 48 50 46 60 Z', 'var(--main2)')}
        {contour('M70 36 C90 14 124 10 142 26 C120 22 100 28 86 46 Z', 'var(--main2)')}
      </g>
    </svg>
  );
};

/** C · Kin: the companions' grammar; one soft mass body (Clawd's block in the stairway's feathered contour), lobed hair cap (Codex), short arms, big hands. */
export const HumanKin: React.FC<P> = ({lift = 0, variant = 0}) => {
  const hx = 6 + lift * 4, hy = 220 - lift * 180;
  return (
    <svg width="200" height="330" viewBox="-40 -30 200 330" style={{overflow: 'visible'}}>
      <DitherDefs id="hkin-d" seed={59} shadow="var(--skin-shadow)" cool="var(--shadow)" />
      <ellipse cx="60" cy="296" rx="64" ry="10" fill="url(#hkin-d-cast)" filter="url(#hkin-d)" />
      <g transform={boil(variant)}>
        {/* stub legs like Clawd's, softened */}
        {contour('M30 250 C28 272 30 288 34 292 L52 292 L54 250 Z', 'var(--main2)')}
        {contour('M66 250 L68 292 L86 292 C90 288 92 272 90 250 Z', 'var(--main2)')}
        {/* one soft mass body with a feathered lower contour */}
        {contour('M18 150 C18 120 40 104 60 104 C80 104 102 120 102 150 L104 236 C96 252 84 256 72 250 C64 256 56 256 48 250 C36 256 24 252 16 236 Z', 'var(--main1)')}
        {contour('M26 150 C30 128 46 120 60 120 C74 120 90 128 94 150 L94 190 C80 198 40 198 26 190 Z', 'var(--light)')}
        <path d="M60 104 C80 104 102 120 102 150 L104 236 C96 252 84 256 72 250 L60 250 Z" fill="url(#hkin-d-ramp-x)" filter="url(#hkin-d)" stroke="none" />
        {/* short arms, big hands */}
        {arm(22, 176, hx - 2, hy, -4 - lift * 30, 210 - lift * 130, 8)}
        {arm(98, 176, 122 - hx, hy, 124 + lift * 30, 210 - lift * 130, 8)}
        {hand(hx - 6, hy, 13)}
        {hand(126 - hx, hy, 13)}
        {/* short neck, round head */}
        {contour('M52 108 L68 108 L66 92 L54 92 Z', 'var(--skin)')}
        {contour('M34 66 C34 38 86 38 86 66 C86 84 74 96 60 96 C46 96 34 84 34 66 Z', 'var(--skin)')}
        <path d="M60 96 C74 96 86 84 86 66 L86 74 C82 88 72 96 60 96 Z" fill="url(#hkin-d-ramp-x)" filter="url(#hkin-d)" stroke="none" />
        {face(60, 66, 26)}
        {/* lobed hair cap echoing Codex's cloud lobes */}
        {contour('M30 62 C26 40 40 28 52 34 C56 22 72 20 78 32 C92 28 100 44 90 60 C80 52 70 50 60 50 C50 50 40 52 30 62 Z', 'var(--main2)')}
      </g>
    </svg>
  );
};
