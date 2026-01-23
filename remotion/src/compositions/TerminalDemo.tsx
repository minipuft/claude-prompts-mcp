/**
 * TerminalDemo - Complete workflow demonstration
 * Year3000 Organic aesthetic
 *
 * Timeline (20s / 600 frames @ 30fps):
 * 0:00-0:03 (0-90):    Title + empty terminal with breathing cursor
 * 0:03-0:08 (90-240):  Command typing with glow trail
 * 0:08-0:10 (240-300): Processing indicator with particles
 * 0:10-0:14 (300-420): Response streaming with reveal glow
 * 0:14-0:17 (420-510): Gate validation overlay
 * 0:17-0:20 (510-600): Success state + celebration
 */

import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig, spring } from "remotion";
import { GlowingText, OrganicPanel, CosmicBackground, Terminal, BioluminescentBadge, type TerminalLine } from "../components";
import { void_backgrounds, bioluminescent, organic_text } from "../constants/colors";
import { fontFamilies, fontSizes, textGlow } from "../constants/typography";
import { durations, stagger, springs } from "../constants/timing";
import { spacing } from "../constants";
import { organicFadeIn, breathingGlow, glowPulse } from "../utils/organic-animations";

// =============================================================================
// DATA
// =============================================================================

const commandLines: TerminalLine[] = [
  { type: "command", text: 'prompt_engine(command:">>audit @CAGEERF")' },
];

const responseLines: TerminalLine[] = [
  { type: "output", text: "Executing audit workflow..." },
  { type: "output", text: "" },
  { type: "output", text: "## Security Analysis" },
  { type: "output", text: "- Authentication: Verified" },
  { type: "output", text: "- Input validation: Complete" },
  { type: "output", text: "- Rate limiting: Active" },
  { type: "output", text: "" },
  { type: "output", text: "## Recommendations" },
  { type: "output", text: "- Enable audit logging" },
  { type: "output", text: "- Review access controls" },
];

const GATE_CRITERIA = [
  { text: "Security review", status: "pass" as const },
  { text: "Structured output", status: "pass" as const },
  { text: "Citations included", status: "pass" as const },
];

// =============================================================================
// MAIN COMPOSITION
// =============================================================================

export const TerminalDemo: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

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
          text="Claude Code Terminal"
          variant="section"
          glowColor="cyan"
          revealStyle="fade"
          start={0}
          duration={durations.quick}
        />

        {/* Command input phase */}
        <Sequence from={90} durationInFrames={fps * 8} premountFor={durations.quick}>
          <div style={{ marginTop: spacing.xl, maxWidth: 800 }}>
            <Terminal
              variant="claude"
              title="prompt_engine"
              lines={commandLines}
              typing={{ enabled: true, charsPerSecond: 25, startFrame: fps * 0.5 }}
              cursor={{ visible: true }}
              start={0}
            />
          </div>
        </Sequence>

        {/* Processing indicator */}
        <Sequence from={240} durationInFrames={fps * 2} premountFor={durations.quick}>
          <ProcessingIndicator frame={frame - 240} fps={fps} />
        </Sequence>

        {/* Response streaming phase */}
        <Sequence from={300} durationInFrames={fps * 7} premountFor={durations.quick}>
          <div style={{ marginTop: spacing.lg, maxWidth: 800 }}>
            <Terminal
              variant="claude"
              title="Response"
              lines={responseLines}
              typing={{ enabled: true, charsPerSecond: 50, startFrame: 0 }}
              cursor={{ visible: false }}
              start={0}
            />
          </div>
        </Sequence>

        {/* Gate validation overlay */}
        <Sequence from={420} durationInFrames={fps * 6} premountFor={durations.quick}>
          <GateValidationOverlay frame={frame - 420} fps={fps} />
        </Sequence>

        {/* Success state */}
        <Sequence from={510} durationInFrames={fps * 3} premountFor={durations.quick}>
          <SuccessState frame={frame - 510} fps={fps} />
        </Sequence>
      </div>
    </AbsoluteFill>
  );
};

// =============================================================================
// PROCESSING INDICATOR
// =============================================================================

const ProcessingIndicator: React.FC<{ frame: number; fps: number }> = ({ frame, fps }) => {
  const opacity = organicFadeIn(frame, 0, durations.quick);
  const dotCount = 3;
  const activeDot = Math.floor((frame / 8) % dotCount);

  return (
    <div
      style={{
        marginTop: spacing.lg,
        display: "flex",
        alignItems: "center",
        gap: spacing.sm,
        opacity,
      }}
    >
      <span
        style={{
          fontFamily: fontFamilies.body,
          fontSize: fontSizes.md,
          color: bioluminescent.cyan.bright,
          textShadow: textGlow.label.cyan,
        }}
      >
        Processing
      </span>
      <div style={{ display: "flex", gap: spacing.xs }}>
        {Array.from({ length: dotCount }).map((_, i) => {
          const isActive = i <= activeDot;
          const pulseIntensity = isActive ? glowPulse(frame + i * 10, fps, 0.7) : 0.3;

          return (
            <div
              key={i}
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                backgroundColor: isActive ? bioluminescent.cyan.core : bioluminescent.cyan.dim,
                boxShadow: isActive ? `0 0 ${10 * pulseIntensity}px ${bioluminescent.cyan.core}` : "none",
                transition: "all 0.2s",
              }}
            />
          );
        })}
      </div>
    </div>
  );
};

// =============================================================================
// GATE VALIDATION OVERLAY
// =============================================================================

const GateValidationOverlay: React.FC<{ frame: number; fps: number }> = ({ frame, fps }) => {
  const slideUp = spring({
    frame,
    fps,
    config: springs.fluid,
  });
  const translateY = (1 - slideUp) * 100;

  return (
    <div
      style={{
        position: "absolute",
        bottom: spacing["2xl"],
        left: spacing["3xl"],
        right: spacing["3xl"],
        transform: `translateY(${translateY}px)`,
      }}
    >
      <OrganicPanel variant="glow" glowColor="cyan" padding={spacing.lg}>
        {/* Header */}
        <div
          style={{
            fontFamily: fontFamilies.display,
            fontSize: fontSizes.lg,
            color: bioluminescent.cyan.bright,
            marginBottom: spacing.md,
            textShadow: textGlow.section.cyan,
          }}
        >
          Gate Validation
        </div>

        {/* Criteria list */}
        <div
          style={{
            display: "grid",
            gap: spacing.sm,
          }}
        >
          {GATE_CRITERIA.map((criterion, index) => (
            <GateCriterionItem
              key={criterion.text}
              text={criterion.text}
              status={criterion.status}
              index={index}
              frame={frame}
              fps={fps}
            />
          ))}
        </div>
      </OrganicPanel>
    </div>
  );
};

// =============================================================================
// GATE CRITERION ITEM
// =============================================================================

type GateCriterionItemProps = {
  text: string;
  status: "pass" | "fail";
  index: number;
  frame: number;
  fps: number;
};

const GateCriterionItem: React.FC<GateCriterionItemProps> = ({ text, status, index, frame, fps }) => {
  const delay = index * stagger.organic;
  const scale = spring({
    frame: Math.max(0, frame - delay),
    fps,
    config: springs.organic,
  });
  const breathIntensity = breathingGlow(frame, fps, 1);

  const isPass = status === "pass";
  const color = isPass ? bioluminescent.green : bioluminescent.crimson;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: spacing.md,
        transform: `scale(${scale})`,
        transformOrigin: "left center",
      }}
    >
      {/* Status icon */}
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: "50%",
          border: `2px solid ${color.core}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: `${color.core}15`,
        }}
      >
        <span
          style={{
            fontSize: fontSizes.sm,
            color: color.core,
            textShadow: color.glow,
            opacity: 0.8 + 0.2 * breathIntensity,
          }}
        >
          {isPass ? "\u2713" : "\u2717"}
        </span>
      </div>

      {/* Criterion text */}
      <span
        style={{
          fontFamily: fontFamilies.body,
          fontSize: fontSizes.md,
          color: organic_text.primary.color,
        }}
      >
        {text}
      </span>
    </div>
  );
};

// =============================================================================
// SUCCESS STATE
// =============================================================================

const SuccessState: React.FC<{ frame: number; fps: number }> = ({ frame, fps }) => {
  const opacity = organicFadeIn(frame, 0, durations.natural);
  const scale = spring({
    frame,
    fps,
    config: springs.pulse,
  });
  const pulseIntensity = glowPulse(frame, fps, 0.8);

  return (
    <div
      style={{
        position: "absolute",
        top: "50%",
        left: "50%",
        transform: `translate(-50%, -50%) scale(${scale})`,
        opacity,
        textAlign: "center",
      }}
    >
      {/* Success icon */}
      <div
        style={{
          width: 80,
          height: 80,
          borderRadius: "50%",
          border: `3px solid ${bioluminescent.green.core}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          margin: "0 auto",
          marginBottom: spacing.lg,
          backgroundColor: `${bioluminescent.green.core}15`,
          boxShadow: `0 0 ${40 * pulseIntensity}px ${bioluminescent.green.aura}`,
        }}
      >
        <span
          style={{
            fontSize: 40,
            color: bioluminescent.green.core,
            textShadow: bioluminescent.green.glow,
          }}
        >
          {"\u2713"}
        </span>
      </div>

      {/* Success message */}
      <div
        style={{
          fontFamily: fontFamilies.display,
          fontSize: fontSizes["2xl"],
          color: bioluminescent.green.bright,
          textShadow: textGlow.status.pass,
          marginBottom: spacing.md,
        }}
      >
        All Gates Passed
      </div>

      {/* Subtitle */}
      <div
        style={{
          fontFamily: fontFamilies.body,
          fontSize: fontSizes.md,
          color: organic_text.secondary.color,
        }}
      >
        Response validated successfully
      </div>

      {/* Success badge */}
      <div style={{ marginTop: spacing.lg }}>
        <BioluminescentBadge status="pass" label="Workflow Complete" pulse />
      </div>
    </div>
  );
};
