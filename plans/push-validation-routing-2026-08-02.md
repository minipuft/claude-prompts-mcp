# Push Validation Routing Plan

**Status:** canonical; protected PR #183 passed all required contexts

**Lifecycle:** unconditional monolithic validation = `removed`; impact-aware validation = `canonical`

**Risk:** high — CI required contexts and protected-branch mergeability

## Intent Declaration

- **Work type:** `refactor`
- **Secondary type:** `feature`
- **Confidence:** high
- **Problem:** every push currently pays the server typecheck, lint, unit-test, architecture, version, and build cost even when the diff contains only documentation. Skipping the entire workflow is unsafe because required checks would remain pending.
- **Desired state:** one fail-closed changed-file classifier routes both local pre-push and hosted CI through the minimum sufficient validation while every protected check name still reports a result.
- **Scope:** `scripts/classify-validation-scope.js`, `.husky/pre-push`, `.github/workflows/ci.yml`, `server/package.json`, operator/contributor documentation, and this plan.
- **External dependencies:** none; use Node.js built-ins and existing pinned Actions.
- **Source specification:** operator request on 2026-08-02 plus the four protected contexts in `.github/required-contexts.json`.
- **Next phase:** architecture pre-flight, then implementation and self-test coverage.

## Acceptance Criteria

1. Changes limited to the documented root handbooks, `docs/**/*.md`, `plans/**/*.md`, and the server/CLI READMEs select `docs` and run text hygiene without installing server or CLI dependencies.
2. Changes limited to `hooks/**` plus documentation select `hooks` and run Python validation without the Node build/test matrix.
3. Source, tests, manifests, lockfiles, workflows, configuration, deletions outside the safe sets, mixed changes, empty input, and unknown paths select `full`.
4. CI still emits successful or failed `Lint & Validate`, `CLI`, `Build`, and `Test Suite` jobs for every PR and push; no workflow-level path filter is introduced.
5. The local pre-push hook and hosted workflow consume the same classifier rather than maintaining separate path lists.
6. Classifier self-tests cover each route and fail-closed edge cases.

## Architecture Pre-flight

| Question                  | Decision                                                                                                                               |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Existing source of truth? | `.github/required-contexts.json` owns stable check names; `server/package.json` owns validation commands. No changed-path SSOT exists. |
| State/lifecycle?          | Stateless deterministic transform: changed paths -> `docs`, `hooks`, or `full`.                                                        |
| Readers?                  | `.husky/pre-push`, CI classifier job, validator self-test.                                                                             |
| Writers?                  | Git diff producers only; classifier does not mutate repository state.                                                                  |
| Failure behavior?         | Empty, malformed, deleted, mixed, or unrecognized input resolves to `full`.                                                            |
| Displaced path?           | Unconditional pre-push/CI heavy execution is deleted when both consumers use the classifier. No parallel classifier remains.           |
| Required-check safety?    | Workflow triggers remain unconditional; required jobs execute lightweight no-op/status steps for safe scopes.                          |
| Rollback?                 | Revert routing commit; required-context names and live branch protection do not change.                                                |

## Compound Diagnosis

**Unconditional validation with protected-context coupling**: the repository correctly avoided workflow-level path filtering, but treated “workflow must run” as “every expensive step must run.” The missing abstraction is validation-scenario routing inside an always-triggered workflow.

## Scenario Matrix

| Scenario | Examples                                                                        | Local pre-push                                           | Hosted required contexts                                                                            |
| -------- | ------------------------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `docs`   | canonical root/docs/plans README additions, edits, or deletions                 | diff hygiene + formatting of existing changed text files | lint performs diff hygiene; CLI/build/tests report an intentional lightweight pass                  |
| `hooks`  | `hooks/**` with optional Markdown                                               | diff hygiene + formatting + `validate:python`            | lint runs pinned Ruff/Pyrefly/Pytest/PyYAML; CLI/build/tests report an intentional lightweight pass |
| `full`   | source, tests, manifests, lockfiles, workflows, Renovate, config, mixed/unknown | existing eight-step validation                           | existing lint/CLI/build/two-version test matrix                                                     |

## Validation

- `node scripts/classify-validation-scope.js --self-test`
- Synthetic stdin checks for `docs`, `hooks`, and `full` outputs.
- Parse `.github/workflows/ci.yml` and run Action-pin/required-context validators.
- Run pre-push in dry/synthetic mode where practical; otherwise exercise the classifier directly.
- Because this PR changes CI and Renovate configuration, run the full local gate once before publication.
- On the PR, verify all four protected context names report success and the CI summary shows the selected scope.

## Removal Contract

- Delete unconditional heavy steps once their conditional replacements are present in the same workflow/hook.
- Do not add workflow-level `paths`/`paths-ignore` to required CI.
- Do not create a second workflow with duplicate required check names.
- Mark the old path `removed` only after hosted checks prove all four contexts report on this implementation PR.

## Local Evidence

| Check                             | Result                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------ |
| Classifier self-test              | pass; 17 cases across docs, hooks, full, unsafe Markdown, malformed, and empty input |
| Workflow YAML + required contexts | pass; seven jobs parse and all four protected names resolve                          |
| Action pin policy                 | pass; all external Action references use full SHAs                                   |
| Server typecheck/lint/unit/build  | pass; 145 suites / 1,754 tests                                                       |
| `validate:all`                    | pass, including classifier and Renovate recurrence tests                             |
| CLI typecheck/build/tests         | pass; 3 suites / 75 tests                                                            |
| Hook validation                   | pass; Ruff, Pyrefly, and 178 Pytest tests                                            |
| Clean Python 3.10 environment     | pass with pinned Pytest 9.1.1 + PyYAML 6.0.3                                         |

The clean Python environment initially failed 13 hook tests because PyYAML was present
on the developer machine but absent from the CI install contract. PyYAML is now pinned,
Renovate-managed, and installed before the hook suite; the isolated rerun passed all 178
tests. This closes the environment-leak unknown instead of relying on runner contents.

The first hosted run then failed before checkout: `lint` and `build` inherit
`working-directory: server`, but their new prerequisite assertions intentionally run
before checkout creates that directory. Those two assertions now override the working
directory to repository root; no validation command was bypassed.

The corrected hosted run on PR #183 passed `Lint & Validate`, `CLI`, `Build`, and
`Test Suite`. A subsequent documentation-only push to the Release Please branch selected
the `docs` route locally and completed without the server or CLI test suites.
