---
title: "Documentation Governance — Implementation Notes"
date: 2026-08-12
status: reference
tags: [docs, governance, chains]
---

# Documentation Governance Implementation Notes

## Deviations

1. The connected `resource_manager` initially targeted the installed plugin cache rather than this
   repository. The test gate created there was deleted immediately. All canonical resources were
   then created or updated through a local workspace server's `resource_manager`.
2. The prompt resource ignore policy excluded the new documentation and development resources from
   distribution. The allowlist now exposes only `documentation_change`, `readme_improver`, and
   `strategicImplement`; unrelated resources in those categories remain ignored.
3. An initial triage step duplicated classification already owned by `readme_improver` and did not
   provide a dependable draft handoff. Live driving led to the final two-step chain, with
   `readme_improver` reused for both drafting and review.
4. Investigation found a documentation/runtime mismatch around chain `inputMapping` syntax. The
   final chain does not depend on custom mappings, so the unrelated adaptive-chain work was not
   modified.

## Validation Ledger

| Check                            | Status | Evidence                                                                                                                            |
| -------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Resource creation and inspection | Pass   | Four gates, two-step chain, and strategic routing created through the workspace `resource_manager`; chain driven through both steps |
| Packaging inventory              | Pass   | Exact prompt allowlist visible to Git; README inventory reports 31 prompts across 6 categories                                      |
| README validator fixtures        | Pass   | 2 tests: hidden marker accepted; visible terminology rejected                                                                       |
| Live README validation           | Pass   | `npm run validate:readme` — 364 lines, charter checks passed                                                                        |
| Gate index                       | Pass   | `npm run validate:gate-index`                                                                                                       |
| Typecheck                        | Pass   | `npm run typecheck`                                                                                                                 |
| Test typecheck ratchet           | Pass   | `npm run typecheck:tests:ratchet` — no regressions                                                                                  |
| Lint ratchet                     | Pass   | `npm run lint:ratchet` — no regressions                                                                                             |
| Unit suite                       | Pass   | `npm run test:ci` — 181 suites, 2,241 tests                                                                                         |

## Growth

Novel observation captured: a resource can be runtime-correct yet absent from distribution because
the prompt allowlist is a separate ownership boundary. This is one sighting, so it remains in the
implementation record rather than being promoted to a durable rule or skill.
