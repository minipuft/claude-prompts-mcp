/**
 * GlowingText - Animated text with bioluminescent glow effects
 * Year3000 Organic design system
 */

import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { organic_text, bioluminescent } from "../../constants/colors";
import { fontSizes, fontWeights, textGlow, textPresets } from "../../constants/typography";
import { durations, springs } from "../../constants/timing";
import { breathingGlow, organicFadeIn, cascadeReveal } from "../../utils/organic-animations";

type TextVariant = "hero" | "title" | "section" | "body" | "label" | "code";
type GlowColor = "cyan" | "magenta" | "purple" | "green" | "white" | "none";
type RevealStyle = "fade" | "typewriter" | "bloom" | "cascade";

type GlowingTextProps = {
  text: string;
  /** Text style variant */
  variant?: TextVariant;
  /** Glow color */
  glowColor?: GlowColor;
  /** Enable breathing glow animation */
  breathe?: boolean;
  /** Reveal animation style */
  revealStyle?: RevealStyle;
  /** Start frame for animation */
  start?: number;
  /** Animation duration in frames */
  duration?: number;
  /** Text alignment */
  align?: "left" | "center" | "right";
  /** Custom color override */
  color?: string;
  /** Additional style overrides */
  style?: React.CSSProperties;
};

const GLOW_SHADOWS: Record<GlowColor, string> = {
  cyan: textGlow.hero.cyan,
  magenta: textGlow.hero.magenta,
  purple: textGlow.hero.purple,
  green: textGlow.code.green,
  white: textGlow.label.white,
  none: "none",
};

const VARIANT_CONFIGS: Record<TextVariant, {
  preset: keyof typeof textPresets;
  defaultGlow: GlowColor;
  glowLevel: "hero" | "section" | "label";
}> = {
  hero: { preset: "heroTitle", defaultGlow: "cyan", glowLevel: "hero" },
  title: { preset: "heroSubtitle", defaultGlow: "purple", glowLevel: "hero" },
  section: { preset: "sectionTitle", defaultGlow: "cyan", glowLevel: "section" },
  body: { preset: "body", defaultGlow: "none", glowLevel: "label" },
  label: { preset: "label", defaultGlow: "white", glowLevel: "label" },
  code: { preset: "code", defaultGlow: "cyan", glowLevel: "label" },
};

export const GlowingText: React.FC<GlowingTextProps> = ({
  text,
  variant = "hero",
  glowColor,
  breathe = false,
  revealStyle = "fade",
  start = 0,
  duration = durations.natural,
  align = "center",
  color,
  style,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const config = VARIANT_CONFIGS[variant];
  const preset = textPresets[config.preset];
  const effectiveGlowColor = glowColor ?? config.defaultGlow;
  const effectiveFrame = frame - start;

  // Breathing intensity
  const breathIntensity = breathe ? breathingGlow(frame, fps, 1) : 1;

  // Get appropriate glow shadow based on variant level
  let glowShadow = "none";
  if (effectiveGlowColor !== "none") {
    const glowLevel = config.glowLevel;
    if (glowLevel === "hero") {
      glowShadow = effectiveGlowColor === "cyan" ? textGlow.hero.cyan
        : effectiveGlowColor === "magenta" ? textGlow.hero.magenta
        : effectiveGlowColor === "purple" ? textGlow.hero.purple
        : textGlow.hero.cyan;
    } else if (glowLevel === "section") {
      glowShadow = effectiveGlowColor === "cyan" ? textGlow.section.cyan
        : effectiveGlowColor === "magenta" ? textGlow.section.magenta
        : effectiveGlowColor === "purple" ? textGlow.section.purple
        : textGlow.section.cyan;
    } else {
      glowShadow = GLOW_SHADOWS[effectiveGlowColor];
    }
  }

  // Animation based on reveal style
  let opacity = 1;
  let scale = 1;
  let translateY = 0;
  let visibleChars = text.length;

  switch (revealStyle) {
    case "fade":
      opacity = organicFadeIn(frame, start, duration);
      translateY = interpolate(effectiveFrame, [0, duration], [20, 0], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
      break;

    case "bloom":
      const bloomProgress = interpolate(effectiveFrame, [0, duration], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
      scale = spring({
        frame: effectiveFrame,
        fps,
        config: springs.ethereal,
      });
      opacity = bloomProgress;
      break;

    case "typewriter":
      opacity = effectiveFrame > 0 ? 1 : 0;
      visibleChars = Math.floor(interpolate(effectiveFrame, [0, duration], [0, text.length], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      }));
      break;

    case "cascade":
      // Each character animates separately (handled in render)
      break;
  }

  // Adjust glow opacity based on breathing
  const glowOpacityMultiplier = breathe ? 0.7 + 0.3 * breathIntensity : 1;

  // Text color
  const textColor = color ?? organic_text.primary.color;

  // Render cascade style differently
  if (revealStyle === "cascade") {
    const charOpacities = cascadeReveal(frame, start, text.length, 2);
    return (
      <div style={{ textAlign: align, ...style }}>
        {text.split("").map((char, index) => (
          <span
            key={index}
            style={{
              ...preset,
              color: textColor,
              textShadow: glowShadow,
              opacity: charOpacities[index] * glowOpacityMultiplier,
              display: "inline-block",
              transform: `translateY(${(1 - charOpacities[index]) * 10}px)`,
            }}
          >
            {char === " " ? "\u00A0" : char}
          </span>
        ))}
      </div>
    );
  }

  return (
    <div
      style={{
        opacity,
        transform: `translateY(${translateY}px) scale(${scale})`,
        textAlign: align,
        ...style,
      }}
    >
      <span
        style={{
          ...preset,
          color: textColor,
          textShadow: glowShadow,
          opacity: glowOpacityMultiplier,
        }}
      >
        {revealStyle === "typewriter" ? text.slice(0, visibleChars) : text}
        {revealStyle === "typewriter" && visibleChars < text.length && (
          <span
            style={{
              opacity: Math.sin(frame * 0.3) > 0 ? 1 : 0, // Blinking cursor
              color: bioluminescent.cyan.core,
              textShadow: textGlow.code.cyan,
            }}
          >
            |
          </span>
        )}
      </span>
    </div>
  );
};

// =============================================================================
// LEGACY COMPATIBLE ANIMATED TEXT
// =============================================================================

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
  weight: _weight = "bold",
  color,
  glow = false,
  start = 0,
  duration = durations.normal,
  align = "center",
}) => {
  // Map size to variant
  const variant: TextVariant = size === "5xl" || size === "6xl" ? "hero"
    : size === "3xl" || size === "4xl" ? "title"
    : size === "xl" || size === "2xl" ? "section"
    : "body";

  return (
    <GlowingText
      text={text}
      variant={variant}
      glowColor={glow ? "cyan" : "none"}
      start={start}
      duration={duration}
      align={align}
      color={color}
    />
  );
};
