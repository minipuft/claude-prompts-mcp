// @lifecycle canonical - Schema and helpers for MCP tool contract manifests.
/**
 * Tool Contract Schema (SSOT)
 *
 * Defines a single source of truth for MCP tool parameters. Downstream
 * generators will consume this schema to emit Zod validators, action metadata,
 * and documentation snippets. Keeping this in TypeScript + Zod ensures
 * manifests stay strict and human readable.
 */
import { z } from 'zod';

export const parameterStatusSchema = z.enum([
  'working',
  'deprecated',
  'hidden',
  'experimental',
  'needs-validation',
]);

export const compatibilitySchema = z.enum(['canonical', 'legacy', 'deprecated']);

export const parameterSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1), // e.g., "string", "enum[auto|single|chain]", "boolean"
  description: z.string().min(1),
  required: z.boolean().optional(),
  default: z.unknown().optional(),
  status: parameterStatusSchema.default('working'),
  compatibility: compatibilitySchema.default('canonical'),
  examples: z.array(z.string()).optional(),
  notes: z.array(z.string()).optional(),
  enum: z.array(z.string()).optional(), // For enum types with explicit values
  /** If false, param is accepted by schema but not shown in tool description (reduces token usage) */
  includeInDescription: z.boolean().optional(),
});

export type ParameterDefinition = z.infer<typeof parameterSchema>;

export const commandDescriptorSchema = z.object({
  id: z.string().min(1),
  summary: z.string().min(1),
  parameters: z.array(z.string()).optional(),
  status: parameterStatusSchema.default('working'),
  notes: z.array(z.string()).optional(),
});

export type CommandDescriptor = z.infer<typeof commandDescriptorSchema>;

/**
 * Framework-aware description variants shown in MCP tool registration
 * based on whether framework system is enabled or disabled.
 */
export const frameworkAwareDescriptionSchema = z.object({
  enabled: z.string().min(1),
  disabled: z.string().min(1),
});

export type FrameworkAwareDescription = z.infer<typeof frameworkAwareDescriptionSchema>;

/**
 * Tool-level description metadata for MCP registration.
 * This is the SSOT for tool descriptions - generates tool-descriptions.contracts.json.
 */
export const toolDescriptionSchema = z.object({
  description: z.string().min(1),
  shortDescription: z.string().min(1),
  category: z.enum(['execution', 'management', 'system']),
  /** Pattern-matched examples that help LLMs recognize when to invoke this tool */
  triggerExamples: z.array(z.string()).optional(),
  frameworkAware: frameworkAwareDescriptionSchema,
});

export type ToolDescription = z.infer<typeof toolDescriptionSchema>;

export const toolContractSchema = z.object({
  tool: z.string().min(1),
  version: z.number().int().positive(),
  summary: z.string().min(1),
  toolDescription: toolDescriptionSchema.optional(), // Optional for backwards compatibility
  parameters: z.array(parameterSchema).min(1),
  commands: z.array(commandDescriptorSchema).optional(),
  metadata: z.record(z.any()).optional(),
});

export type ToolContract = z.infer<typeof toolContractSchema>;

export function validateToolContract(data: unknown): ToolContract {
  return toolContractSchema.parse(data);
}
