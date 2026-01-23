import { colors, spacing } from "../../constants";

type ProgressDotsProps = {
  total: number;
  activeIndex: number;
};

export const ProgressDots: React.FC<ProgressDotsProps> = ({ total, activeIndex }) => {
  return (
    <div style={{ display: "flex", gap: spacing.sm }}>
      {Array.from({ length: total }).map((_, index) => (
        <div
          key={index}
          style={{
            width: 12,
            height: 12,
            borderRadius: 999,
            backgroundColor:
              index <= activeIndex ? colors.accent.primary : colors.overlay.medium,
            boxShadow:
              index <= activeIndex
                ? `0 0 12px ${colors.accent.primary}`
                : undefined,
          }}
        />
      ))}
    </div>
  );
};
