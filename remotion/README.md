# Claude Prompts MCP — Tutorial Video

> _"We are all just liquid pretending to be solid."_

Animated tutorial video using [Remotion](https://remotion.dev/), powered by the **Liquescent** design system.

---

## The Liquescent Philosophy

**Liquescent** is not a theme—it is a **state of transition**. The viewer doesn't watch the product; they _dissolve into_ it.

### The Manifesto

Every interface is a membrane—a permeable boundary between human intention and digital response. Traditional design treats this membrane as a wall. Liquescent dissolves that wall.

The interface becomes a **living environment**. You don't _watch_ it—you _inhabit_ it. Every interaction sends ripples through a viscous medium. Every element exists in perpetual transformation.

### The Three States

```
╔═══════════════════════════════════════════════════════════════════╗
║                                                                   ║
║    DORMANT         →       AWAKENING       →      LIQUESCENT      ║
║                                                                   ║
║   ⬠ Pentagon            ⬡ Octagon              ● Circle          ║
║                                                                   ║
║   Cyan Glow             Amber Glow            Chartreuse Glow     ║
║   oklch(78% 0.14 200)   oklch(82% 0.18 75)    oklch(85% 0.24 145) ║
║                                                                   ║
║   Waiting               Engaging              Dissolved           ║
║   Observing             Warming               Merged              ║
║   Potential             Intention             Completion          ║
║                                                                   ║
╚═══════════════════════════════════════════════════════════════════╝
```

| State          | Color      | Shape    | Meaning                                      |
| -------------- | ---------- | -------- | -------------------------------------------- |
| **Dormant**    | Cyan       | Pentagon | Quiet observation, latent potential, waiting |
| **Awakening**  | Amber      | Octagon  | User proximity, warming, edges softening     |
| **Liquescent** | Chartreuse | Circle   | Full dissolution, no boundaries, completion  |

---

## The Dissolution Protocol

The video follows a 5-phase journey from interface to environment to perception dissolution:

### Phase 1: The Membrane Breathes

- All surfaces pulse with organic rhythm (4-8 second cycles)
- Breathing is **felt, not seen** — subtle, barely perceptible
- 60 BPM at rest (resting heart rate)

### Phase 2: The Chain Reaction

- Interactions trigger ripples that spread to siblings
- teamLab-style "influence without boundaries"
- One touch, infinite propagation

### Phase 3: The Ganzfeld

- Depth cues dissolve at deep scroll (75%+)
- Background and foreground merge
- Inspired by **James Turrell's** light installations

### Phase 4: The Randomness

- Perlin noise introduces organic variation
- No two frames are mathematically identical
- Per-element randomness creates life

### Phase 5: The Impossible Colors

- P3 gamut at maximum chroma
- Colors that exceed sRGB capability
- `oklch(85% 0.37 195)` — electric beyond comprehension

---

## Artistic Inspirations

> _"Light is not a tool to enable vision but something to look at itself"_ — James Turrell

| Artist                 | Philosophy                                            | What Liquescent Channels                                  |
| ---------------------- | ----------------------------------------------------- | --------------------------------------------------------- |
| **James Turrell**      | Light as medium, not illumination                     | The Ganzfeld Effect — environments where depth disappears |
| **Olafur Eliasson**    | Uses light, water, air to shift perception            | Dichromatic effects, light splitting into wavelengths     |
| **teamLab**            | "Artworks move, relate, influence without boundaries" | Interconnected animations that trigger chain reactions    |
| **Apple Liquid Glass** | Physically accurate lensing and refraction            | Evolution of glassmorphism with caustics                  |

---

## Color Science

### OKLCH — Perceptual Truth

All colors are defined in OKLCH (perceptually uniform color space), not RGB or HSL.

```
oklch(L% C H)
      │  │ └─ Hue (0-360)
      │  └─── Chroma (saturation intensity)
      └────── Lightness (0-100%)
```

### The Palette

**The Void** — Where light dies:
| Token | Value | Role |
|-------|-------|------|
| `abyss` | `oklch(4% 0.02 220)` | Absolute darkness, cold blue undertone |
| `deep` | `oklch(8% 0.03 200)` | Primary background, petro-black |
| `surface` | `oklch(12% 0.04 200)` | Elevated surfaces, membranes |
| `film` | `oklch(16% 0.04 200)` | Interactive elements |

**The Luminescence** — Bioluminescent frequencies:
| Token | Value | Role |
|-------|-------|------|
| `cyan` | `oklch(78% 0.14 200)` | Dormant state, data flow |
| `amber` | `oklch(82% 0.18 75)` | Awakening state, warmth |
| `chartreuse` | `oklch(85% 0.24 145)` | Liquescent state, completion |
| `coral` | `oklch(72% 0.16 25)` | Attention, errors |

### Golden Ratio Hue

Nature's most efficient angle for distributing elements — found in sunflowers, galaxies, and DNA.

```typescript
const GOLDEN_ANGLE = 137.5; // degrees
const PHI = 1.618; // golden ratio
```

---

## Motion Philosophy

> _"❌ Linear = mechanical, dead. ❌ Cubic-bezier = smooth but predictable. ✅ Spring physics = ALIVE."_

### The Unified Field Theory

The interface is modeled as a **viscous medium**. All interactions follow:

```
effect = disturbance × decay(distance) × depth_modifier × (1 / viscosity)
```

### Spring Physics

| Preset        | Damping | Stiffness | Mass | Use Case                  |
| ------------- | ------- | --------- | ---- | ------------------------- |
| `viscous`     | 30      | 80        | 1.2  | Major state transitions   |
| `membrane`    | 25      | 120       | 0.8  | Container animations      |
| `dissolution` | 40      | 60        | 1.5  | Exit animations, Ganzfeld |
| `ripple`      | 15      | 200       | 0.5  | Impact propagation        |
| `breath`      | 20      | 60        | 1.0  | Idle animations           |

### Breathing — Felt, Not Seen

The breathing animation is **subtle**:

- 4-second primary cycle + 7-second variation
- 3% intensity range (0.97–1.0)
- Multi-wave composition so no two cycles are identical
- Perlin noise modulation for organic uniqueness

**Anti-pattern**: Visible pulsing. If you can clearly see the breathing, it's too strong.

### Motion Patterns from Nature

| Pattern             | Natural Source      | Implementation                      |
| ------------------- | ------------------- | ----------------------------------- |
| **Flocking**        | Birds, fish schools | Staggered delays with phase offsets |
| **Ripples**         | Water droplets      | Radial gradients with spring decay  |
| **Bioluminescence** | Deep sea creatures  | Glow pulses with sin() timing       |
| **Breathing**       | Living organisms    | Scale + opacity with layered waves  |

---

## Remotion-Specific Rules

### Forbidden: CSS Transitions

CSS `transition` properties **do not render** in video output. All animation must be frame-based.

```typescript
// ❌ WRONG — Will not animate in rendered video
style={{ transition: 'opacity 0.3s ease' }}

// ✅ CORRECT — Frame-based with spring()
const opacity = spring({ frame, fps, config: springs.membrane });
```

### Required: premountFor

All `<Sequence>` components must include `premountFor` for proper asset preloading:

```tsx
<Sequence from={START} durationInFrames={DURATION} premountFor={30}>
  <MyComponent />
</Sequence>
```

### Required: extrapolateRight: 'clamp'

Prevent value overshoot in interpolations:

```typescript
const value = interpolate(frame, [0, 100], [0, 1], {
  extrapolateRight: "clamp",
});
```

---

## Project Structure

```
remotion/
├── src/
│   ├── compositions/
│   │   └── Tutorial.tsx        # Main video composition
│   ├── components/
│   │   ├── primitives/         # Liquescent atoms
│   │   │   ├── LiquescentMembrane.tsx
│   │   │   ├── CoalesceText.tsx
│   │   │   ├── StateNucleus.tsx
│   │   │   ├── RippleCascade.tsx
│   │   │   └── FluidChannel.tsx
│   │   ├── environment/        # Atmosphere effects
│   │   │   ├── DepthField.tsx
│   │   │   ├── ViscousMedium.tsx
│   │   │   └── DissolutionOverlay.tsx
│   │   └── domain/             # Business components
│   │       ├── LiquescentTerminal.tsx
│   │       ├── ValidationMembrane.tsx
│   │       └── FrameworkField.tsx
│   ├── design-system/          # Tokens, physics, types
│   │   ├── tokens/
│   │   │   ├── colors.ts       # OKLCH palette
│   │   │   └── motion.ts       # Spring configs, breathing
│   │   ├── physics/
│   │   │   └── perlin-noise.ts # Multi-octave Perlin
│   │   └── types.ts
│   └── utils/
│       └── liquescent-animations.ts
├── SCRIPT.md                   # Video script with timing
└── package.json
```

---

## Quick Start

```bash
cd remotion
npm install
npm run studio    # Preview in browser
```

## Render

```bash
# Full video (90 seconds)
npx remotion render src/index.ts Tutorial --output=out/tutorial.mp4

# Higher quality
npx remotion render src/index.ts Tutorial --output=out/tutorial.mp4 --codec=h264 --crf=18

# Preview specific section
npx remotion render src/index.ts Tutorial --output=out/test.mp4 --frames=0-240
```

---

## Video Sections

| Section      | Time      | Content                    | State Progression      |
| ------------ | --------- | -------------------------- | ---------------------- |
| Introduction | 0:00-0:08 | What is Claude Prompts MCP | dormant                |
| Basic Usage  | 0:08-0:25 | `>>prompt` execution       | dormant → awakening    |
| Chains       | 0:25-0:45 | `-->` sequential workflows | awakening              |
| Frameworks   | 0:45-1:00 | `@CAGEERF` framework       | awakening → liquescent |
| Gates        | 1:00-1:15 | `::` quality validation    | liquescent             |
| Combined     | 1:15-1:30 | Full example               | liquescent (Ganzfeld)  |

See [SCRIPT.md](SCRIPT.md) for detailed timing, terminal content, and visual cues.

---

## Design Principles

### Do

- **Dissolve boundaries** — Every element should feel like touching liquid
- **Breathe subtly** — Animation adds life without distraction
- **Light from within** — Luminescence is internal, not external
- **Transform shapes** — States morph through clip-path
- **Layer the membrane** — Build depth through stacked glass effects
- **Use oklch()** — All colors in perceptually uniform space
- **Spring with physics** — Organic bounce, not mechanical

### Don't

- **Snap instantly** — Everything moves through viscous resistance
- **Use flat hex colors** — Always oklch() with proper tokens
- **Add external light** — No bright backgrounds or sunlight metaphors
- **Over-use chartreuse** — It's the _final_ state, not decoration
- **Create sharp edges** — Corners soften; shapes flow
- **Make breathing visible** — If you can see it pulsing, it's too strong
- **Use CSS transitions** — They don't render in video output

---

## The Closing Thought

> _"The interface doesn't contain you. It doesn't display to you. It envelops. Like warm fog that knows your name."_

Liquescent is not finished. It cannot be finished. By definition, it is always in the process of becoming something else.

Welcome to the state of becoming liquid.

---

## References

- **Liquescent Theme**: `~/.claude/skills/theme-factory/themes/liquescent/`
- **James Turrell**: [Light and Space Movement](https://www.theartstory.org/movement/light-and-space/)
- **Olafur Eliasson**: [Perception Shift](https://www.acmi.net.au/stories-and-ideas/olafur-eliasson-james-turrell-perception-can-shift-perspective/)
- **teamLab**: [Borderless](https://borderless.teamlab.art/)
- **OKLCH**: [Why quit RGB/HSL](https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl)
- **Spring Physics**: [Josh Comeau's Guide](https://www.joshwcomeau.com/animation/a-friendly-introduction-to-spring-physics/)
