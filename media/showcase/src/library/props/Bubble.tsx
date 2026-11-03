/**
 * The bubble (object inventory: capability seen through glass, swells from the box, pops): a transparent sphere in the Seuss contour language.
 * A pale contour ring, a faint role-filled body, two highlight sweeps and a small stipple of beads along the lower rim. `squash` (-1..1, a boil
 * variant) makes it a slightly different ellipse each variant, so the bubble breathes on the contract's rate instead of sitting perfectly round.
 * Roles: main2 body, light contour and highlights, accent the bead marks. Drawn in a 280 x 280 box centred on (140, 140); a Sprite scales it.
 */
export const Bubble: React.FC<{squash?: number; wobble?: number}> = ({squash = 0, wobble = 0}) => {
  const rx = 124 * (1 + squash * 0.035), ry = 124 * (1 - squash * 0.035);
  return (
    <svg width="280" height="280" viewBox="0 0 280 280" style={{overflow: 'visible'}}>
      <g transform={`rotate(${wobble * 3} 140 140)`}>
        <ellipse cx="140" cy="140" rx={rx} ry={ry} fill="var(--main2)" opacity="0.2" />
        <ellipse cx="140" cy="140" rx={rx} ry={ry} fill="none" stroke="var(--light)" strokeWidth="6" />
        <ellipse cx="140" cy="140" rx={rx + 5} ry={ry + 5} fill="none" stroke="var(--outline)" strokeWidth="2.5" opacity="0.9" />
        {/* highlight sweeps, upper left: the glass catching the light */}
        <path d="M54 118 C58 84 86 54 122 44" fill="none" stroke="var(--light)" strokeWidth="9" strokeLinecap="round" />
        <path d="M70 142 C72 128 78 116 86 106" fill="none" stroke="var(--light)" strokeWidth="5" strokeLinecap="round" />
        {/* beads along the lower rim */}
        {[0, 1, 2, 3, 4, 5, 6].map((i) => {
          const t = Math.PI * (0.12 + 0.76 * (i / 6));
          return <circle key={i} cx={140 + (rx - 14) * Math.cos(t)} cy={140 + (ry - 14) * Math.sin(t)} r={i % 2 ? 3.2 : 4.6} fill={i === 3 ? 'var(--accent)' : 'var(--light)'} />;
        })}
      </g>
    </svg>
  );
};
