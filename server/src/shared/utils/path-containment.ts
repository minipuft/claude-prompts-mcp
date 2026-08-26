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

import { isAbsolute, relative, resolve } from 'node:path';

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
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
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
