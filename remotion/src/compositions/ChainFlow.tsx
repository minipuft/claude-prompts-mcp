/**
 * ChainFlow - Multi-step chain execution visualization
 * Year3000 Organic aesthetic
 *
 * Timeline (20s / 600 frames @ 30fps):
 * 0:00-0:03 (0-90):    Title + command input
 * 0:03-0:05 (90-150):  Flow diagram materializes
 * 0:05-0:09 (150-270): Step 1: Parse activates
 * 0:09-0:13 (270-390): Step 2: Resolve activates
 * 0:13-0:17 (390-510): Step 3: Execute activates
 * 0:17-0:20 (510-600): Success state + persistence
 */

import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig, spring } from "remotion";
import { GlowingText, OrganicPanel, CosmicBackground, Terminal, BioluminescentBadge, ProgressDots, type TerminalLine } from "../components";
import { void_backgrounds, bioluminescent, organic_text } from "../constants/colors";
import { fontFamilies, fontSizes, textGlow } from "../constants/typography";
import { durations, springs } from "../constants/timing";
import { spacing, radii } from "../constants";
import { organicFadeIn, breathingGlow, glowPulse } from "../utils/organic-animations";

// =============================================================================
// DATA
// =============================================================================

const commandLines: TerminalLine[] = [
  { type: "command", text: ">>research_chain" },
];

const STEPS = [
  { title: "Parse", desc: "Decode command", icon: "\u{1F4DD}" },
  { title: "Resolve", desc: "Load prompts", icon: "\u{1F50D}" },
  { title: "Execute", desc: "Run pipeline", icon: "\u26A1" },
];

// =============================================================================
// MAIN COMPOSITION
// =============================================================================

export const ChainFlow: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Calculate active step (4 seconds per step, starting at frame 150)
  const stepDuration = fps * 4;
  const stepStart = 150;
  const activeStep = Math.max(
    -1,
    Math.min(STEPS.length - 1, Math.floor((frame - stepStart) / stepDuration))
  );

  return (
    <AbsoluteFill style={{ backgroundColor: void_backgrounds.abyss }}>
      {/* Cosmic background */}
      <CosmicBackground
        particles={{ density: "normal", glow: true, depth: true, speed: 0.4 }}
        aurora={{ variant: "cyanMagenta", opacity: 0.5, animate: true }}
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
          text="Chain Execution Flow"
          variant="section"
          glowColor="cyan"
          revealStyle="fade"
          start={0}
          duration={durations.quick}
        />

        {/* Terminal with command */}
        <Sequence from={0} durationInFrames={fps * 4} premountFor={durations.quick}>
          <div style={{ marginTop: spacing.xl, maxWidth: 600 }}>
            <Terminal
              variant="opencode"
              title="Chain Command"
              lines={commandLines}
              typing={{ enabled: true, charsPerSecond: 20, startFrame: fps * 0.5 }}
              cursor={{ visible: true }}
              start={0}
            />
          </div>
        </Sequence>

        {/* Flow visualization */}
        <Sequence from={90} durationInFrames={fps * 17} premountFor={durations.quick}>
          <FlowDiagram frame={frame - 90} fps={fps} activeStep={activeStep} />
        </Sequence>

        {/* Success indicator */}
        <Sequence from={510} durationInFrames={fps * 3} premountFor={durations.quick}>
          <SuccessIndicator frame={frame - 510} fps={fps} activeStep={activeStep} />
        </Sequence>
      </div>
    </AbsoluteFill>
  );
};

// =============================================================================
// FLOW DIAGRAM
// =============================================================================

const FlowDiagram: React.FC<{ frame: number; fps: number; activeStep: number }> = ({
  frame,
  fps,
  activeStep,
}) => {
  const opacity = organicFadeIn(frame, 0, durations.natural);

  return (
    <div
      style={{
        marginTop: spacing["2xl"],
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: spacing.sm,
        opacity,
      }}
    >
      {STEPS.map((step, index) => (
        <div key={step.title} style={{ display: "flex", alignItems: "center" }}>
          <FlowStep
            title={step.title}
            description={step.desc}
            icon={step.icon}
            index={index}
            active={index === activeStep}
            complete={index < activeStep}
            frame={frame}
            fps={fps}
          />
          {index < STEPS.length - 1 && (
            <FlowConnector active={index < activeStep} frame={frame} fps={fps} />
          )}
        </div>
      ))}
    </div>
  );
};

// =============================================================================
// FLOW STEP
// =============================================================================

type FlowStepProps = {
  title: string;
  description: string;
  icon: string;
  index: number;
  active: boolean;
  complete: boolean;
  frame: number;
  fps: number;
};

const FlowStep: React.FC<FlowStepProps> = ({
  title,
  description,
  icon,
  index,
  active,
  complete,
  frame,
  fps,
}) => {
  const scale = spring({ frame: frame - index * 8, fps, config: springs.organic });
  const breathIntensity = breathingGlow(frame, fps, 1);
  const pulseIntensity = active ? glowPulse(frame, fps, 0.7) : 1;

  // Determine colors based on state
  const borderColor = complete
    ? bioluminescent.green.core
    : active
      ? bioluminescent.cyan.core
      : bioluminescent.cyan.dim;

  const bgColor = complete
    ? "rgba(0, 255, 136, 0.1)"
    : active
      ? "rgba(0, 255, 255, 0.15)"
      : `${void_backgrounds.cosmos}cc`;

  const glowShadow = complete
    ? bioluminescent.green.glow
    : active
      ? bioluminescent.cyan.glow
      : "none";

  return (
    <div
      style={{
        transform: `scale(${scale})`,
        padding: spacing.lg,
        borderRadius: radii.xl,
        border: `2px solid ${borderColor}`,
        backgroundColor: bgColor,
        minWidth: 200,
        textAlign: "center",
        boxShadow: `0 0 ${active ? 30 * pulseIntensity : complete ? 20 : 0}px ${borderColor}40`,
        transition: "border-color 0.3s, background-color 0.3s",
      }}
    >
      {/* Icon */}
      <div
        style={{
          fontSize: 32,
          marginBottom: spacing.sm,
          opacity: 0.8 + 0.2 * breathIntensity,
        }}
      >
        {icon}
      </div>

      {/* Step label */}
      <div
        style={{
          fontFamily: fontFamilies.body,
          fontSize: fontSizes.xs,
          color: organic_text.muted.color,
          letterSpacing: 1,
          textTransform: "uppercase",
          marginBottom: spacing.xs,
        }}
      >
        Step {index + 1}
      </div>

      {/* Title */}
      <div
        style={{
          fontFamily: fontFamilies.display,
          fontSize: fontSizes.lg,
          fontWeight: 600,
          color: complete
            ? bioluminescent.green.core
            : active
              ? bioluminescent.cyan.core
              : organic_text.primary.color,
          textShadow: glowShadow,
        }}
      >
        {title}
      </div>

      {/* Description */}
      <div
        style={{
          fontFamily: fontFamilies.body,
          fontSize: fontSizes.sm,
          color: organic_text.secondary.color,
          marginTop: spacing.xs,
        }}
      >
        {description}
      </div>

      {/* Complete indicator */}
      {complete && (
        <div
          style={{
            marginTop: spacing.sm,
            color: bioluminescent.green.core,
            fontSize: fontSizes.sm,
            textShadow: textGlow.status.pass,
          }}
        >
          {"\u2713"} Complete
        </div>
      )}
    </div>
  );
};

// =============================================================================
// FLOW CONNECTOR
// =============================================================================

const FlowConnector: React.FC<{ active: boolean; frame: number; fps: number }> = ({
  active,
  frame,
  fps,
}) => {
  const pulseIntensity = active ? glowPulse(frame, fps, 0.6) : 0.3;

  return (
    <div
      style={{
        width: 80,
        height: 4,
        margin: `0 ${spacing.sm}px`,
        backgroundColor: active ? bioluminescent.cyan.mid : bioluminescent.cyan.dim,
        borderRadius: radii.pill,
        boxShadow: active
          ? `0 0 ${15 * pulseIntensity}px ${bioluminescent.cyan.core}`
          : "none",
        opacity: active ? 1 : 0.4,
      }}
    />
  );
};

// =============================================================================
// SUCCESS INDICATOR
// =============================================================================

const SuccessIndicator: React.FC<{ frame: number; fps: number; activeStep: number }> = ({
  frame,
  fps,
  activeStep,
}) => {
  const opacity = organicFadeIn(frame, 0, durations.natural);

  return (
    <div
      style={{
        position: "absolute",
        bottom: spacing["2xl"],
        left: spacing["3xl"],
        right: spacing["3xl"],
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        opacity,
      }}
    >
      {/* Success message */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: spacing.sm,
        }}
      >
        <span
          style={{
            color: bioluminescent.green.core,
            textShadow: bioluminescent.green.glow,
          }}
        >
          {"\u2713"}
        </span>
        <span
          style={{
            fontFamily: fontFamilies.body,
            fontSize: fontSizes.md,
            color: bioluminescent.green.bright,
            textShadow: textGlow.status.pass,
          }}
        >
          Session state persisted
        </span>
      </div>

      {/* Progress dots */}
      <ProgressDots total={STEPS.length} activeIndex={activeStep} />
    </div>
  );
};
