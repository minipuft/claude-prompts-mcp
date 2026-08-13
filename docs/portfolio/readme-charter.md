# README Charter

The constitution `README.md` is reviewed against. Changes that violate the charter fail review. Charter amendments go through their own PR.

## 1. Purpose

The README's job is **acquisition + activation**, not retention. A reader arriving for the first time should be able to answer in 30 seconds:

1. What problem this solves.
2. Whether it solves theirs.
3. What "trying it" looks like in one concrete command.

Retention (deep how-to, reference, concepts) lives in `docs/` under the Diátaxis split. The README points there; it does not duplicate.

## 2. Audience (priority order)

| Persona                                    | Their question                                | First thing they should see                                   |
| ------------------------------------------ | --------------------------------------------- | ------------------------------------------------------------- |
| MCP-aware developer evaluating servers     | "Is this different from what I already have?" | Pitch table — "what your client gives you vs. what this adds" |
| Existing prompt-writer wanting reusability | "Can I version and share my prompts?"         | Prompt templates + skills export                              |
| Team lead distributing workflows           | "How do teammates get my prompts?"            | Skills export to native client format                         |
| Curious newcomer                           | "What is this category of tool?"              | One-paragraph framing + "Is this for me?" filter              |

**Out of scope readers**: people writing their own MCP server, people debugging Claude Code internals. They get `CONTRIBUTING.md` and `docs/architecture/`, not the README.

## 3. Reader Journey

Section order follows the reader's question progression:

```
"is this for me?"        → Pitch table + "Is this for me?" filter
"show me it works"       → Hero demo + Quick Start (2 clients)
"what are the parts?"    → The Four Primitives
"how do they combine?"   → Compose Workflows
"how does it work?"      → How It Works diagram
"where do I go next?"    → Documentation index (Diátaxis quadrants)
```

A reader should be able to stop at any point and feel they got value; sections are self-contained.

## 4. Budgets (hard limits)

| Constraint                        | Limit       | Rationale                                                        |
| --------------------------------- | ----------- | ---------------------------------------------------------------- |
| Total file length                 | ≤ 400 lines | Above this, no one reads to the bottom                           |
| Tagline → Quick Start             | ≤ 40 lines  | Pitch must precede plumbing                                      |
| Per-section length                | ≤ 100 lines | Forces decomposition; also caps how much install plumbing weighs |
| `<details>` blocks above the fold | ≤ 4         | More than this signals hidden complexity                         |
| `> [!TIP]` callouts (total)       | ≤ 4         | "See the X Guide" fatigue otherwise                              |

A PR exceeding any limit must justify the exception in the charter, not in the PR description.

**Amended 2026-08-04.** Tagline → Quick Start was ≤ 30; raised to 40 because the hero legitimately grew by a charter-serving block — the one-click VS Code/Cursor install buttons in the badge row (the strongest adoption-correlated pattern in a survey of seven high-adoption MCP server READMEs) — while the pitch region already carries the six-row comparison table and the "Is this for me?" filter. The former "Tagline → What You Get ≤ 80" row was removed as unsatisfiable: §3 requires two clients in the Quick Start main flow, which alone measures ~130 lines from the tagline, so the budget failed from the day it was written. Pitch-before-plumbing is guaranteed by the ≤ 40 row; plumbing size is bounded by the per-section limit. Both are now enforced mechanically by `validate:readme` — before this amendment the validator checked only total length, forbidden words, Diátaxis markers, and links, which is how a 59-line tagline→Quick Start distance shipped green.

## 5. Voice

Technical, direct, evidence-led.

| Use                                             | Don't use                                          |
| ----------------------------------------------- | -------------------------------------------------- |
| Active verbs ("compose", "execute", "validate") | Passive ("is composed", "is executed")             |
| Concrete nouns ("operator", "template", "gate") | Abstract ("solution", "ecosystem", "platform")     |
| Measured claims ("90 prompts", "4 primitives")  | Unmeasured ("powerful", "comprehensive", "robust") |
| Show code, then explain                         | Explain, then maybe show code                      |
| Honest scope ("doesn't do X")                   | Aspirational scope ("can do anything")             |
| Second person sparingly ("you compose…")        | First-person plural ("we believe…")                |

**Forbidden words**: `seamlessly`, `revolutionary`, `powerful`, `robust`, `comprehensive`, `cutting-edge`, `delight`, `unleash`, `next-generation`, `simply`, `just`, `effortless`, `magical`. Each signals marketing copy and erodes trust with developer readers.

**Required phrasing patterns**:

- Pitch sentences **contrast**: "X already does A; this adds B" — never "this does B" alone.
- Examples include expected output or behavior, not just commands.
- Section openings name the reader's question, not the feature name.

### Positioning litmus (assistant to the client)

Every section must describe something the server does **for** the client, never **instead of** the client:

| Passes                                        | Fails                                           |
| --------------------------------------------- | ----------------------------------------------- |
| "Author workflows that run on any MCP client" | "A workflow engine that replaces native skills" |
| "Add quality gates to your existing prompts"  | "Our gate system is better than the client's"   |
| "Export templates as client-native skills"    | "Use our template format instead"               |
| "Delegate steps to your client's subagents"   | "Our execution is more powerful"                |

This keeps the positioning one whose value grows **as** clients get more capable, instead of one clients eventually obsolete. It applies to repo metadata (description, listings copy) as much as README prose.

### Canonical positioning and terminology

The client or harness provides execution, tools, agents, working context, memory features, and
native skills. Claude Prompts adds a portable workflow layer around those capabilities: reusable
prompt resources, step sequencing and context transfer, reasoning guidance, validation gates,
version history, rollback, hot reload, and client-native skills export.

Use the following terms consistently:

| Concept                                       | Canonical term                                      | Avoid unless explicitly qualified |
| --------------------------------------------- | --------------------------------------------------- | --------------------------------- |
| Claude Code, Codex, Cursor, and similar hosts | `client` after first naming the client or harness   | body, operating system            |
| A client-provided reusable capability         | `native skill`                                      | Claude Prompts skill              |
| What this server adds                         | `portable workflow layer` or the specific feature   | training, intelligence            |
| Stored prompt and gate definitions            | `versioned resources` or the specific resource type | memory, learning                  |
| Work performed from a rendered prompt         | `the client executes`                               | the server executes               |

Claims that the server trains a model, learns automatically from completed work, supplies general
client memory, executes repository changes, or replaces native skills fail review. When hooks or a
plugin provide behavior beyond MCP-only operation, name that dependency in the claim.

Governance follows one path: this charter defines durable policy, `documentation_change` organizes
the editorial workflow, `readme_improver` drafts, semantic gates review judgment-bearing claims,
and `validate-readme.js` enforces mechanically decidable rules.

## 6. Syntax & Semantic Conventions

### Section headers

- **Nouns** for _what it is_: `The Four Primitives`, `Operator Syntax`.
- **Verbs** for _what you do_: `Compose Workflows`, `Run Anywhere`.
- Never adjectives: not `Powerful Composition`, not `Flexible Workflows`.

### Diátaxis labelling

Each section starts with an HTML comment marker so editors stay honest:

```markdown
<!-- diataxis: how-to -->

## Quick Start
```

Valid markers: `tutorial`, `how-to`, `reference`, `explanation`. A section mixing quadrants must be split.

These labels are maintainer metadata, not product terminology. Keep them inside HTML comments.
Reader-facing headings and navigation describe the task: learn, accomplish a task, look up syntax,
or understand the design. Visible references to Diátaxis in `README.md` fail validation.

### Code blocks

- Show the command + expected shape of output (truncated is fine).
- Use real prompt names from the catalogue, not invented ones.
- Triple-backtick fence with language tag for every block.

### Tables

- Two columns for comparisons.
- Three columns for option matrices.
- No four-column tables — they don't render on narrow screens.

### Cross-links

- Tutorial → Reference (parameter details).
- How-to → Explanation (background).
- Reference → How-to (usage examples).
- Never link across quadrants without an explicit handoff sentence.

### Callouts (`> [!TIP]`, `> [!NOTE]`, etc.)

- Reserve for genuinely non-obvious pointers.
- Maximum 4 across the whole README (budget rule).
- Never use one to repeat a link that already appeared in prose.

## 7. Forbidden Patterns

- Marketing voice (see §5).
- Duplicating `docs/README.md` (the canonical doc index).
- Per-client config blocks in the main flow (collapse all non-primary clients).
- Defining the same primitive in more than one place.
- Tables mixing Diátaxis quadrants without labels.
- Mermaid diagrams without a one-paragraph narrative explaining the takeaway.
- License badge as the only badge (signals pre-launch — add version, downloads, or stars).
- Installation badges without a current official client contract and a live verification. A badge
  that links to instructions says `Set up`; reserve `Install` and `one-click` for links that perform
  that action.

## 8. Success Metrics

A README revision is acceptable when:

1. **30-second test** — A reader who has never seen MCP can state the project's purpose after 30 s.
2. **Acquisition test** — First screen contains the pitch table; install plumbing is below the fold.
3. **Budget test** — All limits in §4 hold.
4. **Voice test** — Zero forbidden words; ≤ 1 unmeasured claim per 100 lines.
5. **Quadrant test** — Every section carries a Diátaxis marker; no section mixes quadrants.
6. **Link test** — Every cross-link points to a section that exists and is the correct quadrant.

Tests 1 and 6 are manual; 2–5 are partially automatable (line counts, forbidden-word grep, marker grep).

## 9. Re-audit Cadence

- **Every README PR** — charter checklist on the PR template.
- **Every minor release** — walkthrough as a first-time user; log violations as issues with label `readme-charter`.
- **Quarterly** — charter itself reviewed: has the audience changed? have priorities shifted?

## 10. Amendment

Charter changes are their own PR. The PR must:

1. State the principle being changed and why.
2. Show 2+ examples where the current charter fails.
3. Update any checklists, tests, or scripts that depend on the changed principle.

Content PRs cannot silently change the charter.

**Amended 2026-08-12.** The positioning litmus rejected direct native-skill replacement claims but
did not define ownership for adjacent claims about training, learning, memory, or execution. It also
required Diátaxis markers without distinguishing hidden editorial metadata from visible reader copy;
the README consequently described its documentation index using the framework name. This amendment
adds a canonical terminology map, explicit client/server boundaries, governance ownership, and the
reader-visible terminology rule. The companion validator change enforces only the last item because
the remaining checks require semantic judgment.

**Amended 2026-08-12 (client setup links).** The hero treated a legacy VS Code redirect and an
undocumented Cursor MCP deeplink as durable one-click installers. The Cursor action failed in live
use, and current official client documentation no longer supports the two links as one shared
pattern. Installation URLs are now external contracts: verify each against current official client
documentation and test the exact link before publishing it. Navigation badges may link to local
Claude Code or Codex instructions, but their label must say `Set up`, not `Install`. This supersedes
the install-link assumption in the 2026-08-04 budget rationale without changing the 40-line budget.
