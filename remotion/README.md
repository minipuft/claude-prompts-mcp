# Claude Prompts Demo Videos

Programmatic demo videos and concept animations using [Remotion](https://remotion.dev/).

## Setup

```bash
cd remotion
npm install
```

## Development

Start Remotion Studio for live preview and development:

```bash
npm run studio
```

This opens a browser-based editor where you can:
- Preview compositions in real-time
- Adjust timing and animations
- Export individual frames

## Render Videos

Render a single composition:

```bash
npm run render HeroIntro out/hero-intro.mp4
```

Render all compositions:

```bash
npm run render:all
```

## Compositions

| ID | Description | Duration |
|----|-------------|----------|
| `HeroIntro` | Hero intro with feature cards | 10s |
| `SymbolicSyntax` | Symbolic operator showcase | 15s |
| `ChainFlow` | Chain execution flow | 20s |
| `GateSystem` | Gate validation workflow | 15s |
| `FrameworkInjection` | Framework comparison | 15s |
| `TerminalDemo` | Terminal walkthrough | 20s |

## Structure

```
remotion/
├── src/
│   ├── index.ts           # Entry point
│   ├── Root.tsx           # Composition registry
│   └── compositions/      # Video components
│       ├── HeroIntro.tsx
│       ├── SymbolicSyntax.tsx
│       ├── ChainFlow.tsx
│       ├── GateSystem.tsx
│       ├── FrameworkInjection.tsx
│       └── TerminalDemo.tsx
├── scripts/
│   └── render-all.ts      # Batch render script
├── out/                   # Rendered videos (gitignored)
├── remotion.config.ts     # Remotion configuration
└── package.json
```

## Adding New Compositions

1. Create a new component in `src/compositions/`
2. Register it in `src/Root.tsx` with a `<Composition>`
3. Add to `scripts/render-all.ts` for batch rendering

## Tips

- Use `useCurrentFrame()` and `interpolate()` for animations
- Use `<Sequence>` to orchestrate timing
- Use `spring()` for physics-based easing
- Keep FPS at 30 for standard web playback
- Use 1920x1080 for high-quality output
