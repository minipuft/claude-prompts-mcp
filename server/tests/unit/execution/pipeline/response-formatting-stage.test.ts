import { describe, expect, jest, test } from '@jest/globals';

import { PromptRequestContext } from '../../../../src/engine/execution/context/prompt-request-context.js';
import { ResponseAssembler } from '../../../../src/engine/execution/formatting/response-assembler.js';
import { ResponseFormattingStage } from '../../../../src/engine/execution/pipeline/stages/21-formatting-stage.js';
import { ResponseFormatter } from '../../../../src/mcp/tools/prompt-engine/processors/response-formatter.js';

import type { Logger } from '../../../../src/infra/logging/index.js';
import type { ExecutionRecordStore } from '../../../../src/modules/chains/execution-record-store.js';
import type {
  ChainSession,
  ChainSessionService,
} from '../../../../src/shared/types/chain-session.js';

const createLogger = (): Logger => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
});

describe('ResponseFormattingStage', () => {
  test('formats chain responses with footer and structured metadata', async () => {
    const formatter = new ResponseFormatter(createLogger());
    const stage = new ResponseFormattingStage(formatter, new ResponseAssembler(), createLogger());

    const context = new PromptRequestContext({ command: '>>chain' });
    context.executionPlan = {
      strategy: 'chain',
      gates: [],
      requiresFramework: false,
      requiresSession: true,
      llmValidationEnabled: true,
      category: 'analysis',
    } as any;
    context.sessionContext = {
      sessionId: 'sess-123',
      chainId: 'chain-demo#2',
      isChainExecution: true,
      currentStep: 2,
      totalSteps: 2,
    };
    context.executionResults = {
      content: 'Chain output with inline guidance',
    };
    context.gateInstructions = 'Gate Summary:\n- inline gate passed';

    await stage.execute(context);

    const response = context.response;
    if (!response) {
      throw new Error('expected response');
    }
    const text = response.content[0].text;
    expect(text).toContain('Chain output with inline guidance');
    expect(text).toContain('Gate Summary');
    expect(text).toContain('Chain: chain-demo#2');
    // 2/2 with no completion latch means "standing on the final step, work outstanding" —
    // it is NOT a completed run, and saying so is the P3 row-13 fix.
    expect(text).toContain('Progress 2/2');
    expect(text).not.toContain('Chain complete');
    expect(text).toContain('user_response="<your step output>"');
    // Note: structuredContent is intentionally disabled (includeStructuredContent: false)
    // to keep model input lean. Chain metadata is included in the text footer instead.
    expect(response.structuredContent).toBeUndefined();
  });

  test('a completed run gets the completion footer, not a request for more output', async () => {
    const formatter = new ResponseFormatter(createLogger());
    const stage = new ResponseFormattingStage(formatter, new ResponseAssembler(), createLogger());

    const context = new PromptRequestContext({ command: '>>chain' });
    context.executionPlan = {
      strategy: 'chain',
      gates: [],
      requiresFramework: false,
      requiresSession: true,
      llmValidationEnabled: true,
      category: 'analysis',
    } as any;
    context.sessionContext = {
      sessionId: 'sess-123',
      chainId: 'chain-demo#2',
      isChainExecution: true,
      currentStep: 3,
      totalSteps: 2,
    };
    context.executionResults = { content: 'Execution complete.' };
    // The latch StepExecutionStage sets from the store's terminal runStatus.
    context.state.session.chainComplete = true;

    await stage.execute(context);

    const text = context.response?.content[0].text ?? '';
    expect(text).toContain('✓ Chain complete (2/2)');
    // R96: one payload states one state — a finished run carries no `Next:` line.
    expect(text).not.toContain('Next:');
    expect(text).toContain('Chain execution complete');
  });

  test('passes simple prompt content through response formatter when no session data is present', async () => {
    const formatter = new ResponseFormatter(createLogger());
    const stage = new ResponseFormattingStage(formatter, new ResponseAssembler(), createLogger());

    const context = new PromptRequestContext({ command: '>>prompt' });
    context.executionPlan = {
      strategy: 'prompt',
      gates: [],
      requiresFramework: false,
      requiresSession: false,
      llmValidationEnabled: false,
      category: 'analysis',
    } as any;
    context.parsedCommand = {
      promptId: 'prompt',
      rawArgs: '',
      format: 'simple',
      confidence: 0.9,
      metadata: {
        originalCommand: '>>prompt',
        parseStrategy: 'simple',
        detectedFormat: 'simple',
        warnings: [],
      },
      convertedPrompt: { id: 'prompt' },
    } as any;
    context.executionResults = {
      content: 'Single prompt output',
    };

    await stage.execute(context);

    const content = context.response?.content[0].text ?? '';
    expect(content).toContain('Single prompt output');
    expect(content).not.toContain('Gate Inputs Provided');
    expect(context.response?.structuredContent).toBeUndefined();
  });
});

/**
 * Tier 3.4 — terminal execution records emitted from the formatting stage.
 *
 * Completion records are emitted here. Cancellation uses the executor's terminal observer;
 * failure uses the pipeline's catch boundary. Historical records keep their original outcomes.
 */
describe('ResponseFormattingStage — stepsExecuted', () => {
  /** Captures the FormatterExecutionContext the stage builds, which is otherwise unobservable. */
  const capturingFormatter = (): {
    port: any;
    captured: Array<Record<string, unknown>>;
  } => {
    const captured: Array<Record<string, unknown>> = [];
    const port = {
      formatPromptEngineResponse: (_text: string, formatterContext: Record<string, unknown>) => {
        captured.push(formatterContext);
        return { content: [{ type: 'text', text: 'ok' }], isError: false };
      },
    };
    return { port, captured };
  };

  const chainContext = (): PromptRequestContext => {
    const context = new PromptRequestContext({ command: '>>chain' });
    context.executionPlan = {
      strategy: 'chain',
      gates: [],
      requiresFramework: false,
      requiresSession: true,
      llmValidationEnabled: true,
      category: 'analysis',
    } as any;
    context.sessionContext = {
      sessionId: 'sess-count',
      chainId: 'chain-count#1',
      isChainExecution: true,
      currentStep: 3,
      totalSteps: 3,
    };
    context.executionResults = { content: 'output' };
    return context;
  };

  test('reports the number of nodes actually executed, not the current position', async () => {
    const { port, captured } = capturingFormatter();
    const sessionStore = {
      getSession: () => ({ executionOrder: ['n1'] }),
      getRunTelemetry: () => undefined,
    } as any;
    const stage = new ResponseFormattingStage(
      port,
      new ResponseAssembler(),
      createLogger(),
      null,
      sessionStore
    );

    // Standing at position 3 with only ONE node advanced past — the shape a run takes when a
    // step is skipped or the run resumed mid-flight. Reporting `currentStep` would claim 3.
    await stage.execute(chainContext());

    expect(captured[0]!['stepsExecuted']).toBe(1);
  });

  test('falls back to the position when no session store is wired', async () => {
    const { port, captured } = capturingFormatter();
    const stage = new ResponseFormattingStage(port, new ResponseAssembler(), createLogger());

    await stage.execute(chainContext());

    // Undefined store means "cannot count", not "counted zero".
    expect(captured[0]!['stepsExecuted']).toBe(3);
  });
});

describe('ResponseFormattingStage terminal records', () => {
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
    } as unknown as ExecutionRecordStore;
    return { store, appended };
  };

  const runStage = async (
    mutate: (context: PromptRequestContext) => void,
    store?: ExecutionRecordStore,
    sessions?: ChainSessionService
  ): Promise<void> => {
    const stage = new ResponseFormattingStage(
      new ResponseFormatter(createLogger()),
      new ResponseAssembler(),
      createLogger(),
      store ?? null,
      sessions ?? null
    );

    const context = new PromptRequestContext({ command: '>>chain' });
    context.executionPlan = {
      strategy: 'chain',
      gates: [],
      requiresFramework: false,
      requiresSession: true,
      llmValidationEnabled: true,
      category: 'analysis',
    } as any;
    context.sessionContext = {
      sessionId: 'sess-term',
      chainId: 'chain-term#1',
      isChainExecution: true,
      currentStep: 2,
      totalSteps: 2,
    };
    context.executionResults = { content: 'output' };

    mutate(context);
    await stage.execute(context);
  };

  test('still emits completed for an ordinary finished chain', async () => {
    const { store, appended } = createRecordStore();

    await runStage((context) => {
      context.state.session.chainComplete = true;
    }, store);

    expect(appended).toHaveLength(1);
    expect(appended[0]).toMatchObject({ status: 'completed', completedAt: expect.any(Number) });
  });

  test('emits nothing for a run still in progress', async () => {
    const { store, appended } = createRecordStore();

    await runStage(() => undefined, store);

    expect(appended).toEqual([]);
  });

  test.each(['working', 'completed', 'cancelled', 'failed'] as const)(
    'completion records respect the scoped run status %s',
    async (runStatus) => {
      const { store, appended } = createRecordStore();
      const scope = { workspaceId: 'ws-format' };
      const session = {
        sessionId: 'sess-term',
        chainId: 'chain-term#1',
        state: { nodes: [], currentNodeId: null, lastUpdated: 0 },
        executionOrder: [],
        startTime: 0,
        lastActivity: 0,
        originalArgs: {},
        runStatus,
      } satisfies ChainSession;
      const getSession = jest.fn((id: string, lookup?: { workspaceId?: string }) =>
        id === 'sess-term' && lookup?.workspaceId === scope.workspaceId ? session : undefined
      );
      const getRunTelemetry = jest.fn();
      await runStage(
        (context) => {
          context.state.session.chainComplete = true;
          jest.spyOn(context, 'getScopeOptions').mockReturnValue(scope);
        },
        store,
        { getSession, getRunTelemetry } as unknown as ChainSessionService
      );

      expect(getSession).toHaveBeenCalledWith('sess-term', scope);
      if (runStatus === 'cancelled' || runStatus === 'failed') {
        expect(appended).toEqual([]);
        expect(getRunTelemetry).not.toHaveBeenCalled();
      } else {
        expect(appended).toHaveLength(1);
        expect(appended[0]).toMatchObject({ status: 'completed', completedAt: expect.any(Number) });
      }
    }
  );

  test('does not throw when no record store is wired', async () => {
    await expect(
      runStage((context) => {
        context.state.session.chainComplete = true;
      })
    ).resolves.toBeUndefined();
  });
});
