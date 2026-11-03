═════════════════════════════════════════════════════════════════
EXECUTION BRIEF (sub-agent prompt — pass everything between these delimiters)
═════════════════════════════════════════════════════════════════

### Original Request Intent

This step was given the following request. Your work must satisfy this intent:

- **asset**: pieces: the family the gadget projects as one sheet: stalk (prompt, curling with a flag leaf), arch (gate, pointed with keystone), ring (framework, a receding turned frame), block, frame (prompt_engin...
- **constraints**: Five-role flat drawing on a pure black field, pale contour one step lighter than each fill (D76/D71), Seuss silhouette grammar (swooping lobes, curling stalks with flag leaves, stacked pointed arches)...

Asset: pieces: the family the gadget projects as one sheet: stalk (prompt, curling with a flag leaf), arch (gate, pointed with keystone), ring (framework, a receding turned frame), block, frame (prompt_engine, held up), soft ground patch, and the beaded light string (chain). Hand-coded today: src/library/props/Pieces.tsx and Frame.tsx.
Muse directions:
**Summary**: Design muse for the pieces (row 5.2): three directions from the owner's library cards (picks.json by eagle id and facet), each between one existing cast property and the Seuss grammar. The step rendered an empty Challenge line (the `challenge: asset` mapping did not carry; constraints did), so the asset is restated here from `v3/shots.json` object_inventory. creed: n/a, no CloudySky visual surface.

**Gate Coverage**:
- [1] PASS: framework-compliance, all eight muse sections in order with a counterexample and a reversal condition.

## Context
### 1. FRAME
Asset: the piece family the gadget projects, one sheet: a stalk (a prompt: a curling stalk with a flag leaf), a pointed arch (a gate, with a keystone), a ring (a framework: a receding turned frame), a block, a frame (prompt_engine, held up), a soft ground patch and a beaded light string (a chain) joining two stalks; hand-coded today in Pieces.tsx and Frame.tsx. Surface: a five-role flat drawing on a black field in the s01 colour script (radiance #0a51fb, accent #fad204), pale contour, two-scale stipple shadow, parts that cut into movable layers (D68). Observation: the current pieces (Pieces.tsx, Frame.tsx) are generated strokes and kit rectangles; each member is correct in role and none is related to the others by one grammar. The comparison that resolves the uncertainty: three variants at one scale, each citing library cards and one cast property.

## Analysis
### 2. GOAL-RELATIVE REFERENCE SET
| Pointer / source | Role | OBSERVATION | INTERPRETATION | TRANSFER | Confidence |
| --- | --- | --- | --- | --- | --- |
| MFI6SELJHX04J (composition.framing=tower) | property donor | height told by one vertical and a flat pattern | the facet is what the owner filed it for | carry the facet, not the subject | medium: one image per card |
| MFI6SELJHX04J (colour.scheme=two-tone) | property donor | two tones per member | the facet is what the owner filed it for | carry the facet, not the subject | medium: one image per card |
| MFI6QTUOYA66U (composition.framing=window) | property donor | windows framing what is inside the architecture | the facet is what the owner filed it for | carry the facet, not the subject | medium: one image per card |
| MFP3WX8X3LIX2 (composition.framing=doorway) | property donor | a lit doorway the interior shows through | the facet is what the owner filed it for | carry the facet, not the subject | medium: one image per card |
| LYCZ7B8LTHX9V (fx=none) | property donor | pure thin lines on a blank field | the facet is what the owner filed it for | carry the facet, not the subject | medium: one image per card |
| LYCYY9LR7XD55 (fx=glow) | property donor | lit edges as glowing lines | the facet is what the owner filed it for | carry the facet, not the subject | medium: one image per card |
| counterexample: the hand-coded pieces (src/library/props) | boundary | correct role, no cited reference | a first draw cites nothing (C19's own failing control) | kept as a control, not replaced | high |

### 3. CAPABILITY CONTRACT
| Desired property | Primitive | Control parameters | [we own] or [client limit] | Verification |
| --- | --- | --- | --- | --- |
| one emitter, flat silhouette | role fills + Radiance layer | accent role, emitter anchor | [we own] | colour probe on the render |
| parts that move | cut layers from the generated plate (D68) | per-part mesh | [we own] | cutout check |
| drawing by image model, not coordinates | imagegen tool (codex exec) | prompt, reference images | [client limit]: the model draws what it likes within references | receipts name referenced_image_paths |

### 4. DISTINCT DIRECTIONS
- **muse-01 Seuss grammar**: Every member in the Seuss grammar: stalks with flag leaves, a stacked pointed arch, a nested turned frame as the ring, beads as the string. Borrows MFI6SELJHX04J composition.framing (height told by one vertical and a flat pattern); MFI6SELJHX04J colour.scheme (two tones per member). Sits between codex (rounded soft silhouette) and the Seuss paintings. Failure mode: it can read as the reference's subject rather than its operation.
- **muse-02 Window family**: Every member reads as a window or doorway kit: arch as a doorway, ring as a window frame, frame as a window pair, string as lit lead lines. Borrows MFI6QTUOYA66U composition.framing (windows framing what is inside the architecture); MFP3WX8X3LIX2 composition.framing (a lit doorway the interior shows through). Sits between clawd (stubby plated block bodies) and the Seuss paintings. Failure mode: it can read as the reference's subject rather than its operation.
- **muse-03 Line family**: Every member is mostly thin lit lines: stalk and arch as glowing edges, ring as concentric lines, the string a web of beaded lines. Borrows LYCZ7B8LTHX9V fx (pure thin lines on a blank field); LYCYY9LR7XD55 fx (lit edges as glowing lines). Sits between human (thin tapered pale contour) and the Seuss paintings. Failure mode: it can read as the reference's subject rather than its operation.

### 5. PAIRWISE CRITIQUE
Deciding distinction: which cast property the form leans on. muse-01 vs muse-02: the first leans on codex, the second on clawd; muse-03 is the stranger transfer. The owner picks; this is a goal-local proposal.

## Goals
### 6. CONTROLLED VISUAL EVIDENCE
Artifact: three generated sheets (assets/props/pieces/muse-01..03.png). One variable: the design direction. Held constant: black field, five roles, contour weight, the shot's colour script, layout of states. Observable comparison: reads at 64 px, parts separable, one emitter. Reversal: if all three read as the hand-coded prop, the cards are the wrong donors.

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
| muse-01 Seuss grammar | MFI6SELJHX04J composition.framing=tower, MFI6SELJHX04J colour.scheme=two-tone | codex: rounded soft silhouette |
| muse-02 Window family | MFI6QTUOYA66U composition.framing=window, MFP3WX8X3LIX2 composition.framing=doorway | clawd: stubby plated block bodies |
| muse-03 Line family | LYCZ7B8LTHX9V fx=none, LYCYY9LR7XD55 fx=glow | human: thin tapered pale contour |

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
