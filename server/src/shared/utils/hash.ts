// @lifecycle canonical - Content hashing utilities for cache generation and sync.
/**
 * Hash Utilities
 *
 * Provides deterministic content hashing for cache invalidation and sync manifests.
 * Single source of truth for SHA-256 hashing across the codebase.
 *
 * TWO families live here, and they are not interchangeable.
 *
 * **Canonical** — `canonicalJson`, `hashCanonical`, `hashBytes`, `hashFileSet`. Every digest
 * carries the `sha256:` prefix, and the value's canonical form is its IDENTITY: byte-equal
 * canonical forms mean "the same state". This is the equality primitive for every "has this
 * changed?" decision. `hashFileSet` is injective where `computeContentHash` is not.
 *
 * **Legacy** — `computeContentHash`, `hashString`. Raw hex, no prefix; `computeContentHash` sorts
 * and concatenates its inputs with no separator, so `["ab","c"]` and `["a","bc"]` collide. They
 * remain because their digests are PERSISTED (`resource_index.content_hash`,
 * `skills_sync_manifests.source_hash`/`output_hash`), so migrating a call site invalidates stored
 * rows; that migration is its own slice, with the one-time skills-sync re-export it causes stated
 * up front. Do not reach for them in new code.
 *
 * Consumers:
 * - ResourceIndexer: Content hashes for incremental sync (resource_index table)
 * - skills-sync.ts: Manifest hashing for drift detection
 * - ResourceChangeTracker: Audit log hashing (adds `sha256:` prefix)
 * - version_history writers (server + cpm): `hashCanonical` as the unchanged-write test
 */

import { createHash } from 'node:crypto';

/**
 * Compute SHA256 hash from content strings.
 * Sorts inputs for deterministic output regardless of order.
 *
 * @param contents - Array of content strings to hash
 * @returns Hex-encoded SHA256 hash
 *
 * @example
 * ```typescript
 * const hash = computeContentHash([schemaJson, configYaml, description]);
 * ```
 */
export function computeContentHash(contents: string[]): string {
  const h = createHash('sha256');
  for (const c of contents.sort()) h.update(c);
  return h.digest('hex');
}

/**
 * Compute SHA256 hash from a single string.
 *
 * @param content - Content string to hash
 * @returns Hex-encoded SHA256 hash
 */
export function hashString(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * The prefix every canonical hash carries.
 *
 * `sha256:` is the convention an operator already reads in `system_control changes`
 * (`changes-action-handler.ts`), so it is the one the canonical family adopts rather than
 * introducing a fifth.
 */
const HASH_PREFIX = 'sha256:';

/**
 * What `canonicalJson` refuses, and why refusal rather than a guess.
 *
 * The output of this function is an IDENTITY: two values are "the same state" exactly when their
 * canonical forms are byte-equal. A value that cannot round-trip through JSON has no stable
 * identity to compute — `JSON.stringify` maps `undefined`, `NaN` and `Infinity` all onto the same
 * `null` inside an array, and maps a `Date` onto a string that reads back as a string. Encoding
 * any of them would make two genuinely different states collide, or make one state hash
 * differently depending on which side of a persistence boundary it was read from. Both failures
 * are silent, and both corrupt the "unchanged" decisions this hash exists to make — so the
 * unrepresentable input fails loudly at the cause instead.
 *
 * Accepted: `string`, finite `number`, `boolean`, `null`, arrays, and plain objects (an
 * `Object.prototype` or null prototype, no `toJSON`). `undefined` object MEMBERS are dropped,
 * because `JSON.stringify` already drops them and every snapshot in this codebase crosses that
 * boundary; `undefined` as an array element or as the whole value is refused, because there it
 * would become `null`.
 *
 * `-0` is emitted as `0`. That is not a guess: `JSON.stringify(-0)` is `"0"` and the value reads
 * back as `+0`, so `0` IS its round-tripped identity.
 */
function encodeCanonical(value: unknown, path: string): string {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) {
        throw new TypeError(
          `canonicalJson: ${String(value)} at ${path} has no JSON representation ` +
            `(it would serialise as null and collide with a real null)`
        );
      }
      // Object.is(-0, 0) is false, but their JSON forms are both "0".
      return JSON.stringify(value === 0 ? 0 : value);
    case 'object':
      return encodeCanonicalObject(value, path);
    default:
      throw new TypeError(
        `canonicalJson: ${typeof value} at ${path} has no JSON representation; ` +
          `convert it before hashing`
      );
  }
}

function encodeCanonicalObject(value: object, path: string): string {
  if (Array.isArray(value)) {
    // Array ORDER IS content — two orderings of the same members are two different states.
    return `[${value
      .map((member, index) => {
        if (member === undefined) {
          throw new TypeError(
            `canonicalJson: undefined at ${path}[${index}] has no JSON representation ` +
              `(it would serialise as null)`
          );
        }
        return encodeCanonical(member, `${path}[${index}]`);
      })
      .join(',')}]`;
  }

  const prototype = Object.getPrototypeOf(value) as object | null;
  if (prototype !== Object.prototype && prototype !== null) {
    const named = (value as { constructor?: { name?: string } }).constructor?.name;
    throw new TypeError(
      `canonicalJson: ${named ?? 'non-plain object'} at ${path} is not a plain ` +
        `object; convert it to JSON-representable data before hashing`
    );
  }
  if ('toJSON' in value) {
    throw new TypeError(
      `canonicalJson: the object at ${path} defines toJSON, so its hashed form would differ ` +
        `from the value that reads back; convert it before hashing`
    );
  }

  const record = value as Record<string, unknown>;
  // ASCII-ascending by code unit — the default `Array.prototype.sort` comparator, deliberately
  // NOT `localeCompare`, which is locale-dependent and would make the hash machine-dependent.
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${encodeCanonical(record[key], `${path}.${key}`)}`)
    .join(',')}}`;
}

/**
 * Serialise a value to a form where byte-equality means "the same state".
 *
 * Object keys sorted ASCII-ascending, array order preserved, no whitespace. Throws `TypeError`
 * naming the path for anything that cannot round-trip through JSON (see `encodeCanonical`).
 */
export function canonicalJson(value: unknown): string {
  if (value === undefined) {
    throw new TypeError('canonicalJson: undefined has no JSON representation');
  }
  return encodeCanonical(value, '$');
}

/** `sha256:` + the digest of a value's canonical JSON form. */
export function hashCanonical(value: unknown): string {
  return HASH_PREFIX + createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

/** `sha256:` + the digest of raw bytes — for file content, which has no JSON structure. */
export function hashBytes(content: string | Uint8Array): string {
  return HASH_PREFIX + createHash('sha256').update(content).digest('hex');
}

/**
 * One hash for a set of files, keyed by path.
 *
 * Replaces `computeContentHash`, which is **not injective**: it sorts the content strings and
 * concatenates them with no separator, so `["ab","c"]` and `["a","bc"]` produce the same digest
 * and moving one file's content into another is invisible by construction. Here each file
 * contributes its own digest under its own path, so a path can only ever compare against the same
 * path, and JSON delimits every member.
 *
 * Entries are sorted BY PATH rather than left in argument order: a file set has no inherent
 * order, and the callers this replaces (`resource_index`, skills-sync manifests) depend on
 * enumeration order not changing the answer. Sorting by path keeps that property without
 * sacrificing injectivity, because paths are unique — which is why a duplicate path is refused
 * rather than silently collapsed or double-counted.
 */
export function hashFileSet(files: ReadonlyArray<{ path: string; content: string }>): string {
  const seen = new Set<string>();
  for (const file of files) {
    if (seen.has(file.path)) {
      throw new TypeError(
        `hashFileSet: duplicate path '${file.path}' — a file set has one entry per path`
      );
    }
    seen.add(file.path);
  }
  const entries = [...files]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((file) => [file.path, hashBytes(file.content)]);
  return hashCanonical(entries);
}
