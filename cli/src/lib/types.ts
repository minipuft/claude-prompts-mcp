/**
 * Shared type constants for CLI commands.
 *
 * Extracted from list.ts and inspect.ts to eliminate duplication.
 */

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
  { entryFile: string; nested: boolean; snapshotKeysNotInEntryFile?: readonly string[] }
> = {
  prompts: { entryFile: 'prompt.yaml', nested: true },
  // `guidance` is the markdown body of `guidance.md`. The server projects it into a gate snapshot
  // because it is authored content, but writing it back into `gate.yaml` would leave two
  // disagreeing guidance sources — which is why the server's writer excludes it from the YAML
  // (`GATE_YAML_EXCLUDED_KEYS`) and emits it as a file instead.
  gates: { entryFile: 'gate.yaml', nested: false, snapshotKeysNotInEntryFile: ['guidance'] },
  frameworks: {
    entryFile: 'framework.yaml',
    nested: false,
    // Authored in `system-prompt.md`; `framework.yaml` names it `systemPromptGuidance`.
    snapshotKeysNotInEntryFile: ['system_prompt_guidance'],
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
const SINGULAR: Record<ResourceType, string> = {
  prompts: 'prompt',
  gates: 'gate',
  frameworks: 'framework',
  styles: 'style',
};

export function singularName(type: ResourceType): string {
  return SINGULAR[type];
}
