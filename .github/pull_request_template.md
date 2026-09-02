## Summary

<!-- One sentence completing "After this merges, ___" — the OUTCOME, not the activity.
     Then ≤5 bullets, each ONE consumer-observable change in ≤2 lines. No plan vocabulary or
     row ids anywhere in the body: the `Plan:` footer (bottom) is the only sanctioned plan
     mention, and session reasoning lives in the implementation-notes or the collapsed
     Appendix. A PR is one PLAN or GOAL; each concern inside it is its own commit. -->

## Demonstration

<!-- REQUIRED for feat / fix / perf / refactor — show the CONSUMER-OBSERVABLE DELTA: the surface
     someone actually touches (tool response, CLI output, refusal message, lifecycle), BEFORE and
     AFTER, one screen max. Forms by how they age: fenced transcript > mermaid > table > image.
     `verify-*.mjs` drives already emit transcripts — capture, do not paraphrase.
     docs / chore / ci PRs may write `n/a: <reason>`. -->

## How it was verified

<!-- REQUIRED. A TABLE, not a count wall — one row per property:
       | Claim | Probe (command) | Baseline → measured | Mutation that fails it |
     A number without a baseline is noise; a null result ("no leak") needs the positive
     control that proves the probe can see something. An unfilled row fails the gate. -->

## Notes for Reviewers

<!-- REQUIRED. ≤3 pointers: the commit or file to DISTRUST and why. A reviewer's scarcest
     resource is knowing where to look. History and rationale go in the Appendix, not here. -->

## Still open

<!-- Remaining work in plain reader terms, one line each; write "None" if none.
     No plan row ids — and note the Plan footer contract below. -->

## README Charter Compliance

<!-- Answer all 5 only if this PR touches README.md; otherwise write "Not applicable".
     Charter: docs/portfolio/readme-charter.md -->

1. Charter sections touched:
2. Did `npm run validate:readme` pass locally?
3. First 30 lines still contain the pitch table?
4. Any new `<details>` blocks above the fold? (charter §4)
5. Any new cross-link — what Diátaxis quadrant does it point to?

<!--
TWO-REGISTER BODY. Reader voice above; below, an optional collapsed archive:
  <details><summary>Appendix — session archive</summary> … </details>
The appendix (deviation log excerpts, captured drive transcripts, extended verification) is
exempt from the word budget and — because squash merges carry the PR body — lands greppable
in main's history. The generator seeds it from your implementation-notes.

PLAN FOOTER CONTRACT. If this PR executes a plan, end the body with exactly one line:
  Plan: `plans/<path>.md`
The gate FAILS while that plan's `status:` is non-final — finalize (every row terminal,
retired) in this same PR. No other plan mention belongs in the body.

Generate this skeleton pre-filled: `npm run pr:body -- --out /tmp/pr-body.md` (inside server/).
Check before opening: `node scripts/validate-pr-body.mjs --body-file /tmp/pr-body.md --title "<title>"`.
A commit map is appended automatically by CI — do not maintain one by hand.
-->
