/**
 * ParticleField - Cosmic particle background system
 * Creates floating, drifting particles with optional parallax depth
 */

import { useCurrentFrame, useVideoConfig } from "remotion";
import { useMemo } from "react";
import { bioluminescent, void_backgrounds } from "../../constants/colors";
import { particleDrift } from "../../utils/organic-animations";

// =============================================================================
// TYPES
// =============================================================================

type ParticleDensity = "sparse" | "normal" | "dense";

type ParticleFieldProps = {
  /** Particle density preset */
  density?: ParticleDensity;
  /** Custom particle colors (defaults to cyan/magenta/white) */
  colors?: string[];
  /** Enable particle glow effect */
  glow?: boolean;
  /** Enable parallax depth layers (3 layers) */
  depth?: boolean;
  /** Movement speed multiplier */
  speed?: number;
  /** Opacity multiplier for all particles */
  opacity?: number;
};

type Particle = {
  id: number;
  x: number;
  y: number;
  size: number;
  color: string;
  opacity: number;
  layer: number; // 0 = far, 1 = mid, 2 = near
  seed: number;
};

// =============================================================================
// CONSTANTS
// =============================================================================

const DENSITY_MAP: Record<ParticleDensity, number> = {
  sparse: 50,
  normal: 100,
  dense: 180,
};

const DEFAULT_COLORS = [
  bioluminescent.cyan.core,
  bioluminescent.magenta.core,
  "#ffffff",
  bioluminescent.purple.bright,
];

// Layer configs for parallax
const LAYER_CONFIGS = [
  { speedMultiplier: 0.3, sizeRange: [1, 2], opacityRange: [0.1, 0.3] }, // Far
  { speedMultiplier: 0.6, sizeRange: [2, 3], opacityRange: [0.2, 0.5] }, // Mid
  { speedMultiplier: 1.0, sizeRange: [2, 4], opacityRange: [0.3, 0.6] }, // Near
];

// =============================================================================
// PARTICLE GENERATION
// =============================================================================

const generateParticles = (
  count: number,
  colors: string[],
  enableDepth: boolean,
  width: number,
  height: number
): Particle[] => {
  const particles: Particle[] = [];

  for (let i = 0; i < count; i++) {
    const layer = enableDepth ? Math.floor(Math.random() * 3) : 1;
    const config = LAYER_CONFIGS[layer];

    particles.push({
      id: i,
      x: Math.random() * width,
      y: Math.random() * height,
      size: config.sizeRange[0] + Math.random() * (config.sizeRange[1] - config.sizeRange[0]),
      color: colors[Math.floor(Math.random() * colors.length)],
      opacity: config.opacityRange[0] + Math.random() * (config.opacityRange[1] - config.opacityRange[0]),
      layer,
      seed: Math.random() * 1000,
    });
  }

  return particles;
};

// =============================================================================
// COMPONENT
// =============================================================================

export const ParticleField: React.FC<ParticleFieldProps> = ({
  density = "normal",
  colors = DEFAULT_COLORS,
  glow = true,
  depth = true,
  speed = 1,
  opacity = 1,
}) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();

  // Generate particles once (memoized)
  const particles = useMemo(
    () => generateParticles(DENSITY_MAP[density], colors, depth, width, height),
    [density, colors, depth, width, height]
  );

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        backgroundColor: void_backgrounds.abyss,
        pointerEvents: "none",
      }}
    >
      {/* Render particles as divs (performant for Remotion) */}
      {particles.map((particle) => {
        const layerConfig = LAYER_CONFIGS[particle.layer];
        const drift = particleDrift(
          frame,
          particle.seed,
          speed * layerConfig.speedMultiplier
        );

        // Wrap position to stay in bounds
        const x = ((particle.x + drift.x) % width + width) % width;
        const y = ((particle.y + drift.y) % height + height) % height;

        const particleOpacity = particle.opacity * opacity;

        return (
          <div
            key={particle.id}
            style={{
              position: "absolute",
              left: x,
              top: y,
              width: particle.size,
              height: particle.size,
              borderRadius: "50%",
              backgroundColor: particle.color,
              opacity: particleOpacity,
              boxShadow: glow
                ? `0 0 ${particle.size * 2}px ${particle.color}, 0 0 ${particle.size * 4}px ${particle.color}`
                : undefined,
              transform: "translate(-50%, -50%)",
            }}
          />
        );
      })}
    </div>
  );
};

// =============================================================================
// AURORA OVERLAY (Optional atmospheric gradient)
// =============================================================================

type AuroraOverlayProps = {
  variant?: "nebula" | "cosmic" | "cyanMagenta";
  opacity?: number;
  animate?: boolean;
};

export const AuroraOverlay: React.FC<AuroraOverlayProps> = ({
  variant = "nebula",
  opacity = 1,
  animate = false,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Subtle movement for animated variant
  const offsetX = animate ? Math.sin(frame / (fps * 10)) * 5 : 0;
  const offsetY = animate ? Math.cos(frame / (fps * 8)) * 5 : 0;

  const gradients: Record<string, string> = {
    nebula: `
      radial-gradient(ellipse at ${30 + offsetX}% ${20 + offsetY}%, rgba(168, 85, 247, 0.2) 0%, transparent 50%),
      radial-gradient(ellipse at ${70 - offsetX}% ${80 - offsetY}%, rgba(0, 255, 255, 0.15) 0%, transparent 50%)
    `,
    cosmic: `
      radial-gradient(circle at ${20 + offsetX}% ${30 + offsetY}%, rgba(255, 0, 255, 0.1) 0%, transparent 40%),
      radial-gradient(circle at ${80 - offsetX}% ${70 - offsetY}%, rgba(0, 255, 255, 0.1) 0%, transparent 40%)
    `,
    cyanMagenta: `
      linear-gradient(${135 + offsetX}deg, rgba(0, 255, 255, 0.15) 0%, rgba(255, 0, 255, 0.1) 50%, rgba(0, 255, 136, 0.08) 100%)
    `,
  };

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: gradients[variant],
        opacity,
        pointerEvents: "none",
      }}
    />
  );
};

// =============================================================================
// COMBINED BACKGROUND
// =============================================================================

type CosmicBackgroundProps = {
  particles?: ParticleFieldProps;
  aurora?: AuroraOverlayProps;
};

export const CosmicBackground: React.FC<CosmicBackgroundProps> = ({
  particles = {},
  aurora = {},
}) => {
  return (
    <>
      <ParticleField {...particles} />
      <AuroraOverlay {...aurora} />
    </>
  );
};
