// @lifecycle canonical - system_control action vocabulary (Layer 0, cross-cutting).
//
// Moved from mcp/metadata/definitions/system-control.ts (row B.61 follow-up): that module's
// layer (mcp/) sits above engine/, so tool-routing.ts — which types a routed system_control call
// against this vocabulary before it ever reaches the MCP SDK's schema validation — could only
// reach it with an upward, cross-layer import. `validate:arch`'s layer hierarchy is
// shared(L0) -> infra(L1) -> engine(L2) -> modules(L3) -> mcp(L4) (row B.35, PR #316), so the
// vocabulary lives here instead, one definition every layer can reach downward.
//
// Consumed by:
// - mcp/metadata/definitions/system-control.ts (action descriptor metadata)
// - mcp/tools/schemas/system-control.schema.ts (`z.enum(SYSTEM_CONTROL_ACTION_IDS)`)
// - mcp/tools/system-control/system-control-router.ts (the runtime refusal + dispatch switch)
// - engine/execution/pipeline/routing/tool-routing.ts (typing a routed call before it exists)

/**
 * Every action `system_control` dispatches. The published surface (this schema's `action` enum),
 * the dispatch table (`ConsolidatedSystemControl.getActionHandler`), and the runtime refusal for
 * an unrecognized action all read this one list — see `system-control-router.ts`.
 */
export const SYSTEM_CONTROL_ACTION_IDS = [
  'status',
  'framework',
  'gates',
  'analytics',
  'config',
  'maintenance',
  'guide',
  'injection',
  'session',
  'changes',
  'execution_history',
  'skills_sync',
] as const;

export type SystemControlActionId = (typeof SYSTEM_CONTROL_ACTION_IDS)[number];
