/**
 * Year3000 Organic Animation Timing
 * Breath-like motion, fluid springs, organic easing
 */

export const fps = 30;

// =============================================================================
// ORGANIC DURATIONS (Named for feeling, not speed)
// =============================================================================

export const durations = {
  // Micro-interactions
  whisper: 8,       // 0.27s - barely perceptible
  quick: 15,        // 0.5s - fast but visible

  // Standard motion
  natural: 30,      // 1.0s - comfortable pace
  deliberate: 45,   // 1.5s - noticeable, intentional

  // Atmospheric
  contemplative: 60, // 2.0s - slow, dramatic
  cosmic: 90,        // 3.0s - ambient, breathing cycle

  // Legacy compatibility
  fast: 12,
  normal: 30,
  slow: 45,
};

// =============================================================================
// STAGGER PATTERNS
// =============================================================================

export const stagger = {
  cascade: 8,       // Rapid cascade effect
  ripple: 12,       // Water ripple spreading
  organic: 18,      // Natural, breathing spread
  relaxed: 24,      // Slower, spaced reveal

  // Legacy compatibility
  base: 15,
};

// =============================================================================
// ORGANIC SPRING CONFIGURATIONS
// =============================================================================

export const springs = {
  // Ethereal - very soft, floaty (for ambient motion)
  ethereal: { damping: 30, stiffness: 60, mass: 1.5 },

  // Fluid - liquid-like motion (for smooth transitions)
  fluid: { damping: 25, stiffness: 100, mass: 1 },

  // Organic - natural bounce (for UI elements)
  organic: { damping: 20, stiffness: 150, mass: 0.8 },

  // Pulse - heartbeat-like (for status indicators)
  pulse: { damping: 15, stiffness: 200, mass: 0.5 },

  // Snap - quick but not harsh (for interactive feedback)
  snap: { damping: 22, stiffness: 300, mass: 0.6 },

  // Legacy compatibility
  soft: { damping: 200 },
  snappy: { damping: 18, stiffness: 220 },
  bounce: { damping: 12, stiffness: 180 },
};

// =============================================================================
// BREATHING CYCLE (Core timing constant)
// =============================================================================

export const breathCycle = 90; // 3 seconds per full breath

// =============================================================================
// EASING FUNCTIONS (for interpolate extrapolation)
// =============================================================================

/**
 * Breath-like ease - slow start, gentle peak, slow end
 * Use with interpolate for organic motion
 */
export const breatheEase = (t: number): number => {
  return Math.sin(t * Math.PI * 0.5) * Math.sin(t * Math.PI * 0.5);
};

/**
 * Fluid ease - like liquid movement
 * Cubic ease-in-out
 */
export const fluidEase = (t: number): number => {
  return t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2;
};

/**
 * Bloom ease - slow start, accelerate, gentle land
 * Elastic-like with controlled overshoot
 */
export const bloomEase = (t: number): number => {
  const c4 = (2 * Math.PI) / 3;
  return t === 0
    ? 0
    : t === 1
      ? 1
      : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
};

/**
 * Drift ease - very slow, ambient motion
 * Sine-based for smooth looping
 */
export const driftEase = (t: number): number => {
  return (Math.sin(t * Math.PI - Math.PI / 2) + 1) / 2;
};

// =============================================================================
// TIMING PRESETS (Common animation configs)
// =============================================================================

export const timingPresets = {
  // Title reveal
  heroReveal: {
    duration: durations.contemplative,
    stagger: stagger.organic,
    spring: springs.ethereal,
  },

  // Card appearance
  cardAppear: {
    duration: durations.natural,
    stagger: stagger.ripple,
    spring: springs.organic,
  },

  // Status indicator
  statusPulse: {
    duration: durations.cosmic,
    spring: springs.pulse,
  },

  // Interactive feedback
  buttonPress: {
    duration: durations.quick,
    spring: springs.snap,
  },

  // Flow connector
  flowEnergy: {
    duration: durations.deliberate,
    spring: springs.fluid,
  },
};
