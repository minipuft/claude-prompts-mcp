# Silent showcase renderer trial

This private Remotion package renders an editable, frame-driven **technical proof**, separate from
the newer environment concept in [the direction board](../../docs/portfolio/showcase-directions.html)
and [the script](../../docs/portfolio/showcase-script.md). It does not change the server runtime,
README, brand identity, or prompt resources. The 75-second manifest describes the earlier staging
proof; the exported film intentionally contains only its first 20 seconds.

## Run locally

Run inside this directory. Its dependencies and lockfile are independent of the parent worktree's
shared dependency symlinks. Do not install dependencies from the repository root for this trial.

```bash
npm ci
npm run typecheck
npm run studio          # editable timeline, port 3107
npm run render:proof    # out/renderer-proof.mp4, frames 0–599, 1280×720
npm run still -- out/title.png --frame=240
npm run still -- out/compose.png --frame=450
```

The full-manifest command is deliberately separate: `npm run render:full`. The environmental
story is still under discussion; no full film of that story has been rendered or adopted.

The default browser is Remotion's managed Chrome Headless Shell, downloaded inside this package's
own `node_modules/.remotion/`. System Google Chrome 151.0.7922.169 loaded the root and local fonts
but stalled at the renderer's `requestAnimationFrame` continuation. Using managed Headless Shell
149.0.7790.0 completed the same identity still and the film proof. This is an environment workaround,
not a claim that every installation of Chrome 151 fails.

## Structure and editing

- `story.json`: authored copy/timing; the story worker owns it. Its strict runtime reader rejects
  malformed fields, duplicate IDs, gaps, overlaps, and durations that do not cover the film.
- `src/Root.tsx`: composition metadata from the manifest.
- `src/film.tsx`: scene staging, typography, read holds, and frame-based transitions.
- `src/graphics.tsx`: document consolidation, syntax specimens, context-transfer graphics,
  review criteria and artifact illustration. No timers, CSS animation clocks, random events,
  fabricated transcripts, or fabricated gate verdicts.
- `public/`: byte-identical canonical positive/reversed mascot copies and local licensed fonts.
- `out/`: ignored local proof, stills, probe results, and render logs.

The opening can be inspected at frames 120 (consolidated prompt slips), 240 (identity), and 450
(syntax specimens). Later scenes remain an editable illustration of the earlier concept; they
are not a captured agent run or the selected environmental story.

## Asset and API provenance

The mascot comes unchanged from `assets/brand/claude-prompts-mark.svg` and
`claude-prompts-mark-reversed.svg`. Keep those canonical sources intact; surrounding composition
is the trial's design surface.

Font files are Latin WOFF2 specimens from Fontsource 5.3.0 npm tarballs:

- `https://registry.npmjs.org/@fontsource/instrument-sans/-/instrument-sans-5.3.0.tgz`:
  weights 400/600/700, Instrument Sans. License retained as `public/fonts/instrument-sans-LICENSE`.
- `https://registry.npmjs.org/@fontsource/ibm-plex-mono/-/ibm-plex-mono-5.3.0.tgz`:
  weight 400, IBM Plex Mono. License retained as `public/fonts/ibm-plex-mono-LICENSE`.

Remotion 4.0.530 APIs were retrieved through Context7 `/remotion-dev/remotion` before implementation:
`registerRoot`, `Composition`, `Sequence`, `useCurrentFrame`, `interpolate`, `Easing`, `staticFile`,
`Img`, local `loadFont`, and CLI frame/scale output. Versions are pinned in `package-lock.json`.
Verified environment: Node 24.15.0, React/React DOM 19.3.0, TypeScript 5.9.3. Remotion has a separate
license from this repository; this is a private local evaluation, with no paid rendering service.

## Completed artifact checks

`npm run typecheck` passed. The real renderer produced `out/renderer-proof.mp4`. `ffprobe` measured
H.264 video, **1280×720**, **30 fps**, **600 frames**, **20.000 seconds**, **769114 bytes**, and no
audio stream. `out/ffprobe.json` retains the measurement. The full 2250-frame narrative was held
after the story changed.

The identity still was visually inspected at 1920×1080. Both copied SVG masters have identical
SHA256 hashes to the canonical source assets. The direction board uses inline fonts/mascot and
SVG illustrations, so its comparison does not require an external asset service. Browser layout
and interaction inspection belong to the planner's shared preview pass.
