import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import { colors, fontFamilies, fontSizes, fontWeights, radii, spacing } from "../../constants";

type GateCriterionProps = {
  text: string;
  status: "pass" | "fail";
  index: number;
};

export const GateCriterion: React.FC<GateCriterionProps> = ({ text, status, index }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const delay = index * 12;
  const scale = spring({ frame: frame - delay, fps, config: { damping: 16 } });
  const color = status === "pass" ? colors.status.pass : colors.status.fail;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: spacing.md,
        padding: `${spacing.md}px ${spacing.lg}px`,
        borderRadius: radii.md,
        border: `1px solid ${color}`,
        backgroundColor: `${color}1a`,
        transform: `scale(${scale})`,
      }}
    >
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: 999,
          border: `2px solid ${color}`,
          backgroundColor: `${color}22`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: fontSizes.md,
          color,
        }}
      >
        {status === "pass" ? "✓" : "✕"}
      </div>
      <div
        style={{
          flex: 1,
          fontFamily: fontFamilies.body,
          fontSize: fontSizes.md,
          color: colors.text.primary,
        }}
      >
        {text}
      </div>
      <div
        style={{
          fontFamily: fontFamilies.body,
          fontSize: fontSizes.sm,
          fontWeight: fontWeights.semibold,
          letterSpacing: 1,
          textTransform: "uppercase",
          color,
        }}
      >
        {status}
      </div>
    </div>
  );
};
