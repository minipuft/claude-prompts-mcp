# Demo Video Recording Plan

## Format Decision

**Multiple short clips** embedded as WebP in the README, not one long video.
Each clip shows ONE feature clearly in 10-30s.

## Recording Setup

- **Tool**: ShareX (Windows) recording Claude Code in Windows Terminal
- **Font**: Fira Code (set in Windows Terminal profile)
- **Resolution**: 1424x1298 (native terminal size)
- **Model**: Use `haiku` for speed/cost where possible, `opus` only where output quality matters for the demo
- **Source format**: MP4 from ShareX
- **Target format**: Animated WebP for README inline (convert with ffmpeg)
- **File size target**: <5MB per clip (GitHub renders inline up to 10MB)

## Post-Processing (ffmpeg)

### Standard Pipeline (all clips)

Every clip uses this WebP filter chain:

1. `crop=iw:ih-50:0:50` — remove Windows Terminal tab bar (50px)
2. Speed adjustment (`setpts`)
3. `fps=20`, `scale=720:-1:flags=lanczos` — native display size
4. `libwebp` encoder with quality 60

```bash
# Simple clip (single speed)
ffmpeg -i input.mp4 -vf "
  trim=start=S:end=E,setpts=(PTS-STARTPTS),
  crop=iw:ih-50:0:50,
  setpts=0.5*PTS,
  fps=20,
  scale=720:-1:flags=lanczos
" -c:v libwebp -quality 60 -loop 0 output.webp

# Variable speed (split into segments, concat)
ffmpeg -i input.mp4 -filter_complex "
  [0:v]split=2[a][b];
  [a]trim=start=S1:end=E1,setpts=(PTS-STARTPTS)*0.5[seg1];
  [b]trim=start=S2:end=E2,setpts=(PTS-STARTPTS)*0.33[seg2];
  [seg1][seg2]concat=n=2:v=1[joined];
  [joined]crop=iw:ih-50:0:50,fps=20,scale=720:-1:flags=lanczos
" -c:v libwebp -quality 60 -loop 0 output.webp
```

### Why WebP over GIF

The v1 GIFs suffered from compounding quality issues:

| Problem                             | Root Cause                                    | WebP Fix                    |
| ----------------------------------- | --------------------------------------------- | --------------------------- |
| Blurry text                         | 580px rendered at `width="720"` (33% upscale) | Render at 720px native      |
| Visible banding                     | 48-color palette limit                        | Full 16.7M colors           |
| Dithering grid                      | bayer_scale=5 aggressive dithering            | No dithering needed         |
| Blue/purple artifacts               | Acrylic transparency + 48-color palette       | Full color absorbs bleed    |
| Choppy playback                     | 10fps + 6-12x speed                           | 20fps + 2-3x speed          |
| Large file size despite low quality | GIF LZW compression                           | VP8 video-grade compression |

**Eliminated from pipeline**: `geq` blue clamp, `palettegen`/`paletteuse`, bayer dithering, `colorchannelmixer`. Full-color WebP makes all palette workarounds unnecessary.

### Speed Standards

| Speed    | When to Use                                             |
| -------- | ------------------------------------------------------- |
| **1x**   | Key payoff moment (PASS/FAIL verdict, final output)     |
| **1.5x** | Output the viewer should read and absorb                |
| **2x**   | Standard comfortable speedup (default)                  |
| **3x**   | Typing, loading, boilerplate — nothing critical to read |
| **4x+**  | Avoid — trim the boring parts instead                   |

### v1 GIF Settings (archived)

<details>
<summary>Previous GIF pipeline (deprecated)</summary>

v1 used aggressive GIF optimization to hit <5MB:

- `fps=10`, `scale=580:-1`, `max_colors=48`, `bayer_scale=5`
- `geq` blue-excess clamp for acrylic transparency bleed
- `colorchannelmixer` (abandoned — yellow tint), `curves` (abandoned — insufficient)
- Speed: 3x-12x with variable-speed segment concat

Color correction history:

1. `colorchannelmixer=bb=0.72:rb=0.04:gb=0.04` — killed blue but introduced yellow tint
2. `curves` on blue shadows — not aggressive enough
3. `geq` pixel-level clamp — surgical, no tint shift, but compounds with low palette

All issues traced to the 48-color GIF palette constraint. WebP eliminates the root cause.

</details>

---

## Recording Checklist (Before Each Clip)

- [ ] Fresh `claude` session (no prior context)
- [ ] Terminal font set to Fira Code
- [ ] Terminal sized consistently (same width across all clips)
- [ ] Windows Terminal acrylic transparency OFF (or minimal) — reduces post-processing artifacts
- [ ] Plugin loaded (status bar shows MCP server)
- [ ] Start ShareX BEFORE typing
- [ ] Trim dead time from start/end after recording

---

## Clip List

All clips need fresh recordings. v1 source MP4s are no longer available.

### Clip 1: System Status — NEEDS RE-RECORDING

- **v1 source**: `WindowsTerminal_qWBilRChm0.mp4` (lost)
- **v1 output**: `assets/demos/status-demo-3x.gif` (720x656, 12fps, 48 colors)
- **Target**: `assets/demos/status-demo.webp`
- **Prompt**: `system_control(action:"status")`
- **Shows**: Loaded resources, active configuration, server health
- **Target duration**: 10-15s source, render at 2x
- **README placement**: `<details>` dropdown between Quick Start and What You Get

### Clip 2: Hero Demo — Chain + Gate + Delegation — NEEDS RE-RECORDING

- **v1 source**: `WindowsTerminal_DLI4sJn0tS.mp4` (4:12, lost)
- **v1 output**: `assets/demos/hero-demo.gif` (580x438, 10fps) + `assets/demos/hero-chain-demo.gif`
- **Target**: `assets/demos/hero-demo.webp` + `assets/demos/hero-chain-demo.webp`
- **Prompt**: `>>code_review_test` chain (or similar multi-step with gate)
- **Split into 2 clips** (source too long for single file):
  - **WebP A**: Hook detection + template load + gate fail→pass
    - Typing/loading @ 3x, gate verdict moments @ 1.5x
  - **WebP B**: Remaining chain phases + final render
    - Chain execution @ 2-3x, final output @ 1.5x
- **Notes**:
  - Use haiku — cheaper, more likely to fail first gate attempt
  - Gate FAIL→PASS is the visual payoff — keep at 1-1.5x
  - Phases compound reasoning — each step builds on previous validated output
- **README placement**:
  - WebP A: Hero position right after tagline
  - WebP B: `<details>` dropdown in "Compose Workflows" section

### Clip 3: Resource Discovery — NEEDS RE-RECORDING

- **v1 source**: `WindowsTerminal_2JMxV8xaKk.mp4` (17.5s, lost)
- **v1 output**: `assets/demos/resource-list-demo.gif` (580x438, 12fps, 444KB)
- **Target**: `assets/demos/resource-list-demo.webp`
- **Prompt**: `resource_manager(resource_type:"prompt", action:"list")`
- **Shows**: Full prompt catalog — prompts across categories
- **Target duration**: 15-20s source, render at 2x
- **README placement**: `<details>` dropdown in "What You Get" section

### Clip 4: Chain Workflow — NEEDS RE-RECORDING

- **v1 source**: `WindowsTerminal_FigL75A7Ol.mp4` (2:36, lost)
- **v1 output**: `assets/demos/chain-workflow-demo.gif` (580x452, 10fps, 2.7MB)
- **Target**: `assets/demos/chain-workflow-demo.webp`
- **Prompt**: `>>tech_evaluation_chain library:'zod' context:'API validation'`
- **Shows**: Multi-step chain with context7 research delegation, scored assessment table
- **Target duration**: 30-45s source, render at 2-3x
- **README placement**: `<details>` dropdown in "Compose Workflows" section

### Clip 5: Verification Loop — NOT RECORDED

- **Target**: `assets/demos/verify-loop-demo.webp`
- **Prompt**: `>>test_default count:'5' :: verify:"echo 'test passed'" :fast`
- **Shows**: Shell verification — prompt runs, verify command executes, passes
- **Target duration**: 15-20s source, render at 2x
- **README placement**: "Verification Loops" section

### Clip 6: Gate Validation Showcase — NOT RECORDED

- **Target**: `assets/demos/gate-validation-demo.webp`
- **Goal**: Dedicated demo of gates as the star feature — not buried inside a chain
- **Prompt** (pick one that produces a visible FAIL → retry → PASS cycle):
  - `>>code_review target:'src/runtime/' :: 'must include severity ratings' :: 'cite specific line numbers'` — two inline gates + prompt's own configured gates, likely to fail on haiku
  - `>>quick_analysis topic:'error handling patterns' :: 'include code examples for every recommendation'` — demanding gate that forces structured output
- **What to capture**:
  1. The gate criteria appearing in the prompt (shows what's being enforced)
  2. First attempt output (partial/missing something)
  3. `GATE_REVIEW: FAIL` verdict with the specific failure reason
  4. Retry with corrected output
  5. `GATE_REVIEW: PASS` verdict
- **Key visual moments**: The FAIL/PASS verdicts — this is the payoff
- **Speed**: 2-3x on generation, 1-1.5x on verdict moments (let viewer read FAIL/PASS)
- **Target duration**: 20-30s source
- **README placement**: `<details>` dropdown in "What You Get" section under Validation Rules (Gates)
- **Tips**:
  - Use haiku — more likely to miss a gate criterion on first pass
  - Two inline `::` gates are better than one — shows composability
  - `code_review` prompt already ships with `code-quality` + custom gates in its YAML — inline `::` stacks on top
  - The hero GIF shows a gate in a chain; this clip isolates the gate mechanism itself

### Clip 7: Skills Export (CLI — no API cost) — NEEDS RE-RECORDING

- **v1 source**: `WindowsTerminal_xdywH7e01M.mp4` (25.8s, lost)
- **v1 output**: `assets/demos/skills-export-demo.gif` (580x452, 10fps, 1.5MB)
- **Target**: `assets/demos/skills-export-demo.webp`
- **Prompt**: `npm run skills:export -- --dry-run` (terminal command, no API cost)
- **Shows**: Compilation + `bat` preview of generated review skill with phases, gates, and arguments
- **Target duration**: 20-25s source, render at 2x
- **README placement**: `<details>` dropdown in "Run Anywhere" section

---

## Priority Order

Record in this order (highest README impact first):

1. **Clip 2** (Hero) — the single most important visual, gate fail→pass payoff
2. **Clip 6** (Gate Validation) — star feature isolated, FAIL→PASS cycle
3. **Clip 4** (Chain) — signature differentiator, context7 delegation
4. **Clip 7** (Skills Export) — zero API cost, easy win
5. **Clip 5** (Verification) — ground-truth shell validation
6. **Clip 3** (Resource List) — breadth of templates
7. **Clip 1** (Status) — lowest priority, simple dashboard

## README Placement Map

```
# Claude Prompts MCP Server
[logo + badges]
[tagline]

[HERO WebP A — Clip 2]             ← gate fail→pass in chain context
                                      hero-demo.webp

## Quick Start
...
<details>See it running</details>   ← Clip 1: status-demo.webp

## What You Get
[Clip 3 — resource list]           ← resource-list-demo.webp in <details>
[Clip 6 — gate validation]         ← gate-validation-demo.webp in <details>

## Compose Workflows
[HERO WebP B — Clip 2]             ← hero-chain-demo.webp (compound reasoning)
[Clip 4 — chain workflow]          ← chain-workflow-demo.webp in <details>

### Verification Loops
[Clip 5 — verify loop]             ← verify-loop-demo.webp

### Judge Mode
(text description only — no clip planned)

## Run Anywhere
[Clip 7 — skills export]           ← skills-export-demo.webp in <details>
```

## Workflow

1. You record with ShareX (MP4)
2. Share the MP4 path
3. I convert: trim, speed (2x default), crop, WebP encode
4. Store WebP in `assets/demos/`
5. Update README `<img>` tags (`.gif` → `.webp`)

## README Migration

When first WebP clip is ready, update all README `<img>` tags:

- `hero-demo.gif` → `hero-demo.webp`
- `hero-chain-demo.gif` → `hero-chain-demo.webp`
- `status-demo-3x.gif` → `status-demo.webp`
- `resource-list-demo.gif` → `resource-list-demo.webp`
- `chain-workflow-demo.gif` → `chain-workflow-demo.webp`
- `skills-export-demo.gif` → `skills-export-demo.webp`

Old GIF files can be deleted after all WebP replacements are integrated.

## Notes

- VHS tapes abandoned — unreliable with API calls, ShareX is faster
- v1 GIFs suffered from 48-color palette, 580px upscaling, 10fps choppiness — all fixed by WebP
- If any clip exceeds 5MB as WebP, reduce quality to 50 or trim duration
- The `>>` syntax hook detection is visible in the recording — that's a feature, not a bug
- `code_review_test` chain created specifically for the hero demo
- `research_docs` prompt created for context7-based library research
- `code_review` prompt ships with `code-quality` + custom inline gates — good for Clip 6
- 14 pre-built gates exist in `server/resources/gates/` — Clip 6 can reference by name (`:: code-quality`)
