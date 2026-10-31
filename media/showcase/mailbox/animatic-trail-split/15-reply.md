**Summary**: Filed the pass: the study `v3/studies/animatic-02.md` (the earlier receipt) now ends with a dated `## Split-form drive` section holding the per-step gate table, the planted refusal and the receipt directory `evidence/drive-kNopGR`. No `shots.json`, `script.md`, `creative-spec.md` or board file changed, and the plan's `## Now` block was not touched because this task may not write under `plans/`.

## Context
Shot `media/showcase/v3`, pass `animatic-02`. The handoff-artifacts gate reads the `artifacts:` line under `done` and checks each path from the server root. The copies under `v3/studies/animatic-02/` are from the earlier run and unchanged; their sha256 prefixes stay as filed in the study (`animatic-02.mp4` f1daee09a10e, `contact-strip.png` 01298a29d8d6, `probe-all.txt` 0d735fa84b55).

## Analysis
done — artifacts: ../media/showcase/v3/studies/animatic-02.md ../media/showcase/out/animatic-02-contact.png ../media/showcase/v3/studies/animatic-02/contact-strip.png ../media/showcase/v3/studies/animatic-02/animatic-02.mp4 ../media/showcase/v3/studies/animatic-02/probe-all.txt

Script Feed: no delta to `v3/shots.json` or `v3/script.md`, because this is a re-drive of contracts already filed and no beat was re-rendered or re-graded in motion. Rulings Recorded: none, no Owner answer arrived. Board Rebuilt: no.

## Goals
Record, for every step of the chain, whether the engine's shell block rendered and what it returned, and prove the chain refuses a broken contract.

## Execution
Changed (by file): `v3/studies/animatic-02.md` appended (backup of the earlier bytes at `~/.cache/animatic-split/before/animatic-02.md`). `v3/blocking/arrival.json` was altered for one attempt and restored, `cmp` identical to `~/.cache/animatic-split/before/arrival.json`. Nothing committed or pushed.

## Evaluation
The check for this step is `node check-artifacts.js`, which the engine runs against this reply; the five paths above exist at the time of writing.

## Refinement
Open: the manifest gate of step 4 stays red until the owner of `out/s01-arrival-overwhelm` re-renders it; a PASS verdict over a failing probe was not tried.
