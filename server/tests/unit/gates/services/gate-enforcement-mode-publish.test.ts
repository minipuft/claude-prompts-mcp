// @lifecycle canonical - Pins P4.137: stage 11 publishes the mode the applying gates declare.
import { describe, expect, jest, test } from '@jest/globals';

import { ExecutionContext } from '../../../../src/engine/execution/context/execution-context.js';
import { GateEnhancementStage } from '../../../../src/engine/execution/pipeline/stages/11-gate-enhancement-stage.js';
import { GateEnhancementService } from '../../../../src/engine/gates/services/gate-enhancement-service.js';
import { GateMetricsRecorder } from '../../../../src/engine/gates/services/gate-metrics-recorder.js';
import { TemporaryGateRegistrar } from '../../../../src/engine/gates/services/temporary-gate-registrar.js';

import type { RunStepView } from '../../../../src/engine/gates/services/run-step-view.js';

/**
 * Before P4.137 the service wrote `blocking` for every chain step that had a gate, whatever the
 * gate file declared, so an advisory gate's FAIL held the run exactly as a blocking one did. The
 * three twins below differ ONLY in the one gate on the step; the mixed case pins "strictest
 * wins", and the scoping case pins that the mode is the current STEP's, not the run's.
 *
 * Classification: Unit. Real stage + service + registrar; gate service, registry and loader are
 * stubs, and the loader answers exactly what a gate file would declare.
 */

type Mode = 'blocking' | 'advisory' | 'informational';

/** What each gate's file declares. `undefined` is a gate that names no mode. */
const DECLARED: Record<string, Mode | undefined> = {
  'gate-blocking': 'blocking',
  'gate-advisory': 'advisory',
  'gate-informational': 'informational',
  'gate-undeclared': undefined,
};

const createLogger = () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
});

const createRegistry = () => {
  const gates: Array<Record<string, unknown>> = [];
  return {
    createTemporaryGate: jest.fn((definition: Record<string, unknown>) => {
      const id = String(definition['id']);
      gates.push({ ...definition, id });
      return id;
    }),
    getTemporaryGate: jest.fn((gateId: string) => gates.find((gate) => gate['id'] === gateId)),
  };
};

const createGateLoader = () => ({
  loadGate: jest.fn(async (id: string) => {
    if (!(id in DECLARED)) return null;
    const mode = DECLARED[id];
    return {
      id,
      name: id,
      type: 'validation',
      ...(mode === undefined ? {} : { enforcementMode: mode }),
    };
  }),
  isFrameworkGate: jest.fn(async () => false),
  isFrameworkGateCached: jest.fn(() => false),
  getFrameworkGateIds: jest.fn(async () => []),
});

const createGateService = () =>
  ({
    supportsValidation: jest.fn().mockReturnValue(false),
    updateConfig: jest.fn(),
    enhancePrompt: jest.fn(
      async (prompt: { userMessageTemplate: string }, gateIds: readonly string[]) => ({
        enhancedPrompt: {
          ...prompt,
          userMessageTemplate: `${prompt.userMessageTemplate}\n\n${gateIds.join(',')}`,
        },
        gateInstructionsInjected: true,
        injectedGateIds: gateIds,
        instructionLength: gateIds.length,
      })
    ),
  }) as never;

const NODE_IDS = ['first', 'second'];

function buildStage(view: RunStepView | undefined) {
  const registry = createRegistry();
  const logger = createLogger();
  const provider = view === undefined ? undefined : () => view;
  return new GateEnhancementStage(
    new GateEnhancementService(
      createGateService(),
      registry as never,
      () => undefined,
      () => undefined as never,
      createGateLoader() as never,
      new GateMetricsRecorder(undefined),
      logger as never,
      provider as never
    ),
    new TemporaryGateRegistrar(registry as never, undefined, logger as never, provider as never),
    () => ({ enabled: true, definitionsDirectory: 'gates', enableFrameworkGates: false }),
    logger as never
  );
}

const convertedPrompt = (id: string) => ({
  id,
  name: id,
  description: '',
  category: '',
  userMessageTemplate: `Do ${id}.`,
  systemMessage: '',
  arguments: [],
});

/** The mode stage 11 publishes for a two-step chain standing on `first`. */
async function chainMode(options: {
  firstStepGates: string[];
  /** Gates bound to the step the run is NOT standing on, as temporary gate specs. */
  otherStepGateSpecs?: Array<Record<string, unknown>>;
}): Promise<Mode | undefined> {
  const gateSpecs = options.otherStepGateSpecs ?? [];
  const context = new ExecutionContext({ chain_id: 'chain-em#1', gates: gateSpecs } as never);
  context.state.gates.requestedOverrides = { gates: gateSpecs };
  context.executionPlan = {
    strategy: 'chain',
    gates: [],
    requiresFramework: false,
    requiresSession: true,
    llmValidationEnabled: false,
  } as never;
  context.parsedCommand = {
    commandType: 'chain',
    steps: NODE_IDS.map((nodeId, index) => ({
      stepNumber: index + 1,
      nodeId,
      promptId: nodeId,
      args: {},
      metadata: {},
      convertedPrompt: convertedPrompt(nodeId),
      executionPlan: { gates: index === 0 ? options.firstStepGates : [] },
    })),
  } as never;

  await buildStage({ nodeIds: NODE_IDS, skippedNodeIds: [], currentNodeId: 'first' }).execute(
    context
  );
  return context.state.gates.enforcementMode;
}

/** The mode stage 11 publishes for a single prompt carrying `gates`. */
async function singleMode(gates: string[]): Promise<Mode | undefined> {
  const context = new ExecutionContext({ command: '>>demo' } as never);
  context.executionPlan = {
    strategy: 'prompt',
    gates,
    requiresFramework: false,
    requiresSession: false,
    llmValidationEnabled: false,
  } as never;
  context.parsedCommand = {
    commandType: 'single',
    convertedPrompt: convertedPrompt('demo'),
  } as never;

  await buildStage(undefined).execute(context);
  return context.state.gates.enforcementMode;
}

describe('stage 11 publishes the enforcement mode the gates declare (P4.137)', () => {
  describe('chain step — twins differing only in the step gate', () => {
    test('a blocking gate holds', async () => {
      expect(await chainMode({ firstStepGates: ['gate-blocking'] })).toBe('blocking');
    });

    test('an advisory gate advises', async () => {
      expect(await chainMode({ firstStepGates: ['gate-advisory'] })).toBe('advisory');
    });

    test('no gate publishes no mode', async () => {
      expect(await chainMode({ firstStepGates: [] })).toBeUndefined();
    });
  });

  test('a gate that declares nothing holds a chain step', async () => {
    expect(await chainMode({ firstStepGates: ['gate-undeclared'] })).toBe('blocking');
  });

  test('mixed gates on one step: the strictest wins', async () => {
    expect(await chainMode({ firstStepGates: ['gate-advisory', 'gate-blocking'] })).toBe(
      'blocking'
    );
    expect(await chainMode({ firstStepGates: ['gate-informational', 'gate-advisory'] })).toBe(
      'advisory'
    );
    expect(await chainMode({ firstStepGates: ['gate-advisory', 'gate-undeclared'] })).toBe(
      'blocking'
    );
  });

  test("a blocking gate bound to another step does not decide this step's mode", async () => {
    const mode = await chainMode({
      firstStepGates: ['gate-advisory'],
      otherStepGateSpecs: [
        { id: 'gate-blocking', name: 'later', criteria: ['x'], target_step_id: 'second' },
      ],
    });
    expect(mode).toBe('advisory');
  });

  describe('single prompt', () => {
    test('a gate that declares nothing keeps the single-prompt advisory default', async () => {
      expect(await singleMode(['gate-undeclared'])).toBe('advisory');
    });

    test('a declared blocking gate holds', async () => {
      expect(await singleMode(['gate-blocking', 'gate-undeclared'])).toBe('blocking');
    });
  });
});
