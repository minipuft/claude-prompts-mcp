// @lifecycle canonical - Sole containment guard for caller-supplied resource path segments.
/**
 * Join caller-supplied segments under a root and refuse anything that escapes it.
 *
 * Every resource writer builds its destination from values the CALLER chose — a prompt's
 * `category`, a gate's `id`, a framework's `id` and its `phasesFile` / `judgePromptFile`
 * references. `path.join` resolves `..` silently, so a segment carrying `../..` walks out of the
 * resources root and the write lands wherever it points, with caller-controlled content.
 *
 * Measured 2026-08-30 against `dist/`, all three with a passing benign control beside them:
 *
 *   prompt    create(id:'trav_a', category:'../../ESCAPED')  -> <ws>/escaped/trav_a/{prompt.yaml,user-message.md}
 *   gate      create(id:'../../ESCAPED_GATE')                -> <ws>/ESCAPED_GATE/{gate.yaml,guidance.md}
 *   framework create(id:'../../ESCAPED_FW')                  -> <ws>/escaped_fw/{framework.yaml,phases.yaml,system-prompt.md}
 *
 * Each reported success. The prompt case reported `✅ Prompt Created` in its body.
 *
 * Only the prompt `id` was already guarded, by `validatePromptId` — which is reached from the
 * draft service and not from `category` at all. That is the shape of the defect: one segment of a
 * multi-segment path was validated, and the validation read as covering the join.
 *
 * SCOPE, stated so a reader does not over-trust this: the check is LEXICAL. It proves the
 * requested path is inside `root` after `..` resolution. It does not follow symlinks — a symlink
 * already inside `root` that points outside still escapes on write. Real-path resolution is not
 * available here because the destination usually does not exist yet, which is the whole point of
 * a create. Symlink containment is a separate control and this function does not provide it.
 */
import path from 'node:path';

/** A write whose caller-supplied segments resolved outside the root they had to stay inside. */
export class PathEscapeError extends Error {
  constructor(
    readonly root: string,
    readonly attempted: string,
    readonly segments: readonly string[]
  ) {
    super(
      `Refusing to write outside the resources root: ${segments.map((s) => JSON.stringify(s)).join(' / ')} ` +
        `resolves to '${attempted}', which is outside '${root}'. Nothing was written.`
    );
    this.name = 'PathEscapeError';
  }
}

/**
 * True when `candidate` is `root` itself or sits beneath it, comparing resolved paths.
 *
 * The `..` test is segment-wise rather than `startsWith('..')`: a relative result of `..foo` is a
 * sibling NAME, not a parent traversal, and a prefix test would reject a legitimate one.
 */
export function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (relative === '') return true;
  if (path.isAbsolute(relative)) return false;
  return relative !== '..' && !relative.startsWith(`..${path.sep}`);
}

/**
 * `path.join(root, ...segments)`, but throws `PathEscapeError` rather than returning a path
 * outside `root`.
 *
 * Use this for EVERY join whose segments come from a tool payload. A plain `path.join` at such a
 * site is the defect above, and `validate:contained-resource-writes` fails on one.
 */
export function resolveContainedPath(root: string, ...segments: string[]): string {
  const candidate = path.join(root, ...segments);
  if (!isPathInside(root, candidate)) {
    throw new PathEscapeError(root, candidate, segments);
  }
  return candidate;
}
