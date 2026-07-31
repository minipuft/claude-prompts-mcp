# Claude Prompts MCP — Tutorial Video Script

> **Duration**: 90 seconds (2700 frames @ 30fps)
> **Format**: Screen recording style with terminal animations
> **Tone**: Educational, clear, developer-focused
> **Audience**: Developers using Claude Code, Claude Desktop, or other MCP clients

---

## Core Concept: MCP Server Flow

**Critical**: This is an MCP server. Claude (the client) calls our tools, we return prepared prompts, Claude generates responses.

```
User Command          MCP Server              Claude (Client)
     │                    │                        │
     ▼                    │                        │
>>code-review ──────────▶ │                        │
     │        prompt_engine(...)                   │
     │                    │                        │
     │                    ▼                        │
     │           Prepare template                  │
     │           "Review {file}..."                │
     │                    │                        │
     │        ◀────────── │ (return template)      │
     │                    │                        │
     │                    │ ──────────────────────▶│
     │                    │                        ▼
     │                    │              Generate response
     │                    │              based on template
     │                    │                        │
◀────────────────────────────────────────────────── │
          (Claude's response shown to user)
```

**Visual indicators in terminal**:

- `TOOL` badge = MCP tool call
- `← italic text` = MCP server return value
- `⚡ CLAUDE` badge = Claude's generated response

---

## Narrative Arc

```
What is MCP → Basic Execution → Chained Workflows → Structured Thinking → Quality Control → Full Power
```

---

## Section 1: Introduction (0:00–0:08)

**Goal**: Establish what this tool is and who it's for.

### Visual

- Dark background with subtle particle drift
- "Claude Prompts MCP" assembles from fragments (CoalesceText)
- Subtitle fades in: "Template automation for Claude"

### Terminal Content

```text
❯ >>help
TOOL prompt_engine(>>help)
← Prompt template prepared

⚡ CLAUDE Claude Prompts MCP - Template automation for Claude

Core tools:
  prompt_engine    Execute prompts and chains
  resource_manager Create, update, delete prompts
  system_control   Configure frameworks and gates
```

### Narration (text overlay or future voiceover)

> "Claude Prompts MCP lets you build reusable prompt templates with chains, quality gates, and structured reasoning — all hot-reloadable."

---

## Section 2: Basic Usage (0:08–0:25)

**Goal**: Show the simplest use case — running a prompt.

### Visual

- Section title: "Basic Usage"
- Subtitle: "Execute prompts with >> prefix"
- Operator badge appears: `>>` = "Prompt Prefix"

### Terminal Content

```text
❯ >>code-review file:"src/api.ts"
TOOL prompt_engine(>>code-review)
← Template: "Review {file} for issues..."

⚡ CLAUDE Reviewing src/api.ts...

✓ No critical issues found
  - Consider adding error handling at line 42
  - Missing JSDoc for exported function
```

### Key Points

- `>>prompt_id` triggers Claude to call our MCP tool
- MCP server returns the prepared prompt template
- **Claude generates the actual response** based on the template
- Arguments passed as `key:"value"` pairs (interpolated into template)

### Hint (bottom of screen)

> "Arguments are passed as key:\"value\" pairs"

---

## Section 3: Chaining Prompts (0:25–0:45)

**Goal**: Demonstrate multi-step workflows with context passing.

### Visual

- Section title: "Chaining Prompts"
- Subtitle: "Connect prompts for multi-step workflows"
- Operator badge: `-->` = "Chain Operator"
- Visual chain diagram: `analyze → plan → implement`

### Terminal Content

```text
❯ >>analyze --> >>plan --> >>implement
TOOL prompt_engine(chain: 3 steps)
← Step 1: analyze template prepared

[Step 1/3]
⚡ CLAUDE Analysis: Found 3 modules, 2 need refactoring...
✓ Analysis complete → context passed to step 2

← Step 2: plan template + step 1 context
[Step 2/3]
⚡ CLAUDE Plan: 1) Extract shared logic 2) Add tests...
✓ Plan ready for review
```

### Key Points

- `-->` chains prompts, passing context between steps
- MCP server prepares each step's template
- **Claude generates each step's response**
- Previous step's output flows as context to next step
- Chain state persists — resume if interrupted

### Visual Enhancement

Three membrane boxes showing step progression:

- `analyze` (liquescent/complete) — Claude finished this step
- `plan` (awakening/in-progress) — Claude working on this
- `implement` (dormant/pending) — Waiting for previous steps

---

## Section 4: Frameworks (0:45–1:00)

**Goal**: Show how frameworks structure Claude's thinking.

### Visual

- Section title: "Frameworks"
- Subtitle: "Apply structured frameworks to prompts"
- Operator badge: `@` = "Framework Operator"

### Terminal Content

```text
❯ >>research @CAGEERF topic:"API design"
TOOL prompt_engine(>>research @CAGEERF)
← Template + CAGEERF framework injected

⚡ CLAUDE Following CAGEERF framework for API design:

  [C] Context: REST vs GraphQL trade-offs
  [A] Analysis: GraphQL fits data relationships
  [G] Goals: Type-safe, efficient queries
  [E] Execution: Schema-first approach...
```

### Key Points

- `@FRAMEWORK` tells MCP server to inject framework guidance
- MCP server adds framework instructions to the prompt template
- **Claude follows the framework** in its response
- Structures Claude's reasoning without changing the prompt definition
- Can combine with chains: `@CAGEERF >>analyze --> >>implement`

### Future Enhancement

Show CAGEERF phases as visual indicators (FrameworkField component)

---

## Section 5: Quality Gates (1:00–1:15)

**Goal**: Demonstrate output validation.

### Visual

- Section title: "Quality Gates"
- Subtitle: "Validate outputs against quality criteria"
- Operator badge: `::` = "Gate Operator"

### Terminal Content

```text
❯ >>refactor :: 'no breaking changes'
TOOL prompt_engine(>>refactor :: 'no breaking...')
← Template + gate criteria attached

⚡ CLAUDE Refactoring auth module...
  Extracting validateToken() to utils/
  Updating import paths...

← Validating response against gate...
✓ GATE PASS: No breaking changes
  Signature compatibility: maintained
```

### Key Points

- `::` attaches quality criteria to the prompt
- Claude generates its response normally
- **MCP server validates Claude's response** against criteria
- Failed gates can trigger retry or pause for review
- Named gates: `:: code-quality` (predefined in server)
- Inline gates: `:: 'your criteria here'`

### Severity Levels (optional callout)

- Critical/High: Must pass (blocking)
- Medium/Low: Warns, continues (advisory)

---

## Section 6: Putting It Together (1:15–1:30)

**Goal**: Show the full power of combined operators.

### Visual

- Section title: "Complete Example"
- Subtitle: "Combine operators for powerful workflows"
- All operator badges displayed together

### Terminal Content

```text
❯ >>analyze @CAGEERF --> >>implement :: code-quality
TOOL prompt_engine(chain + framework + gate)

← Step 1: analyze + CAGEERF framework
[1/2]
⚡ CLAUDE [C] Context: Auth module complexity...
✓ Analysis complete → context to step 2

← Step 2: implement + code-quality gate
[2/2]
⚡ CLAUDE Implementing: Extract, test, refactor...
← Validating against code-quality...
✓ GATE PASS: All criteria satisfied
```

### Syntax Breakdown (visual callout)

```text
>>analyze      MCP prepares 'analyze' template
@CAGEERF       MCP injects framework guidance
-->            Chain: pass context to next step
>>implement    MCP prepares 'implement' template
:: code-quality  MCP validates Claude's response
```

### The Flow (MCP Server + Claude Client)

```
User writes symbolic command
       ↓
MCP Server parses operators
       ↓
MCP Server prepares templates + metadata
       ↓
Claude generates responses step by step
       ↓
MCP Server validates against gates
       ↓
User sees structured, validated output
```

### Closing Message

> "Start building with Claude Prompts MCP"
> `npm install claude-prompts`

---

## Visual Language

### Color Semantics (from Liquescent theme)

| State      | Color      | Meaning                  |
| ---------- | ---------- | ------------------------ |
| dormant    | Cyan       | Idle, waiting            |
| awakening  | Amber      | Processing, active       |
| liquescent | Chartreuse | Complete, success        |
| error      | Coral      | Failed, attention needed |

### Typography

- Section titles: System UI, 42px, semibold
- Terminal content: JetBrains Mono, 13px
- Operator badges: Monospace, amber highlight
- Hints: System UI, 14px, tertiary color

### Animation Principles

- Liquid fade-ins (spring-based, no CSS transitions)
- Breathing effects on active elements
- Typing effect for terminal commands (25-40 chars/sec)
- Subtle particle drift in background

---

## Technical Notes

### Frame Budget (30fps)

| Section    | Frames   | Seconds |
| ---------- | -------- | ------- |
| Intro      | 240      | 8s      |
| Basic      | 510      | 17s     |
| Chains     | 600      | 20s     |
| Frameworks | 450      | 15s     |
| Gates      | 450      | 15s     |
| Combined   | 450      | 15s     |
| **Total**  | **2700** | **90s** |

### Typing Speed

- Commands: 25-30 chars/sec (deliberate, readable)
- Output: 40 chars/sec (faster, less focus)
- Pause 0.5-1s after each completed line

### Terminal Styling

- Chrome bar with traffic lights (Liquescent colors)
- State-aware accent bar at bottom
- Monospace font with syntax highlighting
- Cursor blink rate: 25 frames (organic)

### Terminal Line Types (MCP Flow)

| Line Type    | Visual                    | Purpose                                  |
| ------------ | ------------------------- | ---------------------------------------- |
| `command`    | `❯ >>prompt`              | User input                               |
| `tool`       | `TOOL prompt_engine(...)` | MCP tool call (amber badge)              |
| `mcp-return` | `← italic text`           | MCP server return value                  |
| `assistant`  | `⚡ CLAUDE text`          | Claude's generated response (cyan badge) |
| `output`     | `  indented text`         | General output                           |
| `success`    | `✓ text`                  | Success message (chartreuse)             |
| `error`      | `text`                    | Error message (coral)                    |

This clearly shows the MCP server/client relationship:

1. User writes command → `command`
2. Claude calls MCP tool → `tool`
3. MCP server returns template → `mcp-return`
4. Claude generates response → `assistant`
5. MCP validates (if gates) → `mcp-return` + `success`/`error`

---

## Future Enhancements

### Potential Additional Sections

1. **Verification Gates (Ralph Loops)** — `:: verify:"npm test" loop:true`
2. **Version History** — `resource_manager(action:"history")`
3. **Checkpoints** — `resource_manager(resource_type:"checkpoint")`
4. **Judge Selection** — `%judge` modifier

### Audio/Voiceover

If adding narration:

- Professional, calm tone
- ~120 words per minute
- Sync with terminal animations
- Music: Ambient, minimal, non-distracting

### Localization

- Subtitles in multiple languages
- Separate audio tracks
- Adjust typing speed for readability

---

## Render Commands

```bash
# Preview in studio
cd remotion && npx remotion studio

# Render full video
npx remotion render src/index.ts Tutorial --output=out/tutorial.mp4

# Render at higher quality
npx remotion render src/index.ts Tutorial --output=out/tutorial.mp4 --codec=h264 --crf=18

# Render specific section (for testing)
npx remotion render src/index.ts Tutorial --output=out/test.mp4 --frames=0-240
```

---

## Changelog

| Version | Date       | Changes                                           |
| ------- | ---------- | ------------------------------------------------- |
| 1.0     | 2025-01-26 | Initial script based on cleanup and README review |
