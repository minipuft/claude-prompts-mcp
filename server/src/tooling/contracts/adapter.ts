// @lifecycle canonical - Adapters to build metadata descriptors from SSOT contracts.
/**
 * Contract Adapters
 *
 * Utilities to convert SSOT tool contracts into shapes used by action-metadata
 * and (optionally) tool registration. Kept standalone so runtime integration
 * can opt in incrementally without touching existing hand-written descriptors.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import type { ToolContract, ParameterDefinition } from './types.js';
import type {
  ParameterDescriptor,
  CommandDescriptor,
} from '../action-metadata/definitions/types.js';

// Map SSOT status to action-metadata status vocabulary.
function mapStatus(status: ParameterDefinition['status']): ParameterDescriptor<string>['status'] {
  if (status === 'deprecated') return 'deprecated';
  if (status === 'hidden') return 'hidden';
  if (status === 'needs-validation') return 'needs-validation';
  if (status === 'experimental') return 'experimental';
  return 'working';
}

/**
 * Convert SSOT parameters to action-metadata parameter descriptors.
 */
export function contractToParameterDescriptors<TParam extends string>(
  contract: ToolContract
): ParameterDescriptor<TParam>[] {
  return contract.parameters
    .filter((param) => param.status !== 'hidden')
    .map((param) => ({
      name: param.name as TParam,
      status: mapStatus(param.status),
      description: param.description,
    }));
}

/**
 * Convert SSOT commands to action-metadata command descriptors.
 */
export function contractToCommandDescriptors(contract: ToolContract): CommandDescriptor[] {
  return (contract.commands ?? []).map((cmd) => ({
    id: cmd.id,
    status: mapStatus(cmd.status ?? 'working'),
    description: cmd.summary,
    issues: [],
  }));
}

/**
 * Build a Zod object schema from a contract. This is intentionally conservative
 * and handles the common primitive/enumerated shapes used in tool inputs.
 */
export function contractToZodObject(
  contract: ToolContract
): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const param of contract.parameters) {
    const base = toZodType(param.type);
    shape[param.name] = param.required ? base : base.optional();
  }
  return z.object(shape);
}

function toZodType(typeString: string): z.ZodTypeAny {
  if (typeString.startsWith('enum[') && typeString.endsWith(']')) {
    const values = typeString.slice(5, -1).split('|');
    return z.enum(values as [string, ...string[]]);
  }
  if (typeString === 'string') return z.string();
  if (typeString === 'boolean') return z.boolean();
  if (typeString === 'number') return z.number();
  if (typeString === 'record') return z.record(z.any());
  if (typeString === 'array<string>') return z.array(z.string());
  if (typeString === 'array<{name,description}>') {
    return z.array(z.object({ name: z.string(), description: z.string() }));
  }
  if (typeString === 'array<step>') return z.array(z.any());
  if (typeString.startsWith('array<')) {
    return z.array(z.any());
  }
  // Fallback
  return z.any();
}

/**
 * Load generated contract metadata from the build artifacts directory.
 *
 * Consumers can pass custom base paths if needed; default resolves to
 * server/tooling/contracts/_generated relative to this file.
 */
export async function loadGeneratedContract(tool: string, baseDir?: string): Promise<ToolContract> {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const root = baseDir ?? path.resolve(path.join(currentDir, '..', '_generated'));
  const metaPath = path.join(root, `${tool}.metadata.json`);
  const raw = await readFile(metaPath, 'utf-8');
  const parsed = JSON.parse(raw);
  return contractMetadataSchema.parse(parsed);
}

// Minimal schema to validate generated metadata blobs.
const contractMetadataSchema = z.object({
  tool: z.string(),
  version: z.number().int().positive(),
  summary: z.string(),
  parameters: z.array(
    z.object({
      name: z.string(),
      type: z.string(),
      description: z.string(),
      status: z.enum(['working', 'needs-validation', 'deprecated', 'hidden', 'experimental']),
      required: z.boolean().optional(),
      default: z.any().optional(),
      compatibility: z.enum(['canonical', 'deprecated', 'legacy']), // Required with default value
      examples: z.array(z.string()).optional(),
      notes: z.array(z.string()).optional(),
    })
  ),
  commands: z
    .array(
      z.object({
        id: z.string(),
        summary: z.string(),
        parameters: z.array(z.string()).optional(),
        status: z.enum(['working', 'needs-validation', 'deprecated', 'hidden', 'experimental']), // Required with default value
        notes: z.array(z.string()).optional(),
      })
    )
    .optional(),
});
