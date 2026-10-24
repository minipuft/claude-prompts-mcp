> You produce client-side creative work guided by the Claude Prompts MCP server. The server renders prompts, propagates step results and manages reviews; the client agents research, write artifacts, implement and render. Use existing services and authored resource contracts. Never invent MCP parameters, workflow schemas or a parallel orchestrator. Preserve actual provenance: recording, source-derived depiction, smoke fixture and conceptual animation are different evidence classes. Do not imply a simulated agent or UI is a recorded Claude/Codex run. No narration, unsolicited public posting, git refs, commits or files outside caller-owned scope. A missing consequential choice becomes a concern; do not silently fabricate it. Read prior context and chain history, and cite actual paths/URLs used. Revisions must have observable rationale. If the selected story uses an environment or travel metaphor, keep its boundaries explicit: the client/resource author creates reusable prompts, gates and frameworks through resource_manager; problems may motivate authored improvements but the server does not learn or author them automatically. Frameworks structure reasoning; a depicted journey represents state/context progression and does not imply physical enforcement.

## Original Task Instructions

### Original Request Intent

This step was given the following request. Your work must satisfy this intent:

- **episode_root**: media/showcase/v3
- **renderer**: media/showcase
- **output_root**: media/showcase
- **brief**: First animatic of the 65 s eight-beat episode (D79): does the pacing hold at the CalArts band, do the three worlds and the two crossings read in sequence, where does the eye go in each beat. Placehold...
- **context**: 

Brief: First animatic of the 65 s eight-beat episode (D79): does the pacing hold at the CalArts band, do the three worlds and the two crossings read in sequence, where does the eye go in each beat. Placeholders allowed for keys; every gate line quoted.
Constraints: Silent motion film; evidence-backed product claims; client-owned rendering; no publishing.
Production root: media/showcase
Previous handoff:


Read, before writing, the project files under the production root's `v3/`: `creative-spec.md` (rulings D41–D72, medium, palette law, animation language, Craft baseline), `script.md` (resource vocabulary and beats), `rubric.md` (criteria C1–C23 and the receipt shape). They are the contract; this prompt does not restate them.

Grade the actual rendered artifact against `rubric.md` by criterion id; do not grade anything you have not viewed. Use only the four marks: HOLDS, FAILS, UNPROVEN, TASTE. Each mark cites its evidence at or above the criterion's minimum tier (still, 3x crop, consecutive frames, moving render, owner viewing) and names the failing control it beats. Measure where the rubric allows it: per-frame pixel change for twos versus ones (C16), two renders hashed for determinism (C12), a sampled pixel for identity pigments (C1), the key-over-model-sheet overlay (C20), the filled silhouette of each key (C21), the measured contour weight (C22), and each breakdown's displacement against its charted favouring (C23).

Motion contract:
Use the recorded Motion Contract step; flag missing handoff.

Write the receipt in the rubric's five parts, in order: Changed (by file); Grades (one line per criterion touched); Controls (which earlier study each flipped FAILS beats); Owner (at most two TASTE questions, each with the default the planner takes if unanswered); Next (one fix per FAILS). Save it as `v3/studies/<name>.md` beside the artifact copies, copied unchanged from `out/` with sha256 prefixes. A render that is absent is BLOCKED, not PASS. Propose a rubric change only through its Evolution rules: a new ruling adds a row; three consecutive HOLDS bakes one; a standing TASTE is ruled or deleted.

Return: Inspected Evidence; Grades; Controls; Owner; Next; Rubric Evolution; Concerns.

---




---

## Inline Gates

### Reminders

### Animation Review Rubric
Advisory, not a check: nothing here has a positive control. Grade only what was viewed, one mark per touched criterion (HOLDS, FAILS, UNPROVEN, TASTE) with evidence at or above the criterion's minimum tier. The episode-tier criteria (timeline conformance, twos/ones split, hold band, eye trace, colour continuity) are DECIDED by the probe gate, not here: cite its lines, do not re-grade them. Grade here what no probe can: acting reads without text (C14), composition hierarchy per beat (C10), the crossings read as drawn (C13), the story lands in the screen time given. Every TASTE mark asks the owner one question with a default. Receipt in five parts: Changed, Grades, Controls, Owner, Next.

Attest reminders in the verdict's `reminders` field; checks are recorded by the engine.

---

**Inline Gate Priority:** These inline gates triggered the review. Fix them before checking framework standards.

---

### Required Response Format

**Summary**: What was implemented (2-3 sentences)

**Gate Coverage**:
- [1] PASS|FAIL: rationale
- [2] PASS|FAIL: rationale



---

**Gate Review Required** (attempt 1/2)



Review your output above against the gates, then submit:

```
chain_id="chain-animation_animatic#1"
gate_verdict={
  "overall": "PASS",
  "rationale": "<overall assessment>",
  "reminders": {"satisfied": ["animation-review"], "not_applicable": []}
}
```

Set `"overall": "FAIL"` and say what needs improvement if the gates are not met. Rationales are single-line.

A legacy string form is still accepted: `gate_verdict="GATE_REVIEW: PASS - [assessment]"`.

Chain: chain-animation_animatic#1
→ Progress 5/6
Next: chain_id="chain-animation_animatic#1", user_response="<your step output>", gate_verdict="GATE_REVIEW: PASS|FAIL - <why>"
