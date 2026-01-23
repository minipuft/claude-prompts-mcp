/**
 * BioluminescentBadge - Glowing status badge with pulse animation
 * Year3000 Organic design system
 */

import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import { organic_status } from "../../constants/colors";
import { fontFamilies, fontSizes, fontWeights, textGlow } from "../../constants/typography";
import { radii, spacing } from "../../constants";
import { glowPulse, alertPulse } from "../../utils/organic-animations";
import { springs } from "../../constants/timing";

type Status = "pass" | "fail" | "warning" | "info" | "active";

type BioluminescentBadgeProps = {
  status: Status;
  label: string;
  /** Enable pulsing glow animation */
  pulse?: boolean;
  /** Show icon before label */
  icon?: React.ReactNode;
  /** Delay before appearing (in frames) */
  delay?: number;
};

const STATUS_ICONS: Record<Status, string> = {
  pass: "\u2713", // Checkmark
  fail: "\u2717", // X
  warning: "\u26A0", // Warning triangle
  info: "\u2139", // Info
  active: "\u25CF", // Filled circle
};

export const BioluminescentBadge: React.FC<BioluminescentBadgeProps> = ({
  status,
  label,
  pulse = true,
  icon,
  delay = 0,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const config = organic_status[status];
  const effectiveFrame = Math.max(0, frame - delay);

  // Entry animation
  const scale = spring({
    frame: effectiveFrame,
    fps,
    config: springs.organic,
  });

  // Pulse animation
  const pulseIntensity = pulse && config.pulse
    ? status === "fail" || status === "warning"
      ? alertPulse(frame, fps)
      : glowPulse(frame, fps, 0.6)
    : 1;

  // Glow effect
  const glowShadow = status === "pass"
    ? textGlow.status.pass
    : status === "fail"
      ? textGlow.status.fail
      : status === "warning"
        ? textGlow.status.warning
        : textGlow.label.cyan;

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: spacing.sm,
        padding: `${spacing.xs}px ${spacing.md}px`,
        borderRadius: radii.pill,
        backgroundColor: config.bg,
        border: `1px solid ${config.color}`,
        boxShadow: `
          0 0 ${15 * pulseIntensity}px ${config.color}40,
          0 0 ${30 * pulseIntensity}px ${config.color}20,
          inset 0 0 ${10 * pulseIntensity}px ${config.color}10
        `,
        transform: `scale(${scale})`,
        opacity: effectiveFrame > 0 ? 1 : 0,
      }}
    >
      {/* Icon */}
      <span
        style={{
          fontSize: fontSizes.sm,
          color: config.color,
          textShadow: glowShadow,
          opacity: pulseIntensity,
        }}
      >
        {icon || STATUS_ICONS[status]}
      </span>

      {/* Label */}
      <span
        style={{
          fontFamily: fontFamilies.body,
          fontSize: fontSizes.sm,
          fontWeight: fontWeights.semibold,
          color: config.color,
          letterSpacing: 1,
          textTransform: "uppercase",
          textShadow: glowShadow,
        }}
      >
        {label}
      </span>
    </div>
  );
};

// =============================================================================
// LEGACY COMPATIBLE STATUS BADGE
// =============================================================================

type StatusBadgeProps = {
  status: "pass" | "fail" | "warning" | "info";
  label: string;
};

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, label }) => {
  return <BioluminescentBadge status={status} label={label} pulse={true} />;
};
