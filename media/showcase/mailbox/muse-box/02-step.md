═════════════════════════════════════════════════════════════════
EXECUTION BRIEF (sub-agent prompt — pass everything between these delimiters)
═════════════════════════════════════════════════════════════════

### Original Request Intent

This step was given the following request. Your work must satisfy this intent:

- **asset**: box: the package with its lid; the lid lifts to let the bubble swell out (s01 beats 1-2). Hand-coded today: src/library/props/Box.tsx.
- **constraints**: Five-role flat drawing on a pure black field, pale contour one step lighter than each fill (D76/D71), Seuss silhouette grammar (swooping lobes, curling stalks with flag leaves, stacked pointed arches)...

Asset: box: the package with its lid; the lid lifts to let the bubble swell out (s01 beats 1-2). Hand-coded today: src/library/props/Box.tsx.
Muse directions:
**Summary**: Design muse for the box (row 5.2): three directions from the owner's library cards (picks.json by eagle id and facet), each between one existing cast property and the Seuss grammar. The step rendered an empty Challenge line (the `challenge: asset` mapping did not carry; constraints did), so the asset is restated here from `v3/shots.json` object_inventory. creed: n/a, no CloudySky visual surface.

**Gate Coverage**:
- [1] PASS: framework-compliance, all eight muse sections in order with a counterexample and a reversal condition.

## Context
### 1. FRAME
Asset: the box: a plain package, flat and ordinary, whose lid lifts on a back hinge to let a bubble swell out; hand-coded today in Box.tsx. Surface: a five-role flat drawing on a black field in the s01 colour script (radiance #0a51fb, accent #fad204), pale contour, two-scale stipple shadow, parts that cut into movable layers (D68). Observation: the current box is a flat navy parallelogram with a hinged lid (Box.tsx): it reads as a generic crate and carries none of the world's lobes or stalks. The comparison that resolves the uncertainty: three variants at one scale, each citing library cards and one cast property.

## Analysis
### 2. GOAL-RELATIVE REFERENCE SET
| Pointer / source | Role | OBSERVATION | INTERPRETATION | TRANSFER | Confidence |
| --- | --- | --- | --- | --- | --- |
| MTR8RSMQ452E8 (light.contrast=hard) | property donor | one hard emitter lights the form on black, the rest unlit | the facet is what the owner filed it for | carry the facet, not the subject | medium: one image per card |
| MFJFTELGH6FD8 (light.source=single-emitter) | property donor | a single radiant seam behind a flat silhouette that never whites out | the facet is what the owner filed it for | carry the facet, not the subject | medium: one image per card |
| MFI6SELJHX04J (composition.framing=tower) | property donor | height told by one vertical and a flat pattern | the facet is what the owner filed it for | carry the facet, not the subject | medium: one image per card |
| MFJFTELGH6FD8 (composition.scale=figure-small) | property donor | the box stays a small silhouette against the radiant core | the facet is what the owner filed it for | carry the facet, not the subject | medium: one image per card |
| MFI6QTUOYA66U (composition.framing=window) | property donor | a window framing what is inside the architecture | the facet is what the owner filed it for | carry the facet, not the subject | medium: one image per card |
| MFI6SELJDBV13 (light.source=single-emitter) | property donor | one emitter inside an otherwise dark space | the facet is what the owner filed it for | carry the facet, not the subject | medium: one image per card |
| counterexample: the hand-coded box (src/library/props) | boundary | correct role, no cited reference | a first draw cites nothing (C19's own failing control) | kept as a control, not replaced | high |

### 3. CAPABILITY CONTRACT
| Desired property | Primitive | Control parameters | [we own] or [client limit] | Verification |
| --- | --- | --- | --- | --- |
| one emitter, flat silhouette | role fills + Radiance layer | accent role, emitter anchor | [we own] | colour probe on the render |
| parts that move | cut layers from the generated plate (D68) | per-part mesh | [we own] | cutout check |
| drawing by image model, not coordinates | imagegen tool (codex exec) | prompt, reference images | [client limit]: the model draws what it likes within references | receipts name referenced_image_paths |

### 4. DISTINCT DIRECTIONS
- **muse-01 Block box**: A stout box built of two stacked soft blocks with a lobed cap for a lid and one small curled flag-leaf latch; its only light is one hard seam as emitter. Borrows MTR8RSMQ452E8 light.contrast (one hard emitter lights the form on black, the rest unlit); MFJFTELGH6FD8 light.source (a single radiant seam behind a flat silhouette that never whites out). Sits between clawd (stubby blocky body and flat plates) and the Seuss paintings. Failure mode: it can read as the reference's subject rather than its operation.
- **muse-02 Swoop crate**: A tall crate whose sides swoop in like a Seuss tower, a curling stalk as the handle, the lid a long pointed cap lifting on the back edge. Borrows MFI6SELJHX04J composition.framing (height told by one vertical and a flat pattern); MFJFTELGH6FD8 composition.scale (the box stays a small silhouette against the radiant core). Sits between human (long swooping line and tapered tips) and the Seuss paintings. Failure mode: it can read as the reference's subject rather than its operation.
- **muse-03 Nested lid**: A low rounded box whose lid is a slightly turned frame, itself holding a smaller frame: lifting the lid opens a window into the box. Borrows MFI6QTUOYA66U composition.framing (a window framing what is inside the architecture); MFI6SELJDBV13 light.source (one emitter inside an otherwise dark space). Sits between codex (rounded soft silhouette and screen window) and the Seuss paintings. Failure mode: it can read as the reference's subject rather than its operation.

### 5. PAIRWISE CRITIQUE
Deciding distinction: which cast property the form leans on. muse-01 vs muse-02: the first leans on clawd, the second on human; muse-03 is the stranger transfer. The owner picks; this is a goal-local proposal.

## Goals
### 6. CONTROLLED VISUAL EVIDENCE
Artifact: three generated sheets (assets/props/box/muse-01..03.png). One variable: the design direction. Held constant: black field, five roles, contour weight, the shot's colour script, layout of states. Observable comparison: reads at 64 px, parts separable, one emitter. Reversal: if all three read as the hand-coded prop, the cards are the wrong donors.

## Execution
### 7. SYNTHESIS
- [CRITIQUE] weakest point: a generated plate may merge parts, which the cut step then rejects.
- [ALTERNATIVES] keep the hand-coded prop: costs C19, buys nothing.
- [SYNTHESIS] render all three, pick nothing; sheet_proposed set, sheet_accepted null.
- [COUNTER-VECTOR] the assumption that the prop should look like its subject.

## Evaluation
Cast-property table:
| Variant | Cards | Cast property |
| --- | --- | --- |
| muse-01 Block box | MTR8RSMQ452E8 light.contrast=hard, MFJFTELGH6FD8 light.source=single-emitter | clawd: stubby blocky body and flat plates |
| muse-02 Swoop crate | MFI6SELJHX04J composition.framing=tower, MFJFTELGH6FD8 composition.scale=figure-small | human: long swooping line and tapered tips |
| muse-03 Nested lid | MFI6QTUOYA66U composition.framing=window, MFI6SELJDBV13 light.source=single-emitter | codex: rounded soft silhouette and screen window |

## Refinement
### 8. CAPTURE PROPOSAL + BOUNCE
capture: none, goal-local evidence only. Forks: (1) which variant does the owner pick, default none; (2) is a soft glow acceptable on the plate or must it be flat bands, default flat bands.

Read `v3/creative-spec.md` (D65–D68: drawings come from the image model, never from coordinates; the plate must cut into movable layers), `v3/script.md` (the asset's job) and `v3/rubric.md` (C1–C19). For each muse direction (3 or more) generate one sheet through the `imagegen` tool (`tool:imagegen`), never by hand: `references` are the absolute paths of the board cards the direction cites (`v3/references/board.json` → file under `v3/references/`), the `prompt` names which reference supplies which property, asks for a pure black field, five flat colors, pale contour one step lighter, identity pigments by hex, and a parts layout (full figure plus separated head, torso, hands, hair on the same sheet) so the cutout step can rig it; `out` is `media/showcase/out/<asset>-gen-<NN>-<direction>.png`. Lay the generations into the `AssetSheet` composition as images with their labels (borrows by card id, between by cast property) and render one still at frame 0 under media/showcase/src/sheets/. Keep every generation's receipt (prompt, referenced_image_paths, source, sha256) in the step output. Do not pick; the owner picks from the still. A generation that is not cuttable into layers (merged parts, gradients across parts, text) is marked REJECTED on the sheet and regenerated once.

Return: Variants (id, title, borrows, between, generation receipt); Sheet Path; What Was Held Constant; Rejected Generations; Concerns.

### Result Contract

Return your complete work product as plain text — it becomes the chain’s step output verbatim.

You are the worker for this one step. Do not call `prompt_engine` or any other chain tool, and do not put chain metadata or tool calls in your reply — the orchestrating agent owns the run and resumes it with your text.

End your reply with this exact block — `node` is how the server matches your result back to this step:

```
HANDOFF RESULT
node: sheet
```

═════════════════════════════════════════════════════════════════
END EXECUTION BRIEF
═════════════════════════════════════════════════════════════════

⚡ HANDOFF: Execute Step 2 ("Showcase Asset Sheet") via sub-agent for context isolation.

═════════════════════════════════════════════════════════════════
HANDOFF INSTRUCTIONS
═════════════════════════════════════════════════════════════════

→ Handoff: Use your client's sub-agent/handoff capability
→ Prompt: Pass the EXECUTION BRIEF above (everything between the BRIEF delimiters) as the agent's prompt
→ Result: Include the sub-agent's result in user_response to continue the chain

⚠️ CONSTRAINT: Use handed-off execution when available; do not answer inline if handoff exists.
⚠️ RESULT CONTRACT: Include handed-off output in user_response and then resume the chain.

---

### Required Response Format

**Summary**: What was implemented (2-3 sentences)

Chain: chain-showcase_asset_muse#1
→ Progress 2/3
Next: Handoff via your client sub-agent mechanism (see instructions above), then: chain_id="chain-showcase_asset_muse#1", user_response="<sub-agent result>"
