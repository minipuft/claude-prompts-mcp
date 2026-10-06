Write documentation following the **Diátaxis framework** (https://diataxis.fr/).

**Document Type:** {{ doc_type }}
**Context:** {{ context | default("Not specified") }}
**Audience:** {{ audience | default("mixed") }}

{% if previous_step_output %}**Previous Workflow Output:**
{{ previous_step_output }}
{% endif %}
**Input Content:**
{{ content | default("No content provided - generate from context.") }}

---

## Diátaxis Framework Overview

Documentation serves four distinct needs. Each requires different structure, tone, and content:

| Quadrant        | User Need      | Orientation   | Key Question              |
| --------------- | -------------- | ------------- | ------------------------- |
| **Tutorial**    | "Teach me"     | Learning      | "Can you teach me to...?" |
| **How-to**      | "Help me do X" | Task          | "How do I...?"            |
| **Reference**   | "What is X?"   | Information   | "What are the...?"        |
| **Explanation** | "Why does X?"  | Understanding | "Can you explain...?"     |

## {% if doc_type == "tutorial" %}

## Tutorial Guidelines

**Purpose:** Guide learners through a complete learning experience. They should acquire skills, not just complete tasks.

### Structure Requirements

1. **Opening:** State what the learner will accomplish and what they'll learn
2. **Prerequisites:** List required knowledge/tools (keep minimal)
3. **Steps:** Numbered, sequential, each producing visible results
4. **Checkpoints:** "You should now see..." statements after key steps
5. **Conclusion:** Celebrate accomplishment, suggest next steps

### Tone & Language

- Use "we" to establish tutor-learner relationship: "First, we'll create..."
- Be concrete and specific, not abstract
- Show expected output after commands
- Use "Notice that..." to guide observation
- Permit repetition—reinforcement aids learning

### Anti-Patterns (AVOID)

| Don't                      | Why                  | Instead                      |
| -------------------------- | -------------------- | ---------------------------- |
| Explain concepts in detail | Distracts from doing | Link to Explanation docs     |
| Offer choices              | Confuses beginners   | Make decisions for them      |
| Cover edge cases           | Information overload | Stick to the happy path      |
| Use abstract examples      | Harder to follow     | Use real, concrete scenarios |

### Template

```markdown
# Tutorial: [What They'll Build]

In this tutorial, we'll build [concrete outcome]. By the end, you'll know how to [skill 1], [skill 2], and [skill 3].

## Prerequisites

- [Tool/knowledge needed]

## Step 1: [Action]

First, we'll [do thing]:

\`\`\`bash
command here
\`\`\`

You should see:
\`\`\`
expected output
\`\`\`

## Step 2: [Next Action]

...

## Conclusion

You've successfully built [outcome]! You now know how to:

- [Skill 1]
- [Skill 2]

**Next:** Try the [next tutorial] or explore [related how-to].
```

## {% elif doc_type == "howto" %}

## How-to Guide Guidelines

**Purpose:** Help users accomplish a specific task. Assume competence—don't teach, just direct.

### Structure Requirements

1. **Title:** "How to [specific goal]" — must be searchable
2. **Goal statement:** One sentence stating what this achieves
3. **Prerequisites:** What must be true before starting
4. **Steps:** Numbered, action-oriented, minimal explanation
5. **Verification:** How to confirm success
6. **Troubleshooting:** Common issues (optional, brief)

### Tone & Language

- Direct imperatives: "Run X", "Add Y", "Configure Z"
- Conditional instructions: "If you need X, do Y"
- Task-focused, not teaching: assume they know the basics
- Link to Reference for options, Explanation for "why"

### Anti-Patterns (AVOID)

| Don't                     | Why                | Instead                   |
| ------------------------- | ------------------ | ------------------------- |
| Explain why steps work    | Not the goal here  | Link to Explanation       |
| Teach prerequisite skills | That's a Tutorial  | Link to Tutorial          |
| Cover every option        | That's Reference   | Show one working path     |
| Include obvious steps     | Wastes reader time | Skip "open terminal" etc. |

### Template

```markdown
# How to [Specific Goal]

This guide shows you how to [goal]. Use this when [situation].

## Prerequisites

- [Requirement]

## Steps

1. **[Action]**
   \`\`\`bash
   command
   \`\`\`

2. **[Action]**
   \`\`\`bash
   command
   \`\`\`

3. **Verify**
   \`\`\`bash
   verification command
   \`\`\`
   Expected: [output]

## Troubleshooting

**Issue:** [Common problem]
**Fix:** [Solution]

## See Also

- [Related how-to]
- [Deeper explanation]
```

## {% elif doc_type == "reference" %}

## Reference Documentation Guidelines

**Purpose:** Provide complete, accurate technical information for lookup. Not for reading—for consulting.

### Structure Requirements

1. **Mirror the product:** Structure docs like the software structure
2. **Consistent format:** Every entry follows the same pattern
3. **Complete coverage:** Document everything, no gaps
4. **Alphabetical/logical ordering:** Easy to scan and find
5. **Cross-references:** Link related items

### Tone & Language

- **Austere and precise:** No marketing, no opinion
- **Factual statements:** "X does Y" not "X can help you Y"
- **Exhaustive:** List all options, parameters, return values
- **Neutral:** No recommendations (that's How-to territory)

### Anti-Patterns (AVOID)

| Don't                     | Why                | Instead              |
| ------------------------- | ------------------ | -------------------- |
| Add instructional content | Not the purpose    | Link to How-to       |
| Explain design decisions  | That's Explanation | Link to Explanation  |
| Use inconsistent formats  | Hard to scan       | Standardize patterns |
| Include tutorials         | Wrong quadrant     | Link to Tutorials    |

### Template

```markdown
# [Component/API] Reference

## Overview

Brief factual description of what this is.

## [Category 1]

### `item_name`

**Type:** `string`
**Default:** `"value"`
**Required:** Yes/No

Description of what it does.

**Options:**

| Value | Description |
| ----- | ----------- |
| `a`   | Does X      |
| `b`   | Does Y      |

**Example:**
\`\`\`
code example
\`\`\`

### `another_item`

...

## See Also

- [Related reference]
```

## {% elif doc_type == "explanation" %}

## Explanation Documentation Guidelines

**Purpose:** Build understanding through discussion of concepts, history, and design decisions. The "why" behind the "what."

### Structure Requirements

1. **Topic scope:** Define clear boundaries—what's included/excluded
2. **Context first:** Historical background, problem space
3. **Concepts:** Define and relate key ideas
4. **Design decisions:** Why things are the way they are
5. **Alternatives:** What other approaches exist and trade-offs
6. **Connections:** How this relates to other concepts

### Tone & Language

- **Conversational:** "The reason for X is..."
- **Balanced:** "Some prefer Y, but Z has advantages when..."
- **Analogical:** "Think of it like..."
- **Reflective:** Invite deeper thinking, not just acceptance

### Anti-Patterns (AVOID)

| Don't                             | Why                      | Instead                  |
| --------------------------------- | ------------------------ | ------------------------ |
| Include step-by-step instructions | That's How-to            | Link to How-to           |
| Document every parameter          | That's Reference         | Link to Reference        |
| Endless scope creep               | Loses focus              | Use "About X" framing    |
| Fragment across docs              | Reduces connection power | Consolidate explanations |

### Template

```markdown
# About [Topic]

## Overview

What this topic covers and why it matters.

## Background

How we got here. Historical context, problem evolution.

## Core Concepts

### [Concept 1]

Explanation with context and reasoning.

### [Concept 2]

How it relates to Concept 1.

## Design Decisions

### Why [Decision]?

The reasoning, alternatives considered, trade-offs made.

## Alternatives and Trade-offs

| Approach    | Pros | Cons |
| ----------- | ---- | ---- |
| Current     | X    | Y    |
| Alternative | A    | B    |

## Further Reading

- [Related explanation]
- [External resource]
```

## {% elif doc_type == "readme" %}

## README Guidelines (Hybrid Document)

**Purpose:** READMEs are hybrid documents combining elements from multiple quadrants. They serve as entry points that route users to detailed documentation.

### Required Sections (makeareadme.com)

| Section             | Required    | Purpose                                                     |
| ------------------- | ----------- | ----------------------------------------------------------- |
| Name + tagline      | Yes         | What is this? One sentence.                                 |
| Badges              | Yes         | Version, license, build status — credibility signals        |
| Visual              | Recommended | GIF > screenshot > code block > nothing                     |
| Quick Start         | Yes         | Install + first use in <2 minutes                           |
| Usage / Features    | Yes         | Show don't describe — real examples, progressive complexity |
| Documentation links | Yes         | Route to Tutorials, How-tos, Reference, Explanation         |
| Contributing        | Yes         | How to contribute (or link to CONTRIBUTING.md)              |
| License             | Yes         | License name + link                                         |

### Structure Requirements

1. **Hook:** One sentence—what is this? (Explanation-style)
2. **Value prop:** Why should I care? Problem → Solution (Explanation-style)
3. **Quick Start:** Get running in <2 minutes (How-to-style)
4. **Features:** What it does, with real examples (Reference-style)
5. **Documentation links:** Route to deeper docs

### Description Standards

- **Outcomes over internals:** "Validate output between steps" not "23-stage execution pipeline"
- **Plain language:** "validation rules" not "gates", "reasoning guidance" not internal framework jargon — define jargon on first use
- **No generic labels:** "MCP workflow server" not "powerful tool for AI workflows"
- **Active voice:** "Hot-reloads instantly" not "Can be hot-reloaded"
- **Concrete examples:** Real commands, real output

### Progressive Disclosure — Use Callouts Sparingly

GitHub `> [!TIP]` callouts CAN route readers to deeper docs, but they read as SEO padding when repeated (validated by reader testing: a README with 9 TIP callouts scored worse than the same README with 0, links folded into prose). Rules:

- Prefer folding the link into the sentence that motivates it: "Failed gate checks can retry automatically ([Gates Guide](docs/guides/gates.md))."
- Budget: at most 2-4 callouts in an entire README, each earning its visual weight.
- Never use a callout where a prose link reads naturally.

### Quick Start: Multi-Client Pattern (github-mcp-server pattern)

For projects supporting multiple clients/platforms:

1. **Primary client inline** — full install + first use, not collapsed
2. **Secondary clients in `<details>`** — one collapsed section per client
3. **Setup badges** may navigate to client instructions; label a badge `Install` or `one-click` only when the exact action has current official documentation and a successful live check
4. **Link to dedicated plugins** rather than inlining full setup for clients with their own repos

```markdown
<details>
<summary><strong>VS Code / Copilot</strong></summary>

[![Set up Client](https://img.shields.io/badge/Client-Setup-555?style=flat-square)](#client-setup)

The badge navigates to tested setup instructions:
...
</details>
```

Installation-link evidence:

- Treat client installation URLs as unstable external contracts, not reusable project constants.
- Before generating an installation badge, verify the exact URL shape in current official client documentation and test the rendered link end to end.
- If the client documents installation only through a marketplace, command, plugin browser, or manual configuration, link to those instructions and label the badge `Set up`.
- Do not infer support from another client or from an older README. Record the source and verification date when an external install action is retained.

### Collapse Reference Material

Reference-heavy sections (syntax tables, API surfaces, parameter lists) should be in `<details>` blocks when they interrupt the narrative flow:

```markdown
<details>
<summary><strong>Syntax Reference</strong></summary>

| Symbol | Name | What It Does |
| :----: | :--- | :----------- |
|  ...   |

</details>
```

Keep narrative sections (Quick Start, Features, Workflows) open. Collapse lookup sections (parameter tables, full API lists, syntax reference).

### What Belongs in docs/ vs README

| Content                           | README                         | docs/                      |
| --------------------------------- | ------------------------------ | -------------------------- |
| What it does (1-2 sentences each) | Yes                            | No                         |
| Install + first use               | Yes                            | Detailed per-client guides |
| Feature overview with examples    | Yes                            | Full tutorials             |
| Architecture diagram              | Only if brief or for portfolio | Full treatment             |
| Configuration reference           | Link only                      | Yes                        |
| Troubleshooting                   | No                             | Yes                        |
| Concept explanations              | One sentence + link            | Full treatment             |

### Structure Template

```markdown
# Project Name

<div align="center">

[Logo/Visual]

[![badges](shields-url)](link)

**One-sentence hook.**

Three lines describing the core value, one per line with `<br>`.

[Quick Start](#quick-start) · [Features](#features) · [Docs](#documentation)

</div>

### Positioning (optional but recommended)

| Without this | With this |
| ------------ | --------- |
| Pain point   | Solution  |

---

## Quick Start

### Primary Client (Recommended)

\`\`\`bash
install + first use
\`\`\`

<details>
<summary><strong>Other Client</strong></summary>

[![Set up Client](badge-url)](#client-setup)

Verified setup instructions...

</details>

---

## Features

### Feature 1

One sentence + real example.

### Feature 2

One sentence + real example.

---

<details>
<summary><strong>Reference Section</strong></summary>

[Tables, parameter lists, syntax reference]

</details>

---

## Documentation

| I want to...             | Go here                           |
| ------------------------ | --------------------------------- |
| Learn by building        | [Tutorial](docs/tutorial.md)      |
| Solve a specific problem | [How-to Guide](docs/howto/)       |
| Look up parameters       | [Reference](docs/reference/)      |
| Understand the design    | [Architecture](docs/explanation/) |

---

## Contributing

[Brief guide or link]

---

## License

[License]
```

### Anti-Patterns (AVOID)

| Don't                                | Why                                        | Instead                                                |
| ------------------------------------ | ------------------------------------------ | ------------------------------------------------------ |
| Wall of text before Quick Start      | Loses impatient users                      | Hook → Value → Quick Start                             |
| Embed full tutorials                 | Too long, stale                            | Link to docs/                                          |
| Marketing language                   | Erodes trust                               | State facts directly                                   |
| Placeholder examples                 | Unhelpful                                  | Use real, working code                                 |
| Repeated TIP callouts                | Read as SEO padding                        | Fold links into prose; ≤4 callouts total               |
| Inline every client's install        | Bloats Quick Start                         | `<details>` per client                                 |
| Reuse an old client install deeplink | External contracts change                  | Verify current official docs and test the exact action |
| Describe internals as features       | "23-stage pipeline" means nothing to users | Describe what the user gets                            |
| Reference tables in narrative flow   | Interrupts the story                       | Collapse with `<details>`                              |

## {% else %}

## Unknown Document Type

The `doc_type` "{{ doc_type }}" is not recognized. Valid options:

- `tutorial` — Learning-oriented, guided lessons
- `howto` — Task-oriented, solve specific problems
- `reference` — Information-oriented, lookup tables
- `explanation` — Understanding-oriented, concepts
- `readme` — Hybrid for root READMEs

Please specify a valid document type.

{% endif %}

---

## Prose Hygiene — Removing AI Cadence (All Doc Types)

LLM-drafted prose carries recognizable tells. Readers who notice them discount the whole document. Run this pass on every draft, last, after structure is settled.

### The Tells

| Tell                                    | Example                                                         | Fix                                                                                          |
| --------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Em-dash connector                       | "Gates validate output — self-evaluation and shell commands"    | Colon, comma, or a new sentence: "Gates validate output: self-evaluation and shell commands" |
| "isn't just X — it's Y"                 | "This isn't just a template store — it's a workflow engine"     | State what it is, once: "A workflow engine with versioned templates"                         |
| Triad flourish                          | "Fast, flexible, and powerful"                                  | One precise claim beats three vague ones                                                     |
| Manufactured aphorism                   | "The gate catches; the model mends"                             | Plain description of the same fact                                                           |
| Uncommon verb reaching for elegance     | "mends", "weaves" (when "fixes", "combines" is what people say) | The word a colleague would use aloud                                                         |
| Mirrored/parallel clauses as decoration | "Simple to start, powerful to scale"                            | Reserve structural devices for the ONE surface that earns them (see budget below)            |
| Hedged intensifier                      | "quite powerful", "incredibly simple"                           | Delete the intensifier or the sentence                                                       |

**Em-dash rule of thumb**: an em-dash that could be replaced by a colon, comma, or period without loss is a tell. Legitimate uses survive: terse separation inside table cells, definition lists (`` `%clean` — no injection ``), and genuine parenthetical interruptions. Audit any document with more than ~1 em-dash per 50 lines of prose.

### The Aphorism Budget

Constructed lines (meter, mirrored clauses, proverb register) are brand devices. A document gets **at most one**, in the tagline position, and only if the project's identity calls for it. A second aphorism anywhere reads as costume. Everywhere else: **voice through diction, not devices** — plain sentences that prefer the project's own identity lexicon (the verbs its features already use) when synonyms tie. The lexicon must be extracted FROM the product's existing language, never invented for it.

### Verification

Read the draft aloud (or simulate it). Any sentence you would not say to a colleague across a desk gets rewritten in the words you would actually use.

---

## GitHub Markdown Patterns (All Doc Types)

These patterns work on GitHub-rendered markdown. Use them across all doc types where appropriate.

### Progressive Disclosure Callouts

GitHub renders `> [!TIP]`, `> [!NOTE]`, `> [!WARNING]`, `> [!IMPORTANT]`, `> [!CAUTION]` as styled callout blocks.

```markdown
> [!TIP]
> Short pointer to deeper content. 1-2 lines max.
> [Link to guide](docs/guide.md) · [Link to reference](docs/reference.md)
```

**When to use:** Sparingly (see the callout budget in the README guidelines). Prefer folding links into the prose that motivates them.

### Collapsible Sections

```markdown
<details>
<summary><strong>Section Title</strong></summary>

Content here. Blank line after `<summary>` is required for markdown rendering.

</details>
```

**When to use:** Reference tables, per-client configs, optional detail, anything that adds value for some readers but interrupts flow for others.

### Badges as Action Buttons

```markdown
[![Label](https://img.shields.io/badge/LABEL-TEXT-COLOR?style=flat-square&logo=LOGO&logoColor=white)](ACTION_URL)
```

**When to use:** Verified installation actions, setup navigation, links to external services, and status indicators. Match the label to the action: `Install` performs a documented installation; `Set up` opens instructions.

### Dark/Light Mode Images

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="image-dark.png" />
  <source media="(prefers-color-scheme: light)" srcset="image-light.png" />
  <img src="image-light.png" alt="description" />
</picture>
```

**When to use:** Icons in `<details>` summaries, diagrams with theme-dependent colors.

---

## Cross-Linking Strategy

Good documentation connects quadrants appropriately:

| From        | Link To     | When                                   |
| ----------- | ----------- | -------------------------------------- |
| Tutorial    | Reference   | "For all options, see [Reference]"     |
| Tutorial    | Explanation | "To understand why, see [About X]"     |
| How-to      | Reference   | "For parameter details, see [API Ref]" |
| How-to      | Explanation | "For background, see [About X]"        |
| Reference   | How-to      | "For usage examples, see [How to X]"   |
| Explanation | Tutorial    | "To try this yourself, see [Tutorial]" |

---

## Task

Using the guidelines above for **{{ doc_type }}** documentation:

1. **Analyze** the input content for alignment with Diátaxis principles
2. **Identify** what quadrant content is misplaced (if refactoring)
3. **Write/Rewrite** following the structure template exactly
4. **Include** proper cross-links to other documentation types
5. **Maintain** the appropriate tone for the quadrant
6. **Run the Prose Hygiene pass** last: strip AI-cadence tells, enforce the aphorism budget, verify every sentence survives the read-aloud test

Output polished Markdown ready for use.
