// @lifecycle canonical - InlineGateProcessor's restore-time gate-id remap, unknown-gate suggestion warning and `verify:` budget resolution, driven through its public methods.
/**
 * `remapRegisteredGateIds` is reached in production only through the `pipeline-builder.ts`
 * closure, so no jest test observed it. Here it runs against a fake run-gate store (the boundary)
 * and asserts the map the store receives. The shell-verify cases read `context.state.gates`, which
 * is where the formatting stage reads the resolved budget.
 */
import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import { ExecutionContext } from '../../../../src/engine/execution/context/execution-context.js';
import { TemporaryGateRegistry } from '../../../../src/engine/gates/core/temporary-gate-registry.js';
import { InlineGateProcessor } from '../../../../src/engine/gates/services/inline-gate-processor.js';

import type { ParsedCommand } from '../../../../src/engine/execution/context/index.js';
import type { GateReferenceResolver } from '../../../../src/engine/gates/services/gate-reference-resolver.js';
import type { ShellVerifyGate } from '../../../../src/engine/gates/shell/index.js';
import type { Logger } from '../../../../src/infra/logging/index.js';
import type { McpToolRequest } from '../../../../src/shared/types/index.js';

const makeLogger = () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
});

type RemapCall = [string, ReadonlyMap<string, string>];

/** A run-gate store that records every `remapRunGates` call. */
const makeStore = () => {
  const calls: RemapCall[] = [];
  return {
    calls,
    store: {
      remapRunGates: async (runId: string, remap: ReadonlyMap<string, string>) => {
        calls.push([runId, remap]);
      },
    },
  };
};

const inlineResolver = {
  resolve: async (ref: string) => ({ referenceType: 'inline', criteria: ref }),
} as unknown as GateReferenceResolver;

const contextInRun = (runId: string | undefined): ExecutionContext => {
  const context = new ExecutionContext({ command: '>>demo' } as McpToolRequest);
  if (runId !== undefined) context.state.session.resumeSessionId = runId;
  return context;
};

const commandWith = (overrides: Partial<ParsedCommand>): ParsedCommand =>
  ({
    promptId: 'demo',
    rawArgs: '',
    format: 'symbolic',
    confidence: 1,
    metadata: {
      originalCommand: '>>demo',
      parseStrategy: 'symbolic',
      detectedFormat: 'symbolic',
      warnings: [],
    },
    ...overrides,
  }) as unknown as ParsedCommand;

describe('InlineGateProcessor.remapRegisteredGateIds', () => {
  const registered = new Map([['declared', 'declared-2']]);
  let logger: ReturnType<typeof makeLogger>;

  const build = (
    currentRemap?: (runId: string) => Readonly<Record<string, string>>,
    resolver: GateReferenceResolver = inlineResolver
  ) => {
    const { calls, store } = makeStore();
    const registry = new TemporaryGateRegistry(logger as unknown as Logger, {
      isCanonicalGateId: () => false,
    });
    const processor = new InlineGateProcessor(
      registry,
      resolver,
      logger as unknown as Logger,
      store,
      currentRemap
    );
    return { calls, processor, registry };
  };

  beforeEach(() => {
    logger = makeLogger();
  });

  test('positive control: a run with registered ids reaches the store', async () => {
    const { calls, processor } = build(() => ({}));
    await processor.remapRegisteredGateIds(contextInRun('run-1'), registered);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe('run-1');
  });

  test('a call with no run id writes nothing, even without a remap provider', async () => {
    const { calls, processor } = build(undefined);
    await expect(
      processor.remapRegisteredGateIds(contextInRun(undefined), registered)
    ).resolves.toBeUndefined();
    expect(calls).toEqual([]);
  });

  test('nothing registered writes nothing, even without a remap provider', async () => {
    const provider = jest.fn(() => ({ a: 'b' }));
    const { calls, processor } = build(provider);
    await processor.remapRegisteredGateIds(contextInRun('run-1'), new Map());
    expect(calls).toEqual([]);
    expect(provider).not.toHaveBeenCalled();
  });

  test('registered ids without a remap provider are refused, and nothing is written', async () => {
    const { calls, processor } = build(undefined);
    await expect(
      processor.remapRegisteredGateIds(contextInRun('run-1'), registered)
    ).rejects.toThrow('Restored inline gates require the current run gate remap');
    expect(calls).toEqual([]);
  });

  test('composes the registered ids over the remap the run already carries', async () => {
    const provider = jest.fn((runId: string) => ({
      'earlier-claim': 'earlier-fresh',
      declared: 'stale-physical',
      [`only-${runId}`]: 'kept',
    }));
    const { calls, processor } = build(provider);

    await processor.remapRegisteredGateIds(
      contextInRun('run-7'),
      new Map([
        ['declared', 'declared-2'],
        ['second', 'second-3'],
      ])
    );

    expect(provider).toHaveBeenCalledWith('run-7');
    expect(calls).toHaveLength(1);
    const [runId, composed] = calls[0] as RemapCall;
    expect(runId).toBe('run-7');
    // The registered id wins over the carried one; carried entries it does not name survive.
    expect(Object.fromEntries(composed)).toEqual({
      'earlier-claim': 'earlier-fresh',
      declared: 'declared-2',
      'only-run-7': 'kept',
      second: 'second-3',
    });
  });
});

describe('InlineGateProcessor: an unknown gate reference with suggestions', () => {
  const resolverReturning = (resolution: Record<string, unknown>) =>
    ({ resolve: async () => resolution }) as unknown as GateReferenceResolver;

  const run = async (resolution: Record<string, unknown>, criteria: string[]) => {
    const logger = makeLogger();
    const registry = new TemporaryGateRegistry(logger as unknown as Logger, {
      isCanonicalGateId: () => false,
    });
    const processor = new InlineGateProcessor(
      registry,
      resolverReturning(resolution),
      logger as unknown as Logger,
      makeStore().store
    );
    const command = commandWith({ inlineGateCriteria: criteria });
    const result = await processor.processInlineGates(contextInRun('run-1'), command);
    return { logger, registry, command, result };
  };

  test('warns with the suggestions and still enforces the text as an inline criterion', async () => {
    const { logger, registry, result, command } = await run(
      { referenceType: 'inline', criteria: 'secruity', suggestions: ['security', 'secrets'] },
      ['secruity']
    );

    expect(logger.warn).toHaveBeenCalledWith(
      '[InlineGateProcessor] Unknown gate "secruity". Did you mean: security, secrets?'
    );
    expect(result.createdIds).toHaveLength(1);
    expect(command.inlineGateIds).toEqual(result.createdIds);
    expect(registry.getTemporaryGate(result.createdIds[0] as string)?.pass_criteria).toEqual([
      'secruity',
    ]);
  });

  test.each([
    ['no suggestions', undefined],
    ['an empty suggestion list', []],
  ])('does not warn with %s', async (_label, suggestions) => {
    const { logger, result } = await run(
      { referenceType: 'inline', criteria: 'plain text', suggestions },
      ['plain text']
    );
    expect(logger.warn).not.toHaveBeenCalled();
    expect(result.createdIds).toHaveLength(1);
  });

  test('a reference resolved to a registered gate is recorded, not turned into a criterion', async () => {
    const { logger, registry, result, command } = await run(
      { referenceType: 'registered', gateId: 'code-quality', suggestions: ['ignored'] },
      ['code-quality']
    );
    expect(logger.warn).not.toHaveBeenCalled();
    expect(result.registeredIds).toEqual(['code-quality']);
    expect(result.createdIds).toEqual([]);
    expect(command.inlineGateIds).toEqual(['code-quality']);
    expect(registry.getTemporaryGate('code-quality')).toBeUndefined();
  });

  test('a resolver failure warns and keeps the text as an inline criterion', async () => {
    const logger = makeLogger();
    const registry = new TemporaryGateRegistry(logger as unknown as Logger, {
      isCanonicalGateId: () => false,
    });
    const processor = new InlineGateProcessor(
      registry,
      {
        resolve: async () => {
          throw new Error('catalog offline');
        },
      } as unknown as GateReferenceResolver,
      logger as unknown as Logger,
      makeStore().store
    );
    const result = await processor.processInlineGates(
      contextInRun('run-1'),
      commandWith({ inlineGateCriteria: ['be concise'] })
    );
    expect(logger.warn).toHaveBeenCalledWith(
      '[InlineGateProcessor] Failed to resolve gate reference',
      { entry: 'be concise', error: 'catalog offline' }
    );
    expect(registry.getTemporaryGate(result.createdIds[0] as string)?.pass_criteria).toEqual([
      'be concise',
    ]);
  });
});

describe('InlineGateProcessor: a `verify:` gate resolves its budget', () => {
  const verifyGate = (shellVerify: Partial<ShellVerifyGate>) => ({
    gateId: 'tests-pass',
    shellVerify: { command: 'npm test', ...shellVerify },
  });

  const setup = (
    shellVerify: Partial<ShellVerifyGate>,
    context: ExecutionContext = contextInRun('run-1'),
    overrides: Partial<ParsedCommand> = {}
  ) => {
    const logger = makeLogger();
    const registry = new TemporaryGateRegistry(logger as unknown as Logger, {
      isCanonicalGateId: () => false,
    });
    const processor = new InlineGateProcessor(
      registry,
      inlineResolver,
      logger as unknown as Logger,
      makeStore().store
    );
    const command = commandWith({
      namedInlineGates: [verifyGate(shellVerify)] as unknown as ParsedCommand['namedInlineGates'],
      ...overrides,
    });
    return { context, registry, run: () => processor.processInlineGates(context, command) };
  };

  test('with no preset or override it takes the shipped defaults', async () => {
    const { context, registry, run } = setup({});
    const result = await run();

    expect(context.state.gates.pendingShellVerification).toMatchObject({
      gateId: 'tests-pass',
      attemptCount: 0,
      maxAttempts: 5,
      shellVerify: { command: 'npm test', timeout: 300000, maxIterations: 5 },
    });
    expect(context.state.gates.shellVerifyBudget).toEqual({ maxAttempts: 5, timeoutMs: 300000 });
    // A verify gate registers nothing and creates no inline gate.
    expect(result).toEqual({ createdIds: [], registeredIds: [], namedCount: 1 });
    expect(registry.getTemporaryGate('tests-pass')).toBeUndefined();
  });

  test('the fast preset replaces the defaults and is published on the budget', async () => {
    const { context, run } = setup({ preset: 'fast' });
    await run();

    expect(context.state.gates.pendingShellVerification).toMatchObject({
      maxAttempts: 1,
      shellVerify: { timeout: 30000, maxIterations: 1, preset: 'fast' },
    });
    expect(context.state.gates.shellVerifyBudget).toEqual({
      maxAttempts: 1,
      timeoutMs: 30000,
      preset: 'fast',
    });
  });

  test('explicit maxIterations and timeout win over the preset', async () => {
    const { context, run } = setup({ preset: 'fast', maxIterations: 3, timeout: 1234 });
    await run();

    expect(context.state.gates.pendingShellVerification).toMatchObject({
      maxAttempts: 3,
      shellVerify: { timeout: 1234, maxIterations: 3 },
    });
    expect(context.state.gates.shellVerifyBudget).toEqual({
      maxAttempts: 3,
      timeoutMs: 1234,
      preset: 'fast',
    });
  });

  test('a preset that is not configured falls back to the defaults', async () => {
    const { context, run } = setup({ preset: 'nonexistent' as unknown as 'fast' });
    await run();

    expect(context.state.gates.shellVerifyBudget).toEqual({
      maxAttempts: 5,
      timeoutMs: 300000,
      preset: 'nonexistent',
    });
  });

  describe('the goal the loop is told to keep working toward', () => {
    const goalOf = (context: ExecutionContext) =>
      context.state.gates.pendingShellVerification?.originalGoal;

    test('prefers the parsed command text', async () => {
      const context = contextInRun('run-1');
      context.parsedCommand = commandWith({});
      await setup({}, context).run();
      expect(goalOf(context)).toBe('>>demo');
    });

    test('falls back to the request command, then the prompt id, then a generic goal', async () => {
      const fromRequest = new ExecutionContext({ command: '>>from-request' } as McpToolRequest);
      await setup({}, fromRequest).run();
      expect(goalOf(fromRequest)).toBe('>>from-request');

      const fromPrompt = new ExecutionContext({} as McpToolRequest);
      fromPrompt.parsedCommand = commandWith({ metadata: undefined, promptId: 'prompt-x' });
      await setup({}, fromPrompt).run();
      expect(goalOf(fromPrompt)).toBe('prompt-x');

      const bare = new ExecutionContext({} as McpToolRequest);
      await setup({}, bare).run();
      expect(goalOf(bare)).toBe('Fix verification failures');
    });
  });
});
