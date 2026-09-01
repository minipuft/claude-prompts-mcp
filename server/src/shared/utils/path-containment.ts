// @lifecycle canonical - Asserts a constructed resource path stays inside its root.
/**
 * Path Containment
 *
 * WHY THIS EXISTS
 * `resource_manager` builds every write target by joining caller-supplied strings onto
 * a resource root -- `path.join(promptsDir, category, id)`, `path.join(gatesDir, id)`,
 * `path.join(serverRoot, 'resources', 'frameworks', id)`. `path.join` resolves `..`
 * silently and happily, so any of those components can walk out of the root.
 *
 * Reproduced 2026-08-25 against a live server, benign files only:
 *
 *   prompt create, category "../../../../../../../tmp/…"  -> reported "Prompt Created",
 *     wrote prompt.yaml and user-message.md outside the root, while the write receipt it
 *     printed still named `server/resources/prompts` as the resource root
 *   gate create, id "../../../../../../../tmp/…"          -> reported "created successfully",
 *     listed the escaped paths as "Files created", and added "Registered in the gate
 *     registry -- ready to use now"
 *
 * Both are arbitrary file writes as the server user, reachable by any client that can call
 * `resource_manager` -- which includes an agent steered by content it merely read.
 *
 * WHY A CONTAINMENT ASSERTION AND NOT ONLY INPUT VALIDATION
 * Prompt *ids* were already safe, via `/^[a-zA-Z][a-zA-Z0-9_-]*$/` in
 * `resource-manager/prompt/utils/validation.ts`. Category was not (`validateCategoryName`
 * checked only emptiness and length) and gate ids had no format rule at all. So the
 * codebase already had the per-field approach, and the holes were the fields nobody
 * remembered to add a rule to.
 *
 * Tightening each field is an enumeration of the vectors someone thought of; the next
 * path-bearing parameter added to a writer starts unprotected again. This asserts the
 * property that actually matters -- the RESOLVED path is inside the root -- at the point
 * the path is built, so a vector nobody enumerated still cannot escape. Field validation
 * is still worth having for the better error message, and remains in place; this is the
 * guarantee underneath it.
 *
 * RETIREMENT CONDITION
 * None. This is a permanent invariant, not deferred debt: it retires only if resource
 * writes stop deriving their path from caller-supplied strings.
 */

import { isAbsolute, join, relative, resolve, sep } from 'node:path';

/**
 * True when `candidate` resolves to `root` itself or something beneath it.
 *
 * Compares RESOLVED paths, because the whole failure being prevented is a string that
 * looks contained and resolves elsewhere. `path.relative` is what decides: a contained
 * path yields a relative result that neither starts with `..` nor is absolute. Testing
 * `candidate.startsWith(root)` instead would be wrong twice -- it admits a sibling
 * directory whose name merely extends the root (`/srv/resources-evil` against
 * `/srv/resources`), and it rejects nothing that `..` can reach.
 */
export function isPathInside(root: string, candidate: string): boolean {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);

  if (resolvedCandidate === resolvedRoot) {
    return true;
  }

  const rel = relative(resolvedRoot, resolvedCandidate);
  if (rel === '' || isAbsolute(rel)) {
    return rel === '';
  }
  // `!rel.startsWith('..')` would be wrong for a legitimate directory whose NAME begins with
  // dots: `<root>/..foo` is inside the root, and yields the relative path `..foo`. Comparing
  // against the traversal segment exactly — `..` alone, or `..` followed by a separator — admits
  // it while still rejecting every real escape. Latent today (the id and category patterns reject
  // such a name first) and corrected here so the predicate does not depend on them to be right.
  return rel !== '..' && !rel.startsWith(`..${sep}`);
}

/**
 * Throw unless `candidate` is contained by `root`.
 *
 * `label` names the caller-supplied field so the operator can tell which parameter was
 * rejected -- "category" and "id" fail very differently for whoever is debugging it. The
 * message deliberately does NOT echo the attacker-supplied string back verbatim into a
 * suggested fix: the pre-fix gate writer printed the traversal into a copy-pasteable
 * `.gitignore` snippet, which turns a refusal into an instruction.
 */
export function assertPathInside(root: string, candidate: string, label: string): void {
  if (isPathInside(root, candidate)) {
    return;
  }
  throw new Error(
    `Refusing to write outside the resource root: the supplied ${label} resolves to a ` +
      `location outside ${resolve(root)}. Resource ids and categories name a directory ` +
      `beneath the root; they cannot contain path separators or '..'.`
  );
}

/**
 * Join caller-supplied segments onto `root` and return the path only if it is contained.
 *
 * The join IS the check, which is the point. `assertPathInside` above requires the caller to
 * build the path and then remember a second call — and a guard the caller must remember is the
 * shape this repository has already been bitten by twice: `validateCategoryName` shipped with
 * ZERO call sites while reading as coverage, and `validatePromptId` was reached from the draft
 * service and from nowhere else. A function that cannot hand back an unchecked path removes the
 * remembering.
 *
 * Both are exported deliberately. `assertPathInside` remains correct where the caller already
 * holds a fully-built path from somewhere else; this is the one to reach for when the path is
 * being composed here, which is every resource write.
 */
export function resolveContainedPath(root: string, ...segments: string[]): string {
  const candidate = join(root, ...segments);
  if (!isPathInside(root, candidate)) {
    throw new Error(
      `Refusing to write outside the resource root: the supplied path segments resolve to a ` +
        `location outside ${resolve(root)}. Resource ids and categories name a directory ` +
        `beneath the root; they cannot contain path separators or '..'. Nothing was written.`
    );
  }
  return candidate;
}
