import { colors, fontFamilies, fontSizes, fontWeights, radii, spacing } from "../../constants";

type FrameworkBadgeProps = {
  label: string;
};

export const FrameworkBadge: React.FC<FrameworkBadgeProps> = ({ label }) => {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: spacing.xs,
        padding: `${spacing.xs}px ${spacing.md}px`,
        borderRadius: radii.pill,
        backgroundColor: "rgba(99, 102, 241, 0.15)",
        border: `1px solid ${colors.accent.primary}`,
        color: colors.accent.light,
        fontFamily: fontFamilies.body,
        fontSize: fontSizes.sm,
        fontWeight: fontWeights.semibold,
        letterSpacing: 1,
      }}
    >
      {label}
    </div>
  );
};
