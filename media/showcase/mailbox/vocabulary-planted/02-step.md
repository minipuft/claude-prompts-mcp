---

## 🎯 C.A.G.E.E.R.F Framework Active

**C.A.G.E.E.R.F Framework**

You are operating under the C.A.G.E.E.R.F Framework for Animation Direction.

Apply the C.A.G.E.E.R.F framework systematically:

**Context**: Establish comprehensive situational awareness and environmental factors
**Analysis**: Apply structured, systematic examination of the problem or opportunity
**Goals**: Define specific, measurable, actionable objectives with clear success criteria
**Execution**: Develop practical, implementable approach with detailed action steps
**Evaluation**: Create robust success metrics and assessment methods
**Refinement**: Enable continuous improvement and iteration processes

Ensure each phase builds logically on the previous phases while maintaining focus on practical, actionable outcomes. Consider stakeholder perspectives, resource constraints, and environmental factors throughout the framework application.


Apply this framework systematically to ensure comprehensive and structured responses.

---


> You direct an animation production through interviews and rulings. Every intent word you offer, write or record comes from the animation-direction vocabulary at `<episode_root>/vocabulary.json` (`media/showcase/v3/vocabulary.json` in the showcase). Read it: each term carries a one-line definition and the bible lane, material property or pose-sheet facet it governs. Quote a term and name what it governs; never restate the terms from memory and never invent a word. The film's own words (register names, hue pairs, worlds) are the aliases and terms in `vocabulary-overrides.json` beside it. An intent word outside the vocabulary is refused by the animation-vocabulary gate.

## The interview: one question per turn

A question has five parts, in this order, and no others:
1. Situation: what the bible page shows at the frame the question is about (the lanes read at that frame, the animatic frame), in two sentences a viewer could check.
2. Options: two to four vocabulary words that answer the question, each with the one thing it would change.
3. Default: the option you would take, named as a word, so the owner's "default" is a complete answer.
4. Changes: the bible lane, material property or pose-sheet facet the answer sets (the chosen term's `governs`).
5. Reference: one card from the board by id that shows the recommended option. Find it first (the board, then the owner's Eagle library through the inspiration skill); a question without a card is not asked.

Ask one question and stop. Do not bundle questions and do not ask a second until the first is ruled. File the question as a proposal of kind owner-ask (shape in the user message); the owner rules it on the bible page and the page writes the ruling.

## The ruling form

`D<N>, <who>, <date>: <verb> <object> <value> because <intent word> (ref <card id>) (closes p<NNN>)`

- `<verb>` is a plain action (adopt, set, move, change, add, remove, keep); `<object>` is the thing ruled on and `<value>` what it becomes.
- `<intent word>` is a vocabulary term, or at most three of them joined by commas; the reason in prose goes in the proposal, never after `because`.
- `(ref <card id>)` names a card on the board; `(closes p<NNN>)` names the proposal the ruling closes.
- `<N>` is the highest D-number in the creative spec plus one. `scripts/animation/rulings.mjs` parses the form into verb, object, value, intent and ref, and `probe-vocabulary.py` refuses an intent word or a card that is not there. Anything that is not in this form is free prose and is not checked.


## Original Task Instructions

### Original Request Intent

This step was given the following request. Your work must satisfy this intent:

- **episode_root**: media/showcase/v3
- **beat**: arrival
- **frame**: 10
- **question**: Should the box seam light be soft or hard?

Episode root: media/showcase/v3
Beat: arrival
Frame: 10
Question for the owner: Should the box seam light be soft or hard?

Read `media/showcase/v3/vocabulary.json` and `media/showcase/v3/vocabulary-overrides.json` (the words you may use), `media/showcase/v3/timeline.json` (the beat's frame range; the frame must sit inside it), `media/showcase/v3/bible.json` (what each lane says at that frame), `media/showcase/v3/references/board.json` (the cards) and the highest-numbered file in `media/showcase/v3/proposals/` (ids are never reused).

Put the question to the owner in the five parts of the interview form and no others: Situation, Options (vocabulary words, each with the one thing it changes), Default, Changes (the lane or property, from the chosen term's `governs`), Reference (one card id). Then file it as one proposal, `media/showcase/v3/proposals/pNNN-<slug>.json`, where NNN is the highest existing number plus one and `<slug>` is the title in at most five kebab-case words, in this shape and no other:
```json
{
  "id": "pNNN",
  "kind": "owner-ask",
  "from": "director",
  "date": "<today, YYYY-MM-DD>",
  "anchor": {"beat": "arrival", "frame": 10},
  "title": "<the decision, in a few words>",
  "text": "<the situation: what the page shows at the frame, in reader voice>",
  "references": ["<card id>"],
  "intent": "<the vocabulary word you would write after because if the owner takes the default>",
  "options": ["<vocabulary word>", "<vocabulary word>"],
  "default": "<one of the options>",
  "changes": "<the lane, material property or facet the answer sets>",
  "before": {"note": "<what the page shows now>"},
  "after": {"note": "<what each option would make true, one clause per option>"},
  "status": "open",
  "ruling": null
}
```
`frame` is an episode frame inside the beat's start and end in `timeline.json`; the bible gate refuses a frame outside its beat. Do not edit an existing proposal. Then run `npm run bible` in the production root and `python3 scripts/animation/probe-vocabulary.py media/showcase/v3/vocabulary.json --overrides media/showcase/v3/vocabulary-overrides.json`; quote the pass line of each, or on a refusal quote the refused line, replace the refused word in your own proposal with a vocabulary term and run both again. Never edit the vocabulary or a probe to make it pass.

Return: Question (the five parts as the owner reads them, one short line each); Proposal (the JSON you filed and its path); Probe Lines (bible, vocabulary); Concerns.

---




---

## Inline Gates

### Checks

- **Animation Vocabulary (planted control)** — check: runs `python3 scripts/animation/probe-vocabulary.py v3/vocabulary.json --overrides v3/vocabulary-overrides.json --proposals /home/minipuft/.cache/vocab-planted/proposals`

### Reminders

### Framework Compliance
**CAGEERF Framework Guidelines:**
- Include Context, Analysis, Goals, Execution, Evaluation, Refinement, Framework considerations
- Structure responses according to framework principles
- Include systematic thinking and framework awareness
- Show iterative improvement and refinement processes

Attest reminders in the verdict's `reminders` field; checks are recorded by the engine.

---

**Inline Gate Priority:** These inline gates triggered the review. Fix them before checking framework standards.

**Inline Fix Guidance:**
- Ensure your response includes the required "## Context" section
- Ensure your response includes the required "## Analysis" section
- Ensure your response includes the required "## Goals" section

---

### Required Response Format

**Summary**: What was implemented (2-3 sentences)

**Required Sections** — emit these headers verbatim; they are graded structurally:
- `## Context` (required)
- `## Analysis` (required)
- `## Goals` (required)
- `## Execution` (required)
- `## Evaluation` (optional)
- `## Refinement` (optional)

**Gate Coverage**:
- [1] PASS|FAIL: rationale
- [2] PASS|FAIL: rationale

**GATE_REVIEW: PASS|FAIL - overall assessment**

## Shell Verification Results

### Animation Vocabulary (planted control) — FAILED

**Command:** `python3 scripts/animation/probe-vocabulary.py v3/vocabulary.json --overrides v3/vocabulary-overrides.json --proposals /home/minipuft/.cache/vocab-planted/proposals`
**Exit Code:** 1
**Duration:** 82ms

```
control: proposal intent 'vibey' -> refused; proposal option 'zesty' -> refused; owner-ask with no default -> refused; ruling 'because vibey' -> refused; ruling citing card 'no-such-card' -> refused; materials intent 'bouncy' -> refused; materials intent 'warm' (a register, not a material intent) -> refused; pose breakdown kind 'wobbly' -> refused; facet word 'zany' -> refused; vocabulary without 'whip' -> refused; alias to a term the vocabulary lacks -> refused; clean proposal intent 'wide' -> accepted; clean owner-ask -> accepted; clean ruling 'because drape' -> accepted; clean materials intent 'drape' -> accepted; clean pose breakdown kind 'passing' -> accepted
  ok   vocabulary: 112 terms in 14 domains, each with a one-line definition and a lane, material property or facet it governs, and every term D96 names is present
  ok   overrides: 8 register phrases map to vocabulary terms, 8 film words (worlds and hue pairs) restate no vocabulary term, 4 hue pairs match the light script
  ok   facets: 72 words of 12 aligned facets of the inspiration board are each a term, an alias or declared unmapped
  FAIL proposals: proposal p900 intent 'vibey' is not in the vocabulary
  ok   rulings: 53 rulings read: 4 in the ruling form (0 with an intent word, all in the vocabulary; 4 with a sentence of reasons, not checked), the rest free prose
  ok   poses: 1 pose sheets read, 28 breakdown kinds and key intents are vocabulary terms
  ok   materials: 73 material intents read, all material terms; 0 presets named by registers
refused: proposals: proposal p900 intent 'vibey' is not in the vocabulary - replace a refused word with a term of the vocabulary; do not edit the vocabulary to pass
```


---

**Structural + Gate Review Required** (attempt 1/2)



Review your output above against the gates, then submit:

```
chain_id="chain-animation_direction#1"
gate_verdict={
  "overall": "PASS",
  "rationale": "<overall assessment>",
  "per_gate": [
    {"index": 1, "passed": false, "rationale": "Animation Vocabulary (planted control) — Temporary control gate; see animation-vocabulary. On FAIL quote the refused line.: <recorded: python3 scripts/animation/probe-vocabulary.py v3/vocabulary.json --overrides v3/vocabulary-overrides.json --proposals /home/minipuft/.cache/vocab-planted/proposals exit 1>"},
    {"index": 3, "passed": true, "rationale": "__phase_guard__: <why>"}
  ],
  "reminders": {"satisfied": ["framework-compliance"], "not_applicable": []}
}
```

Set `"overall": "FAIL"` and say what needs improvement if the gates are not met. Rationales are single-line.

A legacy string form is still accepted: `gate_verdict="GATE_REVIEW: PASS - [assessment]"`.

Chain: chain-animation_direction#1
→ Final step 1/1 — awaiting gate verdict
