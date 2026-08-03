import { describe, expect, jest, test } from '@jest/globals';

import { isFrameworkInjected } from '../../../../src/engine/execution/pipeline/decisions/injection/framework-injection.js';
import { GateSetResolver } from '../../../../src/engine/gates/services/gate-set-resolver.js';

import type { GateResolutionInput } from '../../../../src/engine/gates/services/gate-set-resolver.js';
import type { ConvertedPrompt } from '../../../../src/engine/execution/types.js';

const createLogger = () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
});

/** Minimal ConvertedPrompt — only the fields the resolver reads. */
const makePrompt = (overrides: Partial<ConvertedPrompt> = {}): ConvertedPrompt =>
  ({
    id: 'demo',
    name: 'Demo',
    description: 'demo prompt',
    category: 'development',
    userMessageTemplate: 'hello',
    ...overrides,
  }) as ConvertedPrompt;

/**
 * Fake registry. `selectGates` is the single definition of the `registry-auto` tier (ADR 0001),
 * so the fake mirrors its real contract: framework-scoped gates are returned only when a
 * framework id is present in the selection context.
 */
const createGateManager = (categoryGates: string[] = [], frameworkScopedGates: string[] = []) =>
  ({
    selectGates: jest.fn((context: { framework?: string }) => ({
      selectedIds:
        context.framework !== undefined
          ? [...categoryGates, ...frameworkScopedGates]
          : [...categoryGates],
      guides: [],
      skippedIds: [],
      metadata: { selectionMethod: 'category', selectionTime: 0 },
    })),
  }) as unknown as Parameters<typeof buildResolver>[1];

const createGateLoader = (frameworkGateIds: string[] = []) =>
  ({
    getFrameworkGateIds: jest.fn(async () => frameworkGateIds),
  }) as unknown as Parameters<typeof buildResolver>[2];

function buildResolver(
  logger: ReturnType<typeof createLogger>,
  gateManager?: unknown,
  gateLoader?: unknown
): GateSetResolver {
  return new GateSetResolver(logger as never, gateManager as never, gateLoader as never);
}

const baseInput = (overrides: Partial<GateResolutionInput> = {}): GateResolutionInput => ({
  prompt: makePrompt(),
  category: 'development',
  frameworkInjected: true,
  ...overrides,
});

const sorted = (ids: readonly string[]): string[] => [...ids].sort();

/** All permutations of an array — used for the order-independence property. */
function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) {
    return [[...items]];
  }
  const result: T[][] = [];
  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const tail of permutations(rest)) {
      result.push([items[i] as T, ...tail]);
    }
  }
  return result;
}

describe('GateSetResolver — Stage 1 additive union', () => {
  test('unions every source and attributes duplicates to the highest rank', async () => {
    const resolver = buildResolver(createLogger(), createGateManager(['content-structure']));

    const result = await resolver.resolve(
      baseInput({
        prompt: makePrompt({ gateConfiguration: { include: ['code-quality'] } }),
        // same id supplied by a higher-ranked source
        inlineOperatorGateIds: ['code-quality'],
        callerGateIds: ['test-coverage'],
      })
    );

    expect(sorted(result.gateIds)).toEqual(['code-quality', 'content-structure', 'test-coverage']);
    // The duplicate collapses to ONE entry, attributed to the higher rank.
    expect(result.accepted.filter((gate) => gate.id === 'code-quality')).toHaveLength(1);
    expect(result.accepted.find((gate) => gate.id === 'code-quality')?.source).toBe(
      'inline-operator'
    );
  });

  test('a lower-ranked source never removes a gate — rank is provenance, not subtraction', async () => {
    const resolver = buildResolver(createLogger(), createGateManager(['content-structure']));

    const result = await resolver.resolve(baseInput({ inlineOperatorGateIds: ['code-quality'] }));

    // The rank-20 category gate survives alongside the rank-100 one.
    expect(sorted(result.gateIds)).toEqual(['code-quality', 'content-structure']);
  });

  test('skips blank and whitespace-only ids', async () => {
    const resolver = buildResolver(createLogger(), createGateManager());

    const result = await resolver.resolve(
      baseInput({ callerGateIds: ['  ', '', ' code-quality '] })
    );

    expect(result.gateIds).toEqual(['code-quality']);
  });
});

describe('GateSetResolver — Stage 2 veto binding ranks', () => {
  test('exclude removes a prompt-config gate', async () => {
    const resolver = buildResolver(createLogger(), createGateManager());

    const result = await resolver.resolve(
      baseInput({
        prompt: makePrompt({
          gateConfiguration: { include: ['test-coverage'], exclude: ['test-coverage'] },
        }),
      })
    );

    expect(result.gateIds).toEqual([]);
    expect(result.vetoed.get('test-coverage')).toBe('exclude');
  });

  test('exclude does NOT remove a caller-supplied gate (rank cap 60)', async () => {
    const resolver = buildResolver(createLogger(), createGateManager());

    const result = await resolver.resolve(
      baseInput({
        prompt: makePrompt({ gateConfiguration: { exclude: ['code-quality'] } }),
        callerGateIds: ['code-quality'],
      })
    );

    // A prompt author may not overrule the person invoking the prompt.
    expect(result.gateIds).toEqual(['code-quality']);
    expect(result.vetoed.size).toBe(0);
  });

  test('category-level exclude is honoured alongside prompt-level', async () => {
    const resolver = buildResolver(createLogger(), createGateManager(['content-structure']));

    const result = await resolver.resolve(
      baseInput({ categoryGateConfig: { exclude: ['content-structure'] } })
    );

    expect(result.gateIds).toEqual([]);
  });

  test('%clean removes every gate regardless of rank', async () => {
    const resolver = buildResolver(createLogger(), createGateManager(['content-structure']));

    const result = await resolver.resolve(
      baseInput({
        inlineOperatorGateIds: ['code-quality'],
        callerGateIds: ['test-coverage'],
        modifiers: { clean: true },
      })
    );

    expect(result.gateIds).toEqual([]);
    expect(result.vetoed.get('code-quality')).toBe('modifier-clean');
  });

  test('%lean keeps its gates — dropping them is not what lean means', async () => {
    const resolver = buildResolver(createLogger(), createGateManager(['content-structure']));

    const result = await resolver.resolve(baseInput({ modifiers: { lean: true } }));

    expect(result.gateIds).toEqual(['content-structure']);
  });

  test('framework nesting binds every rank, including the caller', async () => {
    const resolver = buildResolver(
      createLogger(),
      createGateManager(),
      createGateLoader(['framework-compliance'])
    );

    const result = await resolver.resolve(
      baseInput({
        frameworkInjected: false,
        inlineOperatorGateIds: ['framework-compliance'],
        callerGateIds: ['code-quality'],
      })
    );

    // Coherence invariant: nothing scores adherence to a framework that was not injected,
    // even when the caller asked for it by name at rank 100.
    expect(result.gateIds).toEqual(['code-quality']);
    expect(result.vetoed.get('framework-compliance')).toBe('framework-nesting');
  });

  test('framework_gates:false binds only up to rank 60, unlike nesting', async () => {
    const resolver = buildResolver(
      createLogger(),
      createGateManager(),
      createGateLoader(['framework-compliance'])
    );

    const optedOut = makePrompt({
      gateConfiguration: { framework_gates: false, include: ['framework-compliance'] },
    });

    const authorOwn = await resolver.resolve(
      baseInput({ prompt: optedOut, frameworkInjected: true })
    );
    expect(authorOwn.gateIds).toEqual([]);
    expect(authorOwn.vetoed.get('framework-compliance')).toBe('framework-gates-opt-out');

    const callerAsked = await resolver.resolve(
      baseInput({
        prompt: optedOut,
        frameworkInjected: true,
        callerGateIds: ['framework-compliance'],
      })
    );
    expect(callerAsked.gateIds).toEqual(['framework-compliance']);
  });

  test('no framework gate ids means no framework veto is built', async () => {
    const resolver = buildResolver(
      createLogger(),
      createGateManager(['content-structure']),
      createGateLoader([])
    );

    const result = await resolver.resolve(baseInput({ frameworkInjected: false }));

    expect(result.gateIds).toEqual(['content-structure']);
  });

  test('a failing gate loader degrades to no framework veto rather than throwing', async () => {
    const logger = createLogger();
    const failingLoader = {
      getFrameworkGateIds: jest.fn(async () => {
        throw new Error('definitions unreadable');
      }),
    };
    const resolver = buildResolver(logger, createGateManager(['content-structure']), failingLoader);

    const result = await resolver.resolve(baseInput({ frameworkInjected: false }));

    expect(result.gateIds).toEqual(['content-structure']);
    expect(logger.warn).toHaveBeenCalled();
  });
});

describe('GateSetResolver — fixes delivered by routing enhancement through one owner', () => {
  test('exclude now removes a registry-activated gate', async () => {
    const resolver = buildResolver(createLogger(), createGateManager(['content-structure']));

    const result = await resolver.resolve(
      baseInput({
        prompt: makePrompt({ gateConfiguration: { exclude: ['content-structure'] } }),
      })
    );

    // Previously the planner honoured this exclude and the enhancement stage then re-added the
    // same gate at rank 20 with no exclude applied, so the gate came back.
    expect(result.gateIds).toEqual([]);
    expect(result.vetoed.get('content-structure')).toBe('exclude');
  });

  test('framework_gates:false removes a framework-tier gate, not just a planned one', async () => {
    const resolver = buildResolver(
      createLogger(),
      createGateManager(),
      createGateLoader(['framework-compliance'])
    );

    const result = await resolver.resolve(
      baseInput({
        prompt: makePrompt({ gateConfiguration: { framework_gates: false } }),
        // rank 40 — the tier the opt-out previously could not reach
        frameworkGateIds: ['framework-compliance'],
      })
    );

    expect(result.gateIds).toEqual([]);
    expect(result.vetoed.get('framework-compliance')).toBe('framework-gates-opt-out');
  });

  test('frameworkGatesEnabled:false binds every rank, including the caller', async () => {
    const resolver = buildResolver(
      createLogger(),
      createGateManager(['content-structure']),
      createGateLoader(['framework-compliance'])
    );

    const result = await resolver.resolve(
      baseInput({
        frameworkGatesEnabled: false,
        inlineOperatorGateIds: ['framework-compliance'],
      })
    );

    // Operator configuration, not an author preference — it outranks an explicit request.
    expect(result.gateIds).toEqual(['content-structure']);
    expect(result.vetoed.get('framework-compliance')).toBe('framework-gates-disabled');
  });

  test('plannedGateIds join the prompt-config tier and are vetoable by exclude', async () => {
    const resolver = buildResolver(createLogger(), createGateManager());

    const result = await resolver.resolve(
      baseInput({
        prompt: makePrompt({ gateConfiguration: { exclude: ['test-coverage'] } }),
        plannedGateIds: ['code-quality', 'test-coverage'],
      })
    );

    expect(result.gateIds).toEqual(['code-quality']);
    expect(result.accepted[0]?.source).toBe('prompt-config');
  });

  test('knownFrameworkGateIds is used in place of a registry read', async () => {
    const loader = createGateLoader(['should-not-be-read']);
    const resolver = buildResolver(createLogger(), createGateManager(), loader);

    const result = await resolver.resolve(
      baseInput({
        frameworkInjected: false,
        knownFrameworkGateIds: ['framework-compliance'],
        plannedGateIds: ['framework-compliance', 'code-quality'],
      })
    );

    expect(result.gateIds).toEqual(['code-quality']);
    expect(
      (loader as unknown as { getFrameworkGateIds: jest.Mock }).getFrameworkGateIds
    ).not.toHaveBeenCalled();
  });

  test('a throwing registry degrades to no registry gates instead of failing resolution', async () => {
    const logger = createLogger();
    const throwingManager = {
      selectGates: jest.fn(() => {
        throw new Error('registry unavailable');
      }),
    };
    const resolver = buildResolver(logger, throwingManager);

    const result = await resolver.resolve(baseInput({ callerGateIds: ['code-quality'] }));

    expect(result.gateIds).toEqual(['code-quality']);
    expect(logger.warn).toHaveBeenCalled();
  });
});

describe('GateSetResolver — order independence (ADR 0001 Stage 2)', () => {
  test('the accepted set is invariant under permutation of the input ids', async () => {
    const resolver = buildResolver(
      createLogger(),
      createGateManager(['content-structure']),
      createGateLoader(['framework-compliance'])
    );
    const ids = ['code-quality', 'test-coverage', 'framework-compliance'];

    const results: string[][] = [];
    for (const permutation of permutations(ids)) {
      const result = await resolver.resolve(
        baseInput({
          prompt: makePrompt({
            gateConfiguration: { include: [...permutation], exclude: ['test-coverage'] },
          }),
          frameworkInjected: false,
        })
      );
      results.push(sorted(result.gateIds));
    }

    // 6 permutations, one outcome. Both vetoes (exclude, framework-nesting) fire on the same
    // input, and neither ordering of them changes the result.
    expect(results).toHaveLength(6);
    for (const outcome of results) {
      expect(outcome).toEqual(['code-quality', 'content-structure']);
    }
  });

  test('two vetoes rejecting the same gate agree on removing it', async () => {
    const resolver = buildResolver(
      createLogger(),
      createGateManager(),
      createGateLoader(['framework-compliance'])
    );

    const result = await resolver.resolve(
      baseInput({
        prompt: makePrompt({
          gateConfiguration: {
            include: ['framework-compliance'],
            exclude: ['framework-compliance'],
            framework_gates: false,
          },
        }),
        frameworkInjected: false,
      })
    );

    expect(result.gateIds).toEqual([]);
    // Which veto gets the credit is unspecified; that the gate is gone is not.
    expect(result.vetoed.has('framework-compliance')).toBe(true);
  });
});

describe('GateSetResolver — refactor baseline', () => {
  test('a prompt with no gate config resolves to its category gates alone', async () => {
    const resolver = buildResolver(createLogger(), createGateManager(['content-structure']));

    const result = await resolver.resolve(baseInput());

    expect(result.gateIds).toEqual(['content-structure']);
    expect(result.vetoed.size).toBe(0);
    expect(result.accepted[0]?.source).toBe('registry-auto');
  });

  test('resolves to an empty set when nothing is configured and no GateManager is wired', async () => {
    const resolver = buildResolver(createLogger());

    const result = await resolver.resolve(baseInput());

    expect(result.gateIds).toEqual([]);
  });

  test('registry-auto yields framework-scoped gates only when a frameworkId is supplied', async () => {
    const resolver = buildResolver(
      createLogger(),
      createGateManager(['content-structure'], ['framework-compliance'])
    );

    // No framework in context — the registry's AND logic withholds the framework gate, so a
    // caller does not need a narrower query to get category gates only.
    const withoutFramework = await resolver.resolve(baseInput());
    expect(withoutFramework.gateIds).toEqual(['content-structure']);

    const withFramework = await resolver.resolve(baseInput({ frameworkId: 'CAGEERF' }));
    expect(sorted(withFramework.gateIds)).toEqual(['content-structure', 'framework-compliance']);
  });

  test('a framework-scoped registry gate is still subject to the nesting veto', async () => {
    const resolver = buildResolver(
      createLogger(),
      createGateManager(['content-structure'], ['framework-compliance']),
      createGateLoader(['framework-compliance'])
    );

    const result = await resolver.resolve(
      baseInput({ frameworkId: 'CAGEERF', frameworkInjected: false })
    );

    expect(result.gateIds).toEqual(['content-structure']);
    expect(result.vetoed.get('framework-compliance')).toBe('framework-nesting');
  });

  test('autoAssignCategoryGates:false suppresses the registry-auto tier only', async () => {
    const resolver = buildResolver(createLogger(), createGateManager(['content-structure']));

    const result = await resolver.resolve(
      baseInput({ autoAssignCategoryGates: false, callerGateIds: ['code-quality'] })
    );

    expect(result.gateIds).toEqual(['code-quality']);
  });
});

describe('GateSetResolver — framework nesting driven by the real signal (plan item 2.4)', () => {
  // These compose the projection with the resolver rather than passing `frameworkInjected`
  // by hand. The hand-written cases above prove the veto works; these prove the signal that
  // reaches it in production is derived, not the literal `true` T1.5 shipped.

  const resolveWith = async (
    modifiers: Parameters<typeof isFrameworkInjected>[0]['modifiers'],
    prompt = makePrompt()
  ) => {
    const resolver = buildResolver(
      createLogger(),
      createGateManager(['content-structure'], ['framework-compliance']),
      createGateLoader(['framework-compliance'])
    );

    return resolver.resolve(
      baseInput({
        prompt,
        frameworkId: 'CAGEERF',
        modifiers: modifiers as GateResolutionInput['modifiers'],
        frameworkInjected: isFrameworkInjected({
          modifiers,
          promptInjection: prompt.injection,
        }),
      })
    );
  };

  test('%lean schedules zero framework-dependent gates — the T2 gate criterion', async () => {
    const result = await resolveWith({ lean: true });

    expect(result.gateIds).not.toContain('framework-compliance');
    expect(result.vetoed.get('framework-compliance')).toBe('framework-nesting');
  });

  test('%lean leaves non-framework gates untouched', async () => {
    const result = await resolveWith({ lean: true });

    // %lean is documented as keeping gates. What it must stop keeping is the gate that scores
    // adherence to a framework it suppressed — not every gate.
    expect(result.gateIds).toContain('content-structure');
  });

  test('no modifier keeps framework gates scheduled', async () => {
    const result = await resolveWith(undefined);

    expect(sorted(result.gateIds)).toEqual(['content-structure', 'framework-compliance']);
  });

  test('a prompt opting out of the framework loses its framework gates', async () => {
    const optedOut = makePrompt({
      injection: { 'system-prompt': { enabled: false } },
    });

    const result = await resolveWith(undefined, optedOut);

    expect(result.gateIds).toEqual(['content-structure']);
    expect(result.vetoed.get('framework-compliance')).toBe('framework-nesting');
  });

  test('%judge keeps framework gates, since it forces the framework in', async () => {
    const result = await resolveWith({ judge: true });

    expect(result.gateIds).toContain('framework-compliance');
  });
});
