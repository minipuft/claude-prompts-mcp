> Use the animation-direction vocabulary (<episode_root>/vocabulary.json); an intent word outside it is refused by the animation-vocabulary gate.

## Original Task Instructions

### Original Request Intent

This step was given the following request. Your work must satisfy this intent:

- **episode_root**: media/showcase/v3
- **renderer**: media/showcase
- **output_root**: media/showcase
- **brief**: Animatic 04 of the 65 s eight-beat episode: the blocking step resolves the prop collisions animatic 03 left open (the box over the kit blocks and the join glow, the stalk in the air at 300, the struct...
- **context**: 

Episode root: media/showcase/v3
Renderer: media/showcase
Production root: media/showcase
Notes:


Read `timeline.json`, the ledger's actions per beat, every `layouts/<shot>.json` (D77 cinematography sheets: camera, figure heights, emitter path), `blocking/test-scene.json` (the schema and the proven test staging) and board §8 composition cards. For each beat write `blocking/<beat-id>.json`: every actor the beat's actions name with position, scale and facing; props and gates; the emitter anchor at the beat's start and end; `card` (a composition card id, through the /inspiration skill, filed with provenance); `derivedFrom` (the layout or test-scene) and `provisional: true`. Keep identity boxes apart (Codex and Clawd never overlap each other or the human's crop) and keep the arch, gates and floor where the world contracts expect them unless the beat says otherwise. Render `PoseSheet`/`WorldSheet` with the beat's blocking for one beat per world as a staging still under `studies/`. The gate runs `probe-blocking.py`; quote its lines. Reply: Blocking (table: beat · actors placed · emitter start→end · card · derivedFrom), Stills, Deviations from the layouts (with why), Changed, Receipt.

---




---

## Inline Gates

### Checks

- **Animation Blocking Contract** — check: runs `python3 scripts/animation/probe-blocking.py v3/timeline.json v3/blocking`
- **Animation Vocabulary** — check: runs `python3 scripts/animation/probe-vocabulary.py v3/vocabulary.json --overrides v3/vocabulary-overrides.json`

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
- Section "## Analysis" contains forbidden terms: "placeholder". Remove these.

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


## Shell Verification Results

### Animation Blocking Contract — PASSED

**Command:** `python3 scripts/animation/probe-blocking.py v3/timeline.json v3/blocking`
**Exit Code:** 0
**Duration:** 221ms

### Animation Vocabulary — FAILED

**Command:** `python3 scripts/animation/probe-vocabulary.py v3/vocabulary.json --overrides v3/vocabulary-overrides.json`
**Exit Code:** 1
**Duration:** 85ms

```
control: proposal intent 'vibey' -> refused; proposal option 'zesty' -> refused; owner-ask with no default -> refused; ruling 'because vibey' -> refused; ruling citing card 'no-such-card' -> refused; materials intent 'bouncy' -> refused; materials intent 'warm' (a register, not a material intent) -> refused; pose breakdown kind 'wobbly' -> refused; facet word 'zany' -> refused; vocabulary without 'whip' -> refused; alias to a term the vocabulary lacks -> refused; clean proposal intent 'wide' -> accepted; clean owner-ask -> accepted; clean ruling 'because drape' -> accepted; clean materials intent 'drape' -> accepted; clean pose breakdown kind 'passing' -> accepted
  ok   vocabulary: 112 terms in 14 domains, each with a one-line definition and a lane, material property or facet it governs, and every term D96 names is present
  ok   overrides: 8 register phrases map to vocabulary terms, 8 film words (worlds and hue pairs) restate no vocabulary term, 4 hue pairs match the light script
  ok   facets: 72 words of 12 aligned facets of the inspiration board are each a term, an alias or declared unmapped
  FAIL proposals: owner-ask p007 has no intent, options, default
  ok   rulings: 53 rulings read: 4 in the ruling form (0 with an intent word, all in the vocabulary; 4 with a sentence of reasons, not checked), the rest free prose
  ok   poses: 2 pose sheets read, 58 breakdown kinds and key intents are vocabulary terms
  ok   materials: 73 material intents read, all material terms; 0 presets named by registers
refused: proposals: owner-ask p007 has no intent, options, default - replace a refused word with a term of the vocabulary; do not edit the vocabulary to pass
```


---

**Structural + Gate Review Required** (attempt 1/2)



Review your output above against the gates, then submit:

```
chain_id="chain-animation_animatic#1"
gate_verdict={
  "overall": "PASS",
  "rationale": "<overall assessment>",
  "per_gate": [
    {"index": 1, "passed": true, "rationale": "Animation Blocking Contract — Ground truth by exit code (D81). The probe runs `python3 scripts/animation/probe-blocking.py v3/timeline.json v3/blocking` in the renderer root and passes only when every check it prints passes; its first printed line is its positive control and it refuses to report if the control does not trip. Checks one blocking file per beat against the timeline's beat list and each beat's actions. On FAIL quote the probe's own line naming the frame or beat and fix the contract or the render, never the probe. Control: an actor with no position is refused.: <recorded: python3 scripts/animation/probe-blocking.py v3/timeline.json v3/blocking exit 0>"},
    {"index": 2, "passed": false, "rationale": "Animation Vocabulary — Ground truth by exit code (D81, D96). The probe runs `python3 scripts/animation/probe-vocabulary.py v3/vocabulary.json --overrides v3/vocabulary-overrides.json` in the renderer root: it reads the vocabulary and the film's overrides, then the `intent`, `options` and `default` of every file under v3/proposals/, the because clause of every ruling in the ruling form in v3/rulings.json (parsed by scripts/animation/rulings.mjs; older free prose is not checked), the breakdown kinds and key intents of v3/poses/ and every `intent` in v3/materials.json, and refuses a word that is not a term. Its first line is its control (a proposal with intent 'vibey', a ruling 'because vibey', a material intent 'bouncy', a breakdown kind 'wobbly', a facet word 'zany', an owner-ask with no default, an alias to a term that is not there and a vocabulary without 'whip' are each refused, and a clean fixture of each kind is accepted) and it refuses to report if a control does not trip. On FAIL quote the probe's refused line, open the file and field it names and replace the refused word with the vocabulary term that says what was meant (the term's definition and the lane or property it governs are in the vocabulary file); if no term says it, file an owner-ask proposal for a new term and keep the old word out of every file until it is ruled. Never edit the vocabulary, the overrides, the probe or this check to make it pass. Control: a proposal with intent 'vibey' is refused.: <recorded: python3 scripts/animation/probe-vocabulary.py v3/vocabulary.json --overrides v3/vocabulary-overrides.json exit 1>"},
    {"index": 4, "passed": true, "rationale": "__phase_guard__: <why>"}
  ],
  "reminders": {"satisfied": ["framework-compliance"], "not_applicable": []}
}
```

Set `"overall": "FAIL"` and say what needs improvement if the gates are not met. Rationales are single-line.

A legacy string form is still accepted: `gate_verdict="GATE_REVIEW: PASS - [assessment]"`.

Chain: chain-animation_animatic#1
→ Progress 2/6
Next: chain_id="chain-animation_animatic#1", user_response="<your step output>", gate_verdict="GATE_REVIEW: PASS|FAIL - <why>"
