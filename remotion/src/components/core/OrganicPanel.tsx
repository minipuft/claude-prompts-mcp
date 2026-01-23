/**
 * OrganicPanel - Enhanced panel with bioluminescent glow borders
 * Year3000 Organic design system
 */

import { useCurrentFrame, useVideoConfig } from "remotion";
import { bioluminescent, void_backgrounds, organic_gradients } from "../../constants/colors";
import { radii, spacing } from "../../constants";
import { breathingGlow } from "../../utils/organic-animations";

type PanelVariant = "void" | "glow" | "aurora";
type GlowColor = "cyan" | "magenta" | "purple" | "green" | "amber";

type OrganicPanelProps = {
  children: React.ReactNode;
  /** Panel style variant */
  variant?: PanelVariant;
  /** Glow border color */
  glowColor?: GlowColor;
  /** Enable breathing animation on glow */
  breathe?: boolean;
  /** Custom padding */
  padding?: number;
  /** Custom width */
  width?: number | string;
  /** Border radius */
  borderRadius?: number;
  /** Additional style overrides */
  style?: React.CSSProperties;
};

const GLOW_COLORS: Record<GlowColor, { core: string; aura: string; glow: string }> = {
  cyan: bioluminescent.cyan,
  magenta: bioluminescent.magenta,
  purple: bioluminescent.purple,
  green: bioluminescent.green,
  amber: bioluminescent.amber,
};

export const OrganicPanel: React.FC<OrganicPanelProps> = ({
  children,
  variant = "glow",
  glowColor = "cyan",
  breathe = false,
  padding = spacing.lg,
  width,
  borderRadius = radii.xl,
  style,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const glowConfig = GLOW_COLORS[glowColor];
  const breathIntensity = breathe ? breathingGlow(frame, fps, 1) : 1;

  // Background based on variant
  const backgrounds: Record<PanelVariant, string> = {
    void: `linear-gradient(135deg, ${void_backgrounds.cosmos}ee 0%, ${void_backgrounds.abyss}f5 100%)`,
    glow: `linear-gradient(135deg, ${void_backgrounds.nebula}ee 0%, ${void_backgrounds.deep}f5 100%)`,
    aurora: organic_gradients.aurora.nebula,
  };

  // Border glow intensity
  const borderOpacity = 0.3 + 0.2 * breathIntensity;
  const glowOpacity = 0.15 * breathIntensity;

  return (
    <div
      style={{
        position: "relative",
        padding,
        width,
        background: backgrounds[variant],
        border: `1px solid ${glowConfig.core}${Math.round(borderOpacity * 255).toString(16).padStart(2, "0")}`,
        borderRadius,
        boxShadow: `
          0 0 ${20 * breathIntensity}px ${glowConfig.core}${Math.round(glowOpacity * 255).toString(16).padStart(2, "0")},
          0 0 ${40 * breathIntensity}px ${glowConfig.core}${Math.round(glowOpacity * 0.5 * 255).toString(16).padStart(2, "0")},
          inset 0 0 ${30 * breathIntensity}px ${glowConfig.core}${Math.round(glowOpacity * 0.3 * 255).toString(16).padStart(2, "0")},
          0 20px 60px rgba(0, 0, 0, 0.5)
        `,
        backdropFilter: "blur(10px)",
        ...style,
      }}
    >
      {children}
    </div>
  );
};

// =============================================================================
// LEGACY COMPATIBLE PANEL (Enhanced)
// =============================================================================

type PanelProps = {
  children: React.ReactNode;
  padding?: number;
  borderColor?: string;
  background?: string;
  width?: number | string;
};

export const Panel: React.FC<PanelProps> = ({
  children,
  padding = spacing.lg,
  borderColor,
  background,
  width,
}) => {
  // Use organic styling if no custom colors provided
  if (!borderColor && !background) {
    return (
      <OrganicPanel padding={padding} width={width}>
        {children}
      </OrganicPanel>
    );
  }

  // Legacy behavior with custom colors
  return (
    <div
      style={{
        padding,
        background: background || void_backgrounds.cosmos,
        border: `1px solid ${borderColor || bioluminescent.cyan.dim}`,
        borderRadius: radii.lg,
        width,
        boxShadow: "0 20px 60px rgba(0, 0, 0, 0.35)",
      }}
    >
      {children}
    </div>
  );
};
