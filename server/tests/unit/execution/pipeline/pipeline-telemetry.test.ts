import { describe, expect, jest, test, beforeEach, afterEach } from '@jest/globals';

import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { trace, SpanStatusCode } from '@opentelemetry/api';

import { PromptExecutionPipeline } from '../../../../src/engine/execution/pipeline/prompt-execution-pipeline.js';

import type { ExecutionContext } from '../../../../src/engine/execution/context/execution-context.js';
import type { PipelineStage } from '../../../../src/engine/execution/pipeline/stage.js';
import type {
  Logger,
  HookRegistryPort,
  PipelineHookContext,
} from '../../../../src/shared/types/index.js';

// ===== Test Helpers =====

const createLogger = (): Logger => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
});

const createStage = (
  name: string,
  onExecute?: (context: ExecutionContext) => void | Promise<void>
): PipelineStage => ({
  name,
  execute: async (context) => {
    if (onExecute) await onExecute(context);
  },
});

const createMockHookRegistry = (): HookRegistryPort & {
  beforeCalls: Array<{ stage: string; context: PipelineHookContext }>;
  afterCalls: Array<{ stage: string; context: PipelineHookContext }>;
  errorCalls: Array<{ stage: string; error: Error; context: PipelineHookContext }>;
} => {
  const registry = {
    beforeCalls: [] as Array<{ stage: string; context: PipelineHookContext }>,
    afterCalls: [] as Array<{ stage: string; context: PipelineHookContext }>,
    errorCalls: [] as Array<{ stage: string; error: Error; context: PipelineHookContext }>,
    getCounts: () => ({ pipeline: 0, gate: 0, chain: 0 }),
    clearAll: jest.fn(),
    emitBeforeStage: jest.fn(async (stage: string, context: PipelineHookContext) => {
      registry.beforeCalls.push({ stage, context });
    }),
    emitAfterStage: jest.fn(async (stage: string, context: PipelineHookContext) => {
      registry.afterCalls.push({ stage, context });
    }),
    emitStageError: jest.fn(async (stage: string, error: Error, context: PipelineHookContext) => {
      registry.errorCalls.push({ stage, error, context });
    }),
  };
  return registry;
};

// Standard stage list (matching pipeline constructor order)
const stageNames = [
  'RequestNormalization',
  'DependencyInjection',
  'ExecutionLifecycle',
  'IdentityResolution',
  'CommandParsing',
  'InlineGateExtraction',
  'OperatorValidation',
  'ExecutionPlanning',
  'JudgeSelection',
  'GateEnhancement',
  'FrameworkResolution',
  'SessionManagement',
  'FrameworkInjectionControl',
  'PromptGuidance',
  'StepResponseCapture',
  'StepExecution',
  'GateReview',
  'ResponseFormatting',
  'PostFormattingCleanup',
] as const;

function createPipeline(options: {
  hookRegistry?: HookRegistryPort;
  stageOverrides?: Partial<Record<string, PipelineStage>>;
}): PromptExecutionPipeline {
  const stages = stageNames.map((name) => {
    if (options.stageOverrides?.[name]) return options.stageOverrides[name]!;
    // Set response in LAST stage so all stages execute (no early exit)
    if (name === 'PostFormattingCleanup') {
      return createStage(name, (context) => {
        if (!context.response) {
          context.setResponse({ content: [{ type: 'text', text: 'ok' }] });
        }
      });
    }
    return createStage(name);
  });

  return new PromptExecutionPipeline(
    stages[0]!, // requestStage
    stages[1]!, // dependencyStage
    stages[2]!, // lifecycleStage
    stages[3]!, // identityResolutionStage
    stages[4]!, // parsingStage
    stages[5]!, // inlineGateStage
    stages[6]!, // operatorValidationStage
    stages[7]!, // planningStage
    null, // scriptExecutionStage
    null, // scriptAutoExecuteStage
    stages[10]!, // frameworkStage
    stages[8]!, // judgeSelectionStage
    stages[13]!, // promptGuidanceStage
    stages[9]!, // gateStage
    stages[11]!, // sessionStage
    stages[12]!, // frameworkInjectionControlStage
    stages[14]!, // responseCaptureStage
    null, // shellVerificationStage
    stages[15]!, // executionStage
    null, // phaseGuardVerificationStage
    stages[16]!, // gateReviewStage
    stages[17]!, // formattingStage
    stages[18]!, // postFormattingStage
    createLogger(),
    () => undefined,
    options.hookRegistry
  );
}

// ===== Tests =====

describe('Pipeline Hook Emissions (Phase 1.3b)', () => {
  test('emits beforeStage and afterStage for every stage', async () => {
    const hookRegistry = createMockHookRegistry();
    const pipeline = createPipeline({ hookRegistry });

    await pipeline.execute({ command: 'test-command' });

    // Every stage should have a before + after call
    expect(hookRegistry.beforeCalls.length).toBe(stageNames.length);
    expect(hookRegistry.afterCalls.length).toBe(stageNames.length);

    // First stage should be RequestNormalization
    expect(hookRegistry.beforeCalls[0]!.stage).toBe('RequestNormalization');
    // Last stage should be PostFormattingCleanup
    expect(hookRegistry.afterCalls[hookRegistry.afterCalls.length - 1]!.stage).toBe(
      'PostFormattingCleanup'
    );
  });

  test('emits stageError when a stage throws', async () => {
    const hookRegistry = createMockHookRegistry();
    const error = new Error('Stage failed');
    const pipeline = createPipeline({
      hookRegistry,
      stageOverrides: {
        CommandParsing: createStage('CommandParsing', () => {
          throw error;
        }),
      },
    });

    await expect(pipeline.execute({ command: 'test' })).rejects.toThrow('Stage failed');

    expect(hookRegistry.errorCalls.length).toBe(1);
    expect(hookRegistry.errorCalls[0]!.stage).toBe('CommandParsing');
    expect(hookRegistry.errorCalls[0]!.error.message).toBe('Stage failed');
  });

  test('hook context includes execution metadata', async () => {
    const hookRegistry = createMockHookRegistry();
    const pipeline = createPipeline({ hookRegistry });

    await pipeline.execute({ command: 'test-command' });

    const ctx = hookRegistry.beforeCalls[0]!.context;
    expect(ctx.executionId).toBeDefined();
    expect(ctx.executionType).toBe('single');
    expect(ctx.frameworkEnabled).toBe(false);
  });

  test('hook errors do not halt pipeline execution', async () => {
    const hookRegistry = createMockHookRegistry();
    (hookRegistry.emitBeforeStage as jest.Mock<() => Promise<void>>).mockRejectedValueOnce(
      new Error('Hook failed')
    );

    const pipeline = createPipeline({ hookRegistry });
    const result = await pipeline.execute({ command: 'test' });

    expect(result.content[0]!.text).toBe('ok');
  });

  test('early exit emits hooks only for executed stages', async () => {
    const hookRegistry = createMockHookRegistry();
    const pipeline = createPipeline({
      hookRegistry,
      stageOverrides: {
        CommandParsing: createStage('CommandParsing', (context) => {
          context.setResponse({ content: [{ type: 'text', text: 'early' }] });
        }),
      },
    });

    const result = await pipeline.execute({ command: 'test' });
    expect(result.content[0]!.text).toBe('early');

    // Only stages up to and including CommandParsing should fire
    const executedStages = hookRegistry.afterCalls.map((c) => c.stage);
    expect(executedStages).toContain('CommandParsing');
    expect(executedStages).not.toContain('ResponseFormatting');
  });
});

describe('Pipeline OTel Span Instrumentation (Phase 1.4)', () => {
  let exporter: InMemorySpanExporter;
  let provider: NodeTracerProvider;

  beforeEach(() => {
    exporter = new InMemorySpanExporter();
    provider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    provider.register();
  });

  afterEach(async () => {
    await provider.shutdown();
    exporter.reset();
    trace.disable();
  });

  test('creates root span and stage child spans', async () => {
    const pipeline = createPipeline({});

    await pipeline.execute({ command: 'test-command' });

    const spans = exporter.getFinishedSpans();
    const rootSpan = spans.find((s) => s.name === 'prompt_engine.request');
    expect(rootSpan).toBeDefined();
    expect(rootSpan!.status.code).toBe(SpanStatusCode.OK);

    // Stage spans should be present
    const stageSpans = spans.filter((s) => s.name.startsWith('pipeline.stage.'));
    expect(stageSpans.length).toBe(stageNames.length);

    // Stage spans should have name and index attributes
    const firstStageSpan = stageSpans.find((s) => s.name === 'pipeline.stage.RequestNormalization');
    expect(firstStageSpan).toBeDefined();
    expect(firstStageSpan!.attributes['cpm.stage.name']).toBe('RequestNormalization');
    expect(firstStageSpan!.attributes['cpm.stage.index']).toBe(0);
  });

  test('root span has execution attributes', async () => {
    const pipeline = createPipeline({});

    await pipeline.execute({ command: 'test-cmd' });

    const spans = exporter.getFinishedSpans();
    const rootSpan = spans.find((s) => s.name === 'prompt_engine.request')!;
    expect(rootSpan.attributes['cpm.command.type']).toBe('test-cmd');
    expect(rootSpan.attributes['cpm.execution.mode']).toBe('single');
  });

  test('sets ERROR status on stage failure', async () => {
    const pipeline = createPipeline({
      stageOverrides: {
        ExecutionPlanning: createStage('ExecutionPlanning', () => {
          throw new Error('plan failed');
        }),
      },
    });

    await expect(pipeline.execute({ command: 'test' })).rejects.toThrow('plan failed');

    const spans = exporter.getFinishedSpans();
    const rootSpan = spans.find((s) => s.name === 'prompt_engine.request');
    expect(rootSpan).toBeDefined();
    expect(rootSpan!.status.code).toBe(SpanStatusCode.ERROR);

    const failedStage = spans.find((s) => s.name === 'pipeline.stage.ExecutionPlanning');
    expect(failedStage).toBeDefined();
    expect(failedStage!.status.code).toBe(SpanStatusCode.ERROR);
  });

  test('no spans created when no provider registered', async () => {
    // Disable the provider registered in beforeEach
    await provider.shutdown();
    trace.disable();

    const pipeline = createPipeline({});
    await pipeline.execute({ command: 'test' });

    // Re-register for afterEach cleanup
    exporter = new InMemorySpanExporter();
    provider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });

    const spans = exporter.getFinishedSpans();
    expect(spans.length).toBe(0);
  });

  test('stage spans end on early exit', async () => {
    const pipeline = createPipeline({
      stageOverrides: {
        DependencyInjection: createStage('DependencyInjection', (context) => {
          context.setResponse({ content: [{ type: 'text', text: 'early' }] });
        }),
      },
    });

    const result = await pipeline.execute({ command: 'test' });
    expect(result.content[0]!.text).toBe('early');

    const spans = exporter.getFinishedSpans();
    // Root span should be ended
    const rootSpan = spans.find((s) => s.name === 'prompt_engine.request');
    expect(rootSpan).toBeDefined();
    // Only stages up to early exit should have spans
    const stageSpans = spans.filter((s) => s.name.startsWith('pipeline.stage.'));
    expect(stageSpans.length).toBeLessThan(stageNames.length);
  });

  test('hooks and spans work together', async () => {
    const hookRegistry = createMockHookRegistry();
    const pipeline = createPipeline({
      hookRegistry,
    });

    await pipeline.execute({ command: 'test' });

    // Both hooks and spans should fire
    expect(hookRegistry.beforeCalls.length).toBe(stageNames.length);
    const spans = exporter.getFinishedSpans();
    expect(spans.find((s) => s.name === 'prompt_engine.request')).toBeDefined();
  });
});

describe('Pipeline Wide-Event Root Span Enrichment', () => {
  let exporter: InMemorySpanExporter;
  let provider: NodeTracerProvider;

  beforeEach(() => {
    exporter = new InMemorySpanExporter();
    provider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    provider.register();
  });

  afterEach(async () => {
    await provider.shutdown();
    exporter.reset();
    trace.disable();
  });

  test('root span has wide-event performance attributes on normal completion', async () => {
    const pipeline = createPipeline({});
    await pipeline.execute({ command: 'test-wide' });

    const rootSpan = exporter.getFinishedSpans().find((s) => s.name === 'prompt_engine.request')!;
    expect(rootSpan).toBeDefined();

    // Performance attributes
    expect(rootSpan.attributes['cpm.duration.total_ms']).toEqual(expect.any(Number));
    expect(rootSpan.attributes['cpm.stages.executed_count']).toBe(stageNames.length);
    expect(rootSpan.attributes['cpm.stages.slowest']).toEqual(expect.any(String));
    expect(rootSpan.attributes['cpm.stages.slowest_ms']).toEqual(expect.any(Number));
    expect(rootSpan.attributes['cpm.had_early_exit']).toBe(false);
  });

  test('root span has gate attributes', async () => {
    const pipeline = createPipeline({});
    await pipeline.execute({ command: 'test-gates' });

    const rootSpan = exporter.getFinishedSpans().find((s) => s.name === 'prompt_engine.request')!;

    // Gate attributes (empty by default since no gates applied in test)
    expect(rootSpan.attributes['cpm.gates.names']).toBe('');
    expect(rootSpan.attributes['cpm.gates.passed_count']).toBe(0);
    expect(rootSpan.attributes['cpm.gates.failed_count']).toBe(0);
    expect(rootSpan.attributes['cpm.gates.blocked']).toBe(false);
    expect(rootSpan.attributes['cpm.gates.retry_exhausted']).toBe(false);
    expect(rootSpan.attributes['cpm.gates.enforcement_mode']).toBe('standard');
  });

  test('root span has chain and framework attributes', async () => {
    const pipeline = createPipeline({});
    await pipeline.execute({ command: 'test-chain' });

    const rootSpan = exporter.getFinishedSpans().find((s) => s.name === 'prompt_engine.request')!;

    // Chain/framework (defaults for non-chain execution)
    expect(rootSpan.attributes['cpm.chain.is_chain']).toBe(false);
    expect(rootSpan.attributes['cpm.chain.step_index']).toBe(0);
    expect(rootSpan.attributes['cpm.chain.id']).toBe('');
    expect(rootSpan.attributes['cpm.framework.id']).toBe('');
    expect(rootSpan.attributes['cpm.framework.enabled']).toBe(false);
  });

  test('root span has scope attribute', async () => {
    const pipeline = createPipeline({});
    await pipeline.execute({ command: 'test-scope' });

    const rootSpan = exporter.getFinishedSpans().find((s) => s.name === 'prompt_engine.request')!;
    expect(rootSpan.attributes['cpm.scope.source']).toBe('default');
  });

  test('marks early exit on root span', async () => {
    const pipeline = createPipeline({
      stageOverrides: {
        CommandParsing: createStage('CommandParsing', (context) => {
          context.setResponse({ content: [{ type: 'text', text: 'early' }] });
        }),
      },
    });

    await pipeline.execute({ command: 'test-early' });

    const rootSpan = exporter.getFinishedSpans().find((s) => s.name === 'prompt_engine.request')!;
    expect(rootSpan.attributes['cpm.had_early_exit']).toBe(true);
    // Fewer stages executed
    expect(rootSpan.attributes['cpm.stages.executed_count']).toBeLessThan(stageNames.length);
  });

  test('includes error type on pipeline failure', async () => {
    const pipeline = createPipeline({
      stageOverrides: {
        ExecutionPlanning: createStage('ExecutionPlanning', () => {
          throw new Error('plan exploded');
        }),
      },
    });

    await expect(pipeline.execute({ command: 'test-error' })).rejects.toThrow('plan exploded');

    const rootSpan = exporter.getFinishedSpans().find((s) => s.name === 'prompt_engine.request')!;
    expect(rootSpan.attributes['cpm.error.type']).toBe('plan exploded');
    // Error path = fewer stages executed than registered, so early exit is true
    expect(rootSpan.attributes['cpm.had_early_exit']).toBe(true);
  });

  test('slowest stage identifies correct bottleneck', async () => {
    const pipeline = createPipeline({
      stageOverrides: {
        ExecutionPlanning: createStage('ExecutionPlanning', async () => {
          // Simulate a slow stage
          await new Promise((resolve) => setTimeout(resolve, 50));
        }),
      },
    });

    await pipeline.execute({ command: 'test-slow' });

    const rootSpan = exporter.getFinishedSpans().find((s) => s.name === 'prompt_engine.request')!;
    expect(rootSpan.attributes['cpm.stages.slowest']).toBe('ExecutionPlanning');
    expect(rootSpan.attributes['cpm.stages.slowest_ms']).toBeGreaterThanOrEqual(40);
  });
});
