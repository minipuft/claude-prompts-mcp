import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import { colors, fontFamilies, fontSizes, fontWeights, radii, spacing } from "../../constants";

type FlowStepProps = {
  title: string;
  description: string;
  icon?: string;
  index: number;
  active?: boolean;
  complete?: boolean;
};

export const FlowStep: React.FC<FlowStepProps> = ({
  title,
  description,
  icon,
  index,
  active = false,
  complete = false,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const scale = spring({ frame: frame - index * 8, fps, config: { damping: 20 } });

  // Determine colors based on state
  const borderColor = complete
    ? colors.status.pass
    : active
      ? colors.accent.primary
      : colors.overlay.medium;

  const bgColor = complete
    ? "rgba(34, 197, 94, 0.1)"
    : active
      ? "rgba(99, 102, 241, 0.15)"
      : colors.overlay.light;

  return (
    <div
      style={{
        transform: `scale(${scale})`,
        padding: spacing.lg,
        borderRadius: radii.lg,
        border: `2px solid ${borderColor}`,
        backgroundColor: bgColor,
        minWidth: 200,
        textAlign: "center",
        transition: "border-color 0.3s, background-color 0.3s",
      }}
    >
      {icon && (
        <div style={{ fontSize: 32, marginBottom: spacing.sm }}>
          {icon}
        </div>
      )}
      <div
        style={{
          fontFamily: fontFamilies.body,
          fontSize: fontSizes.xs,
          color: colors.text.muted,
          letterSpacing: 1,
          textTransform: "uppercase",
          marginBottom: spacing.xs,
        }}
      >
        Step {index + 1}
      </div>
      <div
        style={{
          fontFamily: fontFamilies.display,
          fontSize: fontSizes.lg,
          fontWeight: fontWeights.semibold,
          color: complete ? colors.status.pass : colors.text.primary,
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontFamily: fontFamilies.body,
          fontSize: fontSizes.sm,
          color: colors.text.secondary,
          marginTop: spacing.xs,
        }}
      >
        {description}
      </div>
      {complete && (
        <div
          style={{
            marginTop: spacing.sm,
            color: colors.status.pass,
            fontSize: fontSizes.sm,
          }}
        >
          ✓ Complete
        </div>
      )}
    </div>
  );
};
