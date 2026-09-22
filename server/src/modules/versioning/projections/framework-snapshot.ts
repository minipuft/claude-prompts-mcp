// @lifecycle canonical - The one framework snapshot projection, read by the MCP tool layer and cpm.

import { canonicalizeSnapshot, copyPresentFields } from '../snapshot-contract.js';

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
 * The test is not "is this field important" but "would a restore without it report version N
 * while writing some other value". All four qualify: omitted, the writer keeps the CURRENT value,
 * because an edit merges over the stored document and supplies no defaults of its own (B.65 moved
 * `enabled: true` to create-only). That carries the current value forward under a message
 * claiming version N was restored.
 *
 * Every pre-contract framework row already carries all four, so this set refuses no history that
 * exists today.
 */
export const FRAMEWORK_REQUIRED_SNAPSHOT_FIELDS = ['id', 'name', 'type', 'enabled'] as const;

/**
 * Projected fields whose absence leaves the corresponding artifact untouched rather than fabricated.
 *
 * These are safe to omit. The writer leaves what is already on disk: unmentioned YAML keys survive
 * the deep merge.
 * But omitting them means that part of the framework is NOT rolled back, which is why `restore`
 * reports them as `unrecordedFields` instead of returning silently.
 */
export const FRAMEWORK_OPTIONAL_SNAPSHOT_FIELDS = FRAMEWORK_SNAPSHOT_PROJECTED_KEYS.filter(
  (key) => !(FRAMEWORK_REQUIRED_SNAPSHOT_FIELDS as readonly string[]).includes(key)
);

/**
 * Everything a framework snapshot is projected FROM: the parsed `framework.yaml`.
 *
 * The system prompt is part of it — `systemPromptGuidance` is its one source (R91), the text the
 * runtime serves. Both surfaces hold exactly this, the server as `ExistingFrameworkData.framework`
 * and the CLI as one file read, so neither needs the other's loader.
 */
export interface FrameworkSnapshotSource {
  readonly framework: Record<string, unknown>;
}

/** Project a framework onto exactly the authored state a version row records. */
export function projectFrameworkSnapshot(
  id: string,
  source: FrameworkSnapshotSource
): Record<string, unknown> {
  const yaml = source.framework;
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

  // `systemPromptGuidance` is the YAML spelling; `system_prompt_guidance` the payload one, for the
  // same reason as `tool_descriptions` above.
  const systemPrompt = yaml['systemPromptGuidance'];
  if (systemPrompt != null) {
    snapshot['system_prompt_guidance'] = systemPrompt;
  }

  // Declared key order, always — `latestSnapshotMatches` is JSON.stringify equality (F18).
  return canonicalizeSnapshot(snapshot, FRAMEWORK_SNAPSHOT_PROJECTED_KEYS);
}
