## Summary

<!-- One sentence completing "After this merges, ___" — the OUTCOME, not the activity.
     Then ≤5 bullets, each ONE consumer-observable change in ≤2 lines. Link the plan if
     there is one (`plans/...`); do not re-tell it. Anything only a session participant
     would understand belongs in the plan's implementation-notes, linked, not here.
     A PR is one PLAN or GOAL; each concern inside it is its own commit. -->

## Demonstration

<!-- REQUIRED for feat / fix / perf / refactor — show it, do not describe it. Pick one:
       · a tool-response transcript, BEFORE and AFTER, in fenced blocks (this server's screenshot)
       · a ```mermaid``` stateDiagram / sequenceDiagram for a lifecycle or pipeline change
       · a before/after table for a contract or output-shape change
       · a screenshot or GIF when there is a UI or terminal to show
     `verify-*.mjs` drives already emit transcripts — capture, do not paraphrase.
     docs / chore / ci PRs may write `n/a: <reason>`. -->

## How it was verified

<!-- REQUIRED. A TABLE, not a count wall — one row per property:
       | Claim | Probe (command) | Baseline → measured | Mutation that fails it |
     A number without a baseline is noise; a null result ("no leak") needs the positive
     control that proves the probe can see something. CI results belong here only if CI
     actually exercises the changed path. -->

## Notes for Reviewers

<!-- REQUIRED. ≤3 pointers: the commit or file to DISTRUST and why. A reviewer's scarcest
     resource is knowing where to look. No history here — a falsified ruling or a deviation
     is a link to implementation-notes, not a paragraph. -->

## Still open

<!-- Plan row ids + links, one line each. Write "None" if none.
     A draft PR says here what makes it ready. -->

## README Charter Compliance

<!-- Answer all 5 only if this PR touches README.md; otherwise write "Not applicable".
     Charter: docs/portfolio/readme-charter.md -->

1. Charter sections touched:
2. Did `npm run validate:readme` pass locally?
3. First 30 lines still contain the pitch table?
4. Any new `<details>` blocks above the fold? (charter §4)
5. Any new cross-link — what Diátaxis quadrant does it point to?

<!--
Generate this skeleton pre-filled from your branch: `npm run pr:body -- --out /tmp/pr-body.md`
(inside server/). Check it before opening: `node scripts/validate-pr-body.mjs --body-file /tmp/pr-body.md --title "<title>"`.
The squash-merge commit carries THIS body, verbatim — it is what `git log` shows forever.
A commit map is appended automatically by CI — do not maintain one by hand.
-->
