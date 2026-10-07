# Optional evaluation evidence archive

This private, repository-local Node24 TypeScript package provides immutable evaluation
records, content-addressed evidence blobs and private gate-suite contracts. Use it
explicitly from a checkout; it does not join the root workspace or default server startup.
Its generic [contracts](core/contracts.ts) and [archive](core/archive.ts) import the existing
[canonical hash source](../server/src/shared/utils/hash.ts) outside this directory, so
the package is not an independently published library. Gate specialization also uses
the server's locked dependencies and source loader; this package adds no dependency or
separate model-provider SDK.

## Setup and checks

Use Node24 on Linux. Core contracts/archive tests use Node's native TypeScript stripping
without a build. Gate-suite tests import the canonical server
[`SemanticCriterionSchema`](../server/src/engine/gates/core/gate-schema.ts) through the
existing server-lockfile-pinned `tsx` loader: native stripping cannot resolve the server
source graph's `.js` specifiers. Gate contracts therefore require that repository-local
tooling when executed; they are not a standalone native-only runtime. Strict typechecking
separately uses TypeScript and Node types from the server's locked development toolchain.

From the repository root, install those tools **only in a standalone checkout with its
own dependency directories**:

```bash
npm ci --prefix server --include=dev --ignore-scripts
```

Do not run `npm ci` or another install through a linked worktree's `node_modules` or
`server/node_modules` symlinks: that changes the shared checkout's dependencies. If those
tools are already available, run the checks directly without installing anything:

```bash
npm --prefix evaluations test
npm --prefix evaluations run typecheck
```

`npm test` runs `test:core` followed by `test:gates`. To run one boundary directly from
the repository root:

```bash
npm --prefix evaluations run test:core
npm --prefix evaluations run test:gates
```

`test:core` runs `node --test tests/*.test.ts`; `test:gates` runs
`node --import ../server/node_modules/tsx/dist/loader.mjs --test gates/*.test.ts` inside
this directory. Both exercise real canonical collaborators and temporary filesystems,
make no model calls and need no provider credentials. The optional
[CI workflow](../.github/workflows/evaluations.yml) uses a fresh Ubuntu checkout and Node24
to run native core controls, explicit gate-loader controls, then strict package types.
Its path filters cover this package and the imported server gate/shared sources; it is
unsuitable as a required branch-protection context. Local checks do not establish that
a hosted workflow ran successfully.

## Private gate-suite contracts

The [gate specialization](gates/contracts.ts) validates public criteria through the
canonical server schema, using the shared criterion types. It specializes the existing
`suite` archive payload rather than creating a second archive or gate-definition authority.
It currently supplies suite contracts, readiness checks and an adapter-facing projection;
there is no live calibration runner or calibration report yet. Committed gate tests are
synthetic development controls, not actual private pilot cases or evidence of model accuracy.

Each suite binds its ID/revision aliases, gate ID/definition digest and exact ordered
criterion IDs. Cases carry UTF-8 target blob references, complete expected criterion
states/acceptance, family, exposure and label-review receipts. Exact archive `record_id`
is the revision identity: changing labels changes that digest even when an author reuses
a revision alias. Gate resources must not embed expected labels or case material; private
suite data stays in the operator-selected evaluation root outside Git. Runtime association
authoring remains part of pending activation.

Structural pilot readiness requires reviewed, nonreserved cases in all five families:
positive, negative, valid alternative, boundary and insufficient evidence. It also requires
a reserved slice and refuses readiness when any labels are unreviewed. This is a structural
coverage check, not a statistical adequacy or promotion threshold. Ordinary adapter projection
accepts a selected development/runtime-anchor case and returns only its target reference,
public rubric binding and criterion IDs. It excludes expected labels, family/exposure,
review/promotion answers and sibling cases; selecting a reserved case is refused. Reserved
cases remain private and unattempted through this projection.

Label receipts explicitly distinguish agent from human review. Human calibration stays
`unknown` with a reason unless a caller supplies human receipts and every case is human-reviewed.
Those references and reviewer identifiers represent supplied authority, not verified human
identity or proof that the review occurred. Agent review cannot establish human calibration,
and readiness alone grants no automatic promotion authority. Suite targets and review receipts
are lifted into the canonical archive's dependency references so publication resolves them.

## Records and references

`createArchiveRecord` creates a detached, recursively frozen envelope.
`parseArchiveRecord` requires explicit usage/cost states and verifies the canonical body
digest. Missing factory measurements become `unknown`, with a reason; known zero remains
`known`. Trial and grade records bind the native seven-part identity, including each
retry's `attempt_id`. Generic JSON payloads remain owned by their domain-specific callers.

References distinguish blobs from records. Blob digests hash exact bytes; record digests
hash the canonical envelope body excluding `record_id`. Record references include their
kind. A blob's `media_type` is a caller annotation, not an independently verified content
classification. Lossy JSON, malformed controls/digests, and `__proto__` object keys are
refused; the last restriction preserves the shared canonical encoder's identity boundary.

## Private storage and replay

Choose an operator-owned private root outside Git and pass it to
`EvaluationArchive.open(root)`. There is no default path and no `state.db` dependency.
Keep raw native traces and authentication/session material out of Git.

| Method                      | Result                                                                       |
| --------------------------- | ---------------------------------------------------------------------------- |
| `putBlob(bytes, mediaType)` | Publish exact bytes and return a blob reference                              |
| `getBlob(ref)`              | Read detached bytes and verify their digest                                  |
| `putRecord(record)`         | Resolve declared dependencies, then publish the canonical envelope           |
| `getRecord(ref)`            | Read a frozen envelope and verify its body digest, kind, and canonical bytes |

Before publishing a record, the archive resolves its top-level references, provenance
references, and known usage/cost source references. Missing or corrupt dependencies
refuse publication. `getRecord` validates the envelope itself; replay must explicitly
load every referenced blob/record through `getBlob`/`getRecord`. A missing dependency
then fails at lookup. Reading one envelope does not recursively validate its dependency
closure.

The flat layout is `blobs/<64-hex-digest>` and `records/<64-hex-digest>.json`. Roots and
archive directories require mode `0700`, final files require `0600`, and ownership is
checked where POSIX UID APIs are available. Existing broader permissions are refused;
caller paths are not chmodded. Newly created directories/files receive private modes.

Publication writes and fsyncs a unique exclusive temporary, creates a hard link without
overwriting the final path, fsyncs the directory, and cleans up the temporary. Identical
existing content is validated and reused. Corrupt finals are refused and preserved;
orphan temporaries do not count as publications.

This backend requires POSIX modes, hard links, and directory fsync; Windows is explicitly
refused. The controls were run on Node24/Linux. They cover concurrency, tampering,
truncation, partial finals, symlinks, traversal, permission refusal, and replay after
deleting unrelated disposable runtime state. Power-loss recovery has not been
fault-injected. Path checks and `O_NOFOLLOW` reject observed symlinks, but Node's
path-based filesystem API provides no guarantee against an adversarial same-user
directory swap inside an operator-owned root.
