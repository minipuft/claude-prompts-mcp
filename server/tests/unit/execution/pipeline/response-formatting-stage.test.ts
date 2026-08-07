import { describe, expect, jest, test } from '@jest/globals';

import { ExecutionContext } from '../../../../src/engine/execution/context/execution-context.js';
import { ResponseAssembler } from '../../../../src/engine/execution/formatting/response-assembler.js';
import { ResponseFormattingStage } from '../../../../src/engine/execution/pipeline/stages/21-formatting-stage.js';
import { ResponseFormatter } from '../../../../src/mcp/tools/prompt-engine/processors/response-formatter.js';

import type { Logger } from '../../../../src/infra/logging/index.js';
import type { ExecutionRecordStore } from '../../../../src/modules/chains/execution-record-store.js';

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

    const context = new ExecutionContext({ command: '>>chain' });
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
    expect(text).toContain('✓ Chain complete (2/2)');
    expect(text).toContain('Next: Chain complete. No user_response needed.');
    // Note: structuredContent is intentionally disabled (includeStructuredContent: false)
    // to keep model input lean. Chain metadata is included in the text footer instead.
    expect(response.structuredContent).toBeUndefined();
  });

  test('passes simple prompt content through response formatter when no session data is present', async () => {
    const formatter = new ResponseFormatter(createLogger());
    const stage = new ResponseFormattingStage(formatter, new ResponseAssembler(), createLogger());

    const context = new ExecutionContext({ command: '>>prompt' });
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
 * Two terminal outcomes reach this stage. Completion was already handled. Abort was not:
 * `state.session.aborted` is set by GateVerdictProcessor and the shell-verification stage
 * and — before this — was read by nothing, so a user-aborted chain left its last ledger
 * record at `working` permanently. Failure is NOT here; it is emitted from the pipeline's
 * catch boundary, because an abort does not throw and a throw never reaches this stage.
 */
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
    mutate: (context: ExecutionContext) => void,
    store?: ExecutionRecordStore
  ): Promise<void> => {
    const stage = new ResponseFormattingStage(
      new ResponseFormatter(createLogger()),
      new ResponseAssembler(),
      createLogger(),
      store ?? null
    );

    const context = new ExecutionContext({ command: '>>chain' });
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

  test('emits a cancelled record when the run was aborted', async () => {
    const { store, appended } = createRecordStore();

    await runStage((context) => {
      context.state.session.aborted = true;
    }, store);

    expect(appended).toHaveLength(1);
    expect(appended[0]).toMatchObject({
      sessionId: 'sess-term',
      chainId: 'chain-term#1',
      status: 'cancelled',
    });
  });

  test('the cancelled record is terminal — completedAt is set', async () => {
    const { store, appended } = createRecordStore();

    await runStage((context) => {
      context.state.session.aborted = true;
    }, store);

    // Without completedAt the row still reads as in-flight, which is the defect
    // this path closes — asserting the status alone would not catch it.
    expect(appended[0]?.['completedAt']).toEqual(expect.any(Number));
  });

  test('abort wins over completion when both flags are set', async () => {
    const { store, appended } = createRecordStore();

    // A chain can be flagged complete and aborted in the same pass. Abort is the more
    // specific outcome, so recording `completed` here would erase the user's choice.
    await runStage((context) => {
      context.state.session.chainComplete = true;
      context.state.session.aborted = true;
    }, store);

    expect(appended).toHaveLength(1);
    expect(appended[0]).toMatchObject({ status: 'cancelled' });
  });

  test('still emits completed for an ordinary finished chain', async () => {
    const { store, appended } = createRecordStore();

    await runStage((context) => {
      context.state.session.chainComplete = true;
    }, store);

    expect(appended).toHaveLength(1);
    expect(appended[0]).toMatchObject({ status: 'completed' });
  });

  test('emits nothing for a run that is neither complete nor aborted', async () => {
    const { store, appended } = createRecordStore();

    await runStage(() => undefined, store);

    expect(appended).toEqual([]);
  });

  test('does not throw when no record store is wired', async () => {
    await expect(
      runStage((context) => {
        context.state.session.aborted = true;
      })
    ).resolves.toBeUndefined();
  });
});
