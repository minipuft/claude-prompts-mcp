/**
 * Tutorial - Claude Prompts MCP Visual Guide
 *
 * An educational walkthrough of the MCP tool's core features.
 * Focus: Clarity over spectacle, teaching over selling.
 *
 * Sections:
 * 1. Introduction (0:00-0:08) - What is Claude Prompts MCP
 * 2. Basic Usage (0:08-0:25) - Running prompts with >>
 * 3. Chains (0:25-0:45) - Sequential execution with -->
 * 4. Frameworks (0:45-1:00) - Framework injection with @
 * 5. Gates (1:00-1:15) - Quality validation with ::
 * 6. Putting It Together (1:15-1:30) - Combined example
 *
 * Total: 90 seconds / 2700 frames @ 30fps
 */

import React from 'react';
import {
  AbsoluteFill,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
} from 'remotion';

import { void_tokens, light_tokens, signal_tokens, stateColors } from '../design-system/tokens/colors';
import { springs } from '../design-system/tokens/motion';
import { liquidFadeIn, liquidBreath } from '../utils/liquescent-animations';
import {
  LiquescentTerminal,
  type TerminalLine,
  CAGEERFField,
  ValidationMembrane,
  type ValidationStatus,
  FlowChannel,
  type FlowStatus,
} from '../components/domain';
import { LiquescentMembrane, CoalesceText, StateNucleus } from '../components/primitives';
import { DepthField } from '../components/environment';
import type { LiquescentState } from '../design-system/types';

// 3D Components
import {
  SceneRoot,
  BackgroundScene,
  CinematicCamera,
  CommandRipple,
  SuccessRipple,
  SubtleEffects,
  SectionTransition,
  CameraShake,
} from '../components/3d';

// =============================================================================
// CONSTANTS
// =============================================================================

const SECTION_TITLES = {
  intro: 'Introduction',
  basic: 'Basic Usage',
  chains: 'Chaining Prompts',
  frameworks: 'Frameworks',
  gates: 'Quality Gates',
  combined: 'Complete Example',
};

// =============================================================================
// SECTION CONTENT
// =============================================================================

const INTRO_LINES: TerminalLine[] = [
  { type: 'command', text: '>>help' },
  { type: 'tool', name: 'prompt_engine', args: '>>help' },
  { type: 'mcp-return', text: '← Prompt template prepared' },
  { type: 'output', text: '' },
  { type: 'assistant', text: 'Claude Prompts MCP - Template automation for Claude' },
  { type: 'output', text: '' },
  { type: 'output', text: 'Core tools:' },
  { type: 'output', text: '  prompt_engine    Execute prompts and chains' },
  { type: 'output', text: '  resource_manager Create, update, delete prompts' },
  { type: 'output', text: '  system_control   Configure frameworks and gates' },
];

const BASIC_LINES: TerminalLine[] = [
  { type: 'command', text: '>>code-review file:"src/api.ts"' },
  { type: 'tool', name: 'prompt_engine', args: '>>code-review' },
  { type: 'mcp-return', text: '← Template: "Review {file} for issues..."' },
  { type: 'output', text: '' },
  { type: 'assistant', text: 'Reviewing src/api.ts...' },
  { type: 'output', text: '' },
  { type: 'success', text: '✓ No critical issues found' },
  { type: 'output', text: '  - Consider adding error handling at line 42' },
  { type: 'output', text: '  - Missing JSDoc for exported function' },
];

const CHAIN_LINES: TerminalLine[] = [
  { type: 'command', text: '>>analyze --> >>plan --> >>implement' },
  { type: 'tool', name: 'prompt_engine', args: 'chain (3 steps)' },
  { type: 'mcp-return', text: '← Step 1: analyze template prepared' },
  { type: 'output', text: '' },
  { type: 'output', text: '[Step 1/3]' },
  { type: 'assistant', text: 'Analysis: Found 3 modules, 2 need refactoring...' },
  { type: 'success', text: '✓ Analysis complete → context passed to step 2' },
  { type: 'output', text: '' },
  { type: 'mcp-return', text: '← Step 2: plan template + step 1 context' },
  { type: 'output', text: '[Step 2/3]' },
  { type: 'assistant', text: 'Plan: 1) Extract shared logic 2) Add tests...' },
  { type: 'success', text: '✓ Plan ready for review' },
];

const FRAMEWORK_LINES: TerminalLine[] = [
  { type: 'command', text: '>>research @CAGEERF topic:"API design"' },
  { type: 'tool', name: 'prompt_engine', args: '>>research @CAGEERF' },
  { type: 'mcp-return', text: '← Template + CAGEERF framework injected' },
  { type: 'output', text: '' },
  { type: 'assistant', text: 'Following CAGEERF framework for API design:' },
  { type: 'output', text: '' },
  { type: 'output', text: '  [C] Context: REST vs GraphQL trade-offs' },
  { type: 'output', text: '  [A] Analysis: GraphQL fits data relationships' },
  { type: 'output', text: '  [G] Goals: Type-safe, efficient queries' },
  { type: 'output', text: '  [E] Execution: Schema-first approach...' },
];

const GATE_LINES: TerminalLine[] = [
  { type: 'command', text: ">>refactor :: 'no breaking changes'" },
  { type: 'tool', name: 'prompt_engine', args: ">>refactor :: 'no breaking...'" },
  { type: 'mcp-return', text: '← Template + gate criteria attached' },
  { type: 'output', text: '' },
  { type: 'assistant', text: 'Refactoring auth module...' },
  { type: 'output', text: '  Extracting validateToken() to utils/' },
  { type: 'output', text: '  Updating import paths...' },
  { type: 'output', text: '' },
  { type: 'mcp-return', text: '← Validating response against gate...' },
  { type: 'success', text: '✓ GATE PASS: No breaking changes' },
  { type: 'output', text: '  Signature compatibility: maintained' },
];

const COMBINED_LINES: TerminalLine[] = [
  { type: 'command', text: '>>analyze @CAGEERF --> >>implement :: code-quality' },
  { type: 'tool', name: 'prompt_engine', args: 'chain + framework + gate' },
  { type: 'output', text: '' },
  { type: 'mcp-return', text: '← Step 1: analyze + CAGEERF framework' },
  { type: 'output', text: '[1/2]' },
  { type: 'assistant', text: '[C] Context: Auth module complexity...' },
  { type: 'success', text: '✓ Analysis complete → context to step 2' },
  { type: 'output', text: '' },
  { type: 'mcp-return', text: '← Step 2: implement + code-quality gate' },
  { type: 'output', text: '[2/2]' },
  { type: 'assistant', text: 'Implementing: Extract, test, refactor...' },
  { type: 'mcp-return', text: '← Validating against code-quality...' },
  { type: 'success', text: '✓ GATE PASS: All criteria satisfied' },
];

// =============================================================================
// SUBCOMPONENTS
// =============================================================================

interface SectionTitleProps {
  title: string;
  subtitle?: string;
  startFrame: number;
}

const SectionTitle: React.FC<SectionTitleProps> = ({ title, subtitle, startFrame }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const localFrame = frame - startFrame;
  const opacity = liquidFadeIn(frame, startFrame, 20, 'membrane', fps);

  const titleScale = spring({
    frame: localFrame,
    fps,
    config: { damping: 200 },
    durationInFrames: 25,
  });

  return (
    <div
      style={{
        position: 'absolute',
        top: 80,
        left: 0,
        right: 0,
        textAlign: 'center',
        opacity,
      }}
    >
      <div
        style={{
          fontFamily: 'system-ui, sans-serif',
          fontSize: 42,
          fontWeight: 600,
          color: signal_tokens.primary.hex,
          transform: `scale(${interpolate(titleScale, [0, 1], [0.9, 1])})`,
          letterSpacing: '-0.5px',
        }}
      >
        {title}
      </div>
      {subtitle && (
        <div
          style={{
            fontFamily: 'system-ui, sans-serif',
            fontSize: 18,
            color: signal_tokens.secondary.hex,
            marginTop: 12,
            opacity: interpolate(localFrame, [15, 30], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
          }}
        >
          {subtitle}
        </div>
      )}
    </div>
  );
};

interface OperatorBadgeProps {
  operator: string;
  label: string;
  description: string;
  startFrame: number;
}

const OperatorBadge: React.FC<OperatorBadgeProps> = ({
  operator,
  label,
  description,
  startFrame,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const opacity = liquidFadeIn(frame, startFrame, 15, 'membrane', fps);
  const slideY = interpolate(frame, [startFrame, startFrame + 20], [20, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <div
      style={{
        opacity,
        transform: `translateY(${slideY}px)`,
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '12px 20px',
        backgroundColor: `${void_tokens.surface.hex}99`,
        borderRadius: 8,
        border: `1px solid ${void_tokens.film.hex}`,
      }}
    >
      <span
        style={{
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: 24,
          fontWeight: 700,
          color: light_tokens.awakening.hex,
          minWidth: 50,
          textAlign: 'center',
        }}
      >
        {operator}
      </span>
      <div>
        <div
          style={{
            fontFamily: 'system-ui, sans-serif',
            fontSize: 16,
            fontWeight: 600,
            color: signal_tokens.primary.hex,
          }}
        >
          {label}
        </div>
        <div
          style={{
            fontFamily: 'system-ui, sans-serif',
            fontSize: 13,
            color: signal_tokens.tertiary.hex,
            marginTop: 2,
          }}
        >
          {description}
        </div>
      </div>
    </div>
  );
};

// =============================================================================
// 3D BACKGROUND COMPONENT
// =============================================================================

type SectionType = 'intro' | 'basic' | 'chains' | 'frameworks' | 'gates' | 'combined';

interface ThreeBackgroundProps {
  state: LiquescentState;
  depthProgress: number;
  commandFrame?: number;
  successFrame?: number;
  currentSection: SectionType;
  sectionProgress: number; // 0-1 progress within current section
  transitionFrames: number[]; // Frames where section transitions occur
  shakeFrame?: number; // Frame for camera shake effect
}

// Camera configurations per section for cinematic feel
const SECTION_CAMERA_CONFIG: Record<SectionType, {
  baseZ: number;
  fov: number;
  breathIntensity: number;
  enablePush: boolean;
  orbitAmount: number;
}> = {
  intro: { baseZ: 14, fov: 50, breathIntensity: 0.2, enablePush: true, orbitAmount: 0 },
  basic: { baseZ: 12, fov: 45, breathIntensity: 0.15, enablePush: false, orbitAmount: 0 },
  chains: { baseZ: 11, fov: 45, breathIntensity: 0.12, enablePush: false, orbitAmount: 0.02 },
  frameworks: { baseZ: 10, fov: 42, breathIntensity: 0.15, enablePush: false, orbitAmount: 0.01 },
  gates: { baseZ: 10, fov: 42, breathIntensity: 0.18, enablePush: true, orbitAmount: 0 },
  combined: { baseZ: 9, fov: 40, breathIntensity: 0.2, enablePush: true, orbitAmount: 0.05 },
};

const ThreeBackground: React.FC<ThreeBackgroundProps> = ({
  state,
  depthProgress,
  commandFrame,
  successFrame,
  currentSection,
  sectionProgress,
  transitionFrames,
  shakeFrame,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Get camera config for current section
  const cameraConfig = SECTION_CAMERA_CONFIG[currentSection];

  // Calculate push-in effect on success frames
  // Uses viscous spring for organic, honey-like movement
  const pushAmount = React.useMemo(() => {
    if (!cameraConfig.enablePush || successFrame === undefined) return 0;
    const framesSinceSuccess = frame - successFrame;
    if (framesSinceSuccess < 0 || framesSinceSuccess > 50) return 0;

    // Push in then ease out with viscous spring physics
    return spring({
      frame: framesSinceSuccess,
      fps,
      config: springs.viscous, // damping: 30, stiffness: 80, mass: 1.2
      durationInFrames: 50,
    }) * 0.6; // Subtle push amount
  }, [cameraConfig.enablePush, successFrame, frame, fps]);

  // Calculate subtle orbit for dynamic sections
  const orbitOffset = React.useMemo(() => {
    if (cameraConfig.orbitAmount === 0) return { x: 0, y: 0 };
    const orbitPhase = sectionProgress * Math.PI * 2;
    return {
      x: Math.sin(orbitPhase) * cameraConfig.orbitAmount * 3,
      y: Math.cos(orbitPhase) * cameraConfig.orbitAmount * 2,
    };
  }, [cameraConfig.orbitAmount, sectionProgress]);

  // Final camera position
  const cameraZ = cameraConfig.baseZ - pushAmount;
  const cameraPosition: [number, number, number] = [
    orbitOffset.x,
    orbitOffset.y,
    cameraZ,
  ];

  return (
    <SceneRoot state={state}>
      {/* Cinematic camera with section-specific settings */}
      <CinematicCamera
        position={cameraPosition}
        lookAt={[0, 0, 0]}
        fov={cameraConfig.fov}
        enableBreathing
        breathingIntensity={cameraConfig.breathIntensity}
        springPreset="viscous"
      />

      {/* 3D Background with particles and caustics */}
      <BackgroundScene
        state={state}
        depthProgress={depthProgress}
        enableParticles
        particleIntensity={0.6}
        enableCaustics={depthProgress > 0.1}
        causticsIntensity={0.4}
      />

      {/* Command execution ripple */}
      {commandFrame !== undefined && (
        <CommandRipple impactFrame={commandFrame} center={[0, -1, 0]} />
      )}

      {/* Success ripple */}
      {successFrame !== undefined && (
        <SuccessRipple impactFrame={successFrame} center={[0, 0, 0]} />
      )}

      {/* Section transitions - liquid wipes between major sections */}
      {transitionFrames.map((transitionFrame, index) => (
        <SectionTransition
          key={`transition-${index}`}
          startFrame={transitionFrame}
          duration={25}
          direction="right"
        />
      ))}

      {/* Camera shake on major success moments */}
      {shakeFrame !== undefined && (
        <CameraShake
          startFrame={shakeFrame}
          duration={20}
          intensity={0.15}
          decay
        />
      )}

      {/* Subtle postprocessing */}
      <SubtleEffects state={state} />
    </SceneRoot>
  );
};

// =============================================================================
// MAIN COMPOSITION
// =============================================================================

export const Tutorial: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Section timing (in frames at 30fps)
  const INTRO_START = 0;
  const INTRO_END = 8 * fps; // 240 frames

  const BASIC_START = INTRO_END;
  const BASIC_END = 25 * fps; // 750 frames

  const CHAIN_START = BASIC_END;
  const CHAIN_END = 45 * fps; // 1350 frames

  const FRAMEWORK_START = CHAIN_END;
  const FRAMEWORK_END = 60 * fps; // 1800 frames

  const GATE_START = FRAMEWORK_END;
  const GATE_END = 75 * fps; // 2250 frames

  const COMBINED_START = GATE_END;
  // COMBINED_END = 90 * fps = 2700 frames

  // Background depth progress
  const depthProgress = interpolate(frame, [0, 2700], [0, 0.3], {
    extrapolateRight: 'clamp',
  });

  // Determine global state based on section
  const getGlobalState = (): LiquescentState => {
    if (frame < BASIC_START) return 'dormant';
    if (frame < GATE_END) return 'awakening';
    return 'liquescent';
  };

  // Determine current section and progress within it
  const getCurrentSection = (): { section: SectionType; progress: number } => {
    if (frame < BASIC_START) {
      return { section: 'intro', progress: frame / INTRO_END };
    }
    if (frame < CHAIN_START) {
      return { section: 'basic', progress: (frame - BASIC_START) / (BASIC_END - BASIC_START) };
    }
    if (frame < FRAMEWORK_START) {
      return { section: 'chains', progress: (frame - CHAIN_START) / (CHAIN_END - CHAIN_START) };
    }
    if (frame < GATE_START) {
      return { section: 'frameworks', progress: (frame - FRAMEWORK_START) / (FRAMEWORK_END - FRAMEWORK_START) };
    }
    if (frame < COMBINED_START) {
      return { section: 'gates', progress: (frame - GATE_START) / (GATE_END - GATE_START) };
    }
    return { section: 'combined', progress: (frame - COMBINED_START) / (2700 - COMBINED_START) };
  };

  const { section: currentSection, progress: sectionProgress } = getCurrentSection();

  // Key frames for ripple effects
  const introCommandFrame = 60; // When >>help is typed
  const basicSuccessFrame = BASIC_START + 350; // Success in basic section
  const chainSuccessFrame = CHAIN_START + 350; // Chain step success
  const gateSuccessFrame = GATE_START + 280; // Gate pass moment
  const finalSuccessFrame = COMBINED_START + 350; // Final success

  // Determine which ripple to show based on current frame
  const getActiveCommandFrame = () => {
    if (frame >= introCommandFrame && frame < introCommandFrame + 60) return introCommandFrame;
    return undefined;
  };

  const getActiveSuccessFrame = () => {
    if (frame >= basicSuccessFrame && frame < basicSuccessFrame + 60) return basicSuccessFrame;
    if (frame >= chainSuccessFrame && frame < chainSuccessFrame + 60) return chainSuccessFrame;
    if (frame >= gateSuccessFrame && frame < gateSuccessFrame + 60) return gateSuccessFrame;
    if (frame >= finalSuccessFrame && frame < finalSuccessFrame + 60) return finalSuccessFrame;
    return undefined;
  };

  // Section transition frames (liquid wipe between sections)
  // Offset by -15 frames so transition overlaps with section end
  const transitionFrames = [
    INTRO_END - 15,      // Intro → Basic
    BASIC_END - 15,      // Basic → Chains
    CHAIN_END - 15,      // Chains → Frameworks
    FRAMEWORK_END - 15,  // Frameworks → Gates
    GATE_END - 15,       // Gates → Combined
  ];

  // Camera shake on the final success moment for impact
  const getActiveShakeFrame = () => {
    if (frame >= finalSuccessFrame && frame < finalSuccessFrame + 30) return finalSuccessFrame;
    return undefined;
  };

  return (
    <DepthField progress={depthProgress} enableGanzfeld={false}>
      {/* 3D Background Layer */}
      <ThreeBackground
        state={getGlobalState()}
        depthProgress={depthProgress}
        commandFrame={getActiveCommandFrame()}
        successFrame={getActiveSuccessFrame()}
        currentSection={currentSection}
        sectionProgress={sectionProgress}
        transitionFrames={transitionFrames}
        shakeFrame={getActiveShakeFrame()}
      />

      <AbsoluteFill
        style={{
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >

        {/* Section 1: Introduction */}
        <Sequence from={INTRO_START} durationInFrames={INTRO_END - INTRO_START} premountFor={30}>
          <IntroSection />
        </Sequence>

        {/* Section 2: Basic Usage */}
        <Sequence from={BASIC_START} durationInFrames={BASIC_END - BASIC_START} premountFor={30}>
          <BasicSection />
        </Sequence>

        {/* Section 3: Chains */}
        <Sequence from={CHAIN_START} durationInFrames={CHAIN_END - CHAIN_START} premountFor={30}>
          <ChainSection />
        </Sequence>

        {/* Section 4: Frameworks */}
        <Sequence
          from={FRAMEWORK_START}
          durationInFrames={FRAMEWORK_END - FRAMEWORK_START}
          premountFor={30}
        >
          <FrameworkSection />
        </Sequence>

        {/* Section 5: Gates */}
        <Sequence from={GATE_START} durationInFrames={GATE_END - GATE_START} premountFor={30}>
          <GateSection />
        </Sequence>

        {/* Section 6: Combined */}
        <Sequence from={COMBINED_START} durationInFrames={2700 - COMBINED_START} premountFor={30}>
          <CombinedSection />
        </Sequence>
      </AbsoluteFill>
    </DepthField>
  );
};

// =============================================================================
// SECTION COMPONENTS
// =============================================================================

const IntroSection: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // State progression through intro
  const getNucleusState = () => {
    if (frame < 60) return 'dormant';
    if (frame < 150) return 'awakening';
    return 'liquescent';
  };

  const breath = liquidBreath(frame, fps, { intensity: 0.3, seed: 7 });

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: 60,
      }}
    >
      {/* Decorative state nucleus */}
      <div
        style={{
          position: 'absolute',
          top: 30,
          right: 60,
          opacity: liquidFadeIn(frame, 20, 30, 'dissolution', fps) * 0.7,
          transform: `scale(${0.9 + breath * 0.1})`,
        }}
      >
        <StateNucleus
          state={getNucleusState()}
          previousState={frame < 150 ? 'dormant' : 'awakening'}
          transitionFrame={frame < 150 ? 60 : 150}
          size={80}
          glowIntensity={0.4}
        />
      </div>

      {/* Hero title */}
      <div style={{ marginTop: 60 }}>
        <CoalesceText
          text="Claude Prompts MCP"
          startFrame={0}
          scatterRadius={80}
          springPreset="membrane"
          fontSize={56}
          fontWeight={700}
          color={signal_tokens.primary.hex}
          glowIntensity={0.3}
        />
      </div>

      <div
        style={{
          fontFamily: 'system-ui, sans-serif',
          fontSize: 20,
          color: signal_tokens.secondary.hex,
          marginTop: 24,
          opacity: liquidFadeIn(frame, 30, 20, 'membrane', fps),
        }}
      >
        Template automation for Claude Code
      </div>

      {/* Terminal demo */}
      <div style={{ marginTop: 60, width: 700 }}>
        <LiquescentTerminal
          state={getNucleusState()}
          title="claude-prompts"
          lines={INTRO_LINES}
          typing={{ enabled: true, charsPerSecond: 40, startFrame: 60 }}
          cursor={{ visible: true, blinkRate: 25 }}
          startFrame={45}
        />
      </div>
    </div>
  );
};

const BasicSection: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: 60,
      }}
    >
      <SectionTitle
        title={SECTION_TITLES.basic}
        subtitle="Execute prompts with >> prefix"
        startFrame={0}
      />

      {/* Syntax explanation */}
      <div style={{ marginTop: 180, display: 'flex', gap: 24 }}>
        <OperatorBadge
          operator=">>"
          label="Prompt Prefix"
          description="Execute a registered prompt"
          startFrame={20}
        />
      </div>

      {/* Terminal demo */}
      <div style={{ marginTop: 40, width: 700 }}>
        <LiquescentTerminal
          state="awakening"
          title="example"
          lines={BASIC_LINES}
          typing={{ enabled: true, charsPerSecond: 30, startFrame: 90 }}
          cursor={{ visible: true, blinkRate: 25 }}
          startFrame={60}
        />
      </div>

      {/* Hint */}
      <div
        style={{
          position: 'absolute',
          bottom: 80,
          fontFamily: 'system-ui, sans-serif',
          fontSize: 14,
          color: signal_tokens.tertiary.hex,
          opacity: liquidFadeIn(frame, 300, 20, 'membrane', fps),
        }}
      >
        Arguments are passed as key:"value" pairs
      </div>
    </div>
  );
};

const ChainSection: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Determine step statuses based on frame timing
  const getStepStatus = (index: number): FlowStatus => {
    const stepFrame = 250 + index * 40;
    if (frame < stepFrame) return 'pending';
    if (frame < stepFrame + 30) return 'flowing';
    return 'complete';
  };

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: 60,
      }}
    >
      <SectionTitle
        title={SECTION_TITLES.chains}
        subtitle="Connect prompts for multi-step workflows"
        startFrame={0}
      />

      {/* Operator explanation */}
      <div style={{ marginTop: 180, display: 'flex', gap: 24 }}>
        <OperatorBadge
          operator="-->"
          label="Chain Operator"
          description="Run prompts in sequence, passing context"
          startFrame={20}
        />
      </div>

      {/* Terminal demo */}
      <div style={{ marginTop: 40, width: 700 }}>
        <LiquescentTerminal
          state="awakening"
          title="chain-demo"
          lines={CHAIN_LINES}
          typing={{ enabled: true, charsPerSecond: 25, startFrame: 90 }}
          cursor={{ visible: true, blinkRate: 25 }}
          startFrame={60}
        />
      </div>

      {/* Visual chain with FlowChannel connections */}
      <div
        style={{
          position: 'relative',
          marginTop: 30,
          width: 400,
          height: 80,
          opacity: liquidFadeIn(frame, 250, 20, 'membrane', fps),
        }}
      >
        {/* FlowChannel connections */}
        <FlowChannel
          from={{ x: 60, y: 40 }}
          to={{ x: 140, y: 40 }}
          status={getStepStatus(0) === 'complete' ? 'complete' : 'pending'}
          activateFrame={260}
        />
        <FlowChannel
          from={{ x: 220, y: 40 }}
          to={{ x: 300, y: 40 }}
          status={getStepStatus(1) === 'complete' ? 'complete' : 'pending'}
          activateFrame={300}
        />

        {/* Step boxes */}
        {['analyze', 'plan', 'implement'].map((step, i) => {
          const status = getStepStatus(i);
          const state = status === 'complete' ? 'liquescent' : status === 'flowing' ? 'awakening' : 'dormant';
          return (
            <div
              key={step}
              style={{
                position: 'absolute',
                left: i * 160,
                top: 15,
              }}
            >
              <LiquescentMembrane
                state={state}
                breathIntensity={status === 'flowing' ? 0.6 : 0.3}
                glowIntensity={status === 'complete' ? 0.5 : 0.2}
              >
                <div
                  style={{
                    padding: '8px 16px',
                    fontFamily: '"JetBrains Mono", monospace',
                    fontSize: 12,
                    color: signal_tokens.primary.hex,
                  }}
                >
                  {step}
                </div>
              </LiquescentMembrane>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const FrameworkSection: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Determine active phase based on frame
  const getActivePhase = (): 'context' | 'analysis' | 'goals' | 'execution' | undefined => {
    const phaseFrame = frame - 200;
    if (phaseFrame < 0) return undefined;
    if (phaseFrame < 40) return 'context';
    if (phaseFrame < 80) return 'analysis';
    if (phaseFrame < 120) return 'goals';
    return 'execution';
  };

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: 60,
      }}
    >
      <SectionTitle
        title={SECTION_TITLES.frameworks}
        subtitle="Apply structured frameworks to prompts"
        startFrame={0}
      />

      {/* Operator explanation */}
      <div style={{ marginTop: 180, display: 'flex', gap: 24 }}>
        <OperatorBadge
          operator="@"
          label="Framework Operator"
          description="Inject framework guidance (CAGEERF, ReACT, etc.)"
          startFrame={20}
        />
      </div>

      {/* Terminal wrapped in CAGEERF framework field */}
      <div style={{ marginTop: 40, width: 750, opacity: liquidFadeIn(frame, 50, 25, 'dissolution', fps) }}>
        <CAGEERFField
          activePhase={getActivePhase()}
          state={getActivePhase() ? 'awakening' : 'dormant'}
          expandFrame={50}
        >
          <LiquescentTerminal
            state="liquescent"
            title="framework-demo"
            lines={FRAMEWORK_LINES}
            typing={{ enabled: true, charsPerSecond: 25, startFrame: 90 }}
            cursor={{ visible: true, blinkRate: 25 }}
            startFrame={60}
          />
        </CAGEERFField>
      </div>
    </div>
  );
};

const GateSection: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Determine gate validation status based on timing
  const getValidationStatus = (): ValidationStatus => {
    if (frame < 200) return 'pending';
    if (frame < 280) return 'validating';
    return 'pass';
  };

  const validationStatus = getValidationStatus();
  const breath = liquidBreath(frame, fps, { intensity: 0.4 });

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: 60,
      }}
    >
      <SectionTitle
        title={SECTION_TITLES.gates}
        subtitle="Validate outputs against quality criteria"
        startFrame={0}
      />

      {/* Operator explanation */}
      <div style={{ marginTop: 180, display: 'flex', gap: 24 }}>
        <OperatorBadge
          operator="::"
          label="Gate Operator"
          description="Apply inline or named quality gates"
          startFrame={20}
        />
      </div>

      {/* Terminal + Validation visualization */}
      <div style={{ marginTop: 40, display: 'flex', gap: 30, alignItems: 'flex-start' }}>
        {/* Terminal demo */}
        <div style={{ width: 550 }}>
          <LiquescentTerminal
            state={validationStatus === 'pass' ? 'liquescent' : 'awakening'}
            title="gate-demo"
            lines={GATE_LINES}
            typing={{ enabled: true, charsPerSecond: 25, startFrame: 90 }}
            cursor={{ visible: true, blinkRate: 25 }}
            startFrame={60}
          />
        </div>

        {/* Validation membrane visualization */}
        <div
          style={{
            opacity: liquidFadeIn(frame, 180, 20, 'membrane', fps),
            transform: `scale(${0.95 + breath * 0.05})`,
          }}
        >
          <ValidationMembrane
            status={validationStatus}
            criterionName="No breaking changes"
            criterionDescription="Validates that API signatures remain compatible"
            statusChangeFrame={280}
            showRipple={validationStatus === 'pass'}
          />
        </div>
      </div>

      {/* Gate criteria visual */}
      <div
        style={{
          marginTop: 30,
          display: 'flex',
          gap: 12,
          opacity: liquidFadeIn(frame, 250, 20, 'membrane', fps),
        }}
      >
        {['Signature compatibility', 'Return type stable', 'No removed exports'].map((criterion, i) => {
          const criterionPassed = frame > 260 + i * 15;
          return (
            <div
              key={criterion}
              style={{
                padding: '6px 12px',
                borderRadius: 6,
                backgroundColor: criterionPassed
                  ? `${stateColors.liquescent.hex}20`
                  : `${stateColors.dormant.hex}20`,
                border: `1px solid ${criterionPassed ? stateColors.liquescent.hex : stateColors.dormant.hex}40`,
                fontFamily: '"JetBrains Mono", monospace',
                fontSize: 11,
                color: criterionPassed ? stateColors.liquescent.hex : stateColors.dormant.hex,
              }}
            >
              {criterionPassed ? '✓' : '○'} {criterion}
            </div>
          );
        })}
      </div>
    </div>
  );
};

const CombinedSection: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: 60,
      }}
    >
      <SectionTitle
        title={SECTION_TITLES.combined}
        subtitle="Combine operators for powerful workflows"
        startFrame={0}
      />

      {/* All operators */}
      <div style={{ marginTop: 160, display: 'flex', gap: 16, flexWrap: 'wrap', justifyContent: 'center' }}>
        <OperatorBadge operator=">>" label="Prompt" description="Execute" startFrame={20} />
        <OperatorBadge operator="@" label="Framework" description="Structure" startFrame={30} />
        <OperatorBadge operator="-->" label="Chain" description="Sequence" startFrame={40} />
        <OperatorBadge operator="::" label="Gate" description="Validate" startFrame={50} />
      </div>

      {/* Terminal demo */}
      <div style={{ marginTop: 30, width: 800 }}>
        <LiquescentTerminal
          state="liquescent"
          title="complete-workflow"
          lines={COMBINED_LINES}
          typing={{ enabled: true, charsPerSecond: 20, startFrame: 90 }}
          cursor={{ visible: true, blinkRate: 25 }}
          startFrame={60}
        />
      </div>

      {/* Closing message */}
      <div
        style={{
          position: 'absolute',
          bottom: 100,
          textAlign: 'center',
          opacity: liquidFadeIn(frame, 350, 30, 'dissolution', fps),
        }}
      >
        <div
          style={{
            fontFamily: 'system-ui, sans-serif',
            fontSize: 24,
            fontWeight: 600,
            color: signal_tokens.primary.hex,
          }}
        >
          Start building with Claude Prompts MCP
        </div>
        <div
          style={{
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: 14,
            color: signal_tokens.tertiary.hex,
            marginTop: 12,
          }}
        >
          npm install claude-prompts
        </div>
      </div>
    </div>
  );
};

export default Tutorial;
