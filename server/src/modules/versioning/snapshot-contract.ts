// @lifecycle canonical - What a complete recorded state is, and how it projects from and restores to disk.

import type { ResourceType } from './types.js';

/**
 * Outcome of reconstructing a write model from a recorded snapshot.
 *
 * The failure case names fields rather than returning a partial model on purpose. The defect this
 * type exists to remove (F2) was `snapshot[k] ?? live.k`: a snapshot missing a field silently
 * borrowed the CURRENT value, so the rollback landed on a state matching neither the target version
 * nor the state before it, under a message telling the operator version N had been restored.
 * Absence must be reportable, and the only honest report names the field.
 */
export type RestoreResult<TWrite> =
  | {
      ok: true;
      writeModel: TWrite;
      /**
       * Projected fields this snapshot does not carry, whose artifacts the writer will therefore
       * leave at their CURRENT content.
       *
       * Only meaningful for a writer that merges rather than rebuilds. A gate write rebuilds
       * `gate.yaml` from the payload, so an absent optional field means the restored gate has no
       * such field — a complete restore. A framework write deep-merges over the existing YAML and
       * cannot remove a key, so an absent field means that part of the resource is NOT rolled
       * back. Reporting the difference is the whole point: a partial restore announced as a full
       * one is the same lie as substituting a live value, just at file granularity instead of
       * field granularity.
       */
      unrecordedFields?: readonly string[];
    }
  | { ok: false; missingFields: string[] };

/**
 * The per-resource-type declaration of what a version record contains.
 *
 * Two directions, deliberately not one reversible mapping: `project` reads a live in-memory
 * resource and `restore` builds the payload a file writer takes, and those two shapes differ
 * (a gate projects `guidance` as a string but its writer takes it as a separate file body).
 *
 * `TLive` and `TWrite` are separate parameters for the same reason.
 */
export interface SnapshotContract<TLive, TWrite> {
  readonly resourceType: ResourceType;

  /**
   * Fields a snapshot must carry before `restore` can reconstruct the resource from it.
   *
   * A snapshot missing one of these is not a restorable record. This set is what makes a refusal
   * possible, so it must list only fields the WRITER genuinely requires — adding a field here that
   * the writer can default turns a working rollback into a refusal.
   */
  readonly requiredFields: readonly string[];

  /**
   * Every key this contract records, required and optional together.
   *
   * Declared so a caller holding a WRITE model rather than a live resource can project it through
   * `projectWriteModel` and get a snapshot comparable to `project`'s output. An update needs
   * exactly that: the state it is about to produce exists only as the writer's payload, and
   * recording it in a different shape than the prior state would make the bridge check —
   * `JSON.stringify` equality against the newest row — differ on every edit.
   */
  readonly projectedFields: readonly string[];

  /** Project the live resource onto exactly the authored state a version row records. */
  project(id: string, live: TLive): Record<string, unknown>;

  /** Rebuild the writer's payload from a recorded snapshot, or refuse and name what is absent. */
  restore(id: string, snapshot: Record<string, unknown>): RestoreResult<TWrite>;
}

/**
 * Which required fields a snapshot does not carry.
 *
 * `null` counts as absent throughout the contract: snapshots round-trip through JSON, which has no
 * `undefined`, so a field that was absent at projection time reads back as `null` rather than as a
 * missing key. Treating only `undefined` as absent would let a `null` reach the writer, which
 * either writes `key: null` into the YAML — failing the loader's schema on the next read — or is
 * silently dropped by a truthiness check further down.
 */
export function missingRequiredFields(
  snapshot: Record<string, unknown>,
  requiredFields: readonly string[]
): string[] {
  return requiredFields.filter((field) => snapshot[field] == null);
}

/**
 * Copy `fields` from `snapshot` onto `target`, skipping absent ones.
 *
 * Absent means "the resource did not have this field at that version", so the writer must see
 * nothing rather than an explicit `undefined` — several writers branch on `!== undefined` and an
 * explicitly-assigned `undefined` reads the same as a supplied value to `Object.keys`.
 */
export function copyPresentFields(
  target: Record<string, unknown>,
  snapshot: Record<string, unknown>,
  fields: readonly string[]
): void {
  for (const field of fields) {
    if (snapshot[field] != null) {
      target[field] = snapshot[field];
    }
  }
}

/**
 * Re-emit a snapshot's keys in the contract's declared order.
 *
 * Every projection MUST end here. `latestSnapshotMatches` decides whether an edit needs a bridge
 * row by comparing `JSON.stringify(recorded) === JSON.stringify(live)`, and `JSON.stringify`
 * preserves insertion order — so two records holding identical data in different key orders
 * compare unequal and every single edit bridges. That is not a hypothetical: it shipped in
 * Tier 3 and was caught only by driving a live server (F18). `project` built its required fields
 * first and appended the optional ones, while `projectWriteModel` emitted `projectedFields` order;
 * the two never matched, so a gate's history filled with bridge rows at two rows per edit.
 *
 * Ordering by the contract's own `projectedFields` makes the two directions agree by construction
 * rather than by each implementation remembering to. Keys outside `projectedFields` are dropped —
 * a projection has no business carrying them, and silently keeping one would reintroduce exactly
 * the order-dependence this removes.
 */
export function canonicalizeSnapshot(
  record: Record<string, unknown>,
  projectedFields: readonly string[]
): Record<string, unknown> {
  const canonical: Record<string, unknown> = {};
  for (const field of projectedFields) {
    if (record[field] != null) {
      canonical[field] = record[field];
    }
  }
  return canonical;
}

/**
 * Project a writer payload onto the same shape `project` produces from a live resource.
 *
 * Used to record the state an edit is ABOUT to produce, before the file write that produces it.
 * Reading the resource back after the write would be the obvious alternative and is wrong twice
 * over: it inverts the record-before-write ordering that lets a persistence failure abort with
 * nothing on disk, and it reads through a registry that has not reloaded yet.
 *
 * `base` carries the fields the payload does not mention, for writers that merge rather than
 * rebuild — the produced state is the merge, so the record must be too.
 */
export function projectWriteModel(
  id: string,
  writeModel: Record<string, unknown>,
  projectedFields: readonly string[],
  base?: Record<string, unknown>
): Record<string, unknown> {
  const snapshot: Record<string, unknown> = { ...(base ?? {}), id };
  copyPresentFields(snapshot, writeModel, projectedFields);
  return canonicalizeSnapshot(snapshot, projectedFields);
}

/**
 * The refusal an operator reads when a version cannot be restored.
 *
 * Centralised because the sentence has to carry three facts every caller was previously free to
 * omit: which fields are missing, that the resource is unchanged, and that no version row was
 * written. The prompt path already said all three; the gate and framework paths said none of them
 * because they never refused at all.
 */
/**
 * What `action: 'preview'` with `preview_action: 'rollback'` reports instead of rolling back.
 *
 * Stated here beside the refusal message because the two are the operator's whole view of a
 * rollback before it happens, and the guarantee they carry is the same one: nothing was written.
 * A preview that ran after the version row was recorded would be a preview of an action already
 * half-taken, which is why the caller returns from here BEFORE `commitEdit`.
 */
export function describeRollbackPreview(
  resourceType: ResourceType,
  id: string,
  version: number,
  diff: { hasChanges: boolean; formatted: string },
  unrecordedFields?: readonly string[]
): string {
  let text =
    `🔍 **Preview** — rollback of ${resourceType} '${id}' to version ${version}\n\n` +
    `Nothing was written: no file changed and no version row was recorded.\n\n`;

  text += diff.hasChanges
    ? `${diff.formatted}\n\n`
    : `Version ${version} matches the current state — this rollback would change nothing.\n\n`;

  if (unrecordedFields !== undefined && unrecordedFields.length > 0) {
    text +=
      `⚠️ Version ${version} recorded no ${unrecordedFields.join(', ')}. ` +
      `Those would keep their current values.\n\n`;
  }

  return `${text}💡 Re-send as \`action:"rollback"\` with \`confirm: true\` to apply it.`;
}

export function describeIncompleteSnapshot(
  resourceType: ResourceType,
  id: string,
  version: number,
  missingFields: readonly string[]
): string {
  return (
    `Rollback failed: version ${version} of ${resourceType} '${id}' is not a complete ` +
    `snapshot — missing ${missingFields.join(', ')}.\n\n` +
    `The ${resourceType} was left unchanged and no version was recorded. Substituting the live ` +
    `value for a missing field is what produced rollbacks landing on a state matching neither ` +
    `version.`
  );
}
