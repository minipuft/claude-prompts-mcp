# Optional evaluation evidence archive

This private, repository-local Node24 TypeScript package provides immutable evaluation
records and content-addressed evidence blobs. Use it explicitly from a checkout; it has
no runtime dependencies and does not join the root workspace or default server startup.
Its [contracts](core/contracts.ts) and [archive](core/archive.ts) import the existing
[canonical hash source](../server/src/shared/utils/hash.ts) outside this directory, so
the package is not an independently published library.

## Setup and checks

Use Node24 on Linux. Runtime and tests use Node's native TypeScript stripping without
a build. Strict typechecking separately uses TypeScript and Node types from the server's
locked development toolchain.

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

The native suite exercises generic contracts and real temporary filesystems. It makes
no model calls and needs no provider credentials. The optional [CI workflow](../.github/workflows/evaluations.yml)
uses a fresh Ubuntu checkout and Node24 to run these same commands; its path filters
make it unsuitable as a required branch-protection context.

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
