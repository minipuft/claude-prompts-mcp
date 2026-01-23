/**
 * Year3000 Organic Color Palette
 * Cosmic void backgrounds + bioluminescent accents
 * See plan for full specification
 */

// =============================================================================
// VOID BACKGROUNDS (Layered Depth)
// =============================================================================

export const void_backgrounds = {
  abyss: "#030308",    // Deepest black with blue undertone
  deep: "#060612",     // Deep space
  cosmos: "#0a0a1f",   // Midnight blue
  nebula: "#0d0d2b",   // Distant nebula
  astral: "#12123d",   // Astral depth
  ether: "#181850",    // Ethereal mist
} as const;

// =============================================================================
// BIOLUMINESCENT ACCENTS
// =============================================================================

export const bioluminescent = {
  // Cyan - data flow, information, active states
  cyan: {
    core: "#00ffff",
    bright: "#00e5e5",
    mid: "#00cccc",
    dim: "#008b8b",
    aura: "rgba(0, 255, 255, 0.15)",
    glow: "0 0 20px rgba(0, 255, 255, 0.6), 0 0 40px rgba(0, 255, 255, 0.3)",
  },

  // Magenta - energy, transformation, emphasis
  magenta: {
    core: "#ff00ff",
    bright: "#e500e5",
    mid: "#cc00cc",
    dim: "#8b008b",
    aura: "rgba(255, 0, 255, 0.12)",
    glow: "0 0 20px rgba(255, 0, 255, 0.6), 0 0 40px rgba(255, 0, 255, 0.3)",
  },

  // Purple - wisdom, frameworks, methodology
  purple: {
    core: "#bf00ff",
    bright: "#a855f7",
    mid: "#8b5cf6",
    dim: "#6d28d9",
    aura: "rgba(168, 85, 247, 0.15)",
    glow: "0 0 20px rgba(168, 85, 247, 0.6), 0 0 40px rgba(168, 85, 247, 0.3)",
  },

  // Green - success, growth, completion
  green: {
    core: "#00ff88",
    bright: "#00e57a",
    mid: "#00cc6e",
    dim: "#008f4d",
    aura: "rgba(0, 255, 136, 0.12)",
    glow: "0 0 20px rgba(0, 255, 136, 0.6), 0 0 40px rgba(0, 255, 136, 0.3)",
  },

  // Crimson - error, danger, failure
  crimson: {
    core: "#ff3366",
    bright: "#ff1a53",
    mid: "#e6194b",
    dim: "#b3153b",
    aura: "rgba(255, 51, 102, 0.15)",
    glow: "0 0 20px rgba(255, 51, 102, 0.6), 0 0 40px rgba(255, 51, 102, 0.3)",
  },

  // Amber - warning, caution, attention
  amber: {
    core: "#ffaa00",
    bright: "#ff9500",
    mid: "#e68900",
    dim: "#b36b00",
    aura: "rgba(255, 170, 0, 0.12)",
    glow: "0 0 20px rgba(255, 170, 0, 0.6), 0 0 40px rgba(255, 170, 0, 0.3)",
  },
} as const;

// =============================================================================
// ORGANIC STATUS (Living Colors)
// =============================================================================

export const organic_status = {
  pass: {
    color: bioluminescent.green.core,
    fill: bioluminescent.green.mid,
    bg: "rgba(0, 255, 136, 0.08)",
    glow: bioluminescent.green.glow,
    pulse: true,
  },
  fail: {
    color: bioluminescent.crimson.core,
    fill: bioluminescent.crimson.mid,
    bg: "rgba(255, 51, 102, 0.08)",
    glow: bioluminescent.crimson.glow,
    pulse: true,
  },
  warning: {
    color: bioluminescent.amber.core,
    fill: bioluminescent.amber.mid,
    bg: "rgba(255, 170, 0, 0.06)",
    glow: bioluminescent.amber.glow,
    pulse: true,
  },
  info: {
    color: bioluminescent.cyan.core,
    fill: bioluminescent.cyan.mid,
    bg: "rgba(0, 255, 255, 0.06)",
    glow: bioluminescent.cyan.glow,
    pulse: false,
  },
  active: {
    color: bioluminescent.purple.core,
    fill: bioluminescent.purple.mid,
    bg: "rgba(168, 85, 247, 0.08)",
    glow: bioluminescent.purple.glow,
    pulse: true,
  },
} as const;

// =============================================================================
// TEXT WITH GLOW
// =============================================================================

export const organic_text = {
  primary: {
    color: "#f0f0ff",
    glow: "0 0 20px rgba(240, 240, 255, 0.3)",
  },
  secondary: {
    color: "#a0a0c0",
    glow: "none",
  },
  muted: {
    color: "#606080",
    glow: "none",
  },
  accent: {
    color: "#00ffff",
    glow: "0 0 30px rgba(0, 255, 255, 0.5)",
  },
  highlight: {
    color: "#ff00ff",
    glow: "0 0 30px rgba(255, 0, 255, 0.5)",
  },
} as const;

// =============================================================================
// ORGANIC GRADIENTS
// =============================================================================

export const organic_gradients = {
  // Background void gradients
  voidDepth: `radial-gradient(ellipse at 50% 50%, ${void_backgrounds.cosmos} 0%, ${void_backgrounds.abyss} 100%)`,
  voidVertical: `linear-gradient(180deg, ${void_backgrounds.abyss} 0%, ${void_backgrounds.cosmos} 50%, ${void_backgrounds.abyss} 100%)`,

  // Aurora effects
  aurora: {
    cyanMagenta: "linear-gradient(135deg, rgba(0, 255, 255, 0.15) 0%, rgba(255, 0, 255, 0.1) 50%, rgba(0, 255, 136, 0.08) 100%)",
    nebula: "radial-gradient(ellipse at 30% 20%, rgba(168, 85, 247, 0.2) 0%, transparent 50%), radial-gradient(ellipse at 70% 80%, rgba(0, 255, 255, 0.15) 0%, transparent 50%)",
    cosmic: "radial-gradient(circle at 20% 30%, rgba(255, 0, 255, 0.1) 0%, transparent 40%), radial-gradient(circle at 80% 70%, rgba(0, 255, 255, 0.1) 0%, transparent 40%)",
  },

  // Glow borders (for border-image or pseudo-elements)
  organicBorder: {
    cyan: "linear-gradient(90deg, rgba(0, 255, 255, 0.6), rgba(0, 255, 255, 0.2), rgba(0, 255, 255, 0.6))",
    magenta: "linear-gradient(90deg, rgba(255, 0, 255, 0.6), rgba(255, 0, 255, 0.2), rgba(255, 0, 255, 0.6))",
    purple: "linear-gradient(90deg, rgba(168, 85, 247, 0.6), rgba(168, 85, 247, 0.2), rgba(168, 85, 247, 0.6))",
  },
} as const;

// =============================================================================
// TERMINAL VARIANTS (Enhanced with Organic)
// =============================================================================

export const terminal = {
  claude: {
    bg: void_backgrounds.nebula,
    chrome: void_backgrounds.astral,
    accent: bioluminescent.purple.bright,
    prompt: bioluminescent.purple.core,
    text: organic_text.primary.color,
    output: organic_text.secondary.color,
    toolBadge: bioluminescent.purple.mid,
    glow: bioluminescent.purple.glow,
  },
  opencode: {
    bg: void_backgrounds.deep,
    chrome: void_backgrounds.cosmos,
    accent: bioluminescent.cyan.bright,
    prompt: bioluminescent.cyan.core,
    text: organic_text.primary.color,
    output: organic_text.secondary.color,
    toolBadge: bioluminescent.cyan.mid,
    glow: bioluminescent.cyan.glow,
  },
  gemini: {
    bg: void_backgrounds.cosmos,
    chrome: void_backgrounds.astral,
    accent: "#8ab4f8",
    prompt: "#4285f4",
    text: organic_text.primary.color,
    output: organic_text.secondary.color,
    toolBadge: "#669df6",
    glow: "0 0 20px rgba(138, 180, 248, 0.6), 0 0 40px rgba(138, 180, 248, 0.3)",
  },
} as const;

// =============================================================================
// LEGACY COMPATIBILITY (Unified Export)
// =============================================================================

export const colors = {
  // Legacy background mapping
  background: {
    primary: void_backgrounds.abyss,
    secondary: void_backgrounds.cosmos,
    tertiary: void_backgrounds.astral,
  },

  // Legacy accent mapping (now purple-based)
  accent: {
    primary: bioluminescent.purple.bright,
    light: bioluminescent.purple.core,
    mid: bioluminescent.purple.mid,
    dark: bioluminescent.purple.dim,
  },

  // Legacy status mapping
  status: {
    pass: bioluminescent.green.core,
    fail: bioluminescent.crimson.core,
    warning: bioluminescent.amber.core,
    info: bioluminescent.cyan.core,
  },

  // Legacy text mapping
  text: {
    primary: organic_text.primary.color,
    secondary: organic_text.secondary.color,
    muted: organic_text.muted.color,
    inverse: void_backgrounds.abyss,
  },

  // Legacy overlay mapping
  overlay: {
    light: "rgba(240, 240, 255, 0.06)",
    medium: "rgba(240, 240, 255, 0.12)",
    strong: "rgba(240, 240, 255, 0.24)",
  },

  // Terminal variants
  terminal,
} as const;

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type TerminalVariant = keyof typeof terminal;
export type StatusType = keyof typeof organic_status;
export type BioluminescentColor = keyof typeof bioluminescent;
export type VoidBackground = keyof typeof void_backgrounds;
