/**
 * Shared type constants for CLI commands.
 *
 * Extracted from list.ts and inspect.ts to eliminate duplication.
 */

import type { HistoryResourceRef } from '@cli-shared/version-history.js';

export type ResourceType = 'prompts' | 'gates' | 'frameworks' | 'styles';

/**
 * Maps singular and plural type names to canonical plural form.
 */
export const TYPE_MAP: Record<string, ResourceType> = {
  prompt: 'prompts',
  prompts: 'prompts',
  gate: 'gates',
  gates: 'gates',
  framework: 'frameworks',
  frameworks: 'frameworks',
  style: 'styles',
  styles: 'styles',
};

/**
 * Per-type configuration for resource discovery.
 */
export const TYPE_CONFIG: Record<
  ResourceType,
  {
    entryFile: string;
    nested: boolean;
    snapshotKeysNotInEntryFile?: readonly string[];
    snapshotKeyToEntryKey?: Readonly<Record<string, string>>;
  }
> = {
  prompts: {
    entryFile: 'prompt.yaml',
    nested: true,
    // Both are authored content held in companion files — `prompt.yaml` carries only the
    // POINTERS, `systemMessageFile` and `userMessageTemplateFile`. Merging the bodies in left
    // `prompt.yaml` declaring both a pointer and an inline body, two sources the loader resolves
    // by reading the file and ignoring what the snapshot restored. Measured 2026-09-19.
    snapshotKeysNotInEntryFile: ['systemMessage', 'userMessageTemplate'],
  },
  // `guidance` is the markdown body of `guidance.md`. The server projects it into a gate snapshot
  // because it is authored content, but writing it back into `gate.yaml` would leave two
  // disagreeing guidance sources — which is why the server's writer excludes it from the YAML
  // (`GATE_YAML_EXCLUDED_KEYS`) and emits it as a file instead.
  gates: { entryFile: 'gate.yaml', nested: false, snapshotKeysNotInEntryFile: ['guidance'] },
  frameworks: {
    entryFile: 'framework.yaml',
    nested: false,
    // A snapshot records the AUTHORING-PAYLOAD spelling, because the server restores by handing
    // it back to `FrameworkFileWriter`, which reads `tool_descriptions` and emits
    // `toolDescriptions`. The CLI has no writer in between, so it renames here. Merging the
    // payload spelling straight in added a second `tool_descriptions:` key beside the real
    // `toolDescriptions:` — and reported `toolDescriptions` as "not restored" while writing it
    // under a name nothing reads. Measured 2026-09-19.
    //
    // `system_prompt_guidance` is renamed for the same reason. It was excluded while the system
    // prompt was also written to `system-prompt.md`, so a `cpm rollback` never restored it; its
    // one source is now `framework.yaml`'s `systemPromptGuidance` (R91).
    snapshotKeyToEntryKey: {
      tool_descriptions: 'toolDescriptions',
      system_prompt_guidance: 'systemPromptGuidance',
    },
  },
  styles: { entryFile: 'style.yaml', nested: false },
};

/**
 * Resource types `version_history` records. `styles` is deliberately absent — nothing writes
 * style version rows, so a rollback of one can only ever report "version not found".
 */
export const VERSIONED_TYPES = ['prompts', 'gates', 'frameworks'] as const;

export function isVersionedType(
  type: ResourceType
): type is (typeof VERSIONED_TYPES)[number] {
  return (VERSIONED_TYPES as readonly ResourceType[]).includes(type);
}

/**
 * Singular display name for a resource type.
 */
const SINGULAR: Record<ResourceType, HistoryResourceRef['resourceType']> = {
  prompts: 'prompt',
  gates: 'gate',
  frameworks: 'framework',
  styles: 'style',
};

export function singularName(type: ResourceType): string {
  return SINGULAR[type];
}

/**
 * The `version_history` key for a resource: its singular type and the id it is served under.
 *
 * Passed to every history call so the id is the composite one the server records
 * (`chain/step`), not a guess from the path's last segment.
 */
export function historyRef(type: ResourceType, id: string): HistoryResourceRef {
  return { resourceType: SINGULAR[type], resourceId: id };
}
