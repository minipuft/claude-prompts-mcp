# Technology Recommendation: {% if subject %}{{subject}}{% else %}{{library}}{% endif %}

## Context

{{context}}

## Baseline (required)

Every verdict below is judged **against the baseline**, not in isolation. State it before deciding:

- **Current approach**: what serves this need today (existing code, existing dependency, or "nothing yet")?
- **Cost of doing nothing**: what does keeping the status quo cost — measured or honestly estimated?
- **Cost of hand-rolling**: if built in-house, what does it take to write AND maintain?
- **Solved-problem check**: is this a domain where hand-rolled code is reliably worse than mature libraries (crypto, date/time/timezones, parsing, sanitization, unicode, compression)? If yes, say so — the burden of proof flips to building.

{% if evaluation_summary %}

## Evaluation Summary

{{evaluation_summary}}
{% endif %}

---

Provide a **clear, actionable recommendation** — grounded in how practitioners actually solve this, not just the library's own marketing or docs.

## Decision

### Verdict: [ADOPT / TRIAL / HOLD / AVOID / KEEP / RETIRE]

| Verdict | Meaning                                                                                         |
| ------- | ----------------------------------------------------------------------------------------------- |
| ADOPT   | Ready for production use — beats the baseline                                                   |
| TRIAL   | Worth exploring in a non-critical project                                                       |
| HOLD    | Wait for improvements or reassess later                                                         |
| AVOID   | Do not use, significant concerns                                                                |
| KEEP    | The baseline already wins — current approach is the right one                                   |
| RETIRE  | The improvement is deletion — platform/stdlib caught up; remove the existing dependency or code |

### Confidence Level: [High / Medium / Low]

### One-Line Summary

> [Single sentence capturing the recommendation]

## Rationale

### Why This Decision

**Strengths that support adoption:**

1.
2.
3.

**Concerns that temper enthusiasm:**

1.
2.
3.

### Key Tradeoffs Accepted

What are you accepting by choosing this path?

## Inspiration & Prior Art

Survey how practitioners actually solve this — beyond any one tool's own docs — and surface the best techniques and tooling for **{% if subject %}{{subject}}{% else %}{{library}}{% endif %}** against the goals in your context above. Seek inspiration across:

| Source type                 | What to mine                                                 | Where to look                                                                                              |
| --------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Engineering dev blogs       | production write-ups, post-mortems, perf deep-dives          | company & personal eng blogs, Smashing Magazine, CSS-Tricks                                                |
| Game-dev talks & blogs      | real-time techniques, frame-budget tricks, game feel / juice | GDC talks (Vault / YouTube), studio tech blogs                                                             |
| Shader & graphics resources | GPU patterns, visual recipes, the underlying math            | Shadertoy, The Book of Shaders, Inigo Quilez (iquilezles.org), GPU Gems                                    |
| Web design / motion blogs   | interaction & motion design, polish, micro-feel              | Codrops, Awwwards write-ups, Josh Comeau, motion-design blogs                                              |
| Practitioner threads        | gotchas, real tradeoffs, "what I'd do differently"           | Hacker News, Reddit (r/gamedev, r/webgl, r/graphicsprogramming…), X / Mastodon threads, GitHub Discussions |

For each promising find:

- **Technique / pattern** — what it is, and **cite the source** (link or talk title + author)
- **Why it fits** — how it serves _your_ design goals and context
- **Tooling implied** — the specific tool / library / approach it points to
- **Adaptation cost** — what applying it here would take

> Prefer **measured / shipped** evidence (a live demo, a perf number, real production usage) over marketing claims. Flag any source that is dated or unverified.

### Best-of-breed tooling shortlist

From the survey, the strongest options for these goals:

| Tool / technique | Source(s) | Fit for the goal | Tradeoff |
| ---------------- | --------- | ---------------- | -------- |
|                  |           |                  |          |

## Immediate Next Steps

If **ADOPT** or **TRIAL**:

### Step 1: Setup (Day 1)

```bash
# Installation commands
```

```typescript
// Initial configuration
```

### Step 2: Proof of Concept (Day 1-2)

```typescript
// Minimal working example for your use case — borrow from the prior-art techniques above
```

### Step 3: Integration (Week 1)

- [ ] Task 1
- [ ] Task 2
- [ ] Task 3

If **HOLD**:

- What conditions would change this to ADOPT?
- When to reassess?

If **AVOID**:

- Recommended alternative (informed by the prior-art survey)
- Why the alternative is better for your context

If **KEEP**:

- What the baseline does better than every surveyed candidate (cited, not asserted)
- Cheap hardening of the current approach, if any (borrowed from the survey)
- What observation would flip this to ADOPT/TRIAL — name it so the reassessment is concrete

If **RETIRE**:

- What replaced the need (platform feature, stdlib, an existing dependency already in the stack)
- Removal plan, same-PR: delete source, update imports, update tests/mocks, rewrite docs to current state, remove from configs — no "cleanup later"
- Migration notes for any consumers of the removed surface

## Success Metrics

How will you know this was the right decision?

| Metric | Target | Measure After |
| ------ | ------ | ------------- |
|        |        |               |

## Risks & Mitigations

| Risk | Mitigation | Owner |
| ---- | ---------- | ----- |
|      |            |       |

---

**Output requirements**:

- Baseline stated first; the verdict reads as a comparison against it
- Clear ADOPT/TRIAL/HOLD/AVOID/KEEP/RETIRE verdict
- At least 3 concrete next steps with code
- At least 3 **cited** practitioner sources (dev blog / game-dev talk / shader / design blog / thread) that informed the recommendation, each tied to a concrete technique or tool
- Every comparative claim ("performs better", "faster", "safer than hand-rolling") carries a source citation — no unverified superlatives; the Baseline comparison cites evidence or names the missing measurement
- A best-of-breed tooling shortlist mapped to the stated design goals
- Specific success metrics
