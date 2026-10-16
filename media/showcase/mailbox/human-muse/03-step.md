### Original Request Intent

This step was given the following request. Your work must satisfy this intent:

- **asset**: human: resource_manager: the hands that place and lift pieces
- **constraints**: Cite board cards seuss-cat-stairway, lin-fosters, seuss-no-one-youer, seuss-archbishop-katz, chetas, codex-official, clawd-official (v3/references/board.json). Five-role flat SVG on a black field; ski...

> You produce client-side creative work guided by the Claude Prompts MCP server. The server renders prompts, propagates step results and manages reviews; the client agents research, write artifacts, implement and render. Use existing services and authored resource contracts. Never invent MCP parameters, workflow schemas or a parallel orchestrator. Preserve actual provenance: recording, source-derived depiction, smoke fixture and conceptual animation are different evidence classes. Do not imply a simulated agent or UI is a recorded Claude/Codex run. No narration, unsolicited public posting, git refs, commits or files outside caller-owned scope. A missing consequential choice becomes a concern; do not silently fabricate it. Read prior context and chain history, and cite actual paths/URLs used. Revisions must have observable rationale. If the selected story uses an environment or travel metaphor, keep its boundaries explicit: the client/resource author creates reusable prompts, gates and frameworks through resource_manager; problems may motivate authored improvements but the server does not learn or author them automatically. Frameworks structure reasoning; a depicted journey represents state/context progression and does not imply physical enforcement.

Brief: human: resource_manager: the hands that place and lift pieces
Constraints: Cite board cards seuss-cat-stairway, lin-fosters, seuss-no-one-youer, seuss-archbishop-katz, chetas, codex-official, clawd-official (v3/references/board.json). Five-role flat SVG on a black field; skin green #67b479 with mauve #c885c2 shadow step (D54, identity, never grades); garment from the Archbishop Katz mauve/blue/cream family; Seuss contour language with a pale contour one step behind; Midnight Gospel two-scale stipple shadows; drawn on twos with 2–3 boil variants. Clean slate (D56): the earlier human sheet and first draw are not candidates and not inspiration; the frozen compact face is retired unless a variant earns it back. Each variant sits between the companions' morphing constructions (D63) and the Seuss stalk figures; silhouette must read at 64 px before any fill.
Production root: media/showcase/output
Previous handoff:
## Context
Delegated sheet step for the human, executed in-session by the planner (no sub-agent was spawned: the style contracts, the board and the muse directions live in this session's context, and a fresh agent would have lost them; stated here so the trail is honest). Inputs: the muse's three directions (A Bell, B Kite, C Kin; D Stalk refused as a vocabulary collision), `v3/creative-spec.md` v4-brief-12, `v3/rubric.md` v1.3, `v3/references/board.json` board-05. creed: n/a — no CloudySky visual surface.

## Analysis
Shared across variants: skin `--skin`/`--skin-shadow` from `identity.humanSkin`; garment roles from `settled.human`; pale contour one step behind (light-role stroke 9 under outline 3); two-scale stipple form shadow with the mauve shift and a stippled cast shadow; `lift` 0..1 moving the hands from hip to above the head; `variant` 0..2 boil offsets; hands radius 12–13 against head radius 20–26 (≥ 0.45). Only construction differs.

## Goals
Three rendered constructions side by side with cited borrows, a 64 px silhouette under each so readability is judged before fills, companions at the edges for scale, no pick.

## Execution
Variants (id, title, borrows, between, file):
- A · Bell — borrows seuss-archbishop-katz (layered mauve/blue/cream bands, rounded apex), lin-fosters (long arms, enlarged hands), chetas (dot eyes, one mouth stroke) — between Codex's lobed cap and the gadget's stacked lobes — `src/sheets/human-v2.tsx` `HumanBell`.
- B · Kite — borrows lin-fosters (stick limbs, enlarged hands and feet), seuss-freebird (hair as one trailing line), chetas (expression economy) — between Clawd's compact mass and Codex's rounder head — `HumanKite`.
- C · Kin — borrows clawd-official (block mass, stub legs), codex-official (lobed cap), seuss-cat-stairway (feathered contour) — between Clawd's block and Codex's cloud lobes, the trio as one species — `HumanKin`.

Sheet Path: `out/human-sheet-15.png`, copied unchanged to `v3/studies/human-sheet-15.png` (sha256 703690f3fc95…). Composition `HumanSheet2` in `src/Root.tsx`; `AssetSheet` gained an optional 64 px silhouette box per variant (`src/scenes/AssetSheet.tsx`), roles bound inside the box and the node run through brightness(0).

What Was Held Constant: pigments, garment roles, contour widths, stipple scales, lift 0.6, scale 1, companion placement (Codex left at 1.3, Clawd right at 1.2).

## Evaluation
Viewed the still. At 64 px: Kite reads unmistakably as a posed figure with hands; Kin reads as a compact figure; Bell reads as a bell with two dots, which is the gate-collision risk the muse named, though its rounded apex keeps it off the arch. At full size all three are distinct constructions in one contour language; the companions and the human share dot-eye economy. Known flaw: variant A's silhouette box is clipped by the frame bottom because its label runs longer; cosmetic, the silhouette is still legible.

Concerns: the chain's `challenge: asset` mapping rendered empty on step 1 (constraints carried); the asset was restated by hand. Not a sheet defect, a chain-authoring one to fix on `showcase_asset_muse`.

## Refinement
No pick made. The grade step should mark C19 by the sheet and leave motion criteria UNPROVEN; the owner picks from the still.

HANDOFF RESULT
node: sheet
Proposed Gate Review:
- framework-compliance: PASS — required sections present, each phase builds on the previous
- creed-fidelity: PASS — n/a stated, no CloudySky surface

Read, before writing, the project files under the production root's `v3/`: `creative-spec.md` (rulings D41–D53, medium, palette law, animation language), `script.md` (resource vocabulary and beats), `rubric.md` (criteria C1–C18 and the receipt shape). They are the contract; this prompt does not restate them.

Grade the actual rendered artifact against `rubric.md` by criterion id; do not grade anything you have not viewed. Use only the four marks: HOLDS, FAILS, UNPROVEN, TASTE. Each mark cites its evidence at or above the criterion's minimum tier (still, 3x crop, consecutive frames, moving render, owner viewing) and names the failing control it beats. Measure where the rubric allows it: per-frame pixel change for twos versus ones (C16), two renders hashed for determinism (C12), a sampled pixel for identity pigments (C1).

Motion contract:
Use the recorded Motion Contract step; flag missing handoff.

Write the receipt in the rubric's five parts, in order: Changed (by file); Grades (one line per criterion touched); Controls (which earlier study each flipped FAILS beats); Owner (at most two TASTE questions, each with the default the planner takes if unanswered); Next (one fix per FAILS). Save it as `v3/studies/<name>.md` beside the artifact copies, copied unchanged from `out/` with sha256 prefixes. A render that is absent is BLOCKED, not PASS. Propose a rubric change only through its Evolution rules: a new ruling adds a row; three consecutive HOLDS bakes one; a standing TASTE is ruled or deleted.

Return: Inspected Evidence; Grades; Controls; Owner; Next; Rubric Evolution; Concerns.

---

## Inline Gates

### Reminders

### Showcase Review Rubric
Grade only what was viewed. One mark per touched criterion: HOLDS, FAILS, UNPROVEN or TASTE, each with evidence at or above the criterion's minimum tier and the failing control it beats. Identity pigments unchanged (C1); role fills, no hex in assets (C2); designed, stippled shadows (C3, C4); black negative space, one emitter under the assets (C5, C6); frame interior refracted and drawn in depth (C7, C8); grain subordinate (C9); interior is the subject (C10); gadget familiar-impossible (C11); byte-identical renders (C12); no shimmer, drawn on twos, staggered, light lagging (C13, C16, C17, C18); acting reads without text (C14); palette travel never greys (C15). Receipt in five parts: Changed, Grades, Controls, Owner, Next.

Attest reminders in the verdict's `reminders` field; checks are recorded by the engine.

---

---

### Required Response Format

**Summary**: What was implemented (2-3 sentences)

**Gate Coverage**:
- [1] PASS|FAIL: rationale
- [2] PASS|FAIL: rationale

**GATE_REVIEW: PASS|FAIL - overall assessment**

Chain: chain-showcase_asset_muse#1
→ Progress 3/3
Next: chain_id="chain-showcase_asset_muse#1", user_response="<your step output>", gate_verdict="GATE_REVIEW: PASS|FAIL - <why>"
