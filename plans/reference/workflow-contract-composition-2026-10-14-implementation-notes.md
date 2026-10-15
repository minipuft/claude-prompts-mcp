---
title: Workflow contract composition implementation notes
date: 2026-10-14
status: reference
tags: [workflows, contracts, integration]
---

# Composition implementation notes

## 2026-10-14 — C1 artifacts accepted under explicit index exception

Root reviewed the73-line C1 receipt, exact handbook/reference diff and root-index-review/logical-review.json. Seven working conflicts resolved; docs57/100, seven actual changed paths, three allowed TypeScript projections and AGENTS unchanged. Source types/contracts/build/schema3/guidance/format and canonical lower ratchets pass. Both capture PIDs exited, ports closed and owned private roots absent.

Raw index hash differed without a retained initial binary; exact-index custody failed and remains failed. Current2017 stage0 blobs match initial byte-identical working merge snapshot, modes match branch mode merge, and21 initial unmerged entries are unchanged. Root review did not modify index; HEAD and MERGE_HEAD exact. This adjudicates current logical correctness only, not historical metadata causality. Preserve guard-after supersession by guard-final and index-final-observation.

The first root reconstruction attempt used unsupported merge-tree --write-tree onGit2.34.1, failed before index writes and is retained. Current logical review supports bounded artifact acceptance without restoration. Root now stages the seven resolutions plus root plan/notes and commits the private merge; C2 test callers/typing and C3 combined transport are still pending. Worker registered-prompt attestation returned no open review; later honest FAIL was hook-blocked and abort gave guidance without termination. This is installed-call supplemental evidence only, not successful closure; no replay/clear/fake PASS.

## 2026-10-14 — C2 behavior checks pass; one incoming caller diagnostic ruled

Root read82-line receipt and one-line testdiff. Five unit files322PASS after object migration of cached gate-off verdict fixture; three integration files64PASS, total386. Initial321PASS/1FAIL and the affected89case retry retained; gate-enabled deliberate negative fails expectedisError predicate, restored89PASS. First integration observer teardown-race attempt is inconclusive, retained; only three incomplete integration files rerun. C1 source588/resource226/dist4/hook61/tooling8 files unchanged, full2048observedfileguard/rawHEAD/index/entries/protectedplan exact; all63 observedPIDs and52 privateDBpaths absent, onlyownroots removed.

C2 remains unaccepted pending test typing:332baseline→333initial/final, same1099root/563test/2102dependency-list view, no source/fatal config diagnostics or row-introduced errors, baseline unchanged. Incoming TS2322 directabortfixture still supplies stringPASS atunit prompt-engine-validation.test.ts488. R-C2-ABORT-FIXTURE extends one named owner while retaining≤3editedtests/180lines, exact structured unused companion verdict, all abort-priority assertions unchanged. New child finishes this correction/abort8/canonicaltyping332. No broad386 replay, sourcepatch, baseline increase or C3/native inference.

## 2026-10-14 — C2 accepted after abort caller migration

Root read67-line typing-fix receiptSHAfd2b2e4dfe32f434116bf0820df4b5d5f511f90aaec1d3d36cc6a902f3a0995d and exact one-line object input diff; seven priority assertions and all companion payloads unchanged. Existing386 checks plus8abortPASS=394. Cumulative2tests/4changedlines within3/180. Canonical type ratchetPASS332; raw final diagnostic bytes equal initial333 minus exactly named TS2322; four pre-existing owner diagnostics and same1099root/563test/2102dependency compiler view unchanged, no baseline producer/cast/suppression. Pinnedformat/diffPASS.

RawHEAD/index/2026stage0entries/2048observedfiles/protectedtwo plans and priorfixture exact; source588/resources226/dist4/hooks61/tooling8 and C1bundle068fab4e… byte/mode-equal. ThreePIDs/eightabort runtimeroots/elevenDBpaths/privatecache roots observedthenabsent; no MCP bookkeeping. Evidence-helper baseline-field lookup corrected without check replay. Root accepts C2 source/test compatibility only; C3registeredSTDIO/HTTP and PRCI/native remain pending.

## 2026-10-14 — Readiness82/85; bounded metadata/catalog repair

Canonical validate:all completed82PASS/3FAIL. Source types/lint/test typing/contracts/architecture and other members passed. Failures: generated module-catalog drift from composedsource; root-authored new plan missing tags, notes missing frontmatter, C3stamp used semicolon rather than required middle dot. Root fixes its own plan fields, adds C2.5 sole generatedcatalog owner, and reruns only those3failedmembers after canonical catalog regeneration. No source/runtime/baseline relaxation or full85replay. Preserve red readiness log.

## 2026-10-14 — R-TAKEOVER: Claude planner continues this plan

The Codex planner session ran out of tokens after committing C2 (4558df34) and leaving C2.5 uncommitted. The owner ruled (2026-10-14, in the Claude review thread) that the Claude session takes over this plan, the pause plan's commit-only step and the 0C2/0C3 PR boundaries. Accepted receipts carry over unchanged; nothing is re-run that no named byte change invalidated.

C2.5 accepted: the uncommitted catalog regeneration (engine-gates 0.55→0.56) and the plan frontmatter/stamp fixes were read, and the three failed readiness members re-run green on this tree. The raw-index exception from C1 stays recorded as it was.

- **R-PR**: the combined branch opens its own PR stating it supersedes #488 and #489; both drafts close as included once it merges. #489's branch is not fast-forwarded, so its review record stays as written.
- **R-ORDER**: merge 0C3, then 0C2, then this branch. The coverage branches are ready now and touch no verdict code; this branch waits on C3 and carries the breaking change, so it lands last and the release PR (#473, not cut) picks up 6.0.0 once.
- **R-C3**: one STDIO session and one fresh HTTP request sequence against the built combined `dist/`, each showing: a string `gate_verdict` refused with the object shape named, an object verdict accepted, and `gate_action:"abort"` ending the run. A positive control is required: the same probe against `origin/main`'s build must ACCEPT the string verdict, or the refusal observation proves nothing. Driver lives outside the repo; no installed-plugin or shared runtime-state mutation (private `MCP_RUNTIME_ROOT`, `MCP_RESOURCES_PATH` unset).

## 2026-10-14 — C3 accepted

Planner read the drive's results file (`results` per build × transport × behavior, `started` PIDs) against the handoff table; they agree. The positive control fired: origin/main accepted `"GATE_REVIEW: PASS - ok"` over STDIO and HTTP, so the candidate's refusal (`gate_verdict takes the structured object, not a string. Resend it as {"overall": ...`) is the change and not a broken probe. The refusal happens at schema validation, before any review state is read. Abort was contrasted against main, where it is refused before review exhaustion; the abort positive control is the control schema still carrying `cancel`.

- **F-C3-1 (finding, no row)**: resuming an aborted run returns `isError:false` with `Chain run already complete ... Status: cancelled`. A client that reads only `isError` sees success. It is the existing completed-run response, not introduced by this composition; it belongs to the conversation-pause plan's resume surface, which owns run-state responses.
- **F-C3-2**: gated `prompt_engine` calls over HTTP emit `notifications/chain/step_complete` SSE frames before the response frame; an ad-hoc driver must match by id. `scripts/verify-mcp-surface.mjs` already does.

## 2026-10-15 — C4: main merged, plan retired in #492

#490 and #491 merged first (R-ORDER). Merging main produced five conflicts, none in source: the module catalog (regenerated), both ratchet baselines (re-measured on the merged tree: lint 2321/693 → 2298/690, knip 1059 → 1049, no rule above main), and the remediation plan's Now block and notes (Now rewritten to the post-merge state; notes kept from both sides, empty base). #488 and #489 close as included once #492 merges.

## 2026-10-15 — C4.1: #491's chain-session tests follow the composed store contract

#492's first CI run failed three unit files #491 added (`handoff-claim`, `run-index-invariant`, `multi-session-listing`); they passed on main and assumed main's store contract. Each was an outdated test premise, not a source contradiction, and each cites the #489 commit that changed the contract on purpose: the registry claim takes the claimer's run scope and an optional request filter (`2d5346e1`); a claim needs a complete execution blueprint (`acbeed71`, `isCompatibleBlueprint`); a numbered run id no longer falls back to its base chain (`2d5346e1`, F22 in the client-workflow plan). 3 test files, +37/−6, no `src/` change; 67/67 pass, and each repaired test goes red against a planted defect in the source it guards (scope argument dropped, chain-index write removed, base fallback restored), restored exactly. Finding: any test that creates and then claims a run needs a full blueprint; `{parsedCommand:{promptId}}` alone is refused `no-blueprint`.
