import { workflow_irParameters } from '../../../src/mcp/contracts/schemas/_generated/workflow_ir.generated.js';
import { workflowIRSchema } from '../../../src/mcp/tools/schemas/workflow-ir.schema.js';
import { MAX_INSERTIONS_PER_RUN } from '../../../src/engine/execution/pipeline/decisions/mutation/types.js';
import { DEFAULT_WORKFLOW_CAPS } from '../../../src/modules/workflow-ir/node-schema.js';

const minimalIR = {
  version: 1,
  nodes: [{ id: 'gather', promptId: 'research_docs' }],
};

describe('workflowIRSchema', () => {
  it('accepts a minimal workflow', () => {
    expect(workflowIRSchema.safeParse(minimalIR).success).toBe(true);
  });

  it('rejects an unknown node key by name, rather than stripping it', () => {
    // `.strict()` for the same reason ChainStepSchema is: a key that is not declared cannot take
    // effect, and Zod's default strip makes that failure invisible (`framwork: ReACT`).
    const result = workflowIRSchema.safeParse({
      version: 1,
      nodes: [{ id: 'gather', promptId: 'research_docs', framwork: 'ReACT' }],
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('framwork');
  });

  it('rejects an unknown top-level key', () => {
    expect(workflowIRSchema.safeParse({ ...minimalIR, budgets: {} }).success).toBe(false);
  });

  it('rejects an unknown visibility item, naming the allowed vocabulary', () => {
    const result = workflowIRSchema.safeParse({
      version: 1,
      nodes: [
        { id: 'gather', promptId: 'research_docs', visibility: { withhold: ['secret_stuff'] } },
      ],
    });
    expect(result.success).toBe(false);
    const message = JSON.stringify(result.error?.issues);
    expect(message).toContain('chain_history');
    expect(message).toContain('previous_step_output');
    expect(message).toContain('unknowns_ledger');
  });

  it('accepts the shipped visibility vocabulary unchanged', () => {
    // Reuse, not re-declaration: this parses through VisibilityItemSchema itself, so a widening
    // of the shipped enum lands here for free and a divergent copy would fail.
    expect(
      workflowIRSchema.safeParse({
        version: 1,
        nodes: [
          {
            id: 'gather',
            promptId: 'research_docs',
            visibility: {
              withhold: ['chain_history'],
              expose: ['previous_step_output', 'unknowns_ledger'],
            },
          },
        ],
      }).success
    ).toBe(true);
  });

  it('rejects a non-kebab node id', () => {
    expect(
      workflowIRSchema.safeParse({ version: 1, nodes: [{ id: 'Gather', promptId: 'p' }] }).success
    ).toBe(false);
    expect(
      workflowIRSchema.safeParse({ version: 1, nodes: [{ id: 'gather_step', promptId: 'p' }] })
        .success
    ).toBe(false);
    expect(
      workflowIRSchema.safeParse({ version: 1, nodes: [{ id: '', promptId: 'p' }] }).success
    ).toBe(false);
  });

  it('accepts an nK-shaped id, because kebab-case already contains that form', () => {
    // Measured 2026-08-13: `n1` matches ^[a-z0-9]+(-[a-z0-9]+)*$, so the `n\d+` alternative
    // `target_step_id` carries is redundant against kebab-case and no regex here could exclude
    // it. Pinned so a future author does not re-derive the false "nK is rejected" claim this
    // test originally asserted.
    expect(
      workflowIRSchema.safeParse({ version: 1, nodes: [{ id: 'n1', promptId: 'p' }] }).success
    ).toBe(true);
  });

  it('accepts the whole gate union verbatim, including target_step_id', () => {
    expect(
      workflowIRSchema.safeParse({
        ...minimalIR,
        gates: [
          'code-quality',
          { name: 'production-ready', description: 'tests and error handling' },
          { id: 'security-review', target_step_id: 'gather' },
        ],
      }).success
    ).toBe(true);
  });

  it('requires at least one node', () => {
    expect(workflowIRSchema.safeParse({ version: 1, nodes: [] }).success).toBe(false);
  });

  it('bounds the three structural caps at the server defaults', () => {
    // The ceiling a client can READ in tools/list is worth more than one it discovers by
    // rejection. The validator still enforces them, because it is callable without the schema.
    expect(
      workflowIRSchema.safeParse({
        ...minimalIR,
        budget: { maxNodes: DEFAULT_WORKFLOW_CAPS.maxNodes + 1 },
      }).success
    ).toBe(false);
    expect(
      workflowIRSchema.safeParse({
        ...minimalIR,
        budget: { maxFanOut: DEFAULT_WORKFLOW_CAPS.maxFanOut + 1 },
      }).success
    ).toBe(false);
    expect(
      workflowIRSchema.safeParse({
        ...minimalIR,
        budget: { maxInsertions: DEFAULT_WORKFLOW_CAPS.maxInsertions + 1 },
      }).success
    ).toBe(false);
  });

  it('places no bound on declaredCostCeiling — it is recorded, never enforced', () => {
    expect(
      workflowIRSchema.safeParse({ ...minimalIR, budget: { declaredCostCeiling: 1e12 } }).success
    ).toBe(true);
  });
});

describe('workflow-ir contract artifact', () => {
  it('declares exactly the schema top-level fields', () => {
    // tooling/contracts/workflow-ir.json is the description/metadata SSOT and the Zod schema is
    // the validation SSOT. Nothing generates one from the other, so this is the only thing
    // standing between them and the P7-D1 drift class.
    const contractNames = new Set(workflow_irParameters.map((p) => p.name));
    const schemaKeys = new Set(Object.keys(workflowIRSchema.shape));
    expect(contractNames).toEqual(schemaKeys);
  });

  it('does not register a workflow_ir MCP tool', async () => {
    // A resource-shape contract describes the shape of one parameter's VALUE. If it ever reached
    // tool-descriptions.contracts.json, ToolDescriptionLoader would carry a phantom tool.
    const descriptions = await import(
      '../../../src/mcp/contracts/schemas/_generated/tool-descriptions.contracts.json',
      { with: { type: 'json' } }
    );
    const tools = (descriptions.default as { tools: Record<string, unknown> }).tools;
    expect(Object.keys(tools)).not.toContain('workflow_ir');
  });
});

describe('DEFAULT_WORKFLOW_CAPS', () => {
  it('mirrors the P4 adaptive-insertion ceiling', () => {
    // types.ts mirrors MAX_INSERTIONS_PER_RUN rather than importing it, so that retuning the
    // runtime's mutation ceiling does not silently retune what a client may declare. This pins
    // the two numbers together so the mirror cannot rot unnoticed.
    expect(DEFAULT_WORKFLOW_CAPS.maxInsertions).toBe(MAX_INSERTIONS_PER_RUN);
  });
});
