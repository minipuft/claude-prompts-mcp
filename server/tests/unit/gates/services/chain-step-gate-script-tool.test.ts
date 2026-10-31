// @lifecycle canonical - Pins that a chain step's own inline gates run when its prompt binds a script tool.
import { describe, expect, jest, test } from '@jest/globals';

import { PromptRequestContext } from '../../../../src/engine/execution/context/prompt-request-context.js';
import { GateEnhancementStage } from '../../../../src/engine/execution/pipeline/stages/11-gate-enhancement-stage.js';
import { ExecutionPlanner } from '../../../../src/engine/execution/planning/execution-planner.js';
import { GateEnhancementService } from '../../../../src/engine/gates/services/gate-enhancement-service.js';
import { GateMetricsRecorder } from '../../../../src/engine/gates/services/gate-metrics-recorder.js';
import { TemporaryGateRegistrar } from '../../../../src/engine/gates/services/temporary-gate-registrar.js';

import type { ParsedCommand } from '../../../../src/engine/execution/context/context-types.js';
import type { ChainStepPrompt } from '../../../../src/engine/execution/operators/types.js';
import type { RunStepView } from '../../../../src/engine/gates/services/run-step-view.js';

/**
 * A chain `[plain -> A -> plain]` where A's prompt binds a script tool and A declares an inline
 * gate. The script-tool `clean` default used to be decided from the CALL (no modifier, no
 * call-level gate), so A's plan said `clean` and stage 11 skipped A's gate with no message
 * (plan chain-step-gates-dropped-by-script-tools-2026-10-15, first shape).
 *
 * Classification: Unit. Real planner, stage and service; gate service, registry and loader are
 * stubs. The twins differ ONLY in whether step A declares the gate.
 */

const NODE_IDS = ['first', 'second', 'third'];

const createLogger = () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
});

const scriptTool = {
  id: 'word_count',
  name: 'Word Counter',
  description: 'Counts words',
  scriptPath: 'script.py',
  runtime: 'python',
  inputSchema: { type: 'object', properties: {} },
  toolDir: '/tmp/tools/word_count',
  absoluteScriptPath: '/tmp/tools/word_count/script.py',
  promptId: 'second',
  descriptionContent: 'Counts words in text',
};

const convertedPrompt = (id: string, withTool = false) => ({
  id,
  name: id,
  description: '',
  category: 'development',
  userMessageTemplate: `Do ${id}.`,
  systemMessage: '',
  arguments: [],
  ...(withTool ? { scriptTools: [scriptTool] } : {}),
});

const parsedChain: ParsedCommand = {
  promptId: 'chain',
  rawArgs: '',
  format: 'symbolic',
  confidence: 0.9,
  commandType: 'chain',
  metadata: {
    originalCommand: '>>chain',
    parseStrategy: 'symbolic',
    detectedFormat: 'symbolic',
    warnings: [],
  },
};

const rawSteps = (gateOnSecond: boolean): ChainStepPrompt[] =>
  NODE_IDS.map((nodeId, index) => ({
    stepNumber: index + 1,
    nodeId,
    promptId: nodeId,
    args: {},
    metadata: {},
    convertedPrompt: convertedPrompt(nodeId, nodeId === 'second'),
    ...(nodeId === 'second' && gateOnSecond ? { inlineGateIds: ['gate-a'] } : {}),
  })) as ChainStepPrompt[];

/** Steps carrying the plans the planner produced for them, as stage 05 attaches them. */
async function plannedSteps(steps: ChainStepPrompt[]): Promise<ChainStepPrompt[]> {
  const { stepPlans } = await new ExecutionPlanner(createLogger() as never).createChainPlan({
    parsedCommand: parsedChain,
    steps,
  });
  return steps.map((step, index) => ({ ...step, executionPlan: stepPlans[index] }));
}

function buildStage(view: RunStepView) {
  const logger = createLogger();
  const registry = {
    canonicalIdRefusal: () => undefined,
    resolveDeclared: () => undefined,
    createTemporaryGate: jest.fn(),
    getTemporaryGate: jest.fn(),
  };
  const loader = {
    loadGate: jest.fn(async (id: string) => ({ id, name: id, type: 'validation' })),
    isFrameworkGate: jest.fn(async () => false),
    isFrameworkGateCached: jest.fn(() => false),
    getFrameworkGateIds: jest.fn(async () => []),
  };
  const gateService = {
    supportsValidation: jest.fn().mockReturnValue(false),
    updateConfig: jest.fn(),
    enhancePrompt: jest.fn(
      async (prompt: { userMessageTemplate: string }, gateIds: readonly string[]) => ({
        enhancedPrompt: { ...prompt, userMessageTemplate: `${prompt.userMessageTemplate}` },
        gateInstructionsInjected: true,
        injectedGateIds: gateIds,
        instructionLength: gateIds.length,
      })
    ),
  } as never;
  const provider = () => view;
  return new GateEnhancementStage(
    new GateEnhancementService(
      gateService,
      registry as never,
      () => undefined,
      () => undefined as never,
      loader as never,
      new GateMetricsRecorder(() => undefined),
      logger as never,
      provider as never
    ),
    new TemporaryGateRegistrar(registry as never, undefined, logger as never, provider as never),
    () => ({ enabled: true, definitionsDirectory: 'gates', enableFrameworkGates: false }),
    logger as never,
    () => true,
    async () => undefined
  );
}

/** Stage 11's gate state when the run stands on step A (`second`). */
async function runStage(steps: ChainStepPrompt[]) {
  const context = new PromptRequestContext({ chain_id: 'chain-sg#2' } as never);
  context.executionPlan = {
    strategy: 'chain',
    gates: [],
    requiresFramework: false,
    requiresSession: true,
    llmValidationEnabled: false,
  } as never;
  context.parsedCommand = { commandType: 'chain', steps } as never;
  await buildStage({
    nodeIds: NODE_IDS,
    skippedNodeIds: [],
    currentNodeId: 'second',
  }).execute(context);
  return context.state.gates;
}

describe('a chain step declaring a gate on a script-tool prompt (first shape)', () => {
  test('the step plan is not made clean, and its gate is applied by stage 11', async () => {
    const steps = await plannedSteps(rawSteps(true));

    expect(steps[1]?.executionPlan?.modifiers?.clean).toBeFalsy();
    const gates = await runStage(steps);
    expect(gates.gatedStepNumbers).toEqual([2]);
    expect(gates.reviewGateIds).toEqual(['gate-a']);
  });

  test('control: the same chain without the gate keeps the script-tool clean default', async () => {
    const steps = await plannedSteps(rawSteps(false));

    expect(steps[1]?.executionPlan?.modifiers?.clean).toBe(true);
    expect(steps[0]?.executionPlan?.modifiers?.clean).toBeFalsy();
    const gates = await runStage(steps);
    expect(gates.gatedStepNumbers ?? []).toEqual([]);
  });

  test('a step declaring only an inline criterion is gated the same way', async () => {
    const steps = rawSteps(false);
    steps[1] = { ...steps[1]!, inlineGateCriteria: ['cites a source'] } as ChainStepPrompt;
    const planned = await plannedSteps(steps);

    expect(planned[1]?.executionPlan?.modifiers?.clean).toBeFalsy();
  });
});

describe('a step plan that carries a declared gate and clean (planted)', () => {
  test('fails by name instead of skipping the step', async () => {
    const steps = rawSteps(true).map((step) =>
      step.nodeId === 'second'
        ? ({
            ...step,
            executionPlan: { gates: [], modifiers: { clean: true } },
          } as unknown as ChainStepPrompt)
        : step
    );

    await expect(runStage(steps)).rejects.toThrow(
      /Chain step 2 \(second\) declares 1 inline gate\(s\) but its plan carries %clean/
    );
  });

  test('control: the same planted clean on a step declaring no gate still skips quietly', async () => {
    const steps = rawSteps(false).map((step) =>
      step.nodeId === 'second'
        ? ({
            ...step,
            executionPlan: { gates: [], modifiers: { clean: true } },
          } as unknown as ChainStepPrompt)
        : step
    );

    const gates = await runStage(steps);
    expect(gates.reviewGateIds).toEqual([]);
  });
});
