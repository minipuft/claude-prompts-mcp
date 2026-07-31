# CI Enforcement Gaps, Release Process, and `#` Import Migration

**Date**: 2026-07-31
**Branch**: `fix/ci-enforcement-and-workflow-gaps`, cut 2026-07-31 from
`refactor/retire-compat-shims-and-methodology-vocab` @ `db5eb408` — **stacked, not off `main`**.
PR #150 is deliberately held unmerged so release-please does not open the 3.0.0 Release PR until
more work is finalized for that release. Stacking is required, not preferred: `origin/main` carries
10 `validate:all` members and 3 `validate-no-*` scripts against this branch's 21 and 8, so Tier 1
cannot enforce guards that do not exist there, and #150 already modifies `ci.yml`.
**Consequence**: this branch's PR shows #150's commits until #150 lands, and must merge after it.
**Work type**: bug_fix (Tier 1–2), refactor (Tier 3, deferred)
**Status**: **Tier 1 complete** (2026-07-31, gate passed — see Tier 1 Gate verdict). 1.4 held at ◐
by design until this branch merges. Tier 2 open. Tier 3 deferred.

| Measure                                           | Before            | Now       | Target |
| ------------------------------------------------- | ----------------- | --------- | ------ |
| `validate:all` members enforced in CI             | **5/21**          | **23/23** | all    |
| Recurrence guards (`validate:no-*`) run in CI     | **0/8**           | **8/8**   | 8/8    |
| Unpinned tool installs in workflows               | **2**             | **0**     | 0      |
| Node version CI tests vs. Node version shipped    | 22.x/24           | 22.x+24   | same   |
| Dead steps in `.husky/pre-push`                   | **1**             | 1         | 0 (T2) |
| PR classes that can never satisfy required checks | **1** (docs-only) | **0**     | 0      |

`validate:all` grew 21 → 23 in Tier 1 (`validate:required-contexts` plus its self-test). It also
**exited 1 on committed HEAD** when Tier 1 started — `validate:documented-options` flagged npm's
own `--prefix` as an undocumented flag of ours. Nothing caught it because nothing ran it. That is
F2 demonstrating itself, not a side issue.

---

## Executive summary

The premise — "these integrations were made hastily and could be failing" — checks out, but the
failure shape is not broken automation. Every workflow runs and reports green. The problem is that
**green means much less than it looks like it means.**

Three independent gaps, all the same shape: a check exists, is trusted, and does not run.

1. The shim-debt sweep built **eight `validate:no-*` recurrence guards** whose entire purpose is to
   make a retirement permanent. **None of them run in CI.** A PR reintroducing `ChainSessionManager`
   or `StepState` merges green.
2. CI tests on **Node 22.x**; every publish path builds on **Node 24**. The artifact that ships is
   built on a runtime CI never exercises.
3. `.husky/pre-push` greps _staged_ files inside a _push_ hook, so one validation step has never
   executed once.

This is the same defect class the sweep just paid down in `95fa1cbd` ("make the action-metadata
guard able to fail again") and `8c79454c` ("assert content in `verify:mcp`"): **a check that cannot
fail**. The sweep fixed the instances it found inside `server/scripts/`. It never looked at
`.github/workflows/` or `.husky/`. This plan finishes that audit one layer out.

Tier 1 and 2 are that audit. Tier 3 — the `#` subpath-import migration — is **deliberately deferred**
and carries no dependency on Tiers 1–2 beyond ordering. It is written down here so the analysis
survives, not to be executed in the same pass.

---

## Findings

Severity per `CLAUDE.md` Quality Gates. Each finding names the probe that produced it.

### F1 — Required status checks name job **ids**, not check-run names — **Critical** — _partially closed_

Branch protection on `main` required contexts `["lint", "build"]`. Those are the job keys at
`.github/workflows/ci.yml:38` and `:125`. GitHub matches required contexts against the **check-run
name**, which is the job's `name:` field — `Lint & Validate` and `Build`. The required contexts
could never be reported by anything, so **every** PR into `main` sat at `mergeStateStatus=BLOCKED`
regardless of CI result.

> Probe: `gh api repos/minipuft/claude-prompts/branches/main/protection/required_status_checks`
> → `contexts: ["lint","build"]`; `gh api .../commits/<sha>/check-runs` → `Lint & Validate`, `Build`.

**Corrected 2026-07-31** via `PATCH .../required_status_checks` to
`["Lint & Validate", "Build"]`; PR #150 moved `BLOCKED` → `CLEAN`. Remaining work is F2 — deciding
whether those two are the _right_ required set — and the regression risk that nothing pins this
config, so a future rename of a job's `name:` silently re-breaks it.

### F1b — `paths-ignore` + required checks = a PR class that can never merge — **Critical**

`ci.yml` declares on both triggers:

```yaml
paths-ignore: ["**.md", "docs/**", ".github/*.md", "LICENSE"]
```

A PR touching **only** those paths does not trigger the workflow. No workflow run means no check
runs are created — which is not the same as a _skipped_ job, and GitHub does not treat it as one.
The required contexts stay pending indefinitely and the PR cannot be merged except by admin
override.

This was latent until today: while the required contexts were unmatchable (F1), every PR was
blocked equally, so the docs-only case was invisible. **Fixing F1 makes F1b live.**

Scope correction, observed live on 2026-07-31: for `pull_request` events GitHub evaluates path
filters against the **PR's entire diff**, not the incremental push. Pushing two doc-only commits
(`5033bc2e`, `6022bb0a`) to PR #150 still triggered CI, because the PR as a whole contains `.ts`
changes. So doc-only _commits_ inside a mixed PR are safe; the trap is a PR whose **every** file
matches `paths-ignore` — a CHANGELOG-only fix, a plan-file-only PR, a docs correction. Those are
routine in this repo, so the exposure is real, but narrower than "any PR containing a doc commit".

Remedy is the documented GitHub pattern: a companion workflow with the **inverse** trigger
(`paths:` matching what CI ignores) whose jobs are named identically and do nothing but succeed —
so the contexts always report. Alternative: drop `paths-ignore` and accept the runner cost.

### F2 — 16 of 21 `validate:all` members never run in CI — **Critical**

> Probe: `grep -rhoE "npm run [a-z:0-9-]+" .github/workflows/ | sort -u` intersected against
> `server/package.json` → `scripts["validate:all"]`.

| Covered in CI (5)                                                                                | Not covered (16)                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lint:ratchet`, `validate:arch`¹, `validate:metadata`, `validate:contracts`, `validate:versions` | `validate:filesize`, `validate:frameworks`, `validate:gate-index`, `validate:extension-deps`, `validate:readme`, `validate:documented-options`, `verify:mcp:self-test`, and **all eight** `validate:no-*` guards |

¹ `validate:arch` runs only in the conditional `architecture` job, gated on
`architecture-scope.outputs.should_run == 'true'`.

`validate:python` is absent from the npm-script grep but _is_ functionally covered — CI runs
`astral-sh/ruff-action` twice plus a pyrefly step directly, rather than through the npm script.

The eight uncovered guards are the ones `8a85ec01` and `4f25843f` added specifically so retirements
could not silently reappear. They are currently enforced by nothing but a human remembering to run
`npm run validate:all`. `.husky/pre-push` does not run them either (F4).

### F3 — CI tests a Node version that nothing ships — **High**

| Source                                      | Node     |
| ------------------------------------------- | -------- |
| `ci.yml` `NODE_LTS` + test matrix           | 22.x     |
| `npm-publish.yml:30`                        | **24**   |
| `extension-publish.yml:36`, `:119`, `:379`  | **24**   |
| `docker-publish.yml:76`                     | **24**   |
| `.node-version` (used by `downstream-sync`) | **24**   |
| `server/package.json` `engines.node`        | >=22.0.0 |

Everything that produces a published artifact builds on Node 24. CI validates only 22.x. A
Node-24-specific regression passes CI and ships. Either add 24 to the test matrix (it is already a
matrix — `strategy.matrix.node: ["22.x"]`), or align the publish paths to the tested version.
Adding to the matrix is the cheaper of the two and the matrix exists for exactly this.

### F4 — `.husky/pre-push` graph step has never executed — **High**

`.husky/pre-push`:

```sh
CHANGED_DOTS=$(git diff --name-only --cached | grep '^server/graphs/.*\.dot$' || true)
```

`--cached` reads the **index**. In a `pre-push` hook nothing is staged, so `CHANGED_DOTS` is
unconditionally empty and `graphs:render` / `graphs:validate` never run. The hook already computes
the correct range 40 lines earlier into `$PUSHED_FILES` (`"$UPSTREAM"..HEAD`); the fix is to grep
that instead.

Same failure shape as the inert `verify-action-inventory.js` guard fixed in `95fa1cbd`.

### F5 — pre-push, CI, and `validate:full` are three different suites — **Medium**

| Gate            | Runs                                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------------- |
| `pre-push`      | typecheck · lint:ratchet · prettier · validate:python · test:ci · validate:arch · validate:versions           |
| CI `lint` job   | validate:contracts · validate:metadata · validate:versions · typecheck · lint:ratchet · ruff ×2 · **pyrefly** |
| `validate:full` | typecheck · lint:ratchet · test:all · **validate:all** (21)                                                   |

No gate is a superset of another. Concretely: **pre-push does not run pyrefly**, which is why the
pyrefly failure on `81bf665e` reached CI despite a clean local push — and `validate:full` does not
run pyrefly either, so "full validation green" did not predict CI. Decide which gate is the
contract and make the others strict subsets of it.

### F5b — The hooks do not meet the repo's own always-loaded hook standard — **High**

`~/.claude/rules/ci-release.md` § Required Hooks is always-loaded context, so it is the declared
standard for this repo. Two of its three hooks do not match.

| Hook         | `ci-release.md` requires                                | Actually runs                                                                                        | Gap          |
| ------------ | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------ |
| `pre-commit` | lint-staged + **typecheck** + generated-file protection | `generate:contracts` · `lint:staged` · `validate:python` · `lint:ratchet`                            | no typecheck |
| `pre-push`   | typecheck + lint:ratchet + test + **build**             | `typecheck` · `lint:ratchet` · `validate:python` · `test:ci` · `validate:arch` · `validate:versions` | no build     |
| `commit-msg` | `npx --no -- commitlint --edit "$1"`                    | matches                                                                                              | —            |

> Probe: `grep -c typecheck .husky/pre-commit` → 0; `grep -c "run build" .husky/pre-push` → 0.

The missing `build` is the sharper one. As of 2026-07-31 `Build` is a **required status check**
(F1), so a push can pass every local gate and still fail a check that blocks the merge. This is the
same "no gate is a superset" problem as F5, but measured against the written standard rather than
against the other gates.

Decide per hook whether the standard or the hook is wrong — `pre-commit` running a full typecheck
may not fit the rule's own `<10s` budget, in which case the rule should say so rather than the hook
silently diverging.

### F6 — Unpinned tool installs make CI non-reproducible — **High**

> Probe: `rg -Nn "pip install|npm install -g|uses: .*@(main|master)" .github/workflows/`

- `ci.yml:87` — `pip install pyrefly --quiet`
- `renovate-config-validator.yml:28` — `npm install -g renovate`

The pyrefly one already caused a failure today: the package went 0.55.x → 1.1.1 since `main` last
ran green in May, and the newer inference flagged two pre-existing lines in `hooks/lib/db_reader.py`
that no commit on the branch had touched. An untouched branch turned red from an upstream release.
Pin both and let renovate propose bumps — noting that renovate does not track bare `pip install`
lines in workflow steps without a `customManagers` regex entry.

### F7 — `Test (Node ${{ matrix.node }})` check name is interpolated — **Medium**

`ci.yml:165`. The check-run name is derived from the matrix value, so it changes if the matrix
changes — which F3 proposes doing. Not currently a required context, but if the required set is
widened (F2), adding a matrix-interpolated name re-creates F1 in a new form. Prefer requiring a
job whose `name:` is a literal.

### F8 — `downstream-sync.yml` swallows its only validation — **Medium**

`.github/workflows/downstream-sync.yml:36` sets `continue-on-error: true` on
`validate-versions.js --distribution --skip-npm`, the sole validation step in the workflow. The
subsequent Summary step runs under `if: always()`. Confirm whether this is a deliberate
report-only posture (in which case say so in a comment naming what would flip it, per
`cleanup-standards.md` "a gate you cannot retire is a bug") or an escape hatch left in.

### F10 — `extension-alignment.md` mandates syncing files that do not exist — **Medium**

`.claude/rules/extension-alignment.md` declares three distribution channels and requires that hook
and config changes be mirrored into the Gemini CLI set:

| Rule requires                | Exists? |
| ---------------------------- | ------- |
| `manifest.json`              | yes     |
| `.claude-plugin/plugin.json` | yes     |
| `gemini-extension.json`      | **no**  |
| `.gemini/hooks/*.py`         | **no**  |
| `.gemini/settings.json`      | **no**  |

> Probe: `ls gemini-extension.json` → absent; `ls -d .gemini` → absent.

The rule is always-loaded context that describes a platform this repo does not currently ship, and
its "Alignment Checklist" asks for edits to files that cannot be edited. Either the Gemini channel
was removed and the rule was not (`cleanup-standards.md`: same-PR cleanup), or it is planned and
the rule is aspirational. Decide which, then either restore the channel or cut the rule down to the
two channels that exist. `GEMINI.md` was deleted 2026-07-31 as part of this; `.mcpbignore` still
lists it, which is harmless — that file also lists `QWEN.md`, equally absent, so it is a defensive
pattern list rather than a manifest.

### F9 — Minor `.husky` issues — **Low**

- `pre-push` labels steps `1/6`…`6/6` but runs seven (there is a `3b/6`).
- `commit-msg` uses GNU `sed -i` with no backup suffix — fails on BSD/macOS sed. Only matters if a
  second contributor is not on Linux.
- `commit-msg` is mode `711`; its siblings are `755`. Functional, inconsistent.
- `commit-msg` strips `Co-Authored-By: Claude` and the `🤖 Generated with` line but **not**
  `Claude-Session:`, so session URLs do reach history. Confirm that is intended.

---

## Tier 1 — Make CI enforce what the repo already checks

Order matters: 1.1 before 1.2, because widening required contexts while a PR class can't report
them makes F1b worse.

| #   | Step                                                                                                                                                                                         | Closes | Status |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------ |
| 1.1 | ~~Companion workflow with inverse `paths:` trigger~~ → **dropped `paths-ignore` instead** (see Deviations)                                                                                   | F1b    | ✓      |
| 1.2 | Add `npm run validate:all` as a step in the CI `lint` job                                                                                                                                    | F2     | ✓      |
| 1.3 | Resolve the overlap 1.2 creates: `lint:ratchet`, `validate:contracts`, `validate:metadata`, `validate:versions` would run twice — drop the standalone steps or drop them from `validate:all` | F2     | ✓      |
| 1.4 | Decide the required-context set and apply it (candidates: `Lint & Validate`, `Build`; `Test` only if F7 is resolved first)                                                                   | F1, F7 | ◐      |
| 1.5 | Add a guard that fails when a workflow job's `name:` no longer matches a required context — sibling of the `validate-no-*` pattern                                                           | F1     | ✓      |
| 1.6 | Add `24` to `ci.yml` `strategy.matrix.node`                                                                                                                                                  | F3     | ✓      |
| 1.7 | Pin `pyrefly` and `renovate`; add a renovate `customManagers` regex so both stay tracked                                                                                                     | F6     | ✓      |

**Exit**: a PR that reintroduces `StepState` fails CI; a docs-only PR reports and merges; the
published Node version is in the test matrix.

### Gate verdict — PASS (executed 2026-07-31)

Each claim proved by making it fail first, not by reading the config:

| Claim                                     | Proof                                                                                                                               |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| A `StepState` regression now fails CI     | Wrote `src/shared/__tier1_probe.ts` exporting `StepState` → `validate:all` exit **1**; removed → exit **0**                         |
| The rename guard can fail                 | Renamed the real `Test Suite` job in `ci.yml` → `validate:required-contexts` exit **1**; restored → **0**. Plus 4/4 self-test rules |
| Docs-only PRs report                      | `paths-ignore` removed from both triggers; every PR into `main` now triggers the workflow                                           |
| Shipped Node is tested                    | matrix `["22.x","24"]`; `.node-version` (what all three publish paths read) is `24`                                                 |
| Pinned pyrefly is the version that passes | `pyrefly==1.1.1` in a clean venv against `hooks/` → **0 errors**                                                                    |
| Renovate config is valid                  | `renovate-config-validator --strict` exit **0** (was **1** — see Deviations)                                                        |

Tier-wide: `typecheck` 0 · `validate:all` 0 (23/23) · `test:ci` 0 (146 suites / 1732 tests) ·
`npx eslint` clean on the new script.

### Deviations

1. **1.1 — dropped `paths-ignore` rather than adding the companion workflow.** The companion
   pattern is unsound here: `paths` and `paths-ignore` both fire on "any file matches", so a mixed
   docs+code PR triggers **both** workflows and produces two check runs sharing a name. A required
   context resolves to the most recent run with that name, so the no-op job could satisfy a check
   the real job failed — a worse bug than the one being fixed. Cost of dropping is runner minutes
   on docs-only PRs. Rationale is recorded as a comment above the `on:` block, not just here.

2. **1.3 went further than "drop the duplicate steps".** `validate:arch` is a `validate:all`
   member, so the conditional `architecture` job and its `architecture-scope` scope-detector became
   pure duplication and were removed (−2 jobs, −1 checkout+install each). `pr-summary` was rewired
   to `[lint, cli, build, test-suite]`. The two `astral-sh/ruff-action` steps were also removed —
   `validate:python` inside `validate:all` is now the single definition of the Python gate rather
   than a second, silently divergent one.

3. **F7 fixed as a prerequisite of 1.4, not deferred.** Added a literal-named `Test Suite`
   aggregator (`needs: test`, asserts `needs.test.result == 'success'`). Matrix legs keep their
   interpolated names and are never required; the aggregate is stable across matrix changes.

4. **1.7 grew a fourth pin.** `renovate-config-validator` ran unpinned _and_ its "Check config
   syntax" step was pure `echo` — it could not fail, and its text advertised auto-merge settings
   that had just been turned off. Step deleted, validator pinned to `renovate@44.5.2`, `--strict`
   added. `--strict` then failed on a pre-existing pending migration (`baseBranches` →
   `baseBranchPatterns`), verified pre-existing by running the validator against `git show HEAD`.
   One-line rename applied.

5. **Prerequisite not in the plan.** `validate:all` could not be added to CI while it exited 1.
   `validate:documented-options` was flagging npm's `--prefix`; added to that script's existing
   `NOT_OUR_OPTIONS` allowlist, which is the mechanism its own error message prescribes.

6. **`develop` removed from the `push:` trigger.** `git ls-remote --heads origin develop` returns
   nothing — the branch does not exist. Matches the same removal from `renovate.json5`.

### 1.4 is ◐ deliberately — do not apply before this branch merges

`.github/required-contexts.json` declares `["Lint & Validate", "CLI", "Build", "Test Suite"]`.
Live protection is still `["Lint & Validate", "Build"]`.

**`CLI` and `Test Suite` do not exist on `main`.** `Test Suite` is created by this branch;
`CLI` is not required today. Applying the new set now would require two contexts nothing on `main`
reports — which is F1 exactly, re-created by the step meant to close it, and it would block PR #150
along with every other open PR.

Apply **after** this branch lands, using the command in the JSON's `$comment`, then confirm with
`gh api repos/OWNER/REPO/commits/<sha>/check-runs --jq '.check_runs[].name'` that all four report.
Until then `validate:required-contexts` still earns its keep: it proves the declared set is
satisfiable by the workflows in the tree.

## Tier 2 — Husky and gate coherence

| #   | Step                                                                                                                    | Closes | Status |
| --- | ----------------------------------------------------------------------------------------------------------------------- | ------ | ------ |
| 2.1 | `pre-push`: grep `$PUSHED_FILES` instead of `git diff --cached` for `.dot` changes; prove it fires by touching a `.dot` | F4     | ☐      |
| 2.2 | Add pyrefly to `validate:python` so pre-push, `validate:full`, and CI agree on the Python gate                          | F5     | ☐      |
| 2.3 | Define one canonical gate and make the others documented subsets; record the decision in `CLAUDE.md`                    | F5     | ☐      |
| 2.4 | Resolve `downstream-sync` `continue-on-error` — remove it, or comment what evidence retires it                          | F8     | ☐      |
| 2.5 | `pre-push` step renumbering; `commit-msg` mode → 755; decide on `sed -i` portability                                    | F9     | ☐      |
| 2.6 | Add `build` to `pre-push` — it gates a required status check and is absent                                              | F5b    | ☐      |
| 2.7 | Reconcile `pre-commit` against the rule's typecheck requirement: add it, or amend `ci-release.md` and say why           | F5b    | ☐      |

**Exit**: every hook step is falsifiable — each one can be made to fail by an input it claims to
check. Verify the way `verify:mcp:self-test` does, by feeding each a wrong-but-well-formed input.

## Tier 3 — `#` subpath imports — **DEFERRED**

Not to be executed with Tiers 1–2. Recorded so the measurement survives; re-measure before acting
(`feedback_untrusted_inventory`).

### Measured state (2026-07-31, at `81bf665e`)

Alias infrastructure is **already fully wired and used zero times**:

| Resolver   | Config                                           | Location                     |
| ---------- | ------------------------------------------------ | ---------------------------- |
| TypeScript | `@shared/* @infra/* @engine/* @modules/* @mcp/*` | `server/tsconfig.json:29-35` |
| esbuild    | same five                                        | `server/esbuild.config.mjs`  |
| Jest       | same five, `moduleNameMapper`                    | `server/jest.config.cjs`     |

```
alias usages in src/ : 0        alias usages in tests/ : 0
total relative imports in src/ : 1603
  depth 0 (./) 501 · 1 388 · 2 268 · 3 178 · 4 224 · 5 42 · 6 2
cross-layer imports (different top-level dir) : 611   ← the only ones worth converting
tests/ importing ../../src/... : 559
```

### Why `#` over `@`

`server` is `"type": "module"` on `moduleResolution: NodeNext`, `engines.node >= 22`. Node's
`imports` field is resolved natively by Node, tsc, esbuild, Jest, and knip — one declaration in
`package.json` instead of the same map maintained in three files. Decisive advantage: **tsc does
not rewrite `paths` aliases on emit**, and `esbuild.config.mjs` shells out to
`npx tsc --emitDeclarationOnly --declaration --outDir dist` while `package.json` ships
`"types": "dist/index.d.ts"` — so `@`-aliases would land unresolvable in published declarations.
`#`-specifiers survive emit because Node resolves them at runtime.

**Unverified.** This must be proven by converting ~10 files, running `npm run build`, and reading
`dist/**/*.d.ts` before committing to the approach. If it fails, the fallback is to delete the three
dead alias configs rather than carry them.

### Sketch

| #   | Step                                                                                                                                                        | Status |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 3.1 | Spike: 10 files, build, inspect emitted `.d.ts`. Decides `#` vs `@` vs abandon                                                                              | ☐      |
| 3.2 | Declare `imports` in `server/package.json`; extend to `runtime/` and `cli-shared/`, which the current map omits                                             | ☐      |
| 3.3 | ts-morph codemod over the **611 cross-layer imports only** — resolve each specifier, rewrite only on layer crossing. Leave the 501 `./` and 388 `../` alone | ☐      |
| 3.4 | ESLint `no-restricted-imports` banning `../../*` — without this the sweep decays                                                                            | ☐      |
| 3.5 | Update `import/order` `pathGroups`: `eslint.config.mjs:106` matches `@/**`, which matches nothing here                                                      | ☐      |
| 3.6 | Confirm `validate:arch` still resolves — `.dependency-cruiser.cjs` sets `tsConfig`, so it maps aliases to real paths before matching `^src/shared/`         | ☐      |

**Not** `ast-grep` or `sed`: deciding whether an import crosses a layer requires _resolving_ the
specifier, not matching its text. ts-morph is already a devDependency. The recorded ts-morph caveat
(`rename()` follows the language service into `implements` targets) does not apply to import
specifier rewriting.

---

## Decisions needed before Tier 1

1. **Required-context set** — just `Lint & Validate` + `Build` (current), or add `Test`?
   Adding it requires F7 first.
2. **`paths-ignore`** — keep it plus a companion reporting workflow, or drop it and let docs PRs
   run full CI?
3. **Canonical gate (F5)** — is `validate:full` the contract that CI and pre-push must both be
   subsets of, or is CI the contract?
4. **`/release` skill access** — audited 2026-07-31; the flag is **correct, not too restrictive.**
   `disable-model-invocation: true` appears on exactly 2 of 51 skills — `release` and `validate` —
   and `release` is built as an executor (`context: fork`, `agent: general-purpose`,
   `argument-hint: <patch|minor|major> [--dry-run]`). A model must not be able to self-trigger an
   npm publish, a tag, or a version bump. Keep the flag.

   The real cost was **content coupling**: the skill held both the executable procedure (stays
   gated) and the setup templates / workflow examples that `ci-release.md` defers to it for — and
   the flag hid both. **Resolved 2026-07-31** by splitting along skill type rather than topic:

   | Skill                  | Type      | Invocable               | Holds                                                                           |
   | ---------------------- | --------- | ----------------------- | ------------------------------------------------------------------------------- |
   | `/release`             | task      | gated (`/release` only) | SKILL.md steps 0–9, unchanged                                                   |
   | `/release-engineering` | reference | **yes**                 | pipeline architecture, branch protection, workflow hygiene, `repo-bootstrap.md` |

   `changelog-conventions.md` was deleted rather than moved — `/changelog-generator` already
   declares itself SSOT for commit-type → section mapping and carries a richer table.

   **This closed F1 at its source.** `repo-bootstrap.md`'s bootstrap checklist read
   `Required status checks (lint, build, test)` — job ids. Any repo configured from that checklist
   inherits F1. The section now names the check-run-vs-job-id distinction and ships a probe that
   compares the two, so the next repo does not repeat it. `/release-engineering` also documents the
   `paths-ignore` trap (F1b).

   Remaining: run `/release` once before Tier 1 to check F1–F10 against the executor half, which
   stays gated by design. The audit also produced F5b from the rule that _was_ readable.
