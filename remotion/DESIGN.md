# Remotion Demo Videos — Design Specification

## 1. Terminal Client Styling

### Claude Code

**Source**: Anthropic's official CLI tool

| Element | Value | Notes |
|---------|-------|-------|
| Background | `#1a1625` | Deep purple-tinted dark |
| Chrome/Header | `#2d2640` | Slightly lighter purple |
| Primary Accent | `#a855f7` | Vivid purple |
| Secondary Accent | `#c084fc` | Light purple |
| Prompt Character | `❯` | Unicode U+276F |
| Prompt Color | `#c084fc` | Light purple |
| Command Text | `#f8fafc` | Near-white |
| Output Text | `#e2e8f0` | Slightly muted |
| Success | `#22c55e` | Green |
| Error | `#ef4444` | Red |
| Tool Call Badge | `#6366f1` | Indigo background |
| Cursor | `▋` blinking | Purple tint |

**Visual Features**:
- Rounded corners (16px)
- Subtle glow on accent elements
- Tool calls shown in indigo badges
- Streaming text effect for responses

### OpenCode

**Source**: Go-based CLI tool (opencode-ai)

| Element | Value | Notes |
|---------|-------|-------|
| Background | `#0d1117` | GitHub-dark style |
| Chrome/Header | `#161b22` | Slightly lighter |
| Primary Accent | `#06b6d4` | Cyan/Teal |
| Secondary Accent | `#22d3ee` | Light cyan |
| Prompt Character | `$` | Standard shell |
| Prompt Color | `#22d3ee` | Light cyan |
| Command Text | `#f0f6fc` | Near-white |
| Output Text | `#c9d1d9` | Muted gray |
| Success | `#3fb950` | GitHub green |
| Error | `#f85149` | GitHub red |
| Tool Badge | `#1f6feb` | Blue |

**Visual Features**:
- Clean, minimal design
- GitHub-inspired aesthetics
- Squared corners (8px)
- No glow effects

### Gemini CLI

**Source**: Google's Gemini CLI

| Element | Value | Notes |
|---------|-------|-------|
| Background | `#1e1e2e` | Dark slate |
| Chrome/Header | `#313244` | Slate gray |
| Primary Accent | `#8ab4f8` | Google Blue light |
| Secondary Accent | `#4285f4` | Google Blue |
| Prompt Character | `>` | Simple arrow |
| Prompt Color | `#8ab4f8` | Light blue |
| Command Text | `#e8eaed` | Light gray |
| Output Text | `#bdc1c6` | Muted |
| Success | `#81c995` | Soft green |
| Error | `#f28b82` | Soft red |
| Tool Badge | `#669df6` | Mid blue |

**Visual Features**:
- Material Design influence
- Medium rounded corners (12px)
- Subtle shadows
- Clean typography

---

## 2. Color Palette (Design Tokens)

### Brand Colors

```typescript
export const colors = {
  // Backgrounds (shared across all themes)
  background: {
    primary: "#0f0f23",     // Main canvas - deep blue-black
    secondary: "#1a1a3e",   // Secondary surfaces
    tertiary: "#2d2d5f",    // Tertiary/elevated surfaces
  },

  // Primary accent (indigo - MCP brand)
  accent: {
    primary: "#6366f1",     // Main brand color
    light: "#a5b4fc",       // Light variant
    mid: "#818cf8",         // Mid variant
    dark: "#4f46e5",        // Dark variant
  },

  // Status colors (semantic)
  status: {
    pass: "#22c55e",        // Success/pass
    fail: "#ef4444",        // Error/fail
    warning: "#f59e0b",     // Warning
    info: "#06b6d4",        // Info
  },

  // Text hierarchy
  text: {
    primary: "#f8fafc",     // Headlines, primary content
    secondary: "#cbd5e1",   // Descriptions, secondary
    muted: "#64748b",       // Disabled, tertiary
    inverse: "#0f172a",     // Text on light backgrounds
  },

  // Overlays and borders
  overlay: {
    light: "rgba(248, 250, 252, 0.06)",
    medium: "rgba(248, 250, 252, 0.12)",
    strong: "rgba(248, 250, 252, 0.24)",
  },

  // Terminal-specific (updated for accuracy)
  terminal: {
    claude: {
      bg: "#1a1625",
      chrome: "#2d2640",
      accent: "#a855f7",
      prompt: "#c084fc",
      text: "#f8fafc",
      output: "#e2e8f0",
    },
    opencode: {
      bg: "#0d1117",
      chrome: "#161b22",
      accent: "#06b6d4",
      prompt: "#22d3ee",
      text: "#f0f6fc",
      output: "#c9d1d9",
    },
    gemini: {
      bg: "#1e1e2e",
      chrome: "#313244",
      accent: "#8ab4f8",
      prompt: "#4285f4",
      text: "#e8eaed",
      output: "#bdc1c6",
    },
  },
};
```

---

## 3. Typography

### Font Stack

| Role | Font | Fallback |
|------|------|----------|
| Display | Space Grotesk | system-ui |
| Body | Space Grotesk | system-ui |
| Mono | JetBrains Mono | Consolas, monospace |

### Size Scale (8px baseline)

| Token | Size | Use Case |
|-------|------|----------|
| xs | 12px | Labels, badges |
| sm | 16px | Body small, terminal |
| md | 20px | Body default |
| lg | 24px | Subheadings |
| xl | 32px | Section titles |
| 2xl | 40px | Large titles |
| 3xl | 48px | Feature titles |
| 4xl | 56px | Hero subtitles |
| 5xl | 72px | Hero titles |
| 6xl | 88px | Display titles |

### Weights

| Token | Weight | Use |
|-------|--------|-----|
| regular | 400 | Body text |
| medium | 500 | Emphasis |
| semibold | 600 | Subheadings |
| bold | 700 | Headlines |

---

## 4. Animation Timing

### Duration Presets (at 30fps)

| Token | Frames | Seconds | Use Case |
|-------|--------|---------|----------|
| instant | 0 | 0s | No animation |
| fast | 12 | 0.4s | Micro-interactions, badges |
| normal | 30 | 1.0s | Standard transitions |
| slow | 45 | 1.5s | Emphasis, reveals |
| dramatic | 60 | 2.0s | Hero animations |

### Stagger Delays

| Token | Frames | Use Case |
|-------|--------|----------|
| tight | 8 | Dense lists |
| base | 15 | Standard lists |
| relaxed | 24 | Spaced items |

### Spring Presets

```typescript
export const springs = {
  // Smooth, subtle - good for scale/opacity
  soft: { damping: 200, stiffness: 100 },

  // Responsive, precise - good for position
  snappy: { damping: 18, stiffness: 220 },

  // Playful bounce - good for emphasis
  bounce: { damping: 12, stiffness: 180 },

  // Elastic overshoot - good for attention
  elastic: { damping: 8, stiffness: 150 },
};
```

### Easing Curves

- **Fade in/out**: Linear with clamp
- **Slide**: Ease-out (decelerate)
- **Scale**: Spring with soft config
- **Emphasis**: Spring with bounce config

---

## 5. Composition Scripts

### 5.1 HeroIntro (10s)

**Purpose**: Brand introduction, feature overview

| Time | Scene | Visual | Audio Cue |
|------|-------|--------|-----------|
| 0-3s | Title reveal | "Claude Prompts MCP" fades in with glow | Whoosh |
| 3-5s | Tagline | "Prompt Engineering at Scale" slides up | Subtle chime |
| 5-10s | Features | 4 cards stagger in (2x2 grid) | Soft ticks |

**Feature Cards**:
1. **Chains** — "Orchestrate multi-step prompts"
2. **Gates** — "Quality validation built-in"
3. **Frameworks** — "Structured reasoning modes"
4. **Operators** — "Symbolic shorthand syntax"

### 5.2 SymbolicSyntax (15s)

**Purpose**: Show the power of symbolic operators vs verbose JSON

| Time | Scene | Visual |
|------|-------|--------|
| 0-4s | Problem | JSON config block (warning accent) |
| 4-8s | Solution | Terminal typing symbolic command |
| 8-15s | Breakdown | 4 operator cards explaining each |

**Command to show**:
```
>>research --> >>analyze --> >>report @CAGEERF :: 'cite sources' #analytical
```

**Operator Breakdown**:
| Operator | Label | Description |
|----------|-------|-------------|
| `-->` | Chain | Sequential step execution |
| `@CAGEERF` | Framework | Apply methodology |
| `::` | Gate | Quality criteria |
| `#analytical` | Style | Response formatting |

### 5.3 ChainFlow (20s)

**Purpose**: Visualize multi-step chain execution with state persistence

| Time | Scene | Visual |
|------|-------|--------|
| 0-3s | Input | Terminal (OpenCode) typing `>>research_chain` |
| 3-8s | Step 1 | Parse → active, others dim |
| 8-13s | Step 2 | Resolve → active, Parse complete |
| 13-18s | Step 3 | Execute → active, flow complete |
| 18-20s | Persist | "Session state saved" badge |

**Flow Steps**:
1. **Parse** — "Decode the command"
2. **Resolve** — "Fetch prompt assets"
3. **Execute** — "Run the step"

### 5.4 GateSystem (15s)

**Purpose**: Show quality validation with pass/fail states

| Time | Scene | Visual |
|------|-------|--------|
| 0-3s | Output | LLM response streaming in |
| 3-10s | Validation | Criteria checking one by one |
| 10-13s | Fail state | Red X on "Token limit" criterion |
| 13-15s | Retry hint | "Improve: Reduce verbosity" badge |

**Criteria to check**:
1. ✅ "Follows template structure"
2. ✅ "Required fields present"
3. ✅ "No sensitive data exposed"
4. ❌ "Response under token limit"

### 5.5 FrameworkInjection (15s)

**Purpose**: Before/after comparison of framework guidance

| Time | Scene | Visual |
|------|-------|--------|
| 0-5s | Without | Messy, unstructured output panel |
| 5-10s | With | Clean, phased output with CAGEERF |
| 10-15s | Side-by-side | Both panels visible, comparison |

**Without Framework** (messy output):
```
Here's what I think about the topic...
There are several considerations...
In conclusion...
```

**With @CAGEERF** (structured output):
```
## Context
[Defined scope]

## Analysis
[Systematic breakdown]

## Goals
[Clear objectives]
```

### 5.6 TerminalDemo (20s)

**Purpose**: Full workflow showing tool call → response → validation

| Time | Scene | Visual |
|------|-------|--------|
| 0-8s | Tool call | Terminal (Claude) typing `prompt_engine(...)` |
| 8-15s | Response | Streaming response appearing |
| 15-20s | Validation | Gate criteria with badges |

**Tool call**:
```
prompt_engine(command:">>audit @CAGEERF")
```

**Response** (streaming):
```
Audit report ready.
- Security checks complete
- Gates validated
- Recommendations prepared
```

**Validation** (bottom bar):
- ✅ Security review — PASS
- ✅ Formatting review — PASS
- Badge: "Gate Review Complete"

---

## 6. Terminal Component Specification

### Line Types

The Terminal should distinguish between:

1. **Command line** — User input with prompt character
2. **Output line** — System response (no prompt)
3. **Tool call line** — MCP tool invocation (badge style)
4. **Error line** — Error output (red accent)

### Props

```typescript
type TerminalLine =
  | { type: 'command'; text: string }
  | { type: 'output'; text: string }
  | { type: 'tool'; name: string; args?: string }
  | { type: 'error'; text: string };

type TerminalProps = {
  variant: 'claude-code' | 'opencode' | 'gemini';
  title?: string;
  lines: TerminalLine[];
  typing?: {
    enabled: boolean;
    charsPerSecond: number;
    startFrame: number;
  };
  cursor?: {
    visible: boolean;
    blinkRate?: number; // frames per blink cycle
  };
};
```

### Visual Structure

```
┌─────────────────────────────────────┐
│ ● ● ●                    [title]    │  ← Chrome bar
├─────────────────────────────────────┤
│                                     │
│ ❯ command text here                 │  ← Command line
│   output line here                  │  ← Output line
│   more output                       │
│                                     │
│ ❯ ▋                                 │  ← Cursor (blinking)
│                                     │
└─────────────────────────────────────┘
│██████████░░░░░░░░░░░░░░░░░░░░░░░░░░│  ← Accent bar (gradient)
```

---

## 7. Component Checklist

### Core Components

- [ ] **AnimatedText** — Fade, slide, glow options
- [ ] **Panel** — Consistent container styling
- [ ] **StatusBadge** — Pass/fail/warning with spring
- [ ] **StaggeredList** — Auto-stagger children
- [ ] **ProgressDots** — Step indicators

### Domain Components

- [ ] **Terminal** — Multi-variant with line types
- [ ] **FlowStep** — Pipeline step visualization
- [ ] **FlowConnector** — Animated arrow between steps
- [ ] **CodeBlock** — Syntax-highlighted code
- [ ] **GateCriterion** — Single validation check
- [ ] **FrameworkBadge** — @CAGEERF style badge
- [ ] **OperatorHighlight** — Syntax colorization

---

## 8. File Deliverables

After implementation, verify these work:

```bash
# All compositions render
npm run studio  # Preview at localhost:3000

# Individual renders
npm run render HeroIntro out/hero-intro.mp4
npm run render SymbolicSyntax out/symbolic-syntax.mp4
npm run render ChainFlow out/chain-flow.mp4
npm run render GateSystem out/gate-system.mp4
npm run render FrameworkInjection out/framework-injection.mp4
npm run render TerminalDemo out/terminal-demo.mp4

# Full batch
npm run render:all
```
