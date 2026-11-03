Episode root: {{episode_root}}
Renderer: {{renderer}}
Production root: {{output_root}}
Notes:
{{context | default("none")}}

Read the ledger in the episode root (`beats-v2.json`, else `beats.json`) and its revision note, the hold band in `studies/craft-ref-01.md` (11–27 frames, 3–6 drawings per move) and `creative-spec.md` for the episode's duration ruling. Run `node scripts/animation/compile-timeline.mjs` in the renderer to write `<episode_root>/timeline.json`; never hand-type frame numbers. Report, as a table per beat: id · world · start–end · seconds · transition in/out · crossing window · state flips with scope. Name every ask the ledger leaves open with its default, and every beat whose actions cannot fit its seconds at the hold band (a beat with N drawn actions needs at least N × 11 frames of holds plus 3–6 drawings per move). Pacing is the timeline's own data: propose seconds changes as a diff to the ledger, not as prose, and apply only what the notes authorize. The gate runs `probe-timeline.py`; quote its lines. Reply: Timeline (the table), Pacing (fits / does not, per beat), Asks (each with default), Changed (files), Receipt.