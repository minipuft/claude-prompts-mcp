/** Kit piece: table (world-kit-01 tray, simplified). Footprint 2x1 units; human height = 3 units. */
export const Table: React.FC = () => (
  <svg width="160" height="96" viewBox="0 0 160 96">
    <g stroke="var(--outline)" strokeWidth="4" strokeLinejoin="round">
      <polygon points="20,30 140,30 156,46 36,46" fill="var(--light)" />
      <polygon points="36,46 156,46 156,58 36,58" fill="var(--main1)" />
      <polygon points="20,30 36,46 36,58 20,42" fill="var(--shadow)" />
      <rect x="40" y="58" width="12" height="30" fill="var(--main2)" />
      <rect x="140" y="58" width="12" height="30" fill="var(--main2)" />
      <rect x="24" y="42" width="12" height="30" fill="var(--shadow)" />
      <rect x="124" y="58" width="12" height="30" fill="var(--shadow)" />
      <rect x="70" y="36" width="36" height="6" fill="var(--accent)" stroke="none" />
    </g>
  </svg>
);
