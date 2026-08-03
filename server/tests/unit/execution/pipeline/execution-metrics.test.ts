/**
 * Unit spec for the MetricsCollector payload builders.
 *
 * Uses a real ExecutionContext rather than a fake: the builders read a dozen of its
 * getters (`getSessionId`, `isChainExecution`, `executionPlan`, `state.gates`), and a fake
 * shaped to satisfy them would be asserting the fake.
 */
import { describe, expect, test } from '@jest/globals';

import { ExecutionContext } from '../../../../src/engine/execution/context/execution-context.js';
import {
  buildCommandMetric,
  buildStageMetric,
  resolveExecutionMode,
  summarizeStageAttempt,
} from '../../../../src/engine/execution/pipeline/execution-metrics.js';

import type {
  CommandOutcome,
  StageAttempt,
} from '../../../../src/engine/execution/pipeline/execution-metrics.js';
import type { McpToolRequest } from '../../../../src/shared/types/index.js';

const memory = (heapUsed: number, rss: number): NodeJS.MemoryUsage => ({
  rss,
  heapTotal: heapUsed * 2,
  heapUsed,
  external: 0,
  arrayBuffers: 0,
});

const createContext = (request: McpToolRequest = { command: '>>demo' }): ExecutionContext =>
  new ExecutionContext(request);

const attempt = (overrides: Partial<StageAttempt> = {}): StageAttempt => ({
  stageName: 'CommandParsing',
  startTime: 1000,
  durationMs: 25,
  status: 'success',
  errorMessage: undefined,
  memoryBefore: memory(100, 500),
  memoryAfter: memory(180, 560),
  ...overrides,
});

const outcome = (overrides: Partial<CommandOutcome> = {}): CommandOutcome => ({
  commandId: 'cmd_test',
  startTime: 1000,
  endTime: 1250,
  status: 'success',
  errorMessage: undefined,
  ...overrides,
});

describe('summarizeStageAttempt', () => {
  test('derives both memory deltas from the two snapshots', () => {
    expect(summarizeStageAttempt(attempt())).toEqual({
      stage: 'CommandParsing',
      durationMs: 25,
      heapUsed: 180,
      rss: 560,
      heapUsedDelta: 80,
      rssDelta: 60,
    });
  });

  test('reports negative deltas when a stage releases memory', () => {
    const summary = summarizeStageAttempt(
      attempt({ memoryBefore: memory(400, 900), memoryAfter: memory(150, 700) })
    );

    expect(summary.heapUsedDelta).toBe(-250);
    expect(summary.rssDelta).toBe(-200);
  });
});

describe('buildStageMetric', () => {
  test('reports the same deltas the summary derives, from one computation', () => {
    const input = attempt();
    const summary = summarizeStageAttempt(input);
    const metric = buildStageMetric(input, createContext());

    expect(metric.metadata).toEqual({
      heapUsed: summary.heapUsed,
      rss: summary.rss,
      heapUsedDelta: summary.heapUsedDelta,
      rssDelta: summary.rssDelta,
      responseReady: false,
    });
  });

  test('builds the full payload for a successful stage', () => {
    const metric = buildStageMetric(attempt(), createContext());

    expect(metric).toMatchObject({
      stageId: 'CommandParsing:sessionless:1000',
      stageName: 'CommandParsing',
      stageType: 'parsing',
      toolName: 'prompt_engine',
      startTime: 1000,
      endTime: 1025,
      durationMs: 25,
      status: 'success',
    });
  });

  test('omits sessionId entirely when the context has no session', () => {
    const metric = buildStageMetric(attempt(), createContext());

    expect(Object.hasOwn(metric, 'sessionId')).toBe(false);
  });

  test('sets sessionId and folds it into stageId when a session exists', () => {
    const context = createContext();
    context.sessionContext = {
      sessionId: 'sess-42',
      chainId: 'chain-1',
      isChainExecution: true,
      currentStep: 1,
      totalSteps: 3,
    };

    const metric = buildStageMetric(attempt(), context);

    expect(metric.sessionId).toBe('sess-42');
    expect(metric.stageId).toBe('CommandParsing:sess-42:1000');
  });

  test('omits errorMessage on success and sets it on failure', () => {
    const context = createContext();

    expect(Object.hasOwn(buildStageMetric(attempt(), context), 'errorMessage')).toBe(false);

    const failed = buildStageMetric(
      attempt({ status: 'error', errorMessage: 'stage exploded' }),
      context
    );
    expect(failed.status).toBe('error');
    expect(failed.errorMessage).toBe('stage exploded');
  });

  test('classifies an unregistered stage name as other', () => {
    expect(buildStageMetric(attempt({ stageName: 'NotAStage' }), createContext()).stageType).toBe(
      'other'
    );
  });

  test('reports responseReady once the context carries a response', () => {
    const context = createContext();
    context.setResponse({ content: [{ type: 'text', text: 'done' }] });

    expect(buildStageMetric(attempt(), context).metadata?.['responseReady']).toBe(true);
  });
});

describe('buildCommandMetric', () => {
  test('builds the full payload and derives duration from the outcome window', () => {
    const metric = buildCommandMetric(createContext(), outcome());

    expect(metric).toMatchObject({
      commandId: 'cmd_test',
      commandName: '>>demo',
      toolName: 'prompt_engine',
      executionMode: 'single',
      startTime: 1000,
      endTime: 1250,
      durationMs: 250,
      status: 'success',
      appliedGates: [],
      temporaryGatesApplied: 0,
    });
  });

  test('names a response-only request explicitly rather than leaving it blank', () => {
    const metric = buildCommandMetric(createContext({}), outcome());

    expect(metric.commandName).toBe('<response-only>');
  });

  test('counts temporary gates from the typed slot, not the metadata bag', () => {
    const context = createContext();
    context.state.gates.temporaryGateIds = ['gate-a', 'gate-b'];

    expect(buildCommandMetric(context, outcome()).temporaryGatesApplied).toBe(2);
  });

  test('omits sessionId entirely when the context has no session', () => {
    const metric = buildCommandMetric(createContext(), outcome());

    expect(Object.hasOwn(metric, 'sessionId')).toBe(false);
  });

  test('sets sessionId when a session exists', () => {
    const context = createContext();
    context.state.session.resumeSessionId = 'sess-99';

    expect(buildCommandMetric(context, outcome()).sessionId).toBe('sess-99');
  });

  test('omits errorMessage on success and sets it on failure', () => {
    const context = createContext();

    expect(Object.hasOwn(buildCommandMetric(context, outcome()), 'errorMessage')).toBe(false);

    const failed = buildCommandMetric(
      context,
      outcome({ status: 'error', errorMessage: 'pipeline exploded' })
    );
    expect(failed.status).toBe('error');
    expect(failed.errorMessage).toBe('pipeline exploded');
  });

  test('reports the execution shape in metadata', () => {
    expect(buildCommandMetric(createContext(), outcome()).metadata).toEqual({
      strategy: undefined,
      category: undefined,
      hasSessionContext: false,
      isChainExecution: false,
      frameworkEnabled: false,
      responseReady: false,
    });
  });
});

describe('resolveExecutionMode', () => {
  test('reports chain when the request carries a chain id', () => {
    expect(resolveExecutionMode(createContext({ chain_id: 'chain-demo#1' }))).toBe('chain');
  });

  test('falls back to single when planning has not run', () => {
    expect(resolveExecutionMode(createContext())).toBe('single');
  });
});
