/**
 * Year3000 Organic Animation Utilities
 * Breathing, floating, particle drift, and glow pulse effects
 */

import { interpolate } from "remotion";
import { breathCycle, durations } from "../constants/timing";

// =============================================================================
// BREATHING ANIMATIONS (Pulsing intensity)
// =============================================================================

/**
 * Breathing glow intensity - creates a living, pulsing effect
 * @param frame - Current frame number
 * @param fps - Frames per second
 * @param intensity - Max intensity multiplier (default 1)
 * @returns Value between 0.7 and 1.0 * intensity
 */
export const breathingGlow = (
  frame: number,
  _fps: number,
  intensity = 1
): number => {
  const cycle = breathCycle;
  const phase = (frame % cycle) / cycle;
  const breathValue = 0.7 + 0.3 * Math.sin(phase * Math.PI * 2);
  return breathValue * intensity;
};

/**
 * Breathing opacity - for subtle presence animations
 * @param frame - Current frame number
 * @param fps - Frames per second
 * @param min - Minimum opacity (default 0.6)
 * @param max - Maximum opacity (default 1.0)
 */
export const breathingOpacity = (
  frame: number,
  _fps: number,
  min = 0.6,
  max = 1.0
): number => {
  const cycle = breathCycle;
  const phase = (frame % cycle) / cycle;
  const normalized = (Math.sin(phase * Math.PI * 2) + 1) / 2;
  return min + normalized * (max - min);
};

/**
 * Breathing scale - subtle size pulse
 * @param frame - Current frame number
 * @param fps - Frames per second
 * @param amplitude - Scale variance (default 0.02 = 2%)
 */
export const breathingScale = (
  frame: number,
  _fps: number,
  amplitude = 0.02
): number => {
  const cycle = breathCycle;
  const phase = (frame % cycle) / cycle;
  return 1 + Math.sin(phase * Math.PI * 2) * amplitude;
};

// =============================================================================
// FLOATING MOTION (Ambient drift)
// =============================================================================

/**
 * Floating Y motion - subtle vertical drift
 * @param frame - Current frame number
 * @param fps - Frames per second
 * @param amplitude - Pixel amplitude (default 8)
 * @param period - Frames per cycle (default fps * 4)
 */
export const floatingMotionY = (
  frame: number,
  fps: number,
  amplitude = 8,
  period?: number
): number => {
  const cyclePeriod = period ?? fps * 4;
  const phase = (frame % cyclePeriod) / cyclePeriod;
  return Math.sin(phase * Math.PI * 2) * amplitude;
};

/**
 * Floating XY motion - organic figure-8 pattern
 * @param frame - Current frame number
 * @param fps - Frames per second
 * @param amplitudeX - X pixel amplitude (default 6)
 * @param amplitudeY - Y pixel amplitude (default 8)
 */
export const floatingMotionXY = (
  frame: number,
  fps: number,
  amplitudeX = 6,
  amplitudeY = 8
): { x: number; y: number } => {
  const periodX = fps * 5;
  const periodY = fps * 4;
  const phaseX = (frame % periodX) / periodX;
  const phaseY = (frame % periodY) / periodY;
  return {
    x: Math.sin(phaseX * Math.PI * 2) * amplitudeX,
    y: Math.sin(phaseY * Math.PI * 2) * amplitudeY,
  };
};

// =============================================================================
// PARTICLE DRIFT (Organic random movement)
// =============================================================================

/**
 * Particle drift - organic pseudo-random movement based on seed
 * @param frame - Current frame number
 * @param seed - Unique seed for this particle (determines movement pattern)
 * @param speed - Movement speed multiplier (default 1)
 */
export const particleDrift = (
  frame: number,
  seed: number,
  speed = 1
): { x: number; y: number } => {
  const t = frame * 0.01 * speed;
  const x = Math.sin(t + seed) * Math.cos(t * 0.7 + seed * 2) * 10;
  const y = Math.cos(t * 0.8 + seed) * Math.sin(t * 0.5 + seed * 3) * 10;
  return { x, y };
};

/**
 * Particle drift 3D - includes depth (z) for parallax
 * @param frame - Current frame number
 * @param seed - Unique seed for this particle
 * @param speed - Movement speed multiplier
 */
export const particleDrift3D = (
  frame: number,
  seed: number,
  speed = 1
): { x: number; y: number; z: number } => {
  const t = frame * 0.01 * speed;
  const x = Math.sin(t + seed) * Math.cos(t * 0.7 + seed * 2) * 10;
  const y = Math.cos(t * 0.8 + seed) * Math.sin(t * 0.5 + seed * 3) * 10;
  const z = Math.sin(t * 0.3 + seed * 4) * 5; // Subtle depth movement
  return { x, y, z };
};

// =============================================================================
// GLOW PULSE (Status indicators)
// =============================================================================

/**
 * Glow pulse - for status indicators and attention-grabbing elements
 * @param frame - Current frame number
 * @param fps - Frames per second
 * @param baseOpacity - Base opacity level (default 0.5)
 */
export const glowPulse = (
  frame: number,
  fps: number,
  baseOpacity = 0.5
): number => {
  const pulsePeriod = fps * 2; // 2-second pulse
  const phase = (frame % pulsePeriod) / pulsePeriod;
  return baseOpacity + (1 - baseOpacity) * ((Math.sin(phase * Math.PI * 2) + 1) / 2);
};

/**
 * Alert pulse - faster, more urgent pulse for errors/warnings
 * @param frame - Current frame number
 * @param fps - Frames per second
 */
export const alertPulse = (frame: number, fps: number): number => {
  const pulsePeriod = fps; // 1-second pulse (faster)
  const phase = (frame % pulsePeriod) / pulsePeriod;
  return 0.6 + 0.4 * ((Math.sin(phase * Math.PI * 2) + 1) / 2);
};

// =============================================================================
// REVEAL ANIMATIONS
// =============================================================================

/**
 * Organic fade in - slower start, natural ease
 * @param frame - Current frame number
 * @param start - Start frame
 * @param duration - Duration in frames
 */
export const organicFadeIn = (
  frame: number,
  start: number,
  duration: number
): number => {
  const progress = interpolate(frame, [start, start + duration], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  // Sine-based ease for organic feel
  return Math.sin((progress * Math.PI) / 2);
};

/**
 * Bloom reveal - scale from small with glow intensification
 * @param frame - Current frame number
 * @param start - Start frame
 * @param duration - Duration in frames
 */
export const bloomReveal = (
  frame: number,
  start: number,
  duration: number
): { scale: number; opacity: number; glowIntensity: number } => {
  const progress = interpolate(frame, [start, start + duration], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Elastic-like scale
  const c4 = (2 * Math.PI) / 3;
  const scale = progress === 0
    ? 0
    : progress === 1
      ? 1
      : Math.pow(2, -10 * progress) * Math.sin((progress * 10 - 0.75) * c4) + 1;

  // Opacity follows progress
  const opacity = Math.sin((progress * Math.PI) / 2);

  // Glow peaks in middle, settles at end
  const glowIntensity = progress < 0.5
    ? progress * 2  // Ramp up
    : 1 - (progress - 0.5) * 0.4; // Settle to 0.8

  return { scale, opacity, glowIntensity };
};

/**
 * Cascade reveal - staggered character/element reveal
 * @param frame - Current frame number
 * @param start - Start frame
 * @param totalItems - Total items to reveal
 * @param staggerFrames - Frames between each item
 */
export const cascadeReveal = (
  frame: number,
  start: number,
  totalItems: number,
  staggerFrames: number
): number[] => {
  return Array.from({ length: totalItems }, (_, index) => {
    const itemStart = start + index * staggerFrames;
    const itemDuration = durations.quick;
    return organicFadeIn(frame, itemStart, itemDuration);
  });
};

// =============================================================================
// FLOW ANIMATIONS (For connectors and energy)
// =============================================================================

/**
 * Energy flow - animated dash offset for SVG strokes
 * @param frame - Current frame number
 * @param fps - Frames per second
 * @param speed - Flow speed multiplier (default 1)
 */
export const energyFlow = (
  frame: number,
  _fps: number,
  speed = 1
): number => {
  const cycleLength = 100; // Dash pattern length
  const flowSpeed = speed * 2;
  return (frame * flowSpeed) % cycleLength;
};

/**
 * Particle stream position along path
 * @param frame - Current frame number
 * @param fps - Frames per second
 * @param particleIndex - Which particle (0-based)
 * @param totalParticles - Total particles in stream
 * @param duration - Time to traverse path in frames
 */
export const particleStreamPosition = (
  frame: number,
  _fps: number,
  particleIndex: number,
  totalParticles: number,
  duration: number
): number => {
  const offset = particleIndex / totalParticles;
  const progress = ((frame / duration) + offset) % 1;
  return progress;
};

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Clamp a value between min and max
 */
export const clamp = (value: number, min: number, max: number): number => {
  return Math.min(Math.max(value, min), max);
};

/**
 * Linear interpolation between two values
 */
export const lerp = (start: number, end: number, t: number): number => {
  return start + (end - start) * t;
};

/**
 * Map a value from one range to another
 */
export const mapRange = (
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number
): number => {
  return outMin + ((value - inMin) / (inMax - inMin)) * (outMax - outMin);
};
