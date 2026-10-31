/**
 * The cloak on the floor (beat 4, D69 and D99): the garment that came off at the rise, a mound of cloth with two folds and a curled hem. Drawn flat in the role fills like the other placeholder props (the
 * animatic's `actors.tsx`), standing on its anchor, which is the bottom centre of the mound (0, 0). About 168 px wide and 64 px high at scale 1.
 */
export const HEAP = {width: 168, height: 64};

export const Heap: React.FC = () => {
  const mound = 'M -84 0 C -82 -20 -60 -34 -36 -42 C -26 -62 6 -66 24 -50 C 52 -46 78 -24 84 0 Z';
  return (
    <svg width="1" height="1" style={{overflow: 'visible', position: 'absolute', left: 0, top: 0}}>
      <path d={mound} fill="var(--main1)" stroke="var(--light)" strokeWidth="4" strokeLinejoin="round" />
      <path d={mound} fill="none" stroke="var(--outline)" strokeWidth="1.5" strokeLinejoin="round" />
      {/* two folds and the hem's curl */}
      <path d="M -42 -32 Q -12 -16 -22 0" fill="none" stroke="var(--shadow)" strokeWidth="5" strokeLinecap="round" />
      <path d="M 14 -52 Q 32 -26 12 0" fill="none" stroke="var(--shadow)" strokeWidth="5" strokeLinecap="round" />
      <path d="M 44 -8 Q 66 -16 80 -4" fill="none" stroke="var(--main2)" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
};
