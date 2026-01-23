import { useCurrentFrame, useVideoConfig } from "remotion";
import { colors, fontFamilies, fontSizes, fontWeights, durations } from "../../constants";
import { fadeIn, scaleIn, slideUp } from "../../utils";

type AnimatedTextProps = {
  text: string;
  size?: keyof typeof fontSizes;
  weight?: keyof typeof fontWeights;
  color?: string;
  glow?: boolean;
  start?: number;
  duration?: number;
  align?: "left" | "center" | "right";
};

export const AnimatedText: React.FC<AnimatedTextProps> = ({
  text,
  size = "4xl",
  weight = "bold",
  color = colors.text.primary,
  glow = false,
  start = 0,
  duration = durations.normal,
  align = "center",
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const opacity = fadeIn(frame, { start, duration });
  const translateY = slideUp(frame, { start, duration, from: 24, to: 0 });
  const scale = scaleIn(frame, fps, { start, duration });

  return (
    <div
      style={{
        opacity,
        transform: `translateY(${translateY}px) scale(${scale})`,
        textAlign: align,
      }}
    >
      <span
        style={{
          fontFamily: fontFamilies.display,
          fontSize: fontSizes[size],
          fontWeight: fontWeights[weight],
          color,
          textShadow: glow ? `0 0 40px ${colors.accent.primary}` : undefined,
        }}
      >
        {text}
      </span>
    </div>
  );
};
