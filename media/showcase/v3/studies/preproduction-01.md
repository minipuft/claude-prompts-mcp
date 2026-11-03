# Study preproduction-01 · package grade

2026-10-13 · `showcase_preproduction` run 1 (`chain-showcase_preproduction#1`, isolated server, receipts under `evidence/drive-YLNwJv`, mailbox `mailbox/preproduction-2`). Graded against `v3/rubric.md` v1.3. The package is three artifacts and no render, so every render-tier criterion is UNPROVEN by definition, not PASS.

## Changed

- `v3/references/board.json` → board-04 (laws.medium block; D41/D56/D57/D58 reachable), `board.html`, `board.png` 1600x6072 · sha 1397ba9f4a53
- `v3/beats.json` beats-01 (6 beats, 1200 frames, 6 joins) · sha c2b8b51a05dd
- `v3/shots.json` shots-01 (8 shots, 12-object inventory with muse commands) · sha 825502fc9be4
- `script.md` untouched.

## Grades

- C2 HOLDS — `src/library/tokens.ts` + `rg -n "#[0-9a-f]{6}" src/library/cast src/library/props` returns only role bindings; the package references roles, never hex — beats a hex literal in an asset SVG.
- C5 UNPROVEN — needs a still; the shot list names one emitter per shot and a black field, which is the contract, not the evidence.
- C6 UNPROVEN — one emitter per shot is declared in every `shots[].emitter`; layering is a render fact.
- C12 UNPROVEN — determinism is measured on a render; the render study's double render is the probe.
- C13, C16, C17, C18 UNPROVEN — motion criteria; beats-01 declares twos, staggers of 3–4 and a lag chain, which the motion step of each shot run must honour.
- C14 UNPROVEN — acting is a moving-render criterion.
- C15 UNPROVEN — palette travel needs a mid-morph still.
- C19 HOLDS — no asset has entered a shot: `object_inventory[*].sheet_accepted` is null for all 12 and every entry carries a muse command citing board card ids; the rule is encoded before any render exists — beats the beat1-11 human (first draw, no sheet).
- C1, C3, C4, C7, C8, C9, C10, C11 — not touched by this package (asset and render criteria); omitted, not implied.

## Controls

- C19: beat1-11 human (first draw, no sheet) → shots-01 inventory (12/12 with muse commands, 0 accepted).
- C2: no flip; already HOLDS since beat4-still-01.

## Owner

1. TASTE — the companions (Codex, Clawd) exist as sprites with fixed identity pigments. Re-muse them under D56 like every other object, or keep them as identity anchors and muse only the human and the nine props? Default: keep them, muse the rest; flips if the first human sheet makes the trio read as two species.
2. TASTE — beat 2 cuts once (pop, then wide). Keep the cut, or hold one camera for the whole beat and let the projections fill the arrival framing? Default: keep the cut; the wide is what makes "everything at once" read.

## Next

- No FAILS. UNPROVEN rows close only through `showcase_shot` runs; the first run is s05-the-frame (provable without the human), after the frame and gadget muses.
- Muse order from the inventory: human, frame, gadget, bubble, box, then stalk, string, arch, patch, ring.
- Wire a composition that reads `beats.json` and `shots.json` so a shot run renders by shot id instead of a hand-written scene.

## Owner answers (2026-10-13)

1. Companions: keep, but their construction morphs to the world (D63); both get a muse pass; inventory updated.
2. Cuts: the fewest; morphs, transitions and camera moves along leading lines (D64). shots-01 (8 shots, 6 cuts) re-cut as shots-02: 4 shots, 0 cuts, each boundary a move led by a world line (bubble/stalk widen, slid-back stalk pan, beaded-string push, silhouette pull).
