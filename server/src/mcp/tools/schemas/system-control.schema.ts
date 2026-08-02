// @lifecycle canonical - Hand-written Zod schema for system_control MCP tool (SSOT for validation).
/**
 * System Control Input Schema
 *
 * Extracted from inline schema in index.ts. This is the SSOT for system_control
 * parameter validation — replaces the generated mcp-schemas.ts.
 */

import { z } from 'zod/v4';

import type { DescriptionResolver } from './prompt-engine.schema.js';

const identity: DescriptionResolver = (_name, fallback) => fallback;

// ---------------------------------------------------------------------------
// Default description text
// ---------------------------------------------------------------------------

const PARAM_DEFAULTS = {
  action:
    'Top-level command. Supported values: status, framework, gates, analytics, config, maintenance.',
  operation:
    'Sub-command for the selected action (e.g. framework: switch|list|enable|disable, analytics: view|reset|history).',
  session_id: 'Target session ID or chain ID for session operations.',
  framework: 'Framework identifier when switching. Use framework:list to see available options.',
  reason: 'Audit-friendly explanation for switches, config changes, or restarts.',
  persist: 'When true, gate/framework enable/disable changes are also written to config.json.',
  show_details: 'Request an expanded response for list/status style commands.',
  include_history: 'Include historical entries (where supported).',
  include_metrics: 'Include detailed metrics output (where supported).',
  topic: 'Guide topic when requesting guidance.',
  search_query:
    'Filter gates by keyword (matches ID, name, or description). Use with gates:list action.',
} as const;

// ---------------------------------------------------------------------------
// Schema factory
// ---------------------------------------------------------------------------

/**
 * Build the system_control input schema with framework-aware descriptions.
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type, @typescript-eslint/explicit-module-boundary-types
export function buildSystemControlSchema(resolve: DescriptionResolver = identity) {
  return z.object({
    action: z.string().describe(resolve('action', PARAM_DEFAULTS.action)),

    operation: z.string().optional().describe(resolve('operation', PARAM_DEFAULTS.operation)),

    session_id: z.string().optional().describe(resolve('session_id', PARAM_DEFAULTS.session_id)),

    framework: z.string().optional().describe(resolve('framework', PARAM_DEFAULTS.framework)),

    reason: z.string().optional().describe(resolve('reason', PARAM_DEFAULTS.reason)),

    persist: z.boolean().optional().describe(resolve('persist', PARAM_DEFAULTS.persist)),

    show_details: z
      .boolean()
      .optional()
      .describe(resolve('show_details', PARAM_DEFAULTS.show_details)),

    include_history: z
      .boolean()
      .optional()
      .describe(resolve('include_history', PARAM_DEFAULTS.include_history)),

    include_metrics: z
      .boolean()
      .optional()
      .describe(resolve('include_metrics', PARAM_DEFAULTS.include_metrics)),

    topic: z.string().optional().describe(resolve('topic', PARAM_DEFAULTS.topic)),

    search_query: z
      .string()
      .optional()
      .describe(resolve('search_query', PARAM_DEFAULTS.search_query)),
  });
}

/** Inferred input type */
export type SystemControlInput = z.infer<ReturnType<typeof buildSystemControlSchema>>;
