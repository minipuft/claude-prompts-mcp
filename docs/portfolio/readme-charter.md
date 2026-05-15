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

| Constraint                        | Limit       | Rationale                                |
| --------------------------------- | ----------- | ---------------------------------------- |
| Total file length                 | ≤ 400 lines | Above this, no one reads to the bottom   |
| Tagline → Quick Start             | ≤ 30 lines  | Pitch must precede plumbing              |
| Tagline → "What You Get"          | ≤ 80 lines  | Install plumbing can't dominate          |
| Per-section length                | ≤ 100 lines | Forces decomposition                     |
| `<details>` blocks above the fold | ≤ 4         | More than this signals hidden complexity |
| `> [!TIP]` callouts (total)       | ≤ 4         | "See the X Guide" fatigue otherwise      |

A PR exceeding any limit must justify the exception in the charter, not in the PR description.

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
