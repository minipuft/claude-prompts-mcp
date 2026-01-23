/**
 * HeroIntro - Brand introduction with cosmic emergence
 * Year3000 Organic aesthetic
 *
 * Timeline (10s / 300 frames @ 30fps):
 * 0:00-0:02 (0-60):    Deep void + particle field, aurora fades in
 * 0:02-0:04 (60-120):  "Claude Prompts" emerges with cyan glow bloom
 * 0:04-0:05 (120-150): "MCP" appears with magenta glow
 * 0:05-0:06 (150-180): Tagline fades in
 * 0:06-0:10 (180-300): Feature cards emerge with staggered float
 */

import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import { GlowingText, OrganicPanel, CosmicBackground } from "../components";
import { void_backgrounds, bioluminescent, organic_text } from "../constants/colors";
import { fontFamilies, fontSizes, textGlow } from "../constants/typography";
import { durations, stagger } from "../constants/timing";
import { layout, spacing } from "../constants/spacing";
import { organicFadeIn, floatingMotionY, breathingGlow } from "../utils/organic-animations";

// =============================================================================
// FEATURE DATA
// =============================================================================

const FEATURES = [
  { title: "Chains", desc: "Orchestrate multi-step prompts", icon: "\u26D3", glowColor: "cyan" as const },
  { title: "Gates", desc: "Quality validation built-in", icon: "\u2713", glowColor: "green" as const },
  { title: "Frameworks", desc: "Structured reasoning modes", icon: "\u2699", glowColor: "purple" as const },
  { title: "Operators", desc: "Symbolic shorthand syntax", icon: "\u2192", glowColor: "magenta" as const },
];

// =============================================================================
// MAIN COMPOSITION
// =============================================================================

export const HeroIntro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill
      style={{
        backgroundColor: void_backgrounds.abyss,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      {/* Cosmic background with particles and aurora */}
      <CosmicBackground
        particles={{ density: "normal", glow: true, depth: true, speed: 0.5 }}
        aurora={{ variant: "nebula", opacity: 0.8, animate: true }}
      />

      {/* Content container */}
      <div
        style={{
          position: "relative",
          zIndex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          padding: spacing["3xl"],
        }}
      >
        {/* Main title: "Claude Prompts" */}
        <Sequence from={60} durationInFrames={fps * 8} premountFor={durations.quick}>
          <GlowingText
            text="Claude Prompts"
            variant="hero"
            glowColor="cyan"
            breathe
            revealStyle="bloom"
            start={0}
            duration={durations.deliberate}
          />
        </Sequence>

        {/* Subtitle: "MCP" */}
        <Sequence from={120} durationInFrames={fps * 7} premountFor={durations.quick}>
          <div style={{ marginTop: spacing.md }}>
            <GlowingText
              text="MCP"
              variant="title"
              glowColor="magenta"
              breathe
              revealStyle="bloom"
              start={0}
              duration={durations.natural}
            />
          </div>
        </Sequence>

        {/* Tagline */}
        <Sequence from={150} durationInFrames={fps * 6.5} premountFor={durations.quick}>
          <div style={{ marginTop: spacing.xl }}>
            <GlowingText
              text="Prompt Engineering at Scale"
              variant="section"
              glowColor="white"
              revealStyle="fade"
              start={0}
              duration={durations.natural}
            />
          </div>
        </Sequence>

        {/* Feature cards */}
        <Sequence from={180} durationInFrames={fps * 4} premountFor={durations.quick}>
          <FeatureCards frame={frame - 180} fps={fps} />
        </Sequence>
      </div>
    </AbsoluteFill>
  );
};

// =============================================================================
// FEATURE CARDS COMPONENT
// =============================================================================

type FeatureCardsProps = {
  frame: number;
  fps: number;
};

const FeatureCards: React.FC<FeatureCardsProps> = ({ frame, fps }) => {
  const containerOpacity = organicFadeIn(frame, 0, durations.natural);

  return (
    <div
      style={{
        marginTop: spacing["2xl"],
        width: layout.contentWidth,
        display: "grid",
        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
        gap: spacing.lg,
        opacity: containerOpacity,
      }}
    >
      {FEATURES.map((feature, index) => (
        <FeatureCard
          key={feature.title}
          feature={feature}
          index={index}
          frame={frame}
          fps={fps}
        />
      ))}
    </div>
  );
};

// =============================================================================
// SINGLE FEATURE CARD
// =============================================================================

type FeatureCardProps = {
  feature: typeof FEATURES[number];
  index: number;
  frame: number;
  fps: number;
};

const FeatureCard: React.FC<FeatureCardProps> = ({ feature, index, frame, fps }) => {
  const delay = index * stagger.ripple;
  const cardOpacity = organicFadeIn(frame, delay, durations.natural);
  const floatY = floatingMotionY(frame + index * 20, fps, 4);
  const breathIntensity = breathingGlow(frame, fps, 1);

  // Get glow color
  const glowColors = {
    cyan: bioluminescent.cyan,
    green: bioluminescent.green,
    purple: bioluminescent.purple,
    magenta: bioluminescent.magenta,
  };
  const glow = glowColors[feature.glowColor];

  return (
    <div
      style={{
        opacity: cardOpacity,
        transform: `translateY(${floatY}px)`,
      }}
    >
      <OrganicPanel
        variant="glow"
        glowColor={feature.glowColor}
        breathe
        padding={spacing.lg}
      >
        {/* Icon */}
        <div
          style={{
            fontSize: 32,
            marginBottom: spacing.sm,
            color: glow.core,
            textShadow: glow.glow,
            opacity: 0.8 + 0.2 * breathIntensity,
          }}
        >
          {feature.icon}
        </div>

        {/* Title */}
        <div
          style={{
            fontFamily: fontFamilies.display,
            fontSize: fontSizes.lg,
            color: glow.bright,
            marginBottom: spacing.xs,
            textShadow: textGlow.section[feature.glowColor === "green" ? "cyan" : feature.glowColor === "magenta" ? "magenta" : feature.glowColor],
          }}
        >
          {feature.title}
        </div>

        {/* Description */}
        <div
          style={{
            fontFamily: fontFamilies.body,
            fontSize: fontSizes.sm,
            color: organic_text.secondary.color,
          }}
        >
          {feature.desc}
        </div>
      </OrganicPanel>
    </div>
  );
};
