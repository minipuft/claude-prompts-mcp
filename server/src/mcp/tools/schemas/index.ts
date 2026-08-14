// @lifecycle canonical - Barrel for hand-written MCP tool schemas (SSOT for validation).
export {
  buildPromptEngineSchema,
  customCheckSchema,
  temporaryGateObjectSchema,
  gateSpecUnionSchema,
  type PromptEngineInput,
  type DescriptionResolver,
  type ToolSurfaceResolver,
  type ToolSurfaceState,
} from './prompt-engine.schema.js';

export { buildSystemControlSchema, type SystemControlInput } from './system-control.schema.js';

export {
  resourceManagerInputSchema,
  type ResourceManagerInput,
} from './resource-manager.schema.js';

export {
  workflowIRSchema,
  workflowNodeSchema,
  workflowEdgeSchema,
  workflowBudgetSchema,
  type WorkflowIRInput,
} from './workflow-ir.schema.js';
