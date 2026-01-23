/**
 * Year3000 Organic Typography
 * Orbitron (futuristic display) + Inter (clean body) + JetBrains Mono (code)
 * With bioluminescent glow effects
 */

import { loadFont as loadOrbitron } from "@remotion/google-fonts/Orbitron";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadJetBrainsMono } from "@remotion/google-fonts/JetBrainsMono";

// =============================================================================
// FONT LOADING
// =============================================================================

const orbitron = loadOrbitron("normal", {
  weights: ["400", "500", "600", "700", "900"],
  subsets: ["latin"],
});

const inter = loadInter("normal", {
  weights: ["400", "500", "600", "700"],
  subsets: ["latin"],
});

const jetBrainsMono = loadJetBrainsMono("normal", {
  weights: ["400", "600"],
  subsets: ["latin"],
});

// =============================================================================
// FONT FAMILIES
// =============================================================================

export const fontFamilies = {
  display: orbitron.fontFamily,      // Futuristic titles
  body: inter.fontFamily,            // Clean body text
  mono: jetBrainsMono.fontFamily,    // Code and terminal
};

// =============================================================================
// FONT WEIGHTS
// =============================================================================

export const fontWeights = {
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
  black: 900,
};

// =============================================================================
// FONT SIZES (8px base)
// =============================================================================

const base = 8;

export const fontSizes = {
  xs: base * 1.5,    // 12px - labels, badges
  sm: base * 2,      // 16px - small body, terminal
  md: base * 2.5,    // 20px - body default
  lg: base * 3,      // 24px - subheadings
  xl: base * 4,      // 32px - section titles
  "2xl": base * 5,   // 40px - large titles
  "3xl": base * 6,   // 48px - feature titles
  "4xl": base * 7,   // 56px - hero subtitles
  "5xl": base * 9,   // 72px - hero titles
  "6xl": base * 11,  // 88px - display titles
};

// =============================================================================
// GLOW EFFECTS (Text Shadows)
// =============================================================================

export const textGlow = {
  // Hero title - maximum bioluminescent glow
  hero: {
    cyan: `
      0 0 10px rgba(0, 255, 255, 0.8),
      0 0 30px rgba(0, 255, 255, 0.6),
      0 0 60px rgba(0, 255, 255, 0.4),
      0 0 100px rgba(0, 255, 255, 0.2)
    `,
    magenta: `
      0 0 10px rgba(255, 0, 255, 0.8),
      0 0 30px rgba(255, 0, 255, 0.6),
      0 0 60px rgba(255, 0, 255, 0.4),
      0 0 100px rgba(255, 0, 255, 0.2)
    `,
    purple: `
      0 0 10px rgba(168, 85, 247, 0.8),
      0 0 30px rgba(168, 85, 247, 0.6),
      0 0 60px rgba(168, 85, 247, 0.4),
      0 0 100px rgba(168, 85, 247, 0.2)
    `,
  },

  // Section titles - medium glow
  section: {
    cyan: `
      0 0 10px rgba(0, 255, 255, 0.6),
      0 0 30px rgba(0, 255, 255, 0.3)
    `,
    magenta: `
      0 0 10px rgba(255, 0, 255, 0.6),
      0 0 30px rgba(255, 0, 255, 0.3)
    `,
    purple: `
      0 0 10px rgba(168, 85, 247, 0.6),
      0 0 30px rgba(168, 85, 247, 0.3)
    `,
  },

  // Labels - subtle glow
  label: {
    white: "0 0 15px rgba(255, 255, 255, 0.2)",
    cyan: "0 0 15px rgba(0, 255, 255, 0.3)",
    purple: "0 0 15px rgba(168, 85, 247, 0.3)",
  },

  // Code/operator highlighting
  code: {
    cyan: `
      0 0 8px rgba(0, 255, 255, 0.5),
      0 0 20px rgba(0, 255, 255, 0.3)
    `,
    magenta: `
      0 0 8px rgba(255, 0, 255, 0.5),
      0 0 20px rgba(255, 0, 255, 0.3)
    `,
    green: `
      0 0 8px rgba(0, 255, 136, 0.5),
      0 0 20px rgba(0, 255, 136, 0.3)
    `,
    amber: `
      0 0 8px rgba(255, 170, 0, 0.5),
      0 0 20px rgba(255, 170, 0, 0.3)
    `,
  },

  // Status text
  status: {
    pass: `
      0 0 10px rgba(0, 255, 136, 0.6),
      0 0 25px rgba(0, 255, 136, 0.3)
    `,
    fail: `
      0 0 10px rgba(255, 51, 102, 0.6),
      0 0 25px rgba(255, 51, 102, 0.3)
    `,
    warning: `
      0 0 10px rgba(255, 170, 0, 0.6),
      0 0 25px rgba(255, 170, 0, 0.3)
    `,
  },

  // No glow
  none: "none",
};

// =============================================================================
// TYPOGRAPHY PRESETS (Common combinations)
// =============================================================================

export const textPresets = {
  // Hero title
  heroTitle: {
    fontFamily: fontFamilies.display,
    fontSize: fontSizes["5xl"],
    fontWeight: fontWeights.black,
    letterSpacing: 2,
  },

  // Hero subtitle
  heroSubtitle: {
    fontFamily: fontFamilies.display,
    fontSize: fontSizes["3xl"],
    fontWeight: fontWeights.bold,
    letterSpacing: 1,
  },

  // Section title
  sectionTitle: {
    fontFamily: fontFamilies.display,
    fontSize: fontSizes.xl,
    fontWeight: fontWeights.semibold,
    letterSpacing: 1,
  },

  // Body text
  body: {
    fontFamily: fontFamilies.body,
    fontSize: fontSizes.md,
    fontWeight: fontWeights.regular,
    lineHeight: 1.6,
  },

  // Small text
  small: {
    fontFamily: fontFamilies.body,
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.regular,
  },

  // Label
  label: {
    fontFamily: fontFamilies.body,
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.medium,
    letterSpacing: 1,
    textTransform: "uppercase" as const,
  },

  // Code
  code: {
    fontFamily: fontFamilies.mono,
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.regular,
  },

  // Terminal command
  terminalCommand: {
    fontFamily: fontFamilies.mono,
    fontSize: fontSizes.md,
    fontWeight: fontWeights.semibold,
  },
};
