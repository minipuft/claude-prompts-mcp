// @lifecycle canonical - Hand-written Zod schema for system_control MCP tool (SSOT for validation).
/**
 * System Control Input Schema
 *
 * The SSOT for system_control parameter validation. It must declare every field an action
 * handler reads: zod strips undeclared keys before the registered callback runs, so an
 * undeclared field never reaches its handler, and the handler runs on its default instead.
 * `tests/unit/mcp-tools/tool-input-fields.test.ts` fails when a handler reads a field this
 * object does not declare.
 *
 * Descriptions come from `tooling/contracts/system-control.json`. Each field is described by its
 * generated contract parameter name, so a field the contract does not list is a type error here.
 */

import { z } from 'zod/v4';

import {
  system_controlParameters,
  type system_controlParamName,
} from '../../contracts/schemas/_generated/system_control.generated.js';

import type { DescriptionResolver } from './prompt-engine.schema.js';

import { INJECTION_TYPES } from '#shared/types/injection.js';

const identity: DescriptionResolver = (_name, fallback) => fallback;

/** Contract description per parameter; the fallback when no framework overlay replaces it. */
const CONTRACT_DESCRIPTIONS = Object.fromEntries(
  system_controlParameters.map((parameter) => [parameter.name, parameter.description])
) as Record<system_controlParamName, string>;

// ---------------------------------------------------------------------------
// Schema factory
// ---------------------------------------------------------------------------

/**
 * Build the system_control input schema with framework-aware descriptions.
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type, @typescript-eslint/explicit-module-boundary-types
export function buildSystemControlSchema(resolve: DescriptionResolver = identity) {
  const describe = (name: system_controlParamName): string =>
    resolve(name, CONTRACT_DESCRIPTIONS[name]);

  return z.object({
    action: z.string().describe(describe('action')),
    operation: z.string().optional().describe(describe('operation')),
    session_id: z.string().optional().describe(describe('session_id')),
    framework: z.string().optional().describe(describe('framework')),
    reason: z.string().optional().describe(describe('reason')),
    persist: z.boolean().optional().describe(describe('persist')),
    show_details: z.boolean().optional().describe(describe('show_details')),
    include_history: z.boolean().optional().describe(describe('include_history')),
    include_metrics: z.boolean().optional().describe(describe('include_metrics')),
    topic: z.string().optional().describe(describe('topic')),
    include_planned: z.boolean().optional().describe(describe('include_planned')),
    search_query: z.string().optional().describe(describe('search_query')),

    // ── Read by several actions ─────────────────────────────────────────
    confirm: z.boolean().optional().describe(describe('confirm')),
    limit: z.number().int().positive().optional().describe(describe('limit')),
    /** Two value sets share one name: skills_sync and injection each refuse the other's. */
    scope: z
      .enum(['user', 'project', 'session', 'chain', 'step'])
      .optional()
      .describe(describe('scope')),
    resource_type: z
      .enum(['prompt', 'gate', 'framework', 'style'])
      .optional()
      .describe(describe('resource_type')),

    // ── config ──────────────────────────────────────────────────────────
    config: z
      .object({
        key: z.string(),
        value: z.string().optional(),
        operation: z.enum(['get', 'set', 'list', 'validate']),
      })
      .optional()
      .describe(describe('config')),
    backup_path: z.string().optional().describe(describe('backup_path')),

    // ── injection ───────────────────────────────────────────────────────
    type: z.enum(INJECTION_TYPES).optional().describe(describe('type')),
    enabled: z.boolean().optional().describe(describe('enabled')),
    scope_id: z.string().optional().describe(describe('scope_id')),
    expires_in_ms: z.number().int().positive().optional().describe(describe('expires_in_ms')),

    // ── changes ─────────────────────────────────────────────────────────
    source: z.enum(['filesystem', 'mcp-tool', 'external']).optional().describe(describe('source')),
    since: z.string().optional().describe(describe('since')),

    // ── skills_sync ─────────────────────────────────────────────────────
    client: z.string().optional().describe(describe('client')),
    id: z.string().optional().describe(describe('id')),
    prune: z.boolean().optional().describe(describe('prune')),
    preview: z.boolean().optional().describe(describe('preview')),
    preview_detail: z.enum(['summary', 'diff']).optional().describe(describe('preview_detail')),
    output: z.string().optional().describe(describe('output')),
    file: z.string().optional().describe(describe('file')),
    category: z.string().optional().describe(describe('category')),
    force: z.boolean().optional().describe(describe('force')),
  });
}

/** Inferred input type */
export type SystemControlInput = z.infer<ReturnType<typeof buildSystemControlSchema>>;
