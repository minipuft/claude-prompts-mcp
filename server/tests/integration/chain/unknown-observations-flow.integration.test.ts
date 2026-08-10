import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

import { StepCaptureService } from '../../../src/engine/execution/capture/step-capture-service.js';
import { UnknownObservationProcessor } from '../../../src/engine/execution/capture/unknown-observation-processor.js';
import { ExecutionContext } from '../../../src/engine/execution/context/index.js';
import { ChainOperatorExecutor } from '../../../src/engine/execution/operators/chain-operator-executor.js';
import { StepResponseCaptureStage } from '../../../src/engine/execution/pipeline/stages/16-response-capture-stage.js';
import {
  GATE_VERDICT_VALIDATION_MESSAGE,
  isValidGateVerdict,
} from '../../../src/engine/gates/core/gate-verdict-contract.js';
import { GateVerdictProcessor } from '../../../src/engine/gates/services/gate-verdict-processor.js';
import { buildPromptEngineSchema } from '../../../src/mcp/tools/schemas/prompt-engine.schema.js';
import { ChainSessionStore } from '../../../src/modules/chains/manager.js';
import { TextReferenceStore } from '../../../src/modules/text-refs/index.js';

import type { ConvertedPrompt } from '../../../src/engine/execution/types.js';
import type { Logger } from '../../../src/infra/logging/index.js';
import type { ChainRunRegistry } from '../../../src/modules/chains/run-registry.js';
import type { PersistedChainRunRegistry } from '../../../src/shared/types/index.js';

/**
 * The chain of custody for a declared unknown, composed from production units:
 *
 *   prompt_engine schema  →  StepResponseCaptureStage  →  UnknownObservationProcessor
 *                                                                    ↓
 *                       ChainSessionStore.applyUnknownObservations (real, persistence stubbed)
 *                                                                    ↓
 *                                            getChainContext → `unknowns_ledger`
 *
 * Each link is unit-tested in isolation; what this asserts is that they agree — in
 * particular that a batch accepted by the schema reaches the ledger, and that the
 * ledger is visible to the SAME call's rendering context rather than only the next.
 */

const createLogger = (): Logger =>
  ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }) as unknown as Logger;

const schema = buildPromptEngineSchema(isValidGateVerdict, GATE_VERDICT_VALIDATION_MESSAGE);

describe('unknown observations, schema through ledger', () => {
  let store: ChainSessionStore;
  let saveSpy: jest.SpiedFunction<() => Promise<void>>;
  let loadSpy: jest.SpiedFunction<() => Promise<void>>;
  let schedulerSpy: jest.SpiedFunction<() => void>;

  const buildStage = (): StepResponseCaptureStage => {
    const logger = createLogger();
    return new StepResponseCaptureStage(
      new GateVerdictProcessor(store, logger),
      new StepCaptureService(store, logger),
      store,
      new UnknownObservationProcessor(store, logger),
      logger
    );
  };

  const buildContext = (observations: unknown): ExecutionContext => {
    // Parse through the real tool schema so the batch under test is one a client could send.
    const parsed = schema.parse({ chain_id: 'chain-demo#1', observations });
    const context = new ExecutionContext({
      chain_id: parsed.chain_id,
      ...(parsed.observations === undefined ? {} : { observations: parsed.observations }),
    });
    context.sessionContext = {
      sessionId: 'sess-1',
      chainId: 'chain-demo',
      isChainExecution: true,
      currentStep: 1,
      totalSteps: 3,
    };
    return context;
  };

  beforeEach(async () => {
    saveSpy = jest
      .spyOn(ChainSessionStore.prototype as any, 'saveSessions')
      .mockResolvedValue(undefined) as unknown as jest.SpiedFunction<() => Promise<void>>;
    loadSpy = jest
      .spyOn(ChainSessionStore.prototype as any, 'loadSessions')
      .mockResolvedValue(undefined) as unknown as jest.SpiedFunction<() => Promise<void>>;
    schedulerSpy = jest
      .spyOn(ChainSessionStore.prototype as any, 'startCleanupScheduler')
      .mockImplementation(() => {}) as unknown as jest.SpiedFunction<() => void>;

    store = new ChainSessionStore(createLogger(), new TextReferenceStore(createLogger()), {
      serverRoot: '/tmp/test-unknown-observations-flow',
      cleanupIntervalMs: 1000,
    });
    await store.createSession('sess-1', 'chain-demo', 3);
  });

  afterEach(async () => {
    await store.cleanup();
    saveSpy.mockRestore();
    loadSpy.mockRestore();
    schedulerSpy.mockRestore();
  });

  test('a schema-valid batch reaches the ledger and this call’s chain context', async () => {
    const context = buildContext([
      {
        type: 'unknown_discovered',
        id: 'cache-ttl',
        statement: 'TTL for the new cache layer is undecided',
        blocking: true,
      },
    ]);

    await buildStage().execute(context);

    expect(context.response).toBeUndefined();
    expect(store.getSession('sess-1')?.unknownsLedger).toEqual([
      {
        id: 'cache-ttl',
        statement: 'TTL for the new cache layer is undecided',
        state: 'active',
        blocking: true,
        discoveredAtStep: 1,
      },
    ]);

    // The ledger must be readable by the render that follows in this same request.
    expect(context.state.session.chainContext?.['unknowns_ledger']).toEqual(
      store.getSession('sess-1')?.unknownsLedger
    );
  });

  test('discover then resolve in one batch closes the same entry', async () => {
    const context = buildContext([
      { type: 'unknown_discovered', id: 'cache-ttl', statement: 'TTL undecided' },
      {
        type: 'unknown_resolved',
        id: 'cache-ttl',
        statement: 'Owner picked 30s',
        resolution: 'answered',
      },
    ]);

    await buildStage().execute(context);

    expect(store.getSession('sess-1')?.unknownsLedger).toEqual([
      {
        id: 'cache-ttl',
        statement: 'TTL undecided',
        state: 'resolved',
        resolution: 'answered',
        resolutionStatement: 'Owner picked 30s',
        blocking: false,
        discoveredAtStep: 1,
        resolvedAtStep: 1,
      },
    ]);
  });

  test('resolving an unknown that was never declared is a tool-result error, not a throw', async () => {
    const context = buildContext([
      {
        type: 'unknown_resolved',
        id: 'never-declared',
        statement: 'done',
        resolution: 'answered',
      },
    ]);

    await expect(buildStage().execute(context)).resolves.toBeUndefined();

    expect(context.response?.isError).toBe(true);
    expect(context.response?.content?.[0]?.text).toContain('never-declared');
    expect(store.getSession('sess-1')?.unknownsLedger).toBeUndefined();
  });
});

/**
 * Render boundary: does `unknowns_ledger` on the chain context actually surface in the
 * text a step response contains? `ChainOperatorExecutor.renderStep` is the closest public
 * seam — same construction used by the executor's own unit tests — so this exercises
 * `buildUnknownsSection` through its real call sites (renderNormalStep) rather than as an
 * isolated unit.
 */
describe('unknowns ledger, rendered section', () => {
  const convertedPrompts: ConvertedPrompt[] = [
    {
      id: 'analyze',
      name: 'Code Analyzer',
      description: 'Analyze code',
      category: 'code',
      userMessageTemplate: 'Analyze this code: {{code}}',
      systemMessage: 'You are a code analyzer',
      arguments: [{ name: 'code', type: 'string', description: 'Code to analyze', required: true }],
    },
  ];

  const buildExecutor = (): ChainOperatorExecutor =>
    new ChainOperatorExecutor(createLogger(), convertedPrompts);

  test('section appears in the rendered step when the ledger is non-empty', async () => {
    const result = await buildExecutor().renderStep({
      executionType: 'normal',
      stepPrompts: [{ stepNumber: 1, promptId: 'analyze', args: { code: 'x' } }],
      currentStepIndex: 0,
      chainContext: {
        unknowns_ledger: [
          {
            id: 'cache-ttl',
            statement: 'TTL for the new cache layer is undecided',
            state: 'active',
            blocking: true,
            discoveredAtStep: 1,
          },
        ],
      },
    });

    expect(result.content).toContain('### Unknowns Ledger');
    expect(result.content).toContain('cache-ttl');
    expect(result.content).toContain('BLOCKING');
  });

  test('section is absent when the ledger key is missing', async () => {
    const result = await buildExecutor().renderStep({
      executionType: 'normal',
      stepPrompts: [{ stepNumber: 1, promptId: 'analyze', args: { code: 'x' } }],
      currentStepIndex: 0,
      chainContext: {},
    });

    expect(result.content).not.toContain('Unknowns Ledger');
  });

  test('section is absent when the ledger key is present but empty', async () => {
    const result = await buildExecutor().renderStep({
      executionType: 'normal',
      stepPrompts: [{ stepNumber: 1, promptId: 'analyze', args: { code: 'x' } }],
      currentStepIndex: 0,
      chainContext: { unknowns_ledger: [] },
    });

    expect(result.content).not.toContain('Unknowns Ledger');
  });
});

/**
 * In-memory `ChainRunRegistry` for exercising the real serialize -> save -> load path
 * (`ChainSessionStore`'s constructor accepts a registry via DI) without a SQLite engine.
 */
class InMemoryRunRegistry implements ChainRunRegistry {
  private blob: PersistedChainRunRegistry = {};

  async ensureInitialized(): Promise<void> {}

  async load(): Promise<PersistedChainRunRegistry> {
    return this.blob;
  }

  async save(store: PersistedChainRunRegistry): Promise<void> {
    this.blob = store;
  }
}

describe('unknowns ledger, persistence round-trip', () => {
  test('ledger survives a real serialize -> save -> load cycle across store instances', async () => {
    const registry = new InMemoryRunRegistry();
    const logger = createLogger();
    const textReferenceStore = new TextReferenceStore(logger);
    const options = {
      serverRoot: '/tmp/test-unknown-observations-roundtrip',
      cleanupIntervalMs: 1000,
    };

    const writer = new ChainSessionStore(logger, textReferenceStore, options, undefined, registry);
    await writer.createSession('sess-rt', 'chain-rt', 2);
    const writtenLedger = await writer.applyUnknownObservations('sess-rt', 1, [
      {
        type: 'unknown_discovered',
        id: 'cache-ttl',
        statement: 'TTL for the new cache layer is undecided',
        blocking: true,
      },
    ]);
    await writer.cleanup();

    const reader = new ChainSessionStore(logger, textReferenceStore, options, undefined, registry);
    // `initPromise` is private; every public read path (e.g. createSession) awaits it
    // internally, so this reaches into the same internal gate rather than re-implementing it.
    await (reader as unknown as { initPromise: Promise<void> }).initPromise;

    expect(reader.getSession('sess-rt')?.unknownsLedger).toEqual(writtenLedger);
    await reader.cleanup();
  });
});
