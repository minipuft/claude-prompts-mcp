/**
 * GateSystem - Quality validation demonstration
 * Year3000 Organic aesthetic
 *
 * Timeline (15s / 450 frames @ 30fps):
 * 0:00-0:03 (0-90):    LLM output streaming
 * 0:03-0:05 (90-150):  "Validating..." transition
 * 0:05-0:10 (150-300): Criteria check sequence (4 criteria)
 * 0:10-0:12 (300-360): Failure highlight
 * 0:12-0:15 (360-450): Retry flow + pass
 */

import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import { GlowingText, OrganicPanel, CosmicBackground, Terminal, BioluminescentBadge, type TerminalLine } from "../components";
import { void_backgrounds, bioluminescent, organic_text } from "../constants/colors";
import { fontFamilies, fontSizes, textGlow } from "../constants/typography";
import { durations, stagger, springs } from "../constants/timing";
import { spacing, radii } from "../constants";
import { organicFadeIn, breathingGlow, alertPulse, glowPulse } from "../utils/organic-animations";
import { spring } from "remotion";

// =============================================================================
// DATA
// =============================================================================

const outputLines: TerminalLine[] = [
  { type: "output", text: "Here is the analysis report:" },
  { type: "output", text: "- Key findings summarized" },
  { type: "output", text: "- Recommendations provided" },
  { type: "output", text: "- Next steps outlined..." },
];

const CRITERIA = [
  { text: "Citations included", status: "pass" as const },
  { text: "Structured summary", status: "pass" as const },
  { text: "No secrets leaked", status: "pass" as const },
  { text: "Under 200 words", status: "fail" as const },
];

// =============================================================================
// MAIN COMPOSITION
// =============================================================================

export const GateSystem: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill style={{ backgroundColor: void_backgrounds.abyss }}>
      {/* Cosmic background with crimson hint for validation theme */}
      <CosmicBackground
        particles={{ density: "sparse", glow: true, depth: true, speed: 0.3 }}
        aurora={{ variant: "nebula", opacity: 0.5, animate: true }}
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
          text="Gate Validation System"
          variant="section"
          glowColor="cyan"
          revealStyle="fade"
          start={0}
          duration={durations.quick}
        />

        {/* LLM Output */}
        <Sequence from={0} durationInFrames={fps * 3} premountFor={durations.quick}>
          <div style={{ marginTop: spacing.xl, maxWidth: 700 }}>
            <Terminal
              variant="claude"
              title="Prompt Output"
              lines={outputLines}
              typing={{ enabled: true, charsPerSecond: 40, startFrame: fps * 0.3 }}
              cursor={{ visible: false }}
              start={0}
            />
          </div>
        </Sequence>

        {/* Gate criteria validation */}
        <Sequence from={90} durationInFrames={fps * 11} premountFor={durations.quick}>
          <CriteriaValidation frame={frame - 90} fps={fps} />
        </Sequence>

        {/* Retry flow */}
        <Sequence from={300} durationInFrames={fps * 5} premountFor={durations.quick}>
          <RetryFlow frame={frame - 300} fps={fps} />
        </Sequence>
      </div>
    </AbsoluteFill>
  );
};

// =============================================================================
// CRITERIA VALIDATION
// =============================================================================

const CriteriaValidation: React.FC<{ frame: number; fps: number }> = ({ frame, fps }) => {
  const opacity = organicFadeIn(frame, 0, durations.natural);

  return (
    <div
      style={{
        marginTop: spacing["2xl"],
        display: "grid",
        gap: spacing.md,
        maxWidth: 600,
        opacity,
      }}
    >
      {/* Section title */}
      <div
        style={{
          fontFamily: fontFamilies.display,
          fontSize: fontSizes.lg,
          color: bioluminescent.cyan.bright,
          marginBottom: spacing.sm,
          textShadow: textGlow.section.cyan,
        }}
      >
        Quality Criteria
      </div>

      {/* Criteria items */}
      {CRITERIA.map((criterion, index) => (
        <GateCriterion
          key={criterion.text}
          text={criterion.text}
          status={criterion.status}
          index={index}
          frame={frame}
          fps={fps}
        />
      ))}
    </div>
  );
};

// =============================================================================
// GATE CRITERION
// =============================================================================

type GateCriterionProps = {
  text: string;
  status: "pass" | "fail";
  index: number;
  frame: number;
  fps: number;
};

const GateCriterion: React.FC<GateCriterionProps> = ({ text, status, index, frame, fps }) => {
  const delay = index * stagger.organic;
  const scale = spring({
    frame: Math.max(0, frame - delay),
    fps,
    config: springs.organic,
  });
  const breathIntensity = breathingGlow(frame, fps, 1);
  const pulseIntensity = status === "fail" ? alertPulse(frame, fps) : glowPulse(frame, fps, 0.7);

  const isPass = status === "pass";
  const color = isPass ? bioluminescent.green : bioluminescent.crimson;
  const glowShadow = isPass ? bioluminescent.green.glow : bioluminescent.crimson.glow;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: spacing.md,
        padding: `${spacing.md}px ${spacing.lg}px`,
        backgroundColor: `${color.core}10`,
        border: `1px solid ${color.mid}`,
        borderRadius: radii.lg,
        transform: `scale(${scale})`,
        boxShadow: `0 0 ${15 * pulseIntensity}px ${color.aura}`,
      }}
    >
      {/* Status icon */}
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: "50%",
          border: `2px solid ${color.core}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: `${color.core}15`,
          boxShadow: `0 0 ${10 * pulseIntensity}px ${color.core}40`,
        }}
      >
        <span
          style={{
            fontSize: fontSizes.lg,
            color: color.core,
            textShadow: glowShadow,
            opacity: 0.8 + 0.2 * breathIntensity,
          }}
        >
          {isPass ? "\u2713" : "\u2717"}
        </span>
      </div>

      {/* Criterion text */}
      <span
        style={{
          flex: 1,
          fontFamily: fontFamilies.body,
          fontSize: fontSizes.md,
          color: organic_text.primary.color,
        }}
      >
        {text}
      </span>

      {/* Status badge */}
      <span
        style={{
          fontFamily: fontFamilies.body,
          fontSize: fontSizes.xs,
          fontWeight: 600,
          color: color.core,
          letterSpacing: 1,
          textTransform: "uppercase",
          textShadow: glowShadow,
        }}
      >
        {status}
      </span>
    </div>
  );
};

// =============================================================================
// RETRY FLOW
// =============================================================================

const RetryFlow: React.FC<{ frame: number; fps: number }> = ({ frame, fps }) => {
  const opacity = organicFadeIn(frame, 0, durations.natural);
  const pulseIntensity = alertPulse(frame, fps);

  return (
    <div
      style={{
        position: "absolute",
        bottom: spacing["2xl"],
        left: spacing["3xl"],
        right: spacing["3xl"],
        display: "flex",
        alignItems: "center",
        gap: spacing.lg,
        opacity,
      }}
    >
      {/* Error panel */}
      <OrganicPanel variant="void" glowColor="amber" padding={spacing.md}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: spacing.sm,
          }}
        >
          <span
            style={{
              fontSize: fontSizes.lg,
              color: bioluminescent.amber.core,
              textShadow: bioluminescent.amber.glow,
              opacity: 0.7 + 0.3 * pulseIntensity,
            }}
          >
            {"\u26A0"}
          </span>
          <span
            style={{
              fontFamily: fontFamilies.body,
              fontSize: fontSizes.sm,
              color: bioluminescent.amber.bright,
            }}
          >
            Gate failed: Response exceeds word limit
          </span>
        </div>
      </OrganicPanel>

      {/* Retry arrow */}
      <div style={{ display: "flex", alignItems: "center", gap: spacing.sm }}>
        <BioluminescentBadge status="warning" label="Retry with hint" pulse />
        <span style={{ color: organic_text.muted.color, fontSize: fontSizes.lg }}>
          {"\u2192"}
        </span>
        <BioluminescentBadge status="pass" label="Pass" pulse={false} />
      </div>
    </div>
  );
};
