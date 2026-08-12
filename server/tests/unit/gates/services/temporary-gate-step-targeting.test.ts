// @lifecycle canonical - Unit tests for chain step targeting on temporary gates (P3 Tier 3 row 16).
import { describe, expect, jest, test } from '@jest/globals';

import { ExecutionContext } from '../../../../src/engine/execution/context/execution-context.js';
import { GateEnhancementStage } from '../../../../src/engine/execution/pipeline/stages/11-gate-enhancement-stage.js';
import { GateEnhancementService } from '../../../../src/engine/gates/services/gate-enhancement-service.js';
import { GateMetricsRecorder } from '../../../../src/engine/gates/services/gate-metrics-recorder.js';
import { TemporaryGateRegistrar } from '../../../../src/engine/gates/services/temporary-gate-registrar.js';
import { buildPromptEngineSchema } from '../../../../src/mcp/tools/schemas/prompt-engine.schema.js';

import type { RunStepView } from '../../../../src/engine/gates/services/run-step-view.js';

/**
 * `target_step_id` is a UNION ADDITION beside `target_step_number`, not a replacement.
 *
 * Gate SELECTION stays positional (OQ5: first/last/odd/even targeting is positional by
 * semantics), so the registrar cross-resolves the two forms at registration: an id fills in its
 * ordinal, an ordinal fills in its node id. These tests pin both directions, because a
 * `target_step_id` that reached `gate-enhancement-service` without an ordinal would silently
 * select nothing — a gate that never fires and never errors.
 */

const createLogger = () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
});

const createRegistry = () => {
  const gates: Array<Record<string, unknown>> = [];
  let autoId = 0;
  return {
    gates,
    createTemporaryGate: jest.fn((definition: Record<string, unknown>) => {
      autoId += 1;
      const id = typeof definition['id'] === 'string' ? definition['id'] : `temp_${autoId}`;
      gates.push({ ...definition, id });
      return id;
    }),
    // A real lookup, not a constant undefined: the selection half of step targeting reads the
    // definition back out of the registry, so a registry that forgets everything can only ever
    // test the registration half. Registration's own "already registered?" probe is unaffected —
    // it only fires for raw gates that declare an `id`, and none of these do.
    getTemporaryGate: jest.fn(
      (gateId: string) =>
        gates.find((gate) => gate['id'] === gateId) as Record<string, unknown> | undefined
    ),
  };
};

/** A three-node chain as the parser mints it: kebab ids from step names. */
const NODE_IDS = ['draft-outline', 'write-body', 'final-review'];

const createContext = (gateSpecs: unknown[]) => ({
  state: { gates: { requestedOverrides: { gates: gateSpecs } } as Record<string, unknown> },
  mcpRequest: { chain_id: 'chain-demo#1' },
  getSessionId: () => 'session-1',
  hasChainCommand: () => true,
  sessionContext: { currentStep: 1 },
  parsedCommand: {
    commandType: 'chain',
    steps: NODE_IDS.map((nodeId, index) => ({
      stepNumber: index + 1,
      nodeId,
      promptId: nodeId,
      args: {},
    })),
  },
});

const registerOne = async (gateSpec: Record<string, unknown>) => {
  const registry = createRegistry();
  const registrar = new TemporaryGateRegistrar(
    registry as never,
    undefined,
    createLogger() as never
  );
  await registrar.registerTemporaryGates(createContext([gateSpec]) as never);
  expect(registry.gates).toHaveLength(1);
  return registry.gates[0] as Record<string, unknown>;
};

// --- P4 row 4.1 / OQ-P4-3 harness ------------------------------------------------------------
//
// Two halves, both needed: REGISTRATION resolves a client ordinal to a node id against the list
// that ordinal was read from, and SELECTION matches by that id from then on. Testing only the
// first would leave the ordinal in charge at the moment it stops meaning anything.

/** The same chain after the mutation policy inserted an investigation node at position 2. */
const MUTATED_NODE_IDS = ['draft-outline', 'inv-cache-ttl', 'write-body', 'final-review'];

const runView = (nodeIds: readonly string[], skippedNodeIds: readonly string[] = []): RunStepView =>
  ({ nodeIds, skippedNodeIds }) as RunStepView;

/** A context for a RESUME call: it carries a chain id, which is how a run is reached at stage 11. */
const createResumeContext = (gateSpecs: unknown[]) => ({
  ...createContext(gateSpecs),
  getRequestedChainId: () => 'chain-demo#1',
  getScopeOptions: () => ({}),
});

const registerAgainstRun = async (
  gateSpec: Record<string, unknown>,
  view: RunStepView | undefined
) => {
  const registry = createRegistry();
  const registrar = new TemporaryGateRegistrar(
    registry as never,
    undefined,
    createLogger() as never,
    () => view
  );
  await registrar.registerTemporaryGates(createResumeContext([gateSpec]) as never);
  expect(registry.gates).toHaveLength(1);
  return registry.gates[0] as Record<string, unknown>;
};

const createGateService = () =>
  ({
    supportsValidation: jest.fn().mockReturnValue(false),
    updateConfig: jest.fn(),
    enhancePrompt: jest.fn(
      async (prompt: { userMessageTemplate: string }, gateIds: readonly string[]) => ({
        enhancedPrompt: {
          ...prompt,
          userMessageTemplate: `${prompt.userMessageTemplate}\n\nGuidance: ${gateIds.join(',')}`,
        },
        gateInstructionsInjected: true,
        injectedGateIds: gateIds,
        instructionLength: gateIds.join(',').length,
      })
    ),
  }) as never;

const stepPrompt = (nodeId: string, stepNumber: number) => ({
  stepNumber,
  nodeId,
  promptId: nodeId,
  args: {},
  metadata: {} as Record<string, unknown>,
  convertedPrompt: {
    id: nodeId,
    name: nodeId,
    description: '',
    category: '',
    userMessageTemplate: `Do ${nodeId}.`,
    systemMessage: '',
    arguments: [],
  },
  executionPlan: { gates: [] },
});

/**
 * Register one gate and then run selection over the PARSE-TIME step list, returning the node ids
 * of the steps that ended up carrying the gate's guidance. Empty means the gate fired nowhere.
 */
const selectStepsFor = async (
  gateSpec: Record<string, unknown>,
  view: RunStepView | undefined
): Promise<string[]> => {
  const registry = createRegistry();
  const logger = createLogger();
  const gateService = createGateService();
  const provider = view === undefined ? undefined : () => view;

  const stage = new GateEnhancementStage(
    new GateEnhancementService(
      gateService,
      registry as never,
      () => undefined,
      () => undefined as never,
      undefined,
      new GateMetricsRecorder(undefined),
      logger as never,
      provider
    ),
    new TemporaryGateRegistrar(registry as never, undefined, logger as never, provider),
    () => ({ enabled: true, definitionsDirectory: 'gates', enableFrameworkGates: true }),
    logger as never
  );

  const steps = NODE_IDS.map((nodeId, index) => stepPrompt(nodeId, index + 1));
  const context = new ExecutionContext({ chain_id: 'chain-demo#1', gates: [gateSpec] } as never);
  context.state.gates.requestedOverrides = { gates: [gateSpec] };
  context.executionPlan = {
    strategy: 'chain',
    gates: [],
    requiresFramework: false,
    requiresSession: true,
    llmValidationEnabled: false,
  } as never;
  context.parsedCommand = { commandType: 'chain', steps } as never;

  await stage.execute(context);

  const registeredId = String(registry.gates[0]?.['id'] ?? '');
  expect(registeredId).not.toBe('');

  return steps
    .filter((step) => String(step.metadata['gateInstructions'] ?? '').includes(registeredId))
    .map((step) => step.nodeId);
};

describe('temporary gate step targeting', () => {
  test('the schema accepts target_step_id beside target_step_number', () => {
    const schema = buildPromptEngineSchema(() => true, 'verdict must be valid');

    // Typed `unknown` because the returned schema is a union of reachable shapes — its
    // inferred type is the narrow (gate-system-disabled) member, which has no `gates` key.
    const parsed: unknown = schema.parse({
      command: '>>chain',
      gates: [
        { name: 'Body only', criteria: ['cite sources'], target_step_id: 'write-body' },
        { name: 'Second only', criteria: ['cite sources'], target_step_number: 2 },
        { name: 'Symbolic', criteria: ['cite sources'], target_step_id: 'n2' },
      ],
    });

    expect((parsed as { gates?: unknown[] }).gates).toHaveLength(3);
  });

  test('the schema rejects a node id that is not kebab-case or nK', () => {
    const schema = buildPromptEngineSchema(() => true, 'verdict must be valid');

    expect(() =>
      schema.parse({
        command: '>>chain',
        gates: [{ name: 'Bad', criteria: ['x'], target_step_id: 'Write_Body' }],
      })
    ).toThrow();
  });

  test('target_step_id resolves to that node’s ordinal, so positional selection still works', async () => {
    const gate = await registerOne({
      name: 'Body only',
      criteria: ['cite sources'],
      target_step_id: 'write-body',
    });

    expect(gate['target_step_id']).toBe('write-body');
    expect(gate['target_step_number']).toBe(2);
  });

  test('target_step_id resolves against position, not alphabetical or insertion luck', async () => {
    const third = await registerOne({
      name: 'Review only',
      criteria: ['cite sources'],
      target_step_id: 'final-review',
    });
    expect(third['target_step_number']).toBe(3);

    const first = await registerOne({
      name: 'Outline only',
      criteria: ['cite sources'],
      target_step_id: 'draft-outline',
    });
    expect(first['target_step_number']).toBe(1);
  });

  test('target_step_number still works and now carries its node id too', async () => {
    const gate = await registerOne({
      name: 'Second only',
      criteria: ['cite sources'],
      target_step_number: 2,
    });

    expect(gate['target_step_number']).toBe(2);
    expect(gate['target_step_id']).toBe('write-body');
  });

  test('an unresolvable target_step_id selects nothing rather than widening to every step', async () => {
    const gate = await registerOne({
      name: 'Ghost step',
      criteria: ['cite sources'],
      target_step_id: 'no-such-node',
    });

    // Kept, not dropped: dropping it would leave a gate with no step target at all, which the
    // selection logic reads as "applies everywhere" — the opposite of what was asked for.
    expect(gate['target_step_id']).toBe('no-such-node');
    expect(gate['target_step_number']).toBeUndefined();
  });

  test('the id wins when a gate carries both and they disagree', async () => {
    const gate = await registerOne({
      name: 'Both',
      criteria: ['cite sources'],
      target_step_number: 1,
      target_step_id: 'final-review',
    });

    expect(gate['target_step_id']).toBe('final-review');
    expect(gate['target_step_number']).toBe(3);
  });

  // --- P4 row 4.1 / OQ-P4-3: targeting under adaptive mutation ------------------------------

  describe('under adaptive mutation', () => {
    test('an ordinal resolves against the LIVE run list, not the parse-time one', async () => {
      // The client reads its ordinals off the rendered footer, which counts the RUN's nodes. On a
      // run that has already had a node inserted, "step 4" is `final-review` — a position the
      // three-element parse-time array does not even have.
      const gate = await registerAgainstRun(
        { name: 'Last step only', criteria: ['cite sources'], target_step_number: 4 },
        runView(MUTATED_NODE_IDS)
      );

      expect(gate['target_step_id']).toBe('final-review');
      expect(gate['target_step_number']).toBe(4);
    });

    test('with no run to ask, the parse-time order still answers', async () => {
      // Negative probe for the provider: the call that STARTS a chain has no run yet, so the
      // parse-time node order is the run's order and resolution must be unchanged.
      const gate = await registerAgainstRun(
        { name: 'Second only', criteria: ['cite sources'], target_step_number: 2 },
        undefined
      );

      expect(gate['target_step_id']).toBe('write-body');
      expect(gate['target_step_number']).toBe(2);
    });

    test('a gate bound to a node fires on THAT node even when its ordinal no longer exists', async () => {
      // The discriminating case for id-vs-ordinal selection: `target_step_number` is 4 (the run's
      // ordinal), and no parse step has stepNumber 4. Ordinal matching selects nothing at all;
      // node-id matching puts the gate exactly where its author aimed it.
      const targeted = await selectStepsFor(
        { name: 'Last step only', criteria: ['cite sources'], target_step_number: 4 },
        runView(MUTATED_NODE_IDS)
      );

      expect(targeted).toEqual(['final-review']);
    });

    test('a gate whose target node was skipped fires nowhere', async () => {
      const targeted = await selectStepsFor(
        { name: 'Body only', criteria: ['cite sources'], target_step_id: 'write-body' },
        runView(MUTATED_NODE_IDS, ['write-body'])
      );

      // Not "fires on some other step" and not "fires on write-body anyway": the step it was
      // authored against will never execute, so the gate is retired with it.
      expect(targeted).toEqual([]);
    });

    test('the same gate DOES fire while its target node is still live', async () => {
      // Falsification partner for the test above — without it, `[]` would also be produced by a
      // filter that simply drops every id-targeted gate.
      const targeted = await selectStepsFor(
        { name: 'Body only', criteria: ['cite sources'], target_step_id: 'write-body' },
        runView(MUTATED_NODE_IDS)
      );

      expect(targeted).toEqual(['write-body']);
    });

    test('an ordinal that lands on an inserted node binds to that node, and fires nowhere in v1', async () => {
      // Documented semantic: the ordinal is resolved ONCE, against the list as it stood at
      // registration — so "step 2" on a mutated run means the inserted investigation node, not
      // the planned step that used to sit there. Inserted nodes get no gates in v1 (OQ-P4-6),
      // and an inserted node has no parse-time step, so the gate correctly selects nothing.
      const gate = await registerAgainstRun(
        { name: 'Step two', criteria: ['cite sources'], target_step_number: 2 },
        runView(MUTATED_NODE_IDS)
      );
      expect(gate['target_step_id']).toBe('inv-cache-ttl');

      const targeted = await selectStepsFor(
        { name: 'Step two', criteria: ['cite sources'], target_step_number: 2 },
        runView(MUTATED_NODE_IDS)
      );
      expect(targeted).toEqual([]);
    });

    test('an unresolvable target still selects nothing rather than every step', async () => {
      // Negative probe on the selection half: registration leaves the id as given and supplies no
      // ordinal, and selection must not read "no ordinal" as "applies everywhere".
      const targeted = await selectStepsFor(
        { name: 'Ghost step', criteria: ['cite sources'], target_step_id: 'no-such-node' },
        runView(MUTATED_NODE_IDS)
      );

      expect(targeted).toEqual([]);
    });

    test('an untargeted gate keeps its pre-existing current-step default', async () => {
      // Nothing here changes for a gate that names no step: normalization still defaults it to
      // `apply_to_steps: [currentStep]`, which the ordinal branch answers exactly as before.
      // Asserted so the id-first branch cannot quietly capture untargeted gates too.
      const targeted = await selectStepsFor(
        { name: 'Everywhere', criteria: ['cite sources'] },
        runView(MUTATED_NODE_IDS)
      );

      expect(targeted).toEqual(['draft-outline']);
    });
  });
});
