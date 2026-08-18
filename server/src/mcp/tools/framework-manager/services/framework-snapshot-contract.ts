// @lifecycle canonical - What a framework version records, and how it restores.

import type { ExistingFrameworkData } from './framework-file-writer.js';
import type { FrameworkCreationData } from '../core/types.js';

import {
  canonicalizeSnapshot,
  copyPresentFields,
  missingRequiredFields,
  type RestoreResult,
  type SnapshotContract,
} from '#modules/versioning/index.js';

/** The payload `FrameworkFileWriter.writeFrameworkFiles` accepts. */
export type FrameworkWriteModel = Partial<FrameworkCreationData> & { id: string };

/**
 * Framework fields a version snapshot records (OQ-C1, ruled 2026-08-17).
 *
 * Frameworks have no equivalent of the gate writer's declared key partition, so the line is drawn
 * by what `writeFrameworkFiles` can actually SET from its payload:
 *
 *  - `buildFrameworkYamlData` emits these from caller data, and `toFrameworkCreationData` reads
 *    every one of them back, so each round-trips.
 *  - Everything else on the framework surface — `phases` and the advanced authoring fields — is
 *    written through `deepMerge` over the existing YAML. A merge is purely additive: it cannot
 *    remove a key, so a rollback could never restore "this field was absent at version N" for
 *    them. Projecting a field a restore cannot honour is the defect this contract exists to
 *    remove, so they are left to the writer, exactly as `PRESERVED_GATE_YAML_KEYS` is on the gate
 *    side.
 *
 * `description` joined this set on 2026-08-17. It was already recorded by the pre-contract
 * snapshot and reported in the update diff, but `buildFrameworkYamlData` built no value for it, so
 * nothing could restore it — fixed in the writer rather than papered over here, because a snapshot
 * that records what no write path can apply is a promise the tool cannot keep.
 */
export const FRAMEWORK_SNAPSHOT_PROJECTED_KEYS = [
  'id',
  'name',
  'type',
  'description',
  'enabled',
  'system_prompt_guidance',
  'gates',
  'tool_descriptions',
] as const;

/**
 * Fields a framework snapshot must carry before it can be restored.
 *
 * The test is not "is this field important" but "does the writer INVENT a value when it is
 * absent". `enabled` qualifies and is the reason it is listed: `buildFrameworkYamlData` writes
 * `data.enabled ?? true`, so restoring a snapshot with no `enabled` would merge `enabled: true`
 * over a framework that is currently disabled — a live-value substitution wearing a default's
 * clothing. `id`, `name` and `type` qualify because omitting them merges the CURRENT value
 * forward under a message claiming version N was restored.
 *
 * Every pre-contract framework row already carries all four, so this set refuses no history that
 * exists today.
 */
export const FRAMEWORK_REQUIRED_SNAPSHOT_FIELDS = ['id', 'name', 'type', 'enabled'] as const;

/**
 * Projected fields whose absence leaves the corresponding artifact untouched rather than fabricated.
 *
 * These are safe to omit — the writer falls back to what is already on disk (`system-prompt.md`
 * survives via `?? existingData?.systemPrompt`; unmentioned YAML keys survive the deep merge) —
 * but omitting them means that part of the framework is NOT rolled back, which is why `restore`
 * reports them as `unrecordedFields` instead of returning silently.
 */
const FRAMEWORK_OPTIONAL_SNAPSHOT_FIELDS = FRAMEWORK_SNAPSHOT_PROJECTED_KEYS.filter(
  (key) => !(FRAMEWORK_REQUIRED_SNAPSHOT_FIELDS as readonly string[]).includes(key)
);

export const frameworkSnapshotContract: SnapshotContract<
  ExistingFrameworkData,
  FrameworkWriteModel
> = {
  resourceType: 'framework',
  requiredFields: FRAMEWORK_REQUIRED_SNAPSHOT_FIELDS,
  projectedFields: FRAMEWORK_SNAPSHOT_PROJECTED_KEYS,

  project(id, live) {
    const yaml = live.framework;
    const snapshot: Record<string, unknown> = {
      id,
      name: yaml['name'],
      type: yaml['type'],
      enabled: yaml['enabled'],
    };

    copyPresentFields(snapshot, yaml, ['description', 'gates']);

    // `toolDescriptions` is the YAML spelling; `tool_descriptions` is the authoring-payload key.
    // The writer accepts the second and emits the first, so the snapshot records the payload
    // spelling — otherwise `restore` would hand the writer a key it does not read.
    if (yaml['toolDescriptions'] != null) {
      snapshot['tool_descriptions'] = yaml['toolDescriptions'];
    }

    // The system prompt is authored in `system-prompt.md`, not in `framework.yaml`. Prefer the
    // file; fall back to the inline YAML key for frameworks that predate the split file.
    const systemPrompt = live.systemPrompt ?? yaml['systemPromptGuidance'];
    if (systemPrompt != null) {
      snapshot['system_prompt_guidance'] = systemPrompt;
    }

    // Declared key order, always — `latestSnapshotMatches` is JSON.stringify equality (F18).
    return canonicalizeSnapshot(snapshot, FRAMEWORK_SNAPSHOT_PROJECTED_KEYS);
  },

  restore(id, snapshot): RestoreResult<FrameworkWriteModel> {
    const missing = missingRequiredFields(snapshot, FRAMEWORK_REQUIRED_SNAPSHOT_FIELDS);
    if (missing.length > 0) {
      return { ok: false, missingFields: missing };
    }

    const writeModel: FrameworkWriteModel = {
      id,
      name: String(snapshot['name']),
      type: String(snapshot['type']),
      enabled: snapshot['enabled'] === true,
    };

    copyPresentFields(writeModel, snapshot, FRAMEWORK_OPTIONAL_SNAPSHOT_FIELDS);

    const unrecordedFields = FRAMEWORK_OPTIONAL_SNAPSHOT_FIELDS.filter(
      (field) => snapshot[field] == null
    );

    return unrecordedFields.length > 0
      ? { ok: true, writeModel, unrecordedFields }
      : { ok: true, writeModel };
  },
};
