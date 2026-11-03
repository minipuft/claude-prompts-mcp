# Chain bible wiring (plan row 7.5)

## 2026-10-18 - the chains file their findings and picks into the bible

What changed for the next run: the animatic and shot chains now end by checking the production bible, and the steps that produce findings or reference picks write them as proposals the bible page shows. Everything below went through `workflow-client.mjs call` against the isolated showcase server; each receipt directory is under `media/showcase/evidence/`.

| Payload | Receipt | What changed |
| --- | --- | --- |
| 141-144, 145 (inspect) | call-7Z4E4S, call-P4gjLb, call-4j0xSr, call-79YFUd, call-HRWC5f | Read the four chains/prompts and the muse's sheet prompt before touching them. Inspect shows a chain's step list but not each step's gates, so the step gates were read from the prompt files on disk. |
| 146-gate-animation-bible | call-mcNMNx | New blocking check-tier gate `animation-bible`. It runs `python3 scripts/animation/probe-bible.py v3/bible.json --page out/bible.html` in `../media/showcase` (same shape as `animation-render-manifest`). Its guidance says: quote the refused line, run `npm run bible`, never edit the bible, the probe or a proposal to pass; control: a proposal anchored outside its beat is refused. |
| 147-showcase_evidence-file-findings-as-proposals | call-aGoQFB | The evidence step now writes one `finding` proposal file per finding in the review's receipt (shape spelled out in the prompt, copied from p001 and adapted), then runs `npm run bible` and reports the proposal ids and the probe's line. Arguments unchanged. |
| 148-animation_animatic-bible-gate | call-OZzwsp | Animatic evidence step gates: `handoff-artifacts`, `animation-bible`. All other steps unchanged. |
| 149-showcase_shot-bible-gate | call-usrcM0 | Shot evidence step gates: `animation-bible`. The step had no gate before, so there is no `handoff-artifacts` to keep. |
| 150-showcase_asset_sheet-file-picks-as-proposals | call-irmPFk | The muse's sheet step files one `inspiration` proposal per direction, anchored to the first beat the asset appears in, referencing board or owner-pick ids, with the sheet image under `after.frames`. The `imagegen` tool binding and the muse chain's gates are untouched. |
| 151-156 (inspect after) | call-vBIRXG (gate), call-ID5a0i, call-WNDkzi, call-cI3Xvy, call-mLGL5h, call-ddshkg | Gate loaded with blocking enforcement; prompt text of evidence and sheet carries the new paragraphs. |

Not yet shown: a chain run in which the gate's `Shell Verification Results` appears. That is the animatic 04 drive (row 7.5's own check).
