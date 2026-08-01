# README Narrative — Working Notes

## Evolution (the real story)

The project grew through four phases, each driven by what was missing in the ecosystem:

```
Phase 1: Template Storage
  Problem: No reusable prompts across AI tools
  Solution: YAML prompt templates with hot-reload
  ↓
Phase 2: Workflows & Chains
  Problem: Complex tasks fail as single prompts
  Solution: Multi-step chains with context threading (`-->`)
  ↓
Phase 3: Quality & Composition
  Problem: AI output is unreliable without validation
  Solution: Gates (`::`), methodologies (`@`), operator language for composing these
  ↓
Phase 4: Client Assistant (current)
  Problem: Clients are building their own skills/subagents — the server can't be "the engine"
  Solution: Position as assistant TO the client — delegation (`==>`), skills-sync export,
            complement native capabilities rather than replace them
```

**The key insight**: Clients (Claude Code, Cursor, Gemini, etc.) are increasingly locking down
or releasing workflow capabilities in their own way. The server's role shifted from
"be the engine" to "be a helpful assistant that enhances whatever the client provides."

This means:

- **Skills sync** exports templates INTO client-native formats (not "use our format instead")
- **Delegation (`==>`)** hands work TO client-native subagents (not "run everything through us")
- **Gates/methodologies** add quality layers the client doesn't have (complementary, not competing)
- **The operator language** is a composition tool for BUILDING workflows, not replacing the client's UI

---

## What the Server Adds (not replaces)

The framing isn't "native skills vs. our engine." It's "what the server layers on top."

| What the client gives you   | What the server adds                                                         |
| --------------------------- | ---------------------------------------------------------------------------- |
| Single-shot skills/commands | Multi-step chains that thread context between steps                          |
| Run a prompt                | Compose prompts with quality gates, methodology, and style in one expression |
| Subagent execution          | Workflow-aware handoffs — pass steps to agents mid-chain with full context   |
| Client-native skill format  | Skills sync — author once as YAML, export to any client format               |
| Manual prompt writing       | Versioned templates with hot-reload, rollback, history                       |
| Trust the output            | Gate verification (self-eval + shell commands) between steps                 |

**The relationship**: Client provides the runtime. Server provides the workflow structure.
Not competing — complementing.

---

## Identity

**Author positioning**: AI tooling specialist building open-source developer infrastructure.
TypeScript + MCP protocol expertise. Not claiming "senior architect" — claiming someone who
builds useful things and iterates honestly on the architecture.

**Audience**: Developers who use AI coding tools and want structured, reusable workflows.
Portfolio evaluation is secondary (separate docs for that).

---

## The Three-Layer Model

The README should present these in order. Each layer builds on the previous.

### Layer 1: Resources (THE PRODUCT)

This is what users actually get. The value lives here.

- **Prompt templates** — versioned, hot-reloadable YAML with Nunjucks rendering
- **Quality gates** — criteria the AI self-evaluates against (blocking or advisory)
- **Methodologies** — reasoning frameworks (CAGEERF, ReACT, 5W1H, SCAMPER, FOCUS, Liquescent)
  that shape HOW the AI thinks, not just WHAT it does
- **Styles** — response formatting guidance

These are the building blocks. They exist as files on disk, versioned with history,
hot-reloaded on change. They're the thing you author, iterate on, and share.

**README framing**: "Here's what you get. Prompt templates for structured tasks.
Quality gates that validate output. Reasoning frameworks that guide the AI's approach."

### Layer 2: Operators (THE EXECUTION METHOD)

This is how you compose resources into workflows. The operator syntax wires Layer 1 together.

```
>>template @methodology :: 'gate criteria' --> next_step :: verify:"shell command" ==> agent_step
```

| Symbol | What it does               | Layer 1 resource it activates |
| ------ | -------------------------- | ----------------------------- |
| `>>`   | Execute a template         | Prompt template               |
| `@`    | Inject reasoning framework | Methodology                   |
| `::`   | Add quality criteria       | Gate                          |
| `#`    | Apply formatting           | Style                         |
| `-->`  | Chain to next step         | (orchestration)               |
| `==>`  | Hand off step to an agent  | (agent handoff)               |
| `%`    | Modify behavior            | (execution control)           |

**README framing**: "Compose resources naturally. The operator syntax wires templates,
gates, and methodologies together — chain steps, add quality criteria inline, hand
off steps to agents. It's how you express workflows."

Not "our powerful language" — "the syntax for composing your resources."

### Layer 3: Skills Sync (THE COMPATIBILITY LAYER)

This is how resources reach clients natively.

- `npm run skills:export` compiles YAML templates → client-native formats
- Claude Code skills, Cursor rules, OpenCode commands, etc.
- SHA-256 drift detection — know when exports are stale
- Author once in YAML, distribute everywhere

**README framing**: "Want these workflows as native skills in your client?
Skills Sync exports them. Author in YAML, run as Claude Code skills, Cursor rules, etc."

---

**Why this order matters**: Users need to understand WHAT they're getting (resources)
before they care about HOW to compose them (operators) or WHERE they run (sync).
Leading with operators puts the cart before the horse.
Leading with resources answers "why should I install this?" first.

---

## Narrative Arc for the README

### Lead: Resources First, Then Composition

Open with what you GET, not how the engine works.

Something like:

> Reusable prompt templates, quality gates, and reasoning frameworks for AI coding tools —
> managed through MCP, composable into multi-step workflows, exportable as native client skills.

Or structured as three beats:

> **Author** prompt templates, quality gates, and reasoning methodologies.
> **Compose** them into multi-step workflows with an operator syntax.
> **Export** as native skills to Claude Code, Cursor, OpenCode, and more.

The key word is **"for"** — it serves the client, not replaces it.

### Middle: Layer 1 → Layer 2 → Layer 3

**Section 1: "What You Get" (Resources)**

Show the four resource types with a concrete example each:

| Resource        | What it is                                | Example                                       |
| --------------- | ----------------------------------------- | --------------------------------------------- |
| Prompt template | Versioned, parameterized YAML template    | `>>code_review target:'src/auth/'`            |
| Quality gate    | Criteria the AI validates against         | `:: 'no false positives' :: 'cite sources'`   |
| Methodology     | Reasoning framework injected into prompts | `@CAGEERF` (Context → Analysis → Goals → ...) |
| Style           | Response formatting guidance              | `#analytical`                                 |

Then: "All resources are hot-reloadable, versioned with history, and manageable through
the `resource_manager` tool. Edit a template, test it immediately."

**Section 2: "Compose Workflows" (Operators)**

NOW show the operator language — as the way to wire resources together:

```
>>review target:'src/auth/' @CAGEERF :: 'no false positives'
  --> security_scan :: verify:"npm test"
  --> recommendations :: 'actionable, with code'
  ==> implementation
```

Decompose what happened — but frame it as "the server composed your resources":

1. Loaded the `review` template, resolved arguments
2. Injected CAGEERF methodology (how to reason about the review)
3. Added a quality gate (the AI must self-evaluate against this)
4. Threaded output to the next step in the chain
5. Ran a shell command for ground-truth validation (not just self-eval)
6. Delegated the final step to a client-native subagent

**Section 3: "Run Anywhere" (Skills Sync)**

> Author workflows as YAML templates. Export as native skills to your client.
> `npm run skills:export` compiles to Claude Code skills, Cursor rules, etc.

Brief. The compatibility story speaks for itself.

### End: Get Started

Quick start (keep current multi-client install — it's good).
Then link to docs by user journey:

- "I want to run workflows" → syntax + quick start
- "I want to build workflows" → prompt authoring tutorial
- "I want to understand the system" → architecture docs

---

## Proposed README Structure

```
1. Title + tagline + badges
2. Quick Start (keep — multi-client install is strong)
3. What You Get (Layer 1: resources — templates, gates, methodologies, styles)
4. Compose Workflows (Layer 2: operator syntax wires resources together)
5. Run Anywhere (Layer 3: skills sync + cross-client support)
6. Syntax Reference (keep — compact table)
7. The Three Tools (keep, reframed as "the API surface")
8. How It Works (keep mermaid — may update to show resource → operator → client flow)
9. Documentation links (reframe as user journeys)
10. Contributing (keep)
```

### What stays from current README

- Multi-client installation (well-structured)
- Syntax reference table (compact, useful)
- Mermaid diagram (update to match three-layer model)
- The Three Tools (reframe as API surface)
- Contributing section

### What gets reworked

- **Opening tagline**: feature description → value proposition
- **"What You Get"**: feature list → resources-first showcase
- **Gates/Frameworks/Chains sections**: standalone features → folded into Layer 2 composition
- **Documentation links**: by feature → by user journey

### What gets added

- **"What the Server Adds" table** — complements the client, doesn't compete
- **Skills Sync section** (Layer 3)
- **Delegation mention** in the composition section

### What moves to docs (out of README)

- Detailed configuration table → `docs/reference/`
- MCP Resources section → `docs/reference/mcp-tools.md`
- Checkpoints → `docs/guides/`
- Version history details → `docs/reference/`
- Ralph Loops deep dive → stays linked, details in `docs/guides/ralph-loops.md`

### What gets removed from README

- Evolution phases (goes to `docs/portfolio/` only)
- Excessive config examples

---

## README Convention Audit

Standard structure (from [makeareadme.com](https://www.makeareadme.com/),
[MCP reference servers](https://github.com/modelcontextprotocol/servers)):

| Section              | Convention                                 | Our current README                     | Action                                      |
| -------------------- | ------------------------------------------ | -------------------------------------- | ------------------------------------------- |
| Name + description   | 1-2 sentences, what it does + who it's for | Has tagline but it describes internals | **Rewrite** — outcome-focused               |
| Badges               | Build, version, license                    | Has npm + license                      | Keep                                        |
| Visual               | Screenshot, GIF, or demo                   | Logo only                              | **Add demo GIF or screenshot**              |
| Installation         | Step-by-step per platform                  | Strong — 6 client setups               | Keep (it's a strength)                      |
| Usage                | "Use examples liberally"                   | Has syntax table + examples            | **Rework** — organize around the 3 layers   |
| Features/Description | What makes this different                  | Feature list (disconnected)            | **Rework** — "what the server adds" framing |
| Documentation        | Links to deeper docs                       | Has links but by feature               | **Rework** — by user journey                |
| Contributing         | How to contribute                          | Has it                                 | Keep                                        |
| License              | State it clearly                           | Has it                                 | Keep                                        |

**Key principle from makeareadme**: "Too long is better than too short" — but use
sub-docs for depth rather than cramming everything in the README.

**MCP convention**: Official servers lead with what the server does, then setup per client,
then transport options. Very practical, setup-focused. Our multi-client install already
matches this pattern well.

**What we're missing**:

- A demo visual (GIF > screenshot > nothing)
- A description that explains what the resources DO, not what they ARE

**What we're overdoing**:

- Config details in README (move to docs)
- MCP Resources section (too deep for README)
- Standalone feature sections that should be folded into usage examples

---

## The Enforcement Insight

**The value is NOT "reusable prompts."**

The value is: **define your standards as resources, and the engine enforces them every time.**

When you create a gate, every prompt that uses it gets validated automatically.
When you activate a methodology, every execution gets structured reasoning injected.
When you author a template, the pipeline renders arguments, injects guidance, adds gates,
threads context — all in the right order, every time.

You don't manually enforce quality. You define what quality means (resources),
and the pipeline enforces it (execution).

This is the framing the tagline needs:

- Not: "reusable prompts" (storage)
- Not: "workflow engine" (replaces client)
- But: "define your standards, the server enforces them" (quality through structure)

**Plain language version**: "Write the rules once. Every prompt follows them automatically."

---

## Tagline Candidates

Current: "Hot-reloadable prompts with chains, gates, and structured reasoning for AI assistants."

**Problem with current**: Describes internals, not value. "Hot-reloadable" is a feature.
"Gates" and "structured reasoning" assume the reader knows what those mean in an LLM context.

### Round 1 (positioning)

These were the earlier candidates, pre-enforcement insight:

1. "Structured prompt workflows for AI coding tools. Author once, run anywhere, validate everything."
2. "Turn one-shot prompts into multi-step workflows — with quality gates, reasoning frameworks, and cross-client portability."
3. "Workflow authoring for MCP clients. Templates, chains, gates, and subagent delegation."
4. "The workflow layer your AI coding tool doesn't have yet."

**Chose**: Merge #1 and #4. But "prompt templates, gates, and reasoning frameworks"
assumes preconceived understanding.

### Round 2 (enforcement + plain language) — REJECTED

"The workflow layer for AI coding tools" is a category label, not a reason to install.
"Enforcement" sounds heavy-handed and doesn't describe assembly/composition.

These don't answer: "I have Claude Code with skills and subagents — why install this?"

### Round 3 (the actual pain point)

**The pain**: Every time you ask AI to do something complex, you re-explain your standards
from scratch. What makes a good review. How to reason through the problem. What to check
before moving on. Output quality is inconsistent because there's no structure — just whatever
you remember to type.

**The promise**: Define your standards once — how to reason, what to validate, what steps
to follow. The server assembles them into every prompt automatically. Use through MCP
or export as native skills to any client.

**The "why now"**: Clients have gotten good at running single prompts. But they still
have no way to define reusable quality standards that compose across prompts, chain steps
with context, or validate output before moving on. That's the gap.

---

**Tagline attempts (problem-first, not category-first):**

A. Stop re-explaining your standards to the AI.
Define your prompts with built-in validation and reasoning guidance —
the server assembles them automatically. Use through MCP or export
as native skills to any client.

B. AI coding tools run your prompts. This server makes sure they run well.
Author prompts with built-in output validation, reasoning guidance, and
multi-step structure — use through MCP or export as native skills.

C. Your AI forgets your standards between prompts. This server doesn't.
Define how prompts should reason, what they should validate, and how
steps connect — applied automatically, on any MCP client.

D. Consistent AI output without repeating yourself.
Author prompts with built-in validation and reasoning guidance.
The server assembles them into structured workflows — use through
MCP or export as native skills to any client.

**What these share**:

- Lead with the PROBLEM (re-explaining, inconsistency, forgetting)
- "assembles" not "enforces"
- Dual-path: "use through MCP or export as native skills"
- Plain language throughout

**Tension**: A and C are punchier but might sound confrontational.
B and D are safer but less distinctive. Need to find the balance.

### LOCKED — Final Tagline

**An MCP workflow server.**

Craft reusable prompts with validation and reasoning guidance.
Orchestrate agentic workflows with a composable operator syntax.
Export as native skills.

Three sentences, three layers:

1. Resources (the product): craft prompts with quality + reasoning built in
2. Composition (the method): orchestrate with operators
3. Distribution (the reach): export as native client skills

"An" not "The" — positions as a tool in the ecosystem, not a claim of being definitive.
"MCP workflow server" — says what it is, no audience qualifier to debate.

### LOCKED — Hooks Section

**Placement**: After Quick Start, before the three layers.
**Framing**: Enhancement, not problem-fixing. Specific behaviors, not generic terms.

**Section title**: "With Hooks" or "Client Integration" (TBD during drafting)

**With hooks:**
Route operator syntax to the right tool automatically.
Track workflow progress across steps and long sessions.
Enforce validation rules and step handoffs between agents.

Three sentences, same rhythm as the main tagline (Craft / Orchestrate / Export):

1. Route: `>>syntax` detected in conversation → correct MCP tool call
2. Track: workflow state persists across steps and context compaction
3. Enforce: validation and agent handoffs stay on track even when models drift

Plain enough for someone who's only read the main tagline. "Validation rules"
and "step handoffs between agents" hint at gates and delegation without
requiring prior knowledge — the reader learns what these mean in the layers below.

Available for Claude Code (full), OpenCode (full), Gemini CLI (partial).
Other clients: MCP tools only.

---

## Honest Framing

Things to be honest about (builds credibility):

- "Architecture is actively evolving" — not claiming production-grade maturity
- The trajectory is the story: template storage → chains → quality gates → client assistant
- "Solo project" — one person, which makes the scope more impressive, not less

Things NOT to undersell:

- Cross-client support is genuinely novel in the MCP ecosystem
- The gate/verification system solves a real problem (LLM self-evaluation is unreliable)
- Skills sync is a forward-looking distribution model
- The operator language is a real composition system, not string concatenation

---

## The "Assistant to the Client" Litmus Test

Every section of the README should pass this test:

> Does this describe something the server does FOR the client,
> or something the server does INSTEAD OF the client?

| Passes                                        | Fails                                           |
| --------------------------------------------- | ----------------------------------------------- |
| "Author workflows that run on any MCP client" | "A workflow engine that replaces native skills" |
| "Add quality gates to your existing prompts"  | "Our gate system is better than the client's"   |
| "Export templates as client-native skills"    | "Use our template format instead"               |
| "Delegate steps to your client's subagents"   | "Our execution is more powerful"                |

This test prevents the README from positioning the project as something clients will
eventually make obsolete. Instead it positions as something that makes clients better —
which means its value grows AS clients get more capable.

---

## Resolved Decisions

- [x] **Evolution in README?** — No. Skip entirely. Goes to `docs/portfolio/` only.
- [x] **Operator prominence?** — Layer 2 (composition), not the lead. Resources first.
      Frame as: "the syntax for composing your resources" not "our language."
- [x] **Portfolio?** — Separate `docs/portfolio/`. README is for users.
- [x] **Resources vs operators vs sync?** — Resources ARE the product. Operators are the
      execution method. Skills sync is the compatibility layer. Present in that order.

## Next Steps

1. Draft the new tagline (choose from candidates above)
2. Write the Layer 1 section ("What You Get" — resources showcase)
3. Write the Layer 2 section ("Compose Workflows" — operator decomposition)
4. Write the Layer 3 section ("Run Anywhere" — skills sync)
5. Write the "What the Server Adds" table
6. Reorganize installation + docs sections
7. Trim detail sections → link to docs
8. Review against "assistant to the client" litmus test
