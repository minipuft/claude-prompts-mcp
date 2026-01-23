/**
 * FrameworkInjection - Before/after comparison with CAGEERF framework
 * Year3000 Organic aesthetic
 *
 * Timeline (15s / 450 frames @ 30fps):
 * 0:00-0:04 (0-120):   "Without framework" panel with amber glow
 * 0:04-0:05 (120-150): Transition effect
 * 0:05-0:10 (150-300): "With @CAGEERF" panel with purple glow
 * 0:10-0:12 (300-360): Framework badge highlight + phase cards
 * 0:12-0:15 (360-450): Split comparison view
 */

import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig, spring } from "remotion";
import { GlowingText, OrganicPanel, CosmicBackground, BioluminescentBadge } from "../components";
import { void_backgrounds, bioluminescent, organic_text } from "../constants/colors";
import { fontFamilies, fontSizes, textGlow } from "../constants/typography";
import { durations, stagger, springs } from "../constants/timing";
import { spacing, radii } from "../constants";
import { organicFadeIn, breathingGlow, glowPulse } from "../utils/organic-animations";

// =============================================================================
// DATA
// =============================================================================

const unstructuredText = `Sure, here are some thoughts...

This topic is broad and it depends on context.
We should probably consider the key points first.
There's a lot to unpack here, honestly.`;

const structuredText = `## Context
Define the problem scope and boundaries

## Analysis
Break down the data systematically

## Goals
Establish clear, measurable objectives

## Execution
Deliver actionable steps with validation`;

const CAGEERF_PHASES = [
  { letter: "C", name: "Context", color: "cyan" as const },
  { letter: "A", name: "Analysis", color: "purple" as const },
  { letter: "G", name: "Goals", color: "green" as const },
  { letter: "E", name: "Execution", color: "magenta" as const },
  { letter: "E", name: "Evaluation", color: "cyan" as const },
  { letter: "R", name: "Refinement", color: "amber" as const },
  { letter: "F", name: "Follow-up", color: "green" as const },
];

// =============================================================================
// MAIN COMPOSITION
// =============================================================================

export const FrameworkInjection: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill style={{ backgroundColor: void_backgrounds.abyss }}>
      {/* Cosmic background with purple tint for framework theme */}
      <CosmicBackground
        particles={{ density: "sparse", glow: true, depth: true, speed: 0.3 }}
        aurora={{ variant: "cosmic", opacity: 0.5, animate: true }}
      />

      <div
        style={{
          position: "relative",
          zIndex: 1,
          padding: spacing["3xl"],
          height: "100%",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Title */}
        <GlowingText
          text="Framework Injection"
          variant="section"
          glowColor="purple"
          revealStyle="fade"
          start={0}
          duration={durations.quick}
        />

        {/* "Without framework" section */}
        <Sequence from={0} durationInFrames={fps * 5} premountFor={durations.quick}>
          <UnstructuredSection frame={frame} fps={fps} />
        </Sequence>

        {/* "With framework" section */}
        <Sequence from={150} durationInFrames={fps * 10} premountFor={durations.quick}>
          <StructuredSection frame={frame - 150} fps={fps} />
        </Sequence>

        {/* CAGEERF phase cards */}
        <Sequence from={300} durationInFrames={fps * 5} premountFor={durations.quick}>
          <PhaseCards frame={frame - 300} fps={fps} />
        </Sequence>

        {/* Split comparison */}
        <Sequence from={360} durationInFrames={fps * 3} premountFor={durations.quick}>
          <ComparisonView frame={frame - 360} fps={fps} />
        </Sequence>
      </div>
    </AbsoluteFill>
  );
};

// =============================================================================
// UNSTRUCTURED SECTION
// =============================================================================

const UnstructuredSection: React.FC<{ frame: number; fps: number }> = ({ frame, fps }) => {
  const opacity = organicFadeIn(frame, 0, durations.natural);
  const breathIntensity = breathingGlow(frame, fps, 0.8);

  return (
    <div
      style={{
        marginTop: spacing.xl,
        maxWidth: 700,
        opacity,
      }}
    >
      {/* Warning label */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: spacing.sm,
          marginBottom: spacing.md,
        }}
      >
        <span
          style={{
            fontSize: fontSizes.xl,
            color: bioluminescent.amber.core,
            textShadow: bioluminescent.amber.glow,
            opacity: 0.8 + 0.2 * breathIntensity,
          }}
        >
          {"\u2717"}
        </span>
        <span
          style={{
            fontFamily: fontFamilies.display,
            fontSize: fontSizes.lg,
            color: bioluminescent.amber.bright,
            textShadow: textGlow.code.amber,
          }}
        >
          Without framework
        </span>
      </div>

      {/* Unstructured content panel */}
      <OrganicPanel variant="void" glowColor="amber" padding={spacing.lg}>
        <pre
          style={{
            fontFamily: fontFamilies.body,
            fontSize: fontSizes.md,
            color: organic_text.secondary.color,
            margin: 0,
            whiteSpace: "pre-wrap",
            lineHeight: 1.6,
          }}
        >
          {unstructuredText}
        </pre>
      </OrganicPanel>
    </div>
  );
};

// =============================================================================
// STRUCTURED SECTION
// =============================================================================

const StructuredSection: React.FC<{ frame: number; fps: number }> = ({ frame, fps }) => {
  const opacity = organicFadeIn(frame, 0, durations.natural);
  const breathIntensity = breathingGlow(frame, fps, 1);

  return (
    <div
      style={{
        marginTop: spacing["2xl"],
        maxWidth: 700,
        opacity,
      }}
    >
      {/* Success label with framework badge */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: spacing.md,
          marginBottom: spacing.md,
        }}
      >
        <span
          style={{
            fontSize: fontSizes.xl,
            color: bioluminescent.green.core,
            textShadow: bioluminescent.green.glow,
            opacity: 0.8 + 0.2 * breathIntensity,
          }}
        >
          {"\u2713"}
        </span>
        <span
          style={{
            fontFamily: fontFamilies.display,
            fontSize: fontSizes.lg,
            color: bioluminescent.green.bright,
            textShadow: textGlow.code.green,
          }}
        >
          With framework
        </span>
        <BioluminescentBadge status="active" label="@CAGEERF" pulse />
      </div>

      {/* Structured content panel */}
      <OrganicPanel variant="glow" glowColor="purple" padding={spacing.lg}>
        <pre
          style={{
            fontFamily: fontFamilies.body,
            fontSize: fontSizes.md,
            color: organic_text.primary.color,
            margin: 0,
            whiteSpace: "pre-wrap",
            lineHeight: 1.8,
          }}
        >
          {structuredText}
        </pre>
      </OrganicPanel>
    </div>
  );
};

// =============================================================================
// PHASE CARDS
// =============================================================================

const PhaseCards: React.FC<{ frame: number; fps: number }> = ({ frame, fps }) => {
  const containerOpacity = organicFadeIn(frame, 0, durations.natural);

  return (
    <div
      style={{
        position: "absolute",
        bottom: spacing["3xl"],
        left: spacing["3xl"],
        right: spacing["3xl"],
        opacity: containerOpacity,
      }}
    >
      {/* Section title */}
      <div
        style={{
          fontFamily: fontFamilies.display,
          fontSize: fontSizes.md,
          color: bioluminescent.purple.bright,
          marginBottom: spacing.md,
          textShadow: textGlow.section.purple,
        }}
      >
        CAGEERF Methodology Phases
      </div>

      {/* Phase badges */}
      <div
        style={{
          display: "flex",
          gap: spacing.sm,
          flexWrap: "wrap",
        }}
      >
        {CAGEERF_PHASES.map((phase, index) => (
          <PhaseCard
            key={`${phase.letter}-${index}`}
            letter={phase.letter}
            name={phase.name}
            color={phase.color}
            delay={index * stagger.cascade}
            frame={frame}
            fps={fps}
          />
        ))}
      </div>
    </div>
  );
};

// =============================================================================
// SINGLE PHASE CARD
// =============================================================================

type PhaseCardProps = {
  letter: string;
  name: string;
  color: "cyan" | "magenta" | "purple" | "green" | "amber";
  delay: number;
  frame: number;
  fps: number;
};

const PhaseCard: React.FC<PhaseCardProps> = ({ letter, name, color, delay, frame, fps }) => {
  const scale = spring({
    frame: Math.max(0, frame - delay),
    fps,
    config: springs.organic,
  });
  const pulseIntensity = glowPulse(frame, fps, 0.6);

  const glowColors = {
    cyan: bioluminescent.cyan,
    magenta: bioluminescent.magenta,
    purple: bioluminescent.purple,
    green: bioluminescent.green,
    amber: bioluminescent.amber,
  };
  const glow = glowColors[color];

  return (
    <div
      style={{
        transform: `scale(${scale})`,
        display: "flex",
        alignItems: "center",
        gap: spacing.xs,
        padding: `${spacing.sm}px ${spacing.md}px`,
        backgroundColor: `${glow.core}15`,
        border: `1px solid ${glow.dim}`,
        borderRadius: radii.md,
        boxShadow: `0 0 ${12 * pulseIntensity}px ${glow.aura}`,
      }}
    >
      {/* Letter badge */}
      <span
        style={{
          fontFamily: fontFamilies.display,
          fontSize: fontSizes.md,
          fontWeight: 700,
          color: glow.core,
          textShadow: glow.glow,
        }}
      >
        {letter}
      </span>

      {/* Phase name */}
      <span
        style={{
          fontFamily: fontFamilies.body,
          fontSize: fontSizes.sm,
          color: glow.bright,
        }}
      >
        {name}
      </span>
    </div>
  );
};

// =============================================================================
// COMPARISON VIEW
// =============================================================================

const ComparisonView: React.FC<{ frame: number; fps: number }> = ({ frame }) => {
  const opacity = organicFadeIn(frame, 0, durations.quick);

  return (
    <div
      style={{
        position: "absolute",
        top: spacing["3xl"],
        right: spacing["3xl"],
        display: "flex",
        flexDirection: "column",
        gap: spacing.sm,
        opacity,
      }}
    >
      {/* Before/After labels */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: spacing.lg,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: spacing.xs,
          }}
        >
          <div
            style={{
              width: 12,
              height: 12,
              borderRadius: "50%",
              backgroundColor: bioluminescent.amber.dim,
              boxShadow: `0 0 8px ${bioluminescent.amber.aura}`,
            }}
          />
          <span
            style={{
              fontFamily: fontFamilies.body,
              fontSize: fontSizes.xs,
              color: bioluminescent.amber.bright,
              textTransform: "uppercase",
              letterSpacing: 1,
            }}
          >
            Before
          </span>
        </div>

        <span style={{ color: organic_text.muted.color }}>{"\u2192"}</span>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: spacing.xs,
          }}
        >
          <div
            style={{
              width: 12,
              height: 12,
              borderRadius: "50%",
              backgroundColor: bioluminescent.purple.core,
              boxShadow: `0 0 8px ${bioluminescent.purple.aura}`,
            }}
          />
          <span
            style={{
              fontFamily: fontFamilies.body,
              fontSize: fontSizes.xs,
              color: bioluminescent.purple.bright,
              textTransform: "uppercase",
              letterSpacing: 1,
            }}
          >
            After
          </span>
        </div>
      </div>
    </div>
  );
};
