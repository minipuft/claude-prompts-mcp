import {
  DEFAULT_WORKFLOW_CAPS,
  type WorkflowIR,
  type WorkflowNode,
  type WorkflowRejectionReason,
} from '../../../src/modules/workflow-ir/types.js';
import {
  validateWorkflowIR,
  type WorkflowValidatorDeps,
} from '../../../src/modules/workflow-ir/validator.js';

/** Every prompt exists and declares no required arguments unless a case says otherwise. */
function deps(overrides: Partial<WorkflowValidatorDeps> = {}): WorkflowValidatorDeps {
  return {
    lookupPrompt: () => ({ requiredArguments: [] }),
    ...overrides,
  };
}

function node(id: string, overrides: Partial<WorkflowNode> = {}): WorkflowNode {
  return { id, promptId: 'research_docs', ...overrides };
}

function ir(overrides: Partial<WorkflowIR> = {}): WorkflowIR {
  return { version: 1, nodes: [node('gather'), node('synthesize')], ...overrides };
}

function reasons(result: ReturnType<typeof validateWorkflowIR>): WorkflowRejectionReason[] {
  if (result.ok) return [];
  return result.rejections.map((rejection) => rejection.reason);
}

describe('validateWorkflowIR — happy path', () => {
  it('accepts a well-formed IR and returns its linearization', () => {
    const result = validateWorkflowIR(
      ir({ edges: [{ from: 'synthesize', to: 'gather' }] }),
      deps()
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.rejections));
    expect(result.order).toEqual(['synthesize', 'gather']);
  });

  it('returns the order from the validator, not just a boolean', () => {
    // An IR is only "valid" if it HAS an order. A caller holding {ok:true} without one could
    // still be holding a cyclic graph.
    const result = validateWorkflowIR(ir(), deps());
    expect(result.ok && result.order).toEqual(['gather', 'synthesize']);
  });
});

describe('validateWorkflowIR — rejection vocabulary (every reason has a producer)', () => {
  const cases: Array<{
    reason: WorkflowRejectionReason;
    build: () => ReturnType<typeof validateWorkflowIR>;
    /** Substring the addressed detail must carry, proving the rejection names its subject. */
    addresses: string;
  }> = [
    {
      reason: 'empty-workflow',
      addresses: 'at least one node',
      build: () => validateWorkflowIR(ir({ nodes: [] }), deps()),
    },
    {
      reason: 'invalid-node-id',
      addresses: 'Gather_Step',
      build: () => validateWorkflowIR(ir({ nodes: [node('Gather_Step')] }), deps()),
    },
    {
      reason: 'duplicate-node-id',
      addresses: 'gather',
      build: () => validateWorkflowIR(ir({ nodes: [node('gather'), node('gather')] }), deps()),
    },
    {
      reason: 'unknown-prompt',
      addresses: 'no_such_prompt',
      build: () =>
        validateWorkflowIR(
          ir({ nodes: [node('gather', { promptId: 'no_such_prompt' })] }),
          deps({ lookupPrompt: () => undefined })
        ),
    },
    {
      reason: 'edge-endpoint-missing',
      addresses: 'ghost',
      build: () => validateWorkflowIR(ir({ edges: [{ from: 'ghost', to: 'gather' }] }), deps()),
    },
    {
      reason: 'cycle',
      addresses: 'gather',
      build: () =>
        validateWorkflowIR(
          ir({
            edges: [
              { from: 'gather', to: 'synthesize' },
              { from: 'synthesize', to: 'gather' },
            ],
          }),
          deps()
        ),
    },
    {
      reason: 'cap-exceeded',
      addresses: 'maxNodes',
      build: () =>
        validateWorkflowIR(
          ir({
            nodes: Array.from({ length: DEFAULT_WORKFLOW_CAPS.maxNodes + 1 }, (_, i) =>
              node(`step-${i + 1}`)
            ),
          }),
          deps()
        ),
    },
    {
      reason: 'gate-target-missing',
      addresses: 'not-a-node',
      build: () =>
        validateWorkflowIR(
          ir({ gates: [{ id: 'code-quality', target_step_id: 'not-a-node' }] }),
          deps()
        ),
    },
    {
      reason: 'required-argument-missing',
      addresses: 'topic',
      build: () =>
        validateWorkflowIR(
          ir({ nodes: [node('gather', { args: { unrelated: 1 } })] }),
          deps({ lookupPrompt: () => ({ requiredArguments: ['topic'] }) })
        ),
    },
    {
      reason: 'unknown-visibility-item',
      addresses: 'secret_stuff',
      build: () =>
        validateWorkflowIR(
          ir({
            nodes: [
              node('gather', {
                // Deliberately off-vocabulary: the pure validator is callable without Zod, so it
                // owns this check too rather than assuming a schema ran first.
                visibility: { withhold: ['secret_stuff' as never] },
              }),
            ],
          }),
          deps()
        ),
    },
  ];

  it.each(cases)('produces $reason, addressed', ({ reason, build, addresses }) => {
    const result = build();
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    const matching = result.rejections.filter((rejection) => rejection.reason === reason);
    expect(matching.length).toBeGreaterThan(0);
    expect(matching.some((rejection) => rejection.detail.includes(addresses))).toBe(true);
  });

  it('covers the whole vocabulary — no reason is declaration-dead', () => {
    // The counterpart of `validate:no-phantom-columns` for this enum: a reason no input can
    // produce is a vocabulary entry that only misleads. `ambiguous-order` was removed for
    // exactly this reason (see linearizer.ts).
    //
    // `mutually-exclusive-source` is the ONE reason this validator deliberately never produces:
    // it is about the shape of the whole REQUEST (workflow + command, or workflow + chain_id),
    // and this function is a pure function of one IR that cannot see the rest of the request.
    // Its producer is `CommandParsingStage.executeWorkflowSubmission`, and its coverage lives in
    // `tests/integration/chain/p6-workflow-ir.integration.test.ts`. Listed here explicitly so
    // "this validator's vocabulary" and "the enum" stay visibly different sets rather than one
    // silently drifting from the other.
    const notProducedHere: WorkflowRejectionReason[] = ['mutually-exclusive-source'];
    expect(notProducedHere).not.toContain(cases[0]?.reason);

    const declared: WorkflowRejectionReason[] = [
      'empty-workflow',
      'duplicate-node-id',
      'invalid-node-id',
      'unknown-prompt',
      'edge-endpoint-missing',
      'cycle',
      'cap-exceeded',
      'gate-target-missing',
      'required-argument-missing',
      'unknown-visibility-item',
    ];
    expect(new Set(cases.map((testCase) => testCase.reason))).toEqual(new Set(declared));
  });
});

describe('validateWorkflowIR — structural caps (ENFORCED)', () => {
  it('rejects a fan-out above the cap, naming the node', () => {
    const fanOutNodes = [
      node('root'),
      ...Array.from({ length: DEFAULT_WORKFLOW_CAPS.maxFanOut + 1 }, (_, i) =>
        node(`leaf-${i + 1}`)
      ),
    ];
    const edges = fanOutNodes.slice(1).map((leaf) => ({ from: 'root', to: leaf.id }));
    const result = validateWorkflowIR(ir({ nodes: fanOutNodes, edges }), deps());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    const capRejection = result.rejections.find((r) => r.reason === 'cap-exceeded');
    expect(capRejection?.nodeId).toBe('root');
    expect(capRejection?.detail).toContain('maxFanOut');
  });

  it('accepts a fan-out exactly at the cap', () => {
    const fanOutNodes = [
      node('root'),
      ...Array.from({ length: DEFAULT_WORKFLOW_CAPS.maxFanOut }, (_, i) => node(`leaf-${i + 1}`)),
    ];
    const edges = fanOutNodes.slice(1).map((leaf) => ({ from: 'root', to: leaf.id }));
    expect(validateWorkflowIR(ir({ nodes: fanOutNodes, edges }), deps()).ok).toBe(true);
  });

  it('lets a declared budget NARROW a cap', () => {
    const result = validateWorkflowIR(
      ir({ nodes: [node('a'), node('b'), node('c')], budget: { maxNodes: 2 } }),
      deps()
    );
    expect(reasons(result)).toEqual(['cap-exceeded']);
  });

  it('rejects a declared budget that tries to WIDEN a cap, rather than clamping it', () => {
    // A clamped run is a run the client did not author. Both the widening attempt and (if the
    // submission is also oversized) the size breach are reported.
    const result = validateWorkflowIR(
      ir({ budget: { maxNodes: DEFAULT_WORKFLOW_CAPS.maxNodes + 10 } }),
      deps()
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.rejections[0]?.detail).toContain('may only narrow');
  });

  it('rejects a maxInsertions above the P4 adaptive-insertion ceiling', () => {
    const result = validateWorkflowIR(
      ir({ budget: { maxInsertions: DEFAULT_WORKFLOW_CAPS.maxInsertions + 1 } }),
      deps()
    );
    expect(reasons(result)).toEqual(['cap-exceeded']);
  });
});

describe('validateWorkflowIR — declared cost ceilings are RECORDED, never enforced', () => {
  it('accepts any declaredCostCeiling, however large or small', () => {
    // OQ-P6-3 / D6. The server never observes client token usage, so enforcing this would be
    // enforcing against an estimate. If this test ever fails, an enforcement path was added.
    expect(validateWorkflowIR(ir({ budget: { declaredCostCeiling: 1 } }), deps()).ok).toBe(true);
    expect(validateWorkflowIR(ir({ budget: { declaredCostCeiling: 1e9 } }), deps()).ok).toBe(true);
  });
});

describe('validateWorkflowIR — reporting posture', () => {
  it('collects every rejection rather than stopping at the first', () => {
    // A client fixing a submission one error per round trip is the failure mode "actionable"
    // exists to prevent.
    const result = validateWorkflowIR(
      ir({
        nodes: [node('gather', { promptId: 'missing' }), node('write', { promptId: 'missing' })],
        edges: [{ from: 'ghost', to: 'gather' }],
      }),
      deps({ lookupPrompt: () => undefined })
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.rejections.length).toBeGreaterThanOrEqual(3);
  });

  it('stops after an id problem, because later rejections could not be addressed', () => {
    // With duplicate ids "the node named X" is not a well-formed address. The unknown prompt on
    // both nodes is real but is not reported, deliberately.
    const result = validateWorkflowIR(
      ir({ nodes: [node('gather', { promptId: 'missing' }), node('gather')] }),
      deps({ lookupPrompt: () => undefined })
    );
    expect(reasons(result)).toEqual(['duplicate-node-id']);
  });

  it('injects prompt existence — it never imports a registry', () => {
    const seen: string[] = [];
    validateWorkflowIR(
      ir(),
      deps({
        lookupPrompt: (id) => {
          seen.push(id);
          return { requiredArguments: [] };
        },
      })
    );
    expect(seen).toEqual(['research_docs', 'research_docs']);
  });
});
