---
title: Semantic-gate review remediation notes
date: 2026-10-11
status: active
tags: [gates, semantic-evaluation, review]
---

# Semantic-gate review remediation — implementation notes

Moved from `plans/workflow-client-evaluation-2026-10-09-implementation-notes.md` on 2026-10-12 with the rows they record. One correction: the client-workflow handoff of 2026-10-12 says its untracked worktree drafts "disappeared (cause unknown)". This planner removed them on 2026-10-12 after committing them unchanged (`ede8be78`, on main via #477), not knowing another session still wrote there.

## 2026-10-12 — Tier 0 review remediation opened

- Review of #474–#476 (2026-10-11) found no failing gate and no added debt; it found two silent-skip wiring guards, a duplicated bypass/acceptance predicate, a mislabelled calibration error, a missing #476 CHANGELOG entry, four untested refusals (P8, C2, H1, H2), one unreachable branch (P5), a persistence stub, drifted test headers, inconsistent attempt numbering and response bloat. Evidence moved from `/tmp` to `~/.local/share/claude-prompts-mcp/evaluations/semantic-review-20261011/`.
- The governing plan was untracked in two checkouts. The worktree copy (newer, carrying R9.x and the 2026-10-10 stop) was committed verbatim on `fix/semantic-gate-review-remediation` as `ede8be78`, then removed from `claude-prompts-mcp-workflow-evaluation`. The older drafts in the primary checkout are superseded and left in place for the owner to delete.
- R10.1: audit the older code that dilutes coverage first (0.4, opus high), then cut cleanup rows from it.
- R10.2: comment and test-header cleanup follows a new reusable skill (0.2, sonnet high, `~/.claude`), applied by 0.7 (sonnet high).
- R10.3: one opus-high worker owns all standards findings plus the persistence stub (0.1). This overrides the ≤3-file row bound by owner direction.
- R10.4: why repetition is not prevented by code or interface is a read-only audit (0.5), answered before any fix.
- R10.5: whether the Zod schema surface is still sound is part of 0.5.
- R10.6: attempt numbering is consolidated to one truthful scheme (0.6); the same row fixes the other render mislabels the drive found.
- R10.7: the evaluations checks join the required Test Suite job; the optional path-filtered workflow is deleted as superseded (0.3).
- R10.8: the fix slice is approved; response size goes into this plan (rows cut after 0.5).
- R10.9: Tier 0 cap is 5 live workers. Editing rows share the slice worktree, commit nothing, and touch disjoint files; read-only audits run in `claude-prompts-mcp-bench-mutation` (clean `origin/main`). 0.2 edits `~/.claude` only.
- Tier 1's 2026-10-10 owner stop stays in force; Tier 0 touches no hook and no 1.x scope.

## 2026-10-12 — Wave A handoffs (0.2, 0.3, 0.5)

- 0.3 accepted. Required `Test Suite` runs `evaluations` test:core, test:gates and typecheck on the Node 24 leg; `evaluations.yml` deleted; `evaluations/**` classifies `full`.
- DEV-T0-1: 0.3 edited `server/scripts/validate-renovate-extraction.js`, outside its named files. The validator listed the deleted workflow in `ACTION_FILES` (expected count 9 → 8, negative control moved to `ci.yml`). The brief's citation pattern missed it; a bare `rg evaluations scripts server/scripts` finds it. Accepted: without it the validator fails on a missing file.
- 0.5 accepted, verdict sound-with-debt. Every repeated block comes from `renderFrozenReviewInstructions` (`describe-review-for-render.ts:201`), reached by three emitters (operator supplements, assembler CTA, footer). Sections are anonymous strings, so nothing can dedupe; `validate:domain-ownership` checks where a symbol is exported, not who composes reply text; conformance has no size or occurrence check. Kernel Zod text reaches clients because `schemaIssues` (`semantic-evaluation.ts:103`) prefixes an empty path. Rows 1.9–1.14 and Q1–Q6 recorded.
- Finding (0.5): `CLAUDE.md:324` says string-verdict retirement is measurable via the `source` field; `GateVerdictSource` records which parameter carried the verdict, not its shape, so the condition cannot be evaluated. Row 1.13.
- Finding (0.5): 1.11 is inferred from source; the detached semantic path has not been driven.
- 0.6 no longer owns the derived-FAIL message text; 1.12 does (one question, one row).
- 0.2 built `~/.claude/skills/code-comments/` (SKILL.md, references, scanner script, template), validated by `validate-skill.sh` and `lint-skills.js`; scanner controls in `/tmp/sb-ctl`. Uncommitted pending Q7.
- DEV-T0-2: 0.2 also edited `skills/_index.md`, `skills/skill-authoring/ecosystem-map.md` and `skills/testing/SKILL.md` (catalog registration), and skipped a gate pointer: `gate_table.py` rows need coded conditions, and the existing `pre-flight`/`tests` pointers fire on the same events.
- Finding (0.2): 271 lines in `server/src` and `server/tests` carry `Tier N`, `ACn` or plan references; 5 cite `~/.claude/plans`. 0.7 is scoped to the #474–#476 range (26 scanner candidates); the remainder needs its own row once 0.7 proves the pass.

## 2026-10-12 — 0.1 accepted; 0.8 opened

- 0.1 accepted (`4ef748b6`). Mutations M3, P8, C2, H1, H2, G6a, G6b each red, then reverted. Persistence: the processor's did-not-run block moved to `execution-record-store.integration.test.ts` on real SQLite with a cold reload; decision-only assertions keep a stub whose persistence methods now throw if called.
- DEV-T0-3: making `remapInlineDefinitions` required turned the earlier optional parameters into explicit `| undefined`; a third predicate `isLegacyUnverifiedAcceptance` was extracted (2 sites); a new unit file `execution-history-latest-facts.test.ts` was created because none existed. `calibration.ts` codes are plain strings with no union, so only the test changed. Accepted.
- Finding (0.1): the guard class is wider than the two named sites. Stage 11 still reads `this.gatesConfigProvider?.()` and `this.gateSystemEnabled?.(…)`, both wired. A fix at the found sites is not a fix of the class → row 0.8 enumerates by shape and adds a lint rule.
- Concern (0.1): a config mock without a `gates` key now throws in `createReview` (e.g. `tests/helpers/test-helpers.ts:382`); suites not run by the row may hit it. Checked at the PR boundary.
- The retired semantic-gate plan's `Now` and four "hosted CI pending" stamps now state the merged #476 result (R10.3 item, planner-owned plan file).

## 2026-10-12 — 0.4 accepted; Tier 0C cut

- 0.4 accepted. A fresh unit+integration run (472 suites, 8295 tests) replaced the review's subset baseline: chains/manager 76.9, gate-lifecycle 77.7, gate-discovery 61.5 branch %. All 17 files remain under 80%. Two files were classified by sub-agents and spot-checked by the 0.4 worker.
- Tier 0C has 30 rows in three module slices. R10.10: each slice ships as its own PR after the Tier 0 PR; a slice over 8 rows runs under its own planner session. 0C1 depends on 0.6/0.8/1.9 where files overlap.
- Finding (0.4): the composition root (`pipeline-builder.ts`, `prompt-executor.ts`) has no in-process test; integration tests rebuild the wiring by hand, so a dropped builder closure is invisible to jest. Row 0C1.13.
- Finding (0.4): live-and-wrong swallows → Q8 (inline gate silently unenforced), Q9 (chain manager init cause lost), skills-sync loaders that never reach `report.failures` (row 0C3.4).
- Finding (0.4): `sync-diff-commands.test.ts:208` passes without creating the stale directory it claims to keep (row 0C3.3).
- Finding (0.4): `chainSessions.reviewTimeoutMinutes` feeds a cleanup for `prompt-review-*` ids nothing mints; removing it changes `config.json` (breaking). Not proposed.
- Finding (0.4): the error-text shape recurs at 163 sites in 76 files → Q11; 0C rows do not sweep it piecemeal (R192 scope rule).

## 2026-10-12 — 0.6 and 0.8 accepted

- Combined tree after both rows: typecheck clean; `lint:ratchet` 2446 errors / 706 warnings, no regressions; `typecheck:tests:ratchet` 338; `validate:arch` 0 errors; `hooks/tests` 402 passed.
- 0.6: every attempt render routes through `shared/utils/attempt-number.ts` (1-based `attempt N/M`; `attemptInHand` = min(consumed+1, max)); storage unchanged. R10.11: the formatter stays in `shared/utils` — the review-render owner would form a cycle through `delegation/detached.ts` (measured with depcruise). `N/M` was chosen because `hooks/lib/session_state.py:248,282` parses `(attempt X/Y)` and `Attempt X/Y`.
- DEV-T0-4: 0.6 also edited docs (`ralph-loops.md`, `mcp-tools.md`), renamed shell `**Attempts:**` to `**Last run:**`/`**Next run:**` and inspect `Type:` to `Declared Type:` beside a derived `Tier:`. Defect 2's premise was wrong: the check line sat inside the `### Evaluations` block, not under Reminders (flat h3 headings); it now renders under `### Checks`. e2e expectations were updated but not run (PR boundary).
- Finding (0.6 → Tier 1, row 1.3 inventory): the blocked reply's `**Attempt 2/5**` now matches the hook regex `Attempt\s+(\d+)/(\d+)` (`session_state.py:282`), which writes gate-review attempts into the `shell_verify_attempts` field. The hook already did the same for `(attempt X/Y)`; the field conflates gate and shell attempts. Hook tests pass.
- Finding (0.6): `gate list` still shows the authored-type icon → row 0.10. Pluralization class → row 0.11 killed with reason.
- 0.8: the rule covers `?`, `| undefined` and `| null` because stage 11's motivating site was `| undefined`; the brief's narrower predicate would have missed it. Seven class-(a) sites baselined → row 0.9. 74 `this.x?.method()` dereference sites are outside the rule → row 0C1.14.
- DEV-T0-5: 0.8 hand-edited the ESLint baseline (the regenerate command would have absorbed 0.6's in-flight counts) and ran Prettier over 0.6's two handler files; 0.6 re-checked formatting after. Accepted.

## 2026-10-12 — 0.9 and 0.10 accepted

- 0.9: all 7 baselined sites plus the alias-typed `ShellVerifyExecutor.gateSystemEnabled` are required; about 110 test constructions changed (found through `typecheck:tests`, which `typecheck` cannot see). `McpToolsManager.onRestart` uses a definite-assignment `!` because it is set in `initialize()`, not the constructor. Combined tree: lint 2436/706, tests-typecheck 338, knip 1065, all OK.
- DEV-T0-6: 0.9 lowered the knip baseline (two deleted factories) and changed `JudgeResourceCollector` parameters to explicit `| null` so a required parameter could follow them. Accepted.
- Finding (0.9 → 0.7): `pipeline-builder.ts` says `PipelinePorts` is "uniformly optional"; `metricsProvider` no longer is.
- 0.10 dropped the icon instead of keeping it beside the tier: a surviving ✓ would still imply a check runs. Accepted.
- Finding (0.10): `resource://gates` renders `id: name (type)` from the authored type → row 0.12.

## 2026-10-12 — 0.12 and 0.13 accepted

- The authored-type mislabel had four human-facing surfaces: inspect (0.6), list (0.10), `resource://gate/` (0.12), `resource://gate/{id}` (0.13). Enumeration by shape (`rg "\.type\b"` over `gate-manager/services`, `resources/handlers/gate-resources.ts`, `gates/guidance`) leaves only writers and structured metadata fields named `type`, which carry the declared value.
- Finding (0.13): `ResourceDependencies.gateManager` declared `getDefinition()` on `list()` items but not on `get()`, which is why only one of the two resource views could derive the tier. Both now declare it.

## 2026-10-12 — 0.7 and 0.14 accepted

- 0.7: 63 scanner candidates (21 session ids, 1 history, 2 tense words, 1 commented code, 38 header-growth) → 21 rewritten or deleted, 24 headers edited, 14 headers kept, 1 tense word kept, 1 JSDoc example kept. The split moved 32 tests byte-identical into `review-capture-custody.integration.test.ts`; the clone-fixture block was kept because nothing else checks that the fixture leaves malformed definitions raw.
- DEV-T0-7: 0.7 renamed two describe titles (`(row 3.12)`, `R10.6:`), which are code, not comments, and fixed context lines in the same hunks and a few unflagged headers in already-touched files. Accepted.
- Finding (0.7 → `/code-comments` skill): the scanner reads added lines only and never test titles, so ids in `test()`/`describe()` names pass unseen; HEADER-UNCHANGED was right on 24 of 38. Its first `--comment-only` run with `:(top)` pathspecs was vacuous until re-run with plain paths. Row 0C1.15 adds a test-title mode before the repo-wide sweep.
- 0.14: the unreached-methods baseline reason cited acceptance ids 0.7 removed; its validator never reads reason prose.

## 2026-10-12 — Tier 0 PR boundary

- Local boundary on the slice tip: `typecheck`, `lint:ratchet` (2436/706), `typecheck:tests:ratchet` (338) and `verify:mcp` (20/20) passed; `validate:all` failed 3 of 85 steps, each attributed to this slice: `validate:knip-ratchet` (exports 428 → 427, stale ceiling), `validate:module-catalog` (new files), `validate:plan-row-tracking` (47 open stamps written `as of <date>; flips when` — the validator requires `·`, `|` or `-`; the Tier 1 rows as authored on 2026-10-09 carried the same form). DEV-T0-P1: the planner ran `knip-ratchet:baseline` and `generate:module-catalog` itself (generated artifacts, no design choice) and corrected the stamps.
- Live drive on the built tip: the 34-check semantic drive passes 34/34 on STDIO and HTTP; the new attempt, tier and pluralization texts were quoted from real replies; p05 baseline unchanged (rubric ×3, 6.9–9.7 KB per reply). The drive asserts none of the new texts, so the attempt numbering is pinned only by unit tests and the source scan.
- CI on #477: E2E (Node 24) failed 2 tests (STDIO and HTTP) in `gate-blocking-response.e2e.test.ts` — the extractor regex still matched `Attempt N of M`; 0.6 had updated the expected list but its e2e edits were never run (as its handoff said). Row 0.15 fixed it and swept `server/tests` for old attempt forms; the six e2e/integration files 0.6 edited unrun now pass locally (8 suites, 263 tests). Every other required job was green on the first run.

## 2026-10-12 — Tier 0 merged; 0C1 wave 1

- #477 merged (squash) with every required check green on its final head; the first CI run failed only E2E on the stale extractor fixed by 0.15. Row receipts now cite #477 instead of branch SHAs that the squash and branch deletion made unreachable.
- Review worktrees `claude-prompts-mcp-bench-review` and `-bench-mutation` removed (both clean); slice worktree `claude-prompts-mcp-coverage-0c1` cut from `origin/main` at #477.
- 0C1 wave 1 = the five test-only rows with no owner question and no shared file: 0C1.1, 0C1.4, 0C1.5, 0C1.6, 0C1.9.

## 2026-10-12 — 0C1 wave 1 accepted

- 0C1.1, 0C1.4, 0C1.5, 0C1.6, 0C1.9 accepted: about 145 tests added, test files only, every source file byte-identical after its mutation checks. Each worker measured on a different suite subset, so the per-row before/after figures are not comparable to the 0.4 audit's unit+integration baseline; a combined re-measure runs before the slice PR (it needs `--max-old-space-size=4096` — the default heap aborted at 2 GB, as `project_unit_suite_heap_ceiling` records).
- Finding (0C1.1): `formatUptime` lives in `action-handler-base.ts`, not the analytics handler the audit attributed it to.
- Finding (0C1.9 → row 0C1.16): four stage-20 guards cannot hold. Finding (0C1.4 → row 0C1.17): two gate-manager arms cannot run.
- Finding (0C1.4): `writeGateFiles` throws `ENOTDIR` from `planGateWrite` when the gates root sits under a regular file, instead of returning `success: false`; the handler's catch boundary turns it into an error reply, which matches the architecture's throw-to-the-boundary posture. Not a row.
- Finding (0C1.4): the repair path's "version row matched" arms (lifecycle ~441, ~484) need a real `version_history` table; left for an integration test if 0C1 coverage stays short.
- Shared-tree noise: the jest tree-state teardown guard fires on any other worker's untracked file; coverage still writes. `structured-gate-verdict-flow` fails without a built `dist` in a fresh worktree.

## 2026-10-12 — owner answers to Q1–Q12

- Ruled: R11.2 (string verdict on a semantic gate refused without spending an attempt; also fix the hints and schema that invite it), R11.5 (no `$defs`/`$ref`), R11.6 (no ceiling raise), R11.7 (commit `/code-comments` and publish the other reviewed framework changes — done as minipuft/claude-code-config#69 from a separate worktree; the Codex dev-hooks plan stays local because its frontmatter says `publish: local-only`; the `release_note` prompt stub and a playwright lockfile were left out), R11.8 (inline gate registration failure throws; retry automatically where meaningful, otherwise give the client the context to retry), R11.11 (`errorText` helper plus lint rule), R11.12 (wire `SkillsSyncCommandError.exitCode`).
- Asked back by the owner, investigation running: Q1 (what "legacy" gates are; consolidate into the structured implementation; target model: gates appear once at workflow start, step gates are add-ons integrated as the run proceeds), Q3 (prefer a codebase check that prevents duplication by construction over a conformance test), Q4 (retire the string verdict completely instead of tracking usage), Q9 (what causes the chain-manager init failure and whether a service fix exists), Q10 (what the stage-11 guards protect and whether they should become something else).

## 2026-10-12 — investigation results (Q1–Q4, Q8–Q10)

- Q9 (measured on scratch DBs): `ensureSchema()` recreates without a transaction; a forced NOT NULL restore failure threw the named error, but `schema_version` was already bumped and the `version_history` row was gone, so the next start reported the file current. → row 0D.1 (own PR). The manager's init catches are effectively dead in production (startup already refuses when the engine cannot initialize); a first-boot lock fails in 2 ms because `busy_timeout` is set after the first read; init errors do not name the db path.
- Q8: `createTemporaryGate` cannot throw for any input (canonical ids refused earlier at stage 05, generated ids cannot collide, capacity force-evicts). The silent drop is `return null` on empty or blank criteria. Same swallow shape in `temporary-gate-registrar.ts` ~:337, ~:867. Server-side retry is meaningless for an in-memory registration. 0C1.7 rewritten (⚠).
- Q10: both stage-11 guards are unreachable; stage 18 fails loudly on the same missing plan, and guard 2 sits after gate registration. 0C1.8 rewritten (⚠) to the existing `require*()` accessor pattern plus `requires`/`provides`.
- Q1: "legacy" names a submission shape (the `GATE_REVIEW:` string) and a review protocol, not a gate tier. Bundled gates: 24 reminder, 2 check, 0 evaluation; plain-criteria gates exist only at runtime (`:: "text"`) and render as reminders. A run-wide gate's full review renders on step 1 before any work, is absent from steps 2..N, and re-renders in full at every review (4× in a 3-step run).
- Q2 hints (measured): a semantic gate on step 2 makes that step's render and footer tell the client to send `gate_verdict="GATE_REVIEW: PASS|FAIL - <why>"` (`response-assembler.ts:524`, `chain-operator-executor.ts:1219`, CTA fallback `:127`); only the review path checks `submission === 'legacy'`. The served contract text never says a string cannot satisfy a semantic criterion. No real string verdicts on semantic gates exist in local runtime state (positive control saw the scratch ones).
- Q4: `GateVerdictSource` is constant (`'gate_verdict'` at every caller), so the CLAUDE.md retirement condition cannot be evaluated. Strings are still taught by server renders (13 src files), hooks (5 files), gemini-prompts (6 files) and opencode-prompts (10 files, one telling a structured FAIL to retry as `GATE_REVIEW: PASS`), and docs (8 files).
- Confirmed again: `hooks/gate-enforce.py:83-117` denies every FAIL verdict, string or object, so an honest semantic FAIL cannot leave Claude Code. This is P01 / row 1.2, under the 2026-10-10 Tier 1 stop.

## 2026-10-12 — 0C1 wave 2 and the Q8/Q10 rows accepted

- Accepted: 0C1.2, 0C1.3, 0C1.7, 0C1.8, 0C1.12, 0C1.13, 0C1.16. Lint ceiling lowered once over the whole slice: 2436 → 2408 errors, 706 → 702 warnings.
- DEV-T0C-1: 0C1.7 found the brief's premise wrong twice: the `return null` paths were unreachable (callers filter with `isValidGateCriteria`), and an empty criteria list means "no gate" because the command builder writes `[]` on ungated steps. It refused only blank strings and named gates with no criterion, and inverted one test that pinned the old swallow. `gate-enforcement-mode-publish.test.ts` had been passing with no gate registered (its mock lacked `resolveDeclared`; the deleted catch hid the TypeError). No typed `InlineGateRegistrationError` was added: nothing reachable throws there.
- DEV-T0C-2: 0C1.8 also declared `requires` on stage 13 and added `provides` to nine integration-test stubs of stage 07 (stubs are name-keyed and carry no contract — a stub helper that copies the real stage's declarations would close that class).
- Finding (0C1.7 → 0D.2): `parseCriteria` corrupts any criterion containing "and"; blank criteria die in the parser. → 0D.3: the registrar's remaining silent skips and registry force-eviction.
- Finding (0C1.13 → 0C1.18, 0C1.19): stage 12's framework context changes no rendered text; shutdown leaves the metrics interval running.

## 2026-10-12 — 0C1 merged as #478; 0D.1 at its boundary

- #478 merged (squash `ca0df3bf`) with every required check green on its head on the first CI run.
- 0D.1 accepted: six commits. R11.9 detail: a store-init failure is logged once at construction (no unhandled rejection, no shutdown) and every awaiting operation still rejects with the port's error; a port-less store refuses its first persist naming the missing port. Requiring the port was not taken: every production path passes one, and requiring it ripples through three production signatures and 56 test constructions; `runRegistry` is now optional behind one accessor, so a new unchecked read fails typecheck.
- Finding (0D.1): Jest cannot observe `unhandledRejection` from inside a test (its sandbox catches it first); the test runs the scenario in a child process with its own positive control.
- Finding (0D.1): the SQLite lock classifier now exists in the engine and the chains manager (infra cannot import modules); `instanceof Error` fails on `node:sqlite` errors under Jest. Both belong with Q11's `errorText` helper.

## 2026-10-12 — 0D.3 accepted; R11.13, R11.14

- 0D.3 accepted (`ec02d149`): every request-gate skip path is a stage-11 refusal (`gate-criteria-invalid`) naming the entry and the accepted shapes; a bare unknown id is refused (it used to register a placeholder enforcing nothing). R11.13: the temporary gate registry evicts expired gates only and otherwise refuses the new registration — never an unexpired gate, since a concurrent call's not-yet-adopted gates are indistinguishable from abandoned ones. A run resumed in another process re-registers the gates it recorded and is never refused for them; a client's new entries on that resume are still judged.
- Finding (0D.3): run-owned gates have no expiry, so many abandoned but unpruned runs could keep the registry full and refuse new calls. Finding: `%clean`/`%framework` and `gates.enabled: false` skip stage 11 entirely, so request gates sent with them may be dropped silently (code read only); a canonical reference with a target may apply to every step (code read only); `template` and `severity` on request gates are accepted and never read.
- R11.14 (owner, 2026-10-12): `and` is no longer a criteria separator; `,` `;` `|` remain. Communicated in the `command` parameter description if it fits under the unchanged schema ceiling, in `mcp-tools.md`, as a CHANGELOG `### Changed` bullet, and by the rendered gate listing each criterion (pinned by a test).
- 0D.2 accepted (`64de69f2`). `:: ""` is refused at parse time (getting it to stage 05 would change the gate token pattern in three places, including one the Python hooks read); `:: "   "` reaches the stage-05 refusal. Shared refusal text moved to `inline-criteria-refusal.ts` because the parser cannot import the processor without a cycle. prompt_engine schema headroom is now 315 bytes.
- Finding (0D.2): the gate token pattern exists three times (`operators.json`, the tokenizer's inline copy, `OPERATOR_PATTERNS`); a command whose `::` yields zero operators falls through to "Unknown prompt" for a prompt that exists; `:: ","` now becomes a gate whose criterion is `,`; `capture:tool-schemas` reflows the prettier-ignored schema snapshot on every run.
- DEV-T0D-P1: a newline-chained commit sequence ran the lint-baseline commit after the docs commit failed on header length, so the docs landed in the wrong commit; split back with a soft reset on the unpushed branch (the existing `feedback_unchained_bash_steps_run_after_failure` memory, second sighting).
- Boundary live drive on the slice: `gates:[{name:"Tone", description:"   "}]` and a blank `name` still ran silently — `mcp/tools/index.ts` normalized quick gates to `null` and filtered them before the pipeline, so registrar-level unit tests could not see it. Fixed in `7e29561d` with a composition-root test entering through the registered `prompt_engine` callback (red on the previous head), plus an enumeration of every filter/skip site from handler to registrar; the only open sites are stage 11's whole-stage skips (row 0D.4). Request-gate shape rules moved to `request-gate-refusal.ts` to keep the registrar under the 1000-line ceiling.

## 2026-10-12 — #480 merged; silent paths wave 2

- #480 merged (squash `f459bf74`): every requested gate is enforced as written or refused; criteria split on `,` `;` `|` only (R11.14); the full registry evicts expired gates only (R11.13). The boundary live drive caught the tool handler filtering blank quick gates before the pipeline — a defect no registrar-level unit test could see; fixed in the same PR with a test entering through the registered callback.
- 0C2.4 killed as superseded by 0D.1 (#479).
- Next slice cut from rows that wait on no open owner decision: 0D.4, 1.12 (Q2/R11.2 ruled), 0C1.17, 0C1.18, 0C1.19.
- 0C1.17 accepted (`fcf6e29e`). 0C1.18 accepted as a classification: 0C1.13's "stage 12 changes nothing" came from its fixtures (`framework_gates: false`, no override), not from stage 12 being unused — a probe for an absence needs a fixture that asks for the thing. Drive evidence under `investigations/0c118/`. R11.15 (planner, from CLAUDE.md's guidance-owner rule): the single-prompt system prompt is built by `PromptGuidanceService` only; the `FrameworkManager.generateSystemPrompt` path and the `systemPromptApplied` flag go (row 0C1.21, after 1.12). Rows 0C1.20 and 0C1.22 wait for 0D.4 because they share the composition-root harness and `gate-enhancement-service.ts`.

## 2026-10-12 — silent paths wave 2: 0D.4, 1.12, 0C1.19 accepted

- 0D.4 (`71a41554`): every way a switch turns gates off now refuses a call that requested gates (`gate-suppressed`), naming the switch and how to keep the gates; `%lean`, `%judge` and a prompt author's own gates are unaffected; `:: verify:` still runs under `%clean`. Lead 2's premise was already solved (R47 release wiring): pinned with an end-to-end test instead of new code.
- 1.12 (`1d540e18`): R11.2 implemented; `missing_report` is an attribution fault in the kernel. A client that wants to fail a semantic gate now sends an unmet report — a string FAIL is refused too. Node-scoped `inlineGateIds` still render before their review opens → 1.12b (R11.16: treat node `inlineGateIds` as targeting that node). Hook findings (not edited, Tier 1 stop): `session_state.py:325,344` and `ralph-stop.py:368` emit string-verdict reminders; `gate-enforce.py:82-101` detects FAIL only in strings. Other string teachers outside the row: `request-validator.ts:91`, `gate-verdict-contract.ts:96-101`, stage 01 example, `prompt-engine.schema.ts:537`, `review-utils.ts`, skills-sync Stop hooks, the blocked-response fallback — inputs to the retirement decision (Q4).
- 0C1.19 (`22c79c58`): the collector already had a stop method nothing called. `--detectOpenHandles` never reported the open handle even when the process hung; a bare run under a timeout is the sharper probe.
- Findings → rows 0D.5 (refusal wording may be false after script stages), 0D.6 (sweep before refusing a full registry), 0D.7 (narrowed-parameter refusal did not fire in-process — transport parity), 0D.8 (per-step modifiers stripped; `%framework` re-run hint; duplicate modifier predicate), 0C1.23 (remaining runtime timers).
- 1.12b, 0C1.20, 0C1.21, 0C1.22 accepted. DEV-T0-P2: the planner told 1.12b a composition-root failure came from a run-wide gate; the gate was a node's own inline gate (`chainSteps[].inlineGateIds`). 1.12b correctly scoped R11.16 to semantic gates, which closes the defect (a semantic step taught the string); reminder timing stays, pending owner decision 1. 0C1.22's premise held for `%judge` but not for the gate-service term (stage 16 reaches it) — a premise should state every caller's stage. 0C1.21 found the R11.15 divergence unreachable as described (every loaded template carries `{FRAMEWORK_GUIDANCE}`); the reachable divergence was placeholder substitution order. Findings → 0C1.24 (one builder for chain and single), 0C1.25 (type-vs-id lookup).
- CI on #481 (first run): E2E failed 2 tests on both Node legs. (1) `claims-conformance › operator-delegation`: the gate pattern's deprecated `=` option matched the first `=` of `==>`, so the parser attached a phantom gate with criterion `=>` to every `==>` delegation; `%clean` used to drop it silently and 0D.4's `gate-suppressed` refusal exposed it. Fixed at the parser in `fd53f448` (`=(?![=>])` in `operators.json` and the tokenizer's copy; hook parity test added). Whether past delegated chains were reviewed against `=>` is unverified (needs a step-2 drive). (2) `review-per-node` control still expected the string offer that 1.12 replaced with the structured object (`1e7e1b71`). Remaining string offers in source, both on legacy paths: the blocked-resubmit fallback (`response-assembler.ts:364`) and the legacy gated-render line (`chain-operator-executor.ts:1239`) — inputs to Q4.
- Finding: the session environment exports `CLAUDE_PLUGIN_ROOT` pointing at the main checkout; `hooks/lib/workspace.get_workspace_root()` prefers it, so in a worktree the Python hook tests (including the pre-commit pytest step) read the main checkout's `operators.json`, not the branch's. CI does not set it.

## 2026-10-13 — slice 7 cut: runtime lifecycle and small rows

- Worktree `claude-prompts-mcp-sgr-slice7`, branch `fix/sgr-runtime-lifecycle`, shared-tree (disjoint files). Rows: 0C1.25, 0C1.23, 1.14, 0D.9 (probe).
- 0D.6 killed before dispatch. The premise said the 24 h stale-run TTL keeps a full registry full for a day; re-measured: `createTemporaryGate` stamps `expires_at = now + defaultExpirationMs` (1 h) on every gate and arms an unref'd timer that removes it then, and no caller sets a longer expiry (`rg "expires_at\s*[:=]"`: prompt YAML inline definitions only). Stale runs hold no gate past the hour, so a sweep before refusing would free nothing the timers have not already freed.
- That measurement raises the opposite question, now probe row 0D.9: a live run idle past one hour loses its temporary gates to the timer. Whether its resume re-registers them, refuses, or silently reviews nothing is unmeasured.
- 0C1.25 re-measured: the type-as-id shape is at four sites, not one (`prompt-guidance/service.ts:140,350`; `framework-manager.ts:238,381`). The row closes the class: every site plus a check that fails on a new one.
- Q9 and Q10 statuses still read "Owner rules" after both were settled (Q9 superseded by 0D.1/#479, Q10 landed as 0C1.8/#478); corrected in place.
- The full-registry refusal text tells clients to "cancel an open run"; `cancel` is being removed by the client-workflow plan. Not edited here (that plan sweeps `cancel` references); noted so that sweep finds it.

## 2026-10-13 — 1.14, 0C1.25, 0D.9 accepted; 0D.6 un-killed

- 1.14 accepted: the header cites `standardSchemaToJsonSchema` in `@modelcontextprotocol/server` 2.0.0 and states the inline-only (`$defs`/`$ref`-free) rule; `validate:tool-schemas` structure identical, sizes unchanged. Finding: no check enforces the 100-column width on comments (prettier does not wrap them); the same file still has 183-, 110- and 105-column comment lines, and a `(B.87)` plan id in a heading for 0C1.15's sweep.
- 0C1.25 accepted: four sites `.type` → `.id`; the new test was red on 6 of 8 before the fix (the active custom framework silently became `cageerf`; an id override yielded `frameworkUsed: 'error'`), and a source scan over both framework services carries a positive control. Finding: `selectFramework` still falls back to the default framework without a log when the active framework is missing or disabled — the guard-hides-defect shape; not cut as a row yet.
- DEV-T7-P1 (planner): 0D.6 was killed before dispatch on a premise measured at `createTemporaryGate` alone. 0D.9's probe showed `adoptIntoRun` → `clearExpiry` removes the expiry of every gate a run adopts, so run gates live until `releaseRun`. The original row's concern was right. The lesson matches the worker's feedback: before reasoning about a timer, find who clears or overrides it.
- 0D.6 rewritten: production cap 100 (`prompt-executor.ts:236`), stale TTL 24 h, sweep every 5 min. Sweep-before-refuse gains at most 5 min, so the row is an owner question: raise the cap, shorten the TTL for gated runs, or release the gates of runs idle past a threshold and rely on `restoreRunGates` (stage 05) to re-register them on resume. The last option reverses R11.13 unless that restore is driven first.
