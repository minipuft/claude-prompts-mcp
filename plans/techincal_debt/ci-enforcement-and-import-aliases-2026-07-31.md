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
**Status**: **Not started.** F1 partially closed in-flight (branch-protection contexts corrected
2026-07-31, see F1). Everything else open.

| Measure                                           | Now               | Target |
| ------------------------------------------------- | ----------------- | ------ |
| `validate:all` members enforced in CI             | **5/21**          | 21/21  |
| Recurrence guards (`validate:no-*`) run in CI     | **0/8**           | 8/8    |
| Unpinned tool installs in workflows               | **2**             | 0      |
| Node version CI tests vs. Node version shipped    | 22.x/24           | same   |
| Dead steps in `.husky/pre-push`                   | **1**             | 0      |
| PR classes that can never satisfy required checks | **1** (docs-only) | 0      |

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
| 1.1 | Add companion workflow with inverse `paths:` trigger, jobs named `Lint & Validate` and `Build`, no-op success — so every PR reports                                                          | F1b    | ☐      |
| 1.2 | Add `npm run validate:all` as a step in the CI `lint` job                                                                                                                                    | F2     | ☐      |
| 1.3 | Resolve the overlap 1.2 creates: `lint:ratchet`, `validate:contracts`, `validate:metadata`, `validate:versions` would run twice — drop the standalone steps or drop them from `validate:all` | F2     | ☐      |
| 1.4 | Decide the required-context set and apply it (candidates: `Lint & Validate`, `Build`; `Test` only if F7 is resolved first)                                                                   | F1, F7 | ☐      |
| 1.5 | Add a guard that fails when a workflow job's `name:` no longer matches a required context — sibling of the `validate-no-*` pattern                                                           | F1     | ☐      |
| 1.6 | Add `24` to `ci.yml` `strategy.matrix.node`                                                                                                                                                  | F3     | ☐      |
| 1.7 | Pin `pyrefly` and `renovate`; add a renovate `customManagers` regex so both stay tracked                                                                                                     | F6     | ☐      |

**Exit**: a PR that reintroduces `StepState` fails CI; a docs-only PR reports and merges; the
published Node version is in the test matrix.

## Tier 2 — Husky and gate coherence

| #   | Step                                                                                                                    | Closes | Status |
| --- | ----------------------------------------------------------------------------------------------------------------------- | ------ | ------ |
| 2.1 | `pre-push`: grep `$PUSHED_FILES` instead of `git diff --cached` for `.dot` changes; prove it fires by touching a `.dot` | F4     | ☐      |
| 2.2 | Add pyrefly to `validate:python` so pre-push, `validate:full`, and CI agree on the Python gate                          | F5     | ☐      |
| 2.3 | Define one canonical gate and make the others documented subsets; record the decision in `CLAUDE.md`                    | F5     | ☐      |
| 2.4 | Resolve `downstream-sync` `continue-on-error` — remove it, or comment what evidence retires it                          | F8     | ☐      |
| 2.5 | `pre-push` step renumbering; `commit-msg` mode → 755; decide on `sed -i` portability                                    | F9     | ☐      |

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
4. **`/release` skill** — it is marked `disable-model-invocation`, so its contents were not
   consulted for this plan. Run `/release` before Tier 1 so its guidance can be checked against
   F1–F8; `ci-release.md` was the only rule available.
