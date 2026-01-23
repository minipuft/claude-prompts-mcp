import { interpolate } from "remotion";
import { colors, durations, fontFamilies, fontSizes, radii, spacing } from "../../constants";

type OperatorHighlightProps = {
  operator: string;
  description: string;
  frame?: number;
  delay?: number;
};

export const OperatorHighlight: React.FC<OperatorHighlightProps> = ({
  operator,
  description,
  frame = 0,
  delay = 0,
}) => {
  const opacity = interpolate(frame, [delay, delay + durations.normal], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const translateY = interpolate(frame, [delay, delay + durations.normal], [12, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        opacity,
        transform: `translateY(${translateY}px)`,
        display: "flex",
        alignItems: "center",
        gap: spacing.md,
        padding: `${spacing.md}px ${spacing.lg}px`,
        backgroundColor: colors.overlay.light,
        borderRadius: radii.md,
        border: `1px solid ${colors.overlay.medium}`,
      }}
    >
      <span
        style={{
          fontFamily: fontFamilies.mono,
          fontSize: fontSizes.md,
          color: colors.accent.light,
          backgroundColor: "rgba(99, 102, 241, 0.2)",
          padding: `${spacing.xs}px ${spacing.sm}px`,
          borderRadius: radii.sm,
          whiteSpace: "nowrap",
        }}
      >
        {operator}
      </span>
      <span
        style={{
          fontFamily: fontFamilies.body,
          fontSize: fontSizes.sm,
          color: colors.text.secondary,
        }}
      >
        {description}
      </span>
    </div>
  );
};
