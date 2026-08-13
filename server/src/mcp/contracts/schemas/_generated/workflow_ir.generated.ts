// Auto-generated from tooling/contracts/*.json. Do not edit manually.
export interface ToolParameter {
  name: string;
  type: string;
  description: string;
  status: 'working' | 'needs-validation' | 'deprecated' | 'hidden' | 'experimental';
  required?: boolean;
  default?: unknown;
  compatibility: 'canonical' | 'deprecated' | 'legacy'; // Required with default value
  examples?: string[];
  notes?: string[];
  enum?: string[]; // For enum types with explicit values
  includeInDescription?: boolean; // If false, param is in schema but not tool description
}

export interface ToolCommand {
  id: string;
  summary: string;
  parameters?: string[];
  status: 'working' | 'needs-validation' | 'deprecated' | 'hidden' | 'experimental'; // Required with default value
  notes?: string[];
}

export type workflow_irParamName = 'version' | 'nodes' | 'edges' | 'gates' | 'budget';
export const workflow_irParameters: ToolParameter[] = [
  {
    name: 'version',
    type: 'number',
    description:
      '[Workflow IR] IR schema version. Literal 1. A future shape change bumps this so the discriminant is typed rather than inferred.',
    required: true,
    status: 'working',
    compatibility: 'canonical',
    examples: ['1'],
  },
  {
    name: 'nodes',
    type: 'array<object>',
    description:
      '[Workflow IR] The steps of the run, in declaration order. Each node: {id (kebab-case, unique), promptId, stepName?, args?, inputMapping?, outputMapping?, visibility?{withhold[],expose[]}, subagentModel?(heavy|standard|fast), agentType?, framework?, retries?, inlineGateIds?}. Declaration order is the tiebreak the linearizer drains its ready set by, so a workflow with no edges runs exactly in the order written.',
    required: true,
    status: 'working',
    compatibility: 'canonical',
    notes: [
      'Node ids are the same id space as ChainNode.id and target_step_id.',
      "Kebab-case. `target_step_id`'s second `n\\d+` alternative is not repeated here and is redundant against kebab-case anyway (`n1` already matches).",
      'Every field mirrors a ChainStepSchema field the runtime consumes. `delegation` is absent: its only reader is the skills-sync exporter, off raw YAML.',
    ],
  },
  {
    name: 'edges',
    type: 'array<object>',
    description:
      '[Workflow IR] Dependency assertions, {from, to}: `to` may not run before `from`. NOT control flow — there is no branching runtime, so edges are compiled to a total order and nothing downstream ever sees an edge. A cycle is rejected; endpoints must name declared nodes.',
    required: false,
    status: 'working',
    compatibility: 'canonical',
    examples: ['[{"from":"gather","to":"synthesize"}]'],
  },
  {
    name: 'gates',
    type: 'array',
    description:
      "[Workflow IR] Run-level gate bindings, reusing the prompt_engine `gates` union verbatim (gate id strings, {name,description} custom checks, or full gate objects). An object entry's `target_step_id` addresses a node id declared in `nodes`; a target naming no declared node is rejected as `gate-target-missing`.",
    required: false,
    status: 'working',
    compatibility: 'canonical',
  },
  {
    name: 'budget',
    type: 'object',
    description:
      '[Workflow IR] Declared budget, split by enforcement posture. ENFORCED (structural, counted server-side): maxNodes, maxFanOut, maxInsertions — each may only NARROW the server cap, never widen it; a wider value is rejected as `cap-exceeded` rather than silently clamped. RECORDED ONLY: declaredCostCeiling, written to the existing execution_records telemetry object and never enforced, because the server never observes client token usage.',
    required: false,
    status: 'working',
    compatibility: 'canonical',
    notes: [
      'Server defaults live in DEFAULT_WORKFLOW_CAPS (modules/workflow-ir/types.ts).',
      'maxInsertions narrows the P4 adaptive-insertion ceiling MAX_INSERTIONS_PER_RUN.',
    ],
  },
];

export const workflow_irCommands: ToolCommand[] = [];

export const workflow_irMetadata = { tool: 'workflow_ir', version: 1 };
