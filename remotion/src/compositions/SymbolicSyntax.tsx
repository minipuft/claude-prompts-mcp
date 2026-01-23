/**
 * SymbolicSyntax - Operator syntax showcase
 * Year3000 Organic aesthetic
 *
 * Timeline (15s / 450 frames @ 30fps):
 * 0:00-0:03 (0-90):    Verbose JSON code block with amber glow
 * 0:03-0:05 (90-150):  JSON dissolves into particles
 * 0:05-0:08 (150-240): Symbolic command forms with cyan glow
 * 0:08-0:12 (240-360): Operator breakdown cards appear
 * 0:12-0:15 (360-450): Side-by-side comparison
 */

import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import { GlowingText, OrganicPanel, CosmicBackground, Terminal, type TerminalLine } from "../components";
import { void_backgrounds, bioluminescent, organic_text } from "../constants/colors";
import { fontFamilies, fontSizes, textGlow } from "../constants/typography";
import { durations, stagger } from "../constants/timing";
import { layout, spacing, radii } from "../constants";
import { organicFadeIn, breathingGlow } from "../utils/organic-animations";

// =============================================================================
// DATA
// =============================================================================

const verboseJSON = `{
  "chain": [
    { "step": "research" },
    { "step": "analyze" },
    { "step": "report" }
  ],
  "framework": "CAGEERF",
  "gate": "cite sources"
}`;

const symbolicCommand: TerminalLine[] = [
  { type: "command", text: ">>research --> >>analyze --> >>report @CAGEERF :: 'cite sources' #analytical" },
];

const OPERATORS = [
  { op: "-->", desc: "Chain operator — sequential execution", glowColor: "magenta" as const },
  { op: "@CAGEERF", desc: "Framework — apply methodology", glowColor: "purple" as const },
  { op: "::", desc: "Gate — inline quality criteria", glowColor: "green" as const },
  { op: "#analytical", desc: "Style — response formatting", glowColor: "amber" as const },
];

// =============================================================================
// MAIN COMPOSITION
// =============================================================================

export const SymbolicSyntax: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill style={{ backgroundColor: void_backgrounds.abyss }}>
      {/* Cosmic background */}
      <CosmicBackground
        particles={{ density: "sparse", glow: true, depth: true, speed: 0.3 }}
        aurora={{ variant: "cosmic", opacity: 0.6, animate: true }}
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
          text="Symbolic Syntax"
          variant="section"
          glowColor="cyan"
          revealStyle="fade"
          start={0}
          duration={durations.quick}
        />

        {/* Section: Verbose JSON (Warning state) */}
        <Sequence from={0} durationInFrames={fps * 5} premountFor={durations.quick}>
          <VerboseSection frame={frame} fps={fps} />
        </Sequence>

        {/* Section: Symbolic Command (Success state) */}
        <Sequence from={150} durationInFrames={fps * 10} premountFor={durations.quick}>
          <SymbolicSection frame={frame - 150} fps={fps} />
        </Sequence>

        {/* Section: Operator Breakdown */}
        <Sequence from={240} durationInFrames={fps * 7} premountFor={durations.quick}>
          <OperatorBreakdown frame={frame - 240} fps={fps} />
        </Sequence>
      </div>
    </AbsoluteFill>
  );
};

// =============================================================================
// VERBOSE JSON SECTION
// =============================================================================

const VerboseSection: React.FC<{ frame: number; fps: number }> = ({ frame, fps }) => {
  const opacity = organicFadeIn(frame, 0, durations.natural);
  const breathIntensity = breathingGlow(frame, fps, 1);

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
          Verbose chain configuration
        </span>
      </div>

      {/* Code block */}
      <OrganicPanel variant="void" glowColor="amber" padding={spacing.lg}>
        <pre
          style={{
            fontFamily: fontFamilies.mono,
            fontSize: fontSizes.sm,
            color: bioluminescent.amber.bright,
            margin: 0,
            whiteSpace: "pre-wrap",
            textShadow: "0 0 10px rgba(255, 170, 0, 0.3)",
          }}
        >
          {verboseJSON}
        </pre>
      </OrganicPanel>
    </div>
  );
};

// =============================================================================
// SYMBOLIC COMMAND SECTION
// =============================================================================

const SymbolicSection: React.FC<{ frame: number; fps: number }> = ({ frame, fps }) => {
  const opacity = organicFadeIn(frame, 0, durations.natural);
  const breathIntensity = breathingGlow(frame, fps, 1);

  return (
    <div
      style={{
        marginTop: spacing["2xl"],
        maxWidth: 900,
        opacity,
      }}
    >
      {/* Success label */}
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
          Symbolic syntax shortcut
        </span>
      </div>

      {/* Terminal */}
      <Terminal
        variant="claude"
        title="Symbolic Command"
        lines={symbolicCommand}
        typing={{ enabled: true, charsPerSecond: 35, startFrame: fps * 0.3 }}
        cursor={{ visible: true }}
        start={0}
      />
    </div>
  );
};

// =============================================================================
// OPERATOR BREAKDOWN
// =============================================================================

const OperatorBreakdown: React.FC<{ frame: number; fps: number }> = ({ frame, fps }) => {
  const containerOpacity = organicFadeIn(frame, 0, durations.natural);

  return (
    <div
      style={{
        position: "absolute",
        bottom: spacing["2xl"],
        left: spacing["3xl"],
        right: spacing["3xl"],
        opacity: containerOpacity,
      }}
    >
      {/* Section title */}
      <div
        style={{
          fontFamily: fontFamilies.display,
          fontSize: fontSizes.lg,
          color: bioluminescent.cyan.bright,
          marginBottom: spacing.lg,
          textShadow: textGlow.section.cyan,
        }}
      >
        Operator Reference
      </div>

      {/* Operator cards grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: spacing.md,
        }}
      >
        {OPERATORS.map((item, index) => (
          <OperatorCard
            key={item.op}
            operator={item.op}
            description={item.desc}
            glowColor={item.glowColor}
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
// SINGLE OPERATOR CARD
// =============================================================================

type OperatorCardProps = {
  operator: string;
  description: string;
  glowColor: "cyan" | "magenta" | "purple" | "green" | "amber";
  delay: number;
  frame: number;
  fps: number;
};

const OperatorCard: React.FC<OperatorCardProps> = ({
  operator,
  description,
  glowColor,
  delay,
  frame,
  fps,
}) => {
  const opacity = organicFadeIn(frame, delay, durations.quick);
  const translateY = frame < delay ? 12 : Math.max(0, 12 - (frame - delay) * 0.8);

  const glowColors = {
    cyan: bioluminescent.cyan,
    magenta: bioluminescent.magenta,
    purple: bioluminescent.purple,
    green: bioluminescent.green,
    amber: bioluminescent.amber,
  };
  const glow = glowColors[glowColor];

  return (
    <div
      style={{
        opacity,
        transform: `translateY(${translateY}px)`,
        display: "flex",
        alignItems: "center",
        gap: spacing.md,
        padding: `${spacing.md}px ${spacing.lg}px`,
        backgroundColor: `${void_backgrounds.cosmos}ee`,
        borderRadius: radii.md,
        border: `1px solid ${glow.dim}`,
        boxShadow: `0 0 20px ${glow.aura}`,
      }}
    >
      {/* Operator badge */}
      <span
        style={{
          fontFamily: fontFamilies.mono,
          fontSize: fontSizes.md,
          color: glow.core,
          backgroundColor: `${glow.core}20`,
          padding: `${spacing.xs}px ${spacing.sm}px`,
          borderRadius: radii.sm,
          whiteSpace: "nowrap",
          textShadow: glow.glow,
        }}
      >
        {operator}
      </span>

      {/* Description */}
      <span
        style={{
          fontFamily: fontFamilies.body,
          fontSize: fontSizes.sm,
          color: organic_text.secondary.color,
        }}
      >
        {description}
      </span>
    </div>
  );
};
