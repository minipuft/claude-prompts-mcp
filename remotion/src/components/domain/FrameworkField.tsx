/**
 * Framework Field
 *
 * An encompassing field that represents framework alignment.
 * Content aligns and transforms within the field's influence.
 */

import React from 'react';
import { useCurrentFrame, useVideoConfig, spring } from 'remotion';
import type { LiquescentState, SpringPreset } from '../../design-system/types';
import { stateColors, void_tokens, signal_tokens } from '../../design-system/tokens/colors';
import { springs } from '../../design-system/tokens';
import { liquidBreath } from '../../utils/liquescent-animations';
import { perlin2D } from '../../design-system/physics';

export interface FrameworkFieldProps {
  frameworkName: string;
  phases?: string[];
  activePhaseIndex?: number;
  state?: LiquescentState;
  expandFrame?: number;
  springPreset?: SpringPreset;
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export const FrameworkField: React.FC<FrameworkFieldProps> = ({
  frameworkName,
  phases = [],
  activePhaseIndex = -1,
  state = 'dormant',
  expandFrame = 0,
  springPreset = 'dissolution',
  children,
  className,
  style,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const stateColor = stateColors[state];

  // Field expansion animation
  const localFrame = frame - expandFrame;
  const expansionProgress = localFrame > 0
    ? spring({
        frame: localFrame,
        fps,
        config: springs[springPreset],
        durationInFrames: 25,
      })
    : 0;

  // Breathing animation
  const breath = liquidBreath(frame, fps, { seed: 13 });

  // Field boundary animation
  const boundaryPulse = 0.95 + breath * 0.05;

  // Noise for organic field edge
  const edgeNoise = perlin2D(frame * 0.02, 0) * 5;

  const containerStyle: React.CSSProperties = {
    position: 'relative',
    padding: 24,
    borderRadius: 16,
    backgroundColor: `${void_tokens.surface.hex}${Math.round(expansionProgress * 0.8 * 255).toString(16).padStart(2, '0')}`,
    border: `1px solid ${stateColor.hex}${Math.round(expansionProgress * 0.4 * 255).toString(16).padStart(2, '0')}`,
    transform: `scale(${0.95 + expansionProgress * 0.05 * boundaryPulse})`,
    opacity: 0.3 + expansionProgress * 0.7,
    // NOTE: No CSS transition - Remotion requires frame-based animation
    ...style,
  };

  // Field gradient overlay
  const fieldOverlayStyle: React.CSSProperties = {
    position: 'absolute',
    inset: -2,
    borderRadius: 18,
    background: `radial-gradient(
      ellipse at ${50 + edgeNoise}% ${30 + edgeNoise * 0.5}%,
      ${stateColor.hex}15 0%,
      ${stateColor.hex}08 40%,
      transparent 70%
    )`,
    pointerEvents: 'none',
    opacity: expansionProgress,
  };

  // Framework label
  const labelStyle: React.CSSProperties = {
    position: 'absolute',
    top: -10,
    left: 20,
    backgroundColor: void_tokens.deep.hex,
    padding: '4px 12px',
    borderRadius: 4,
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 11,
    fontWeight: 600,
    color: stateColor.hex,
    textTransform: 'uppercase',
    letterSpacing: '1px',
    opacity: expansionProgress,
    transform: `translateY(${(1 - expansionProgress) * 10}px)`,
  };

  return (
    <div className={className} style={containerStyle}>
      <div style={fieldOverlayStyle} />

      <div style={labelStyle}>
        {frameworkName}
      </div>

      {/* Phase indicators */}
      {phases.length > 0 && (
        <div
          style={{
            display: 'flex',
            gap: 8,
            marginBottom: 16,
            opacity: expansionProgress,
          }}
        >
          {phases.map((phase, index) => {
            const isActive = index === activePhaseIndex;
            const isPast = index < activePhaseIndex;

            return (
              <div
                key={phase}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    backgroundColor: isActive
                      ? stateColor.hex
                      : isPast
                        ? `${stateColor.hex}60`
                        : `${signal_tokens.tertiary.hex}40`,
                    boxShadow: isActive ? `0 0 8px ${stateColor.hex}` : 'none',
                    // NOTE: No CSS transition - Remotion requires frame-based animation
                  }}
                />
                <span
                  style={{
                    fontFamily: 'system-ui, sans-serif',
                    fontSize: 10,
                    color: isActive
                      ? stateColor.hex
                      : isPast
                        ? signal_tokens.secondary.hex
                        : signal_tokens.tertiary.hex,
                    fontWeight: isActive ? 600 : 400,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}
                >
                  {phase}
                </span>
                {index < phases.length - 1 && (
                  <div
                    style={{
                      width: 16,
                      height: 1,
                      backgroundColor: isPast
                        ? `${stateColor.hex}40`
                        : `${signal_tokens.tertiary.hex}30`,
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Content area */}
      <div style={{ position: 'relative', zIndex: 1 }}>
        {children}
      </div>
    </div>
  );
};

/**
 * CAGEERF Framework Field - pre-configured for CAGEERF phases
 */
export const CAGEERFField: React.FC<{
  activePhase?: 'context' | 'analysis' | 'goals' | 'execution' | 'evaluation' | 'refinement';
  state?: LiquescentState;
  expandFrame?: number;
  children?: React.ReactNode;
}> = ({
  activePhase,
  state = 'dormant',
  expandFrame = 0,
  children,
}) => {
  const phases = ['Context', 'Analysis', 'Goals', 'Execution', 'Evaluation', 'Refinement'];
  const phaseMap: Record<string, number> = {
    context: 0,
    analysis: 1,
    goals: 2,
    execution: 3,
    evaluation: 4,
    refinement: 5,
  };

  return (
    <FrameworkField
      frameworkName="CAGEERF"
      phases={phases}
      activePhaseIndex={activePhase ? phaseMap[activePhase] : -1}
      state={state}
      expandFrame={expandFrame}
    >
      {children}
    </FrameworkField>
  );
};

export default FrameworkField;
