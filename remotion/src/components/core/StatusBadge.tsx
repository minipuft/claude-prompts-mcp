import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import { colors, fontFamilies, fontSizes, fontWeights, radii, spacing } from "../../constants";

type Status = "pass" | "fail" | "warning" | "info";

type StatusBadgeProps = {
  status: Status;
  label: string;
};

const statusColors: Record<Status, string> = {
  pass: colors.status.pass,
  fail: colors.status.fail,
  warning: colors.status.warning,
  info: colors.status.info,
};

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, label }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const scale = spring({ frame, fps, config: { damping: 14, stiffness: 200 } });
  const color = statusColors[status];

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: spacing.xs,
        padding: `${spacing.xs}px ${spacing.md}px`,
        borderRadius: radii.pill,
        backgroundColor: `${color}22`,
        border: `1px solid ${color}`,
        transform: `scale(${scale})`,
      }}
    >
      <span
        style={{
          fontFamily: fontFamilies.body,
          fontSize: fontSizes.sm,
          fontWeight: fontWeights.semibold,
          color,
          letterSpacing: 1,
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>
    </div>
  );
};
