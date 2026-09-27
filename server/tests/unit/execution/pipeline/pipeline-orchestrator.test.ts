import { describe, expect, jest, test } from '@jest/globals';

import { PromptExecutionPipeline } from '../../../../src/engine/execution/pipeline/prompt-execution-pipeline.js';

import { TemporaryGateRegistry } from '../../../../src/engine/gates/core/temporary-gate-registry.js';

import type { ExecutionContext } from '../../../../src/engine/execution/context/execution-context.js';
import type { PipelinePorts } from '../../../../src/engine/execution/pipeline/prompt-execution-pipeline.js';
import type { PipelineStage } from '../../../../src/engine/execution/pipeline/stage.js';
import type { Logger } from '../../../../src/infra/logging/index.js';
import type { ChainSessionService } from '../../../../src/shared/types/chain-session.js';
import type { ExecutionRecordStore } from '../../../../src/modules/chains/execution-record-store.js';

// Stage order matches the array PipelineBuilder.build() hands the constructor.
// Optional stages (ScriptExecution, ScriptAutoExecute, ShellVerification,
// PhaseGuardVerification) are omitted — this suite asserts sequencing and
// short-circuit behaviour, neither of which depends on them.
const stageOrder = [
  'RequestNormalization',
  'ExecutionLifecycle',
  'IdentityResolution',
  'CommandParsing',
  'InlineGateExtraction',
  'OperatorValidation',
  'ExecutionPlanning',
  'JudgeSelection', // before framework/gate stages, for the two-phase judge flow
  'GateEnhancement', // after the judge decision
  'FrameworkResolution', // after the judge decision, so %judge returns an uninjected menu
  'SessionManagement', // populates currentStep
  'InjectionControl', // needs currentStep; writes state.injection
  'PromptGuidance', // reads state.injection
  'StepResponseCapture',
  'StepExecution',
  'GateReview',
  'ResponseFormatting',
] as const;
type StageName = (typeof stageOrder)[number];

const createLogger = (): Logger => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
});

const createStage = (
  name: StageName,
  onExecute?: (context: ExecutionContext) => void | Promise<void>
): PipelineStage => ({
  name,
  execute: async (context) => {
    if (onExecute) {
      await onExecute(context);
    }
  },
});

const createPipeline = (
  overrides: Partial<Record<StageName, PipelineStage>> = {},
  ports: Pick<
    PipelinePorts,
    'executionRecordStore' | 'chainSessionStore' | 'temporaryGateRegistry'
  > = {},
  tracker: string[] = []
): { pipeline: PromptExecutionPipeline; tracker: string[] } => {
  const wrapStage = (stage: PipelineStage): PipelineStage => ({
    name: stage.name,
    execute: async (context) => {
      tracker.push(stage.name);
      await stage.execute(context);
    },
  });

  const defaultFormattingStage = createStage('ResponseFormatting', (context) => {
    context.setResponse({
      content: [{ type: 'text', text: 'ResponseFormatting response' }],
    });
  });

  const stageInstances = stageOrder.map((name) =>
    wrapStage(
      overrides[name] ??
        (name === 'ResponseFormatting' ? defaultFormattingStage : createStage(name))
    )
  );

  const pipeline = new PromptExecutionPipeline(stageInstances, {
    logger: createLogger(),
    metricsProvider: () => undefined,
    ...ports,
  });

  return { pipeline, tracker };
};

const contentText = (response: Awaited<ReturnType<PromptExecutionPipeline['execute']>>): string =>
  response.content[0]?.text ?? '';

describe('PromptExecutionPipeline orchestration', () => {
  test('runs stages sequentially until response formatting produces output', async () => {
    const { pipeline, tracker } = createPipeline();

    const response = await pipeline.execute({ command: '>>demo' });

    const expectedStages = stageOrder.slice(0, stageOrder.indexOf('ResponseFormatting') + 1);
    expect(tracker).toEqual(expectedStages);
    expect(contentText(response)).toContain('ResponseFormatting response');
  });

  test('stops execution when an earlier stage provides a response', async () => {
    const sessionStage = createStage('SessionManagement', (context) => {
      context.setResponse({
        content: [{ type: 'text', text: 'session short-circuit' }],
      });
    });

    const { pipeline, tracker } = createPipeline({
      SessionManagement: sessionStage,
    });

    const response = await pipeline.execute({ command: '>>demo ::gate' });

    const expectedStages = stageOrder.slice(0, stageOrder.indexOf('SessionManagement') + 1);
    expect(tracker).toEqual(expectedStages);
    expect(contentText(response)).toBe('session short-circuit');
  });

  test('step execution short-circuits chain runs before formatting stage', async () => {
    const parsingStage = createStage('CommandParsing', (context) => {
      context.parsedCommand = {
        commandType: 'chain',
        promptId: 'chain_prompt',
        format: 'symbolic',
        confidence: 0.8,
        metadata: {
          originalCommand: '>>chain_prompt',
          parseStrategy: 'symbolic',
          detectedFormat: 'symbolic',
          warnings: [],
        },
      } as any;
    });

    const stepExecutionStage = createStage('StepExecution', (context) => {
      context.setResponse({ content: [{ type: 'text', text: 'chain output' }] });
    });

    const { pipeline, tracker } = createPipeline({
      CommandParsing: parsingStage,
      StepExecution: stepExecutionStage,
      ResponseFormatting: createStage('ResponseFormatting'),
    });

    const response = await pipeline.execute({ command: '>>chain_prompt' });

    const expectedStages = stageOrder.slice(0, stageOrder.indexOf('StepExecution') + 1);
    expect(tracker).toEqual(expectedStages);
    expect(contentText(response)).toBe('chain output');
  });

  test('gate enhancement executes before framework resolution (for two-phase judge flow) and response formatting sees framework context', async () => {
    const gateStage = {
      name: 'GateEnhancement',
      execute: jest.fn(),
    };

    const frameworkStage = {
      name: 'FrameworkResolution',
      execute: jest.fn(async (context: ExecutionContext) => {
        context.frameworkContext = { framework: 'CAGEERF' } as any;
      }),
    };

    const responseFormattingStage = createStage('ResponseFormatting', (context) => {
      context.setResponse({
        content: [
          { type: 'text', text: `framework:${context.frameworkContext?.framework ?? 'none'}` },
        ],
      });
    });

    const { pipeline } = createPipeline({
      GateEnhancement: gateStage,
      FrameworkResolution: frameworkStage,
      ResponseFormatting: responseFormattingStage,
    });

    const response = await pipeline.execute({ command: '>>demo' });

    expect(gateStage.execute).toHaveBeenCalledTimes(1);
    expect(frameworkStage.execute).toHaveBeenCalledTimes(1);
    // Gate enhancement now runs BEFORE framework resolution for two-phase judge flow
    expect(gateStage.execute.mock.invocationCallOrder[0]).toBeLessThan(
      frameworkStage.execute.mock.invocationCallOrder[0]
    );
    expect(contentText(response)).toBe('framework:CAGEERF');
  });
});

describe('PromptExecutionPipeline stage-order enforcement', () => {
  const declared = (
    name: string,
    declarations: Pick<PipelineStage, 'provides' | 'requires'>
  ): PipelineStage => ({
    name,
    ...declarations,
    execute: async () => undefined,
  });

  const session = declared('SessionManagement', { provides: ['sessionContext.currentStep'] });
  const injection = declared('InjectionControl', { requires: ['sessionContext.currentStep'] });

  test('constructs when a declared requirement is met by an earlier stage', () => {
    expect(
      () => new PromptExecutionPipeline([session, injection], { logger: createLogger() })
    ).not.toThrow();
  });

  test('throws when a declared requirement is produced by a later stage', () => {
    expect(
      () => new PromptExecutionPipeline([injection, session], { logger: createLogger() })
    ).toThrow(/InjectionControl requires "sessionContext\.currentStep"/);
  });

  test('the throw names the count and the producing stage, so the fix is the message', () => {
    expect(
      () => new PromptExecutionPipeline([injection, session], { logger: createLogger() })
    ).toThrow(/1 declared ordering constraint\(s\)[\s\S]*SessionManagement at index 1/);
  });
});

/**
 * Tier 3.4 — terminal records on the failure path.
 *
 * Before this, stage 18 appended `working` on every step render and only stage 21
 * appended a terminal record, and only when the chain completed. A throw anywhere in
 * the pipeline left the session's last record at `working` permanently: 35 of the 64
 * rows present when this was written were stuck that way.
 *
 * Emission lives on the pipeline's catch rather than in stages 18/21 because those are
 * the renderer and the formatter — a throw in any of the other stages reaches neither.
 */
describe('PromptExecutionPipeline failure records', () => {
  const createRecordStore = (): {
    store: ExecutionRecordStore;
    appended: Array<Record<string, unknown>>;
  } => {
    const appended: Array<Record<string, unknown>> = [];
    const store = {
      append: (input: Record<string, unknown>) => {
        appended.push(input);
        return 'exec-id';
      },
      watermark: () => 'watermark-id',
      queryBySession: () => [],
    } as unknown as ExecutionRecordStore;
    return { store, appended };
  };

  /** A stage that establishes a session, so the failure record has something to attach to. */
  const sessionStage = (): PipelineStage =>
    createStage('SessionManagement', (context) => {
      (context as unknown as { sessionContext: unknown }).sessionContext = {
        sessionId: 'sess-doomed',
        chainId: 'chain-doomed',
        currentStep: 2,
        totalSteps: 5,
      };
    });

  test('emits a failed record when a stage throws', async () => {
    const { store, appended } = createRecordStore();
    const { pipeline } = createPipeline(
      {
        SessionManagement: sessionStage(),
        StepExecution: createStage('StepExecution', () => {
          throw new Error('render exploded');
        }),
      },
      { executionRecordStore: store }
    );

    await expect(pipeline.execute({ command: '>>demo' })).rejects.toThrow('render exploded');

    expect(appended).toHaveLength(1);
    expect(appended[0]).toMatchObject({
      sessionId: 'sess-doomed',
      chainId: 'chain-doomed',
      status: 'failed',
      errorMessage: 'render exploded',
    });
  });

  test('the failed record is terminal — completedAt is set, not left open', async () => {
    const { store, appended } = createRecordStore();
    const { pipeline } = createPipeline(
      {
        SessionManagement: sessionStage(),
        GateReview: createStage('GateReview', () => {
          throw new Error('gate exploded');
        }),
      },
      { executionRecordStore: store }
    );

    await expect(pipeline.execute({ command: '>>demo' })).rejects.toThrow('gate exploded');

    // A record with no completedAt reads as still-running, which is the exact defect
    // this tier closes — asserting the status alone would not catch it.
    expect(appended[0]?.['completedAt']).toEqual(expect.any(Number));
  });

  test('catches a throw from a stage neither 18 nor 21 would observe', async () => {
    const { store, appended } = createRecordStore();
    const { pipeline } = createPipeline(
      {
        SessionManagement: sessionStage(),
        // CommandParsing runs long before StepExecution (18) and ResponseFormatting (21).
        InjectionControl: createStage('InjectionControl', () => {
          throw new Error('injection exploded');
        }),
      },
      { executionRecordStore: store }
    );

    await expect(pipeline.execute({ command: '>>demo' })).rejects.toThrow('injection exploded');

    expect(appended).toHaveLength(1);
    expect(appended[0]).toMatchObject({ status: 'failed' });
  });

  test('emits nothing when no session was established', async () => {
    const { store, appended } = createRecordStore();
    const { pipeline } = createPipeline(
      {
        StepExecution: createStage('StepExecution', () => {
          throw new Error('no session here');
        }),
      },
      { executionRecordStore: store }
    );

    await expect(pipeline.execute({ command: '>>demo' })).rejects.toThrow('no session here');

    expect(appended).toEqual([]);
  });

  test('a successful run produces no failure record', async () => {
    const { store, appended } = createRecordStore();
    const { pipeline } = createPipeline(
      { SessionManagement: sessionStage() },
      { executionRecordStore: store }
    );

    await pipeline.execute({ command: '>>demo' });

    expect(appended).toEqual([]);
  });
});

/**
 * P4.157 / R12: the pipeline's one run-completion point. It asks the store once per call AFTER
 * the stage loop — whichever stage ended the call — because a stage that sets a response ends the
 * loop, and a run the capture walked past its last node on that call was left `working` with no
 * `chain/complete` when the ask lived in stage 20.
 */
describe('PromptExecutionPipeline — the run-completion point', () => {
  const withSession = (name: StageName, respond: boolean): PipelineStage =>
    createStage(name, (context) => {
      (context as unknown as { sessionContext: unknown }).sessionContext = {
        sessionId: 'session-1',
        chainId: 'chain-1',
        currentStep: 2,
        totalSteps: 1,
      };
      if (respond) context.setResponse({ content: [{ type: 'text', text: 'ended here' }] });
    });

  const createStore = (tracker: string[]) => ({
    completeHeldRun: jest.fn(async (_sessionId: string) => {
      tracker.push('completeHeldRun');
      return true;
    }),
  });

  test('asks once, after every stage, on a call that reaches formatting', async () => {
    const tracker: string[] = [];
    const store = createStore(tracker);
    const { pipeline } = createPipeline(
      { SessionManagement: withSession('SessionManagement', false) },
      { chainSessionStore: store as unknown as ChainSessionService },
      tracker
    );

    await pipeline.execute({ command: '>>demo' });

    expect(store.completeHeldRun).toHaveBeenCalledTimes(1);
    expect(store.completeHeldRun).toHaveBeenCalledWith('session-1');
    // After GateReview (stage 20) and the formatting stage that ends the loop: every review the
    // call can open exists by then.
    expect(tracker.slice(-3)).toEqual(['GateReview', 'ResponseFormatting', 'completeHeldRun']);
  });

  test('asks on a call an earlier stage ended (a shell-verification bounce ends before stage 20)', async () => {
    const tracker: string[] = [];
    const store = createStore(tracker);
    const { pipeline } = createPipeline(
      { StepResponseCapture: withSession('StepResponseCapture', true) },
      { chainSessionStore: store as unknown as ChainSessionService },
      tracker
    );

    const response = await pipeline.execute({ command: '>>demo' });

    expect(contentText(response)).toBe('ended here');
    expect(tracker).not.toContain('GateReview');
    expect(store.completeHeldRun).toHaveBeenCalledTimes(1);
    expect(tracker.at(-1)).toBe('completeHeldRun');
  });

  test('a call with no session asks nothing (control)', async () => {
    const store = createStore([]);
    const { pipeline } = createPipeline(
      {},
      { chainSessionStore: store as unknown as ChainSessionService }
    );

    await pipeline.execute({ command: 'noop' });

    expect(store.completeHeldRun).not.toHaveBeenCalled();
  });
});

/**
 * P6.111. MEASURED 2026-09-26 on `936611fd`: a run's call adopted its temporary gates only after a
 * completed stage loop, so a call that threw after stage 13 created (or resumed) the run released
 * its gates as unowned. The run itself is not ended by a throw — the error boundary writes a
 * `failed` execution record and nothing transitions the run (`transitionRunStatus` has one caller,
 * `completeHeldRun`), so it stays `working` and a `chain_id` resume reaches it — and continued
 * without the gates its own call registered.
 */
describe('PromptExecutionPipeline — a call that throws after the run exists', () => {
  const setup = (throwAt: StageName | undefined) => {
    const registry = new TemporaryGateRegistry(createLogger());
    let gateId = '';
    const registers = createStage('GateEnhancement', (context) => {
      gateId = registry.createTemporaryGate({
        name: 'g111',
        type: 'validation',
        scope: 'execution',
        description: 'd',
        guidance: 'G111',
        source: 'manual',
      });
      context.state.gates.temporaryGateIds = [gateId];
    });
    const session = createStage('SessionManagement', (context) => {
      (context as unknown as { sessionContext: unknown }).sessionContext = {
        sessionId: 'run-111',
        chainId: 'chain-111',
        currentStep: 1,
        totalSteps: 2,
      };
    });
    const overrides: Partial<Record<StageName, PipelineStage>> = {
      GateEnhancement: registers,
      SessionManagement: session,
    };
    if (throwAt !== undefined) {
      overrides[throwAt] = createStage(throwAt, () => {
        throw new Error('stage failed after the run was created');
      });
    }
    const store = { completeHeldRun: jest.fn(async (_sessionId: string) => false) };
    const { pipeline } = createPipeline(overrides, {
      temporaryGateRegistry: registry,
      chainSessionStore: store as unknown as ChainSessionService,
    });
    return { pipeline, registry, store, gateId: () => gateId };
  };

  test("the run owns the call's gates, and the run is not completed", async () => {
    const { pipeline, registry, store, gateId } = setup('StepExecution');

    await expect(pipeline.execute({ command: '>>demo' })).rejects.toThrow(
      'stage failed after the run was created'
    );

    expect(registry.getRunGates('run-111').map((gate) => gate.id)).toEqual([gateId()]);
    expect(store.completeHeldRun).not.toHaveBeenCalled();
  });

  test('control: a call that completes still hands the run its gates', async () => {
    const { pipeline, registry, store, gateId } = setup(undefined);

    await pipeline.execute({ command: '>>demo' });

    expect(registry.getRunGates('run-111').map((gate) => gate.id)).toEqual([gateId()]);
    expect(store.completeHeldRun).toHaveBeenCalledWith('run-111');
  });

  test('control: a throw before any run exists adopts nothing', async () => {
    const { pipeline, registry } = setup('FrameworkResolution');

    await expect(pipeline.execute({ command: '>>demo' })).rejects.toThrow();

    expect(registry.getRunGates('run-111')).toEqual([]);
  });
});

/**
 * P6.121 / R55. MEASURED 2026-09-27 on `ff936b05` (this harness; a throw after stage 13 is not
 * constructible on the shipped server, P6.111): a start call that threw left its run `working`
 * with only a `failed` execution record, so a later `chain_id` resumed a run nothing was ever
 * rendered for; a later call that threw left no trace on the next reply.
 *
 * Now a throw on the call that created the run (`lifecycleDecision` `create-new`) cancels it —
 * its gates go with it through `onRunEnded` — and a later `chain_id` is refused naming the
 * failure; a later call's throw keeps the run `working`, and the next reply names it once.
 */
describe('PromptExecutionPipeline — a call that throws, and the call after it', () => {
  type Decision = 'create-new' | 'resume-chain-id' | 'resume-completed';

  const setup = () => {
    const registry = new TemporaryGateRegistry(createLogger());
    const records: Array<Record<string, unknown> & { executionId: string }> = [];
    let sequence = 0;
    const nextId = (): string => `r${String((sequence += 1)).padStart(6, '0')}`;
    const recordStore = {
      watermark: nextId,
      append: (input: Record<string, unknown>) => {
        const executionId = nextId();
        records.push({ ...input, executionId });
        return executionId;
      },
      queryBySession: (sessionId: string) =>
        records.filter((record) => record['sessionId'] === sessionId),
    } as unknown as ExecutionRecordStore;
    const run = { status: 'working' };
    const sessionStore = {
      completeHeldRun: jest.fn(async (_sessionId: string) => false),
      getRunTelemetry: () => undefined,
      // The builder's `onRunEnded` subscription, inlined: a run that ends releases its gates.
      cancelChain: jest.fn(async (sessionId: string) => {
        run.status = 'cancelled';
        registry.releaseRun(sessionId);
        return true;
      }),
    };

    let decision: Decision = 'create-new';
    let throwMessage: string | undefined;
    const overrides: Partial<Record<StageName, PipelineStage>> = {
      GateEnhancement: createStage('GateEnhancement', (context) => {
        if (decision !== 'create-new') return;
        context.state.gates.temporaryGateIds = [
          registry.createTemporaryGate({
            name: 'g121',
            type: 'validation',
            scope: 'execution',
            description: 'd',
            guidance: 'G121',
            source: 'manual',
          }),
        ];
      }),
      // Stage 13, as far as this row reads it: the decision, the session, and the early answer
      // it gives a resume of an ended run (no session context is published for that one).
      SessionManagement: createStage('SessionManagement', (context) => {
        context.state.session.lifecycleDecision = decision;
        if (decision === 'resume-completed') {
          context.state.session.resumeSessionId = 'run-121';
          context.state.session.resumeChainId = 'chain-121';
          context.setResponse({ content: [{ type: 'text', text: 'Chain run already complete.' }] });
          return;
        }
        (context as unknown as { sessionContext: unknown }).sessionContext = {
          sessionId: 'run-121',
          chainId: 'chain-121',
          currentStep: 1,
          totalSteps: 3,
        };
      }),
      // Stage 18: every call that renders writes the step's `working` record, then may throw.
      StepExecution: createStage('StepExecution', (context) => {
        recordStore.append({
          sessionId: 'run-121',
          nodeId: 'n1',
          stepNumber: 1,
          status: 'working',
        });
        if (throwMessage !== undefined) throw new Error(throwMessage);
        context.setResponse({ content: [{ type: 'text', text: 'STEP-BODY' }] });
      }),
    };
    const { pipeline } = createPipeline(overrides, {
      temporaryGateRegistry: registry,
      executionRecordStore: recordStore,
      chainSessionStore: sessionStore as unknown as ChainSessionService,
    });
    const call = async (next: Decision, throws?: string) => {
      decision = next;
      throwMessage = throws;
      return pipeline.execute(
        next === 'create-new'
          ? { command: '>>demo' }
          : { chain_id: 'chain-121', user_response: 'x' }
      );
    };
    return { call, registry, run, sessionStore };
  };

  test('(a) a start call that throws ends its run, releases its gates, and a later chain_id is refused naming it', async () => {
    const { call, registry, run, sessionStore } = setup();

    await expect(call('create-new', 'render exploded')).rejects.toThrow('render exploded');

    expect(sessionStore.cancelChain).toHaveBeenCalledWith('run-121');
    expect(run.status).toBe('cancelled');
    expect(registry.getRunGates('run-121')).toEqual([]);

    const resumed = await call('resume-completed');
    expect(resumed.isError).toBe(true);
    expect(contentText(resumed)).toContain(
      'run `chain-121` failed on its start call: render exploded'
    );
  });

  test('(b) a later call that throws keeps the run working, and the next reply names it once', async () => {
    const { call, registry, run, sessionStore } = setup();
    await call('create-new');
    const gateIds = registry.getRunGates('run-121').map((gate) => gate.id);
    expect(gateIds).toHaveLength(1);

    await expect(call('resume-chain-id', 'capture exploded')).rejects.toThrow('capture exploded');
    expect(sessionStore.cancelChain).not.toHaveBeenCalled();
    expect(run.status).toBe('working');
    expect(registry.getRunGates('run-121').map((gate) => gate.id)).toEqual(gateIds);

    const next = await call('resume-chain-id');
    expect(contentText(next)).toBe('⚠️ The previous call failed: capture exploded\n\nSTEP-BODY');
    const after = await call('resume-chain-id');
    expect(contentText(after)).toBe('STEP-BODY');
  });

  test('(c) control: calls that do not throw are unchanged', async () => {
    const { call, run, sessionStore } = setup();
    expect(contentText(await call('create-new'))).toBe('STEP-BODY');
    expect(contentText(await call('resume-chain-id'))).toBe('STEP-BODY');
    expect(contentText(await call('resume-chain-id'))).toBe('STEP-BODY');
    expect(sessionStore.cancelChain).not.toHaveBeenCalled();
    expect(run.status).toBe('working');
  });
});
