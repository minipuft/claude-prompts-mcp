// @lifecycle canonical - Pure anchored patch application for a prompt's text bodies.
/**
 * Anchored `old_string`/`new_string` patching for the three prompt text bodies (OQ-P7-1).
 *
 * Pure by construction: no I/O, no logging, no clock. The caller supplies the CURRENT body text
 * and the ordered operations; this module returns either the produced bodies or one typed
 * rejection. It cannot live in `PromptLifecycleProcessor` (orchestration, architecture.md) nor in
 * `file-operations.ts` (the I/O boundary — applying patches there would bypass reference
 * validation and the version snapshot, breaking version parity with a full update).
 *
 * Addressing is exact-match and uniqueness-checked, never fuzzy: an anchor that matches twice is a
 * rejection rather than a best-effort edit, because silently patching the wrong region is the
 * defect class the feature exists to avoid. `replace_all: true` is the explicit opt-in for a
 * multi-occurrence edit.
 *
 * Operations apply IN ORDER, each against the result of the previous one, so a later anchor may
 * legitimately match text a previous operation produced.
 */

/** The three text bodies a patch may address. Values are the tool's own parameter names. */
export const PATCH_TARGET_FIELDS = [
  'user_message_template',
  'system_message',
  'description',
] as const;

export type PatchTargetField = (typeof PATCH_TARGET_FIELDS)[number];

export interface TemplatePatchOperation {
  /** Which text body this operation edits. */
  field: PatchTargetField;
  /** Exact text to locate. Must be non-empty and (without `replace_all`) unique in the body. */
  old_string: string;
  /** Replacement text. May be empty — that is a deletion. */
  new_string: string;
  /** Replace every occurrence instead of rejecting an ambiguous anchor. */
  replace_all?: boolean;
}

export type PatchRejectionReason =
  /** `old_string` was empty — an empty anchor matches everywhere and addresses nothing. */
  | 'empty_old_string'
  /** The prompt has no text for that field at all (e.g. patching an absent `system_message`). */
  | 'target_absent'
  /** The anchor does not occur in the field's current text. */
  | 'anchor_not_found'
  /** The anchor occurs more than once and `replace_all` was not set. */
  | 'anchor_ambiguous';

export interface PatchRejection {
  reason: PatchRejectionReason;
  field: PatchTargetField;
  /** 1-based position of the failing operation in the submitted array. */
  operation: number;
  /** Occurrences of the anchor in the field's current text (0 for not-found / absent target). */
  occurrences: number;
  /** Operator-facing explanation naming the field and a short excerpt of the anchor. */
  message: string;
}

export type TemplatePatchResult =
  | {
      ok: true;
      /** Only the fields an operation actually touched. */
      values: Partial<Record<PatchTargetField, string>>;
      /** Number of operations applied. */
      applied: number;
    }
  | { ok: false; rejection: PatchRejection };

/** Current text of each patchable field. `undefined` means the prompt does not carry that field. */
export type PatchableBodies = Partial<Record<PatchTargetField, string | undefined>>;

const EXCERPT_LIMIT = 60;

/**
 * Non-overlapping occurrence count, matching the stride `replace_all` uses. Counting overlapping
 * matches would report an ambiguity that a replacement could never produce.
 */
function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

/** Single-line, length-capped rendering of an anchor for an error message. */
function excerpt(anchor: string): string {
  const flattened = anchor.replace(/\s+/g, ' ').trim();
  return flattened.length > EXCERPT_LIMIT ? `${flattened.slice(0, EXCERPT_LIMIT)}…` : flattened;
}

function reject(
  reason: PatchRejectionReason,
  field: PatchTargetField,
  operation: number,
  occurrences: number,
  message: string
): TemplatePatchResult {
  return { ok: false, rejection: { reason, field, operation, occurrences, message } };
}

/**
 * Apply anchored replacements to a prompt's text bodies.
 *
 * Fails fast on the first rejected operation: operations apply in sequence against each other's
 * output, so once one cannot be placed the remaining anchors are being matched against text that
 * was never produced. Reporting them together would report guesses.
 */
export function applyTemplatePatches(
  current: PatchableBodies,
  operations: readonly TemplatePatchOperation[]
): TemplatePatchResult {
  const working: PatchableBodies = { ...current };
  const values: Partial<Record<PatchTargetField, string>> = {};
  let applied = 0;

  for (let index = 0; index < operations.length; index += 1) {
    const operation = operations[index] as TemplatePatchOperation;
    const position = index + 1;
    const { field } = operation;

    if (operation.old_string.length === 0) {
      return reject(
        'empty_old_string',
        field,
        position,
        0,
        `Operation ${position} (${field}): \`old_string\` is empty. An anchor must be the exact existing text to replace.`
      );
    }

    const body = working[field];
    if (typeof body !== 'string') {
      return reject(
        'target_absent',
        field,
        position,
        0,
        `Operation ${position}: this prompt has no \`${field}\` to patch. Set it with the full parameter first, then patch it.`
      );
    }

    const occurrences = countOccurrences(body, operation.old_string);
    if (occurrences === 0) {
      return reject(
        'anchor_not_found',
        field,
        position,
        0,
        `Operation ${position} (${field}): anchor not found — "${excerpt(operation.old_string)}". Anchors match exactly, including whitespace.`
      );
    }
    if (occurrences > 1 && operation.replace_all !== true) {
      return reject(
        'anchor_ambiguous',
        field,
        position,
        occurrences,
        `Operation ${position} (${field}): anchor occurs ${occurrences} times — "${excerpt(operation.old_string)}". Extend it until it is unique, or pass \`replace_all: true\`.`
      );
    }

    const next =
      operation.replace_all === true
        ? body.split(operation.old_string).join(operation.new_string)
        : replaceFirst(body, operation.old_string, operation.new_string);

    working[field] = next;
    values[field] = next;
    applied += 1;
  }

  return { ok: true, values, applied };
}

/**
 * Full-body parameters that cannot be combined with `patch` in one call.
 *
 * A full body REPLACES the text the anchors are computed against, so accepting both in one call
 * would make the result depend on an evaluation order the caller cannot see. Rejecting is the
 * point: silently preferring either one is the failure mode.
 */
const PATCH_EXCLUSIVE_BODY_PARAMETERS: readonly PatchTargetField[] = [
  'user_message_template',
  'system_message',
];

/**
 * Detect a `patch` + full-body parameter collision, returning an operator-facing message.
 *
 * `description` is not blanket-exclusive — patching a template while setting a new description is
 * a legitimate single call — but supplying it AND patching it collides exactly like the other two.
 */
export function findPatchParameterConflict(
  suppliedBodyParameters: readonly PatchTargetField[],
  operations: readonly TemplatePatchOperation[]
): string | undefined {
  const supplied = new Set(suppliedBodyParameters);

  const exclusive = PATCH_EXCLUSIVE_BODY_PARAMETERS.filter((parameter) => supplied.has(parameter));
  if (exclusive.length > 0) {
    return `\`patch\` cannot be combined with ${exclusive.map((name) => `\`${name}\``).join(' or ')} in the same call. Send the full body, or patch it — not both.`;
  }

  if (
    supplied.has('description') &&
    operations.some((operation) => operation.field === 'description')
  ) {
    return '`patch` targets `description` while `description` was also supplied as a full value. Send one or the other.';
  }

  return undefined;
}

/** Literal (non-regex) single replacement — `String.replace` would interpret `$&` in `new_string`. */
function replaceFirst(body: string, anchor: string, replacement: string): string {
  const at = body.indexOf(anchor);
  return body.slice(0, at) + replacement + body.slice(at + anchor.length);
}
