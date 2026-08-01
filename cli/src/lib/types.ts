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
export const TYPE_CONFIG: Record<ResourceType, { entryFile: string; nested: boolean }> = {
  prompts: { entryFile: 'prompt.yaml', nested: true },
  gates: { entryFile: 'gate.yaml', nested: false },
  frameworks: { entryFile: 'framework.yaml', nested: false },
  styles: { entryFile: 'style.yaml', nested: false },
};

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
