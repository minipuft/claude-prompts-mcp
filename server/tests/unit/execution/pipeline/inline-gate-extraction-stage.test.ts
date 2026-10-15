import { describe, expect, jest, test } from '@jest/globals';

import { ExecutionContext } from '../../../../src/engine/execution/context/execution-context.js';
import { InlineGateExtractionStage } from '../../../../src/engine/execution/pipeline/stages/05-inline-gate-stage.js';
import { InlineGateProcessor } from '../../../../src/engine/gates/services/inline-gate-processor.js';
import { RequestGateAdmission } from '../../../../src/engine/gates/services/request-gate-admission.js';
import { TemporaryGateRegistrar } from '../../../../src/engine/gates/services/temporary-gate-registrar.js';

import type { TemporaryGateRegistry } from '../../../../src/engine/gates/core/temporary-gate-registry.js';
import type { GateReferenceResolver } from '../../../../src/engine/gates/services/gate-reference-resolver.js';
import type { Logger } from '../../../../src/infra/logging/index.js';

const createLogger = (): Logger => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
});

const createRegistry = (overrides?: {
  createTemporaryGate?: jest.Mock;
  getTemporaryGate?: jest.Mock;
}) => {
  const createTemporaryGate =
    overrides?.createTemporaryGate ?? jest.fn().mockReturnValue('temp_gate');
  const getTemporaryGate = overrides?.getTemporaryGate ?? jest.fn();
  return {
    // No run holds a declared key here: every named gate registers (R49's view is empty).
    registry: {
      createTemporaryGate,
      getTemporaryGate,
      resolveDeclared: jest.fn(),
      // No canonical gate here: no named gate is refused (R100).
      canonicalIdRefusal: () => undefined,
    } as unknown as TemporaryGateRegistry,
    createTemporaryGate,
    getTemporaryGate,
  };
};

const createResolver = (
  impl?: (
    ref: string
  ) => Promise<{ referenceType: 'inline' | 'registered'; criteria?: string; gateId?: string }>
) => {
  const resolve = jest
    .fn<(ref: string) => Promise<any>>()
    .mockImplementation((ref) =>
      impl ? impl(ref) : Promise.resolve({ referenceType: 'inline', criteria: ref })
    );
  return {
    resolver: { resolve } as unknown as GateReferenceResolver,
    resolve,
  };
};

/** The gate switches stage 05's admission reads; every gate runs unless a case turns one off. */
interface GateSwitchState {
  configEnabled?: boolean;
  runtimeEnabled?: boolean;
}

const createStage = (
  registry: TemporaryGateRegistry,
  resolver: GateReferenceResolver,
  switches: GateSwitchState = {}
): InlineGateExtractionStage => {
  const logger = createLogger();
  const inlineGateProcessor = new InlineGateProcessor(registry, resolver, logger, {
    remapRunGates: async () => undefined,
  });
  const admission = new RequestGateAdmission(
    new TemporaryGateRegistrar(registry, resolver, logger),
    () => ({
      enabled: switches.configEnabled ?? true,
      definitionsDirectory: 'gates',
      enableFrameworkGates: true,
    }),
    () => switches.runtimeEnabled ?? true
  );
  return new InlineGateExtractionStage(inlineGateProcessor, logger, admission);
};

describe('InlineGateExtractionStage', () => {
  test('creates temporary inline gate for single prompt criteria', async () => {
    const { registry, createTemporaryGate } = createRegistry();
    const { resolver } = createResolver();
    const stage = createStage(registry, resolver);

    const context = new ExecutionContext({ command: '>>demo :: "Be concise"' });
    context.parsedCommand = {
      promptId: 'demo',
      rawArgs: '',
      format: 'symbolic',
      confidence: 0.9,
      metadata: {
        originalCommand: '>>demo',
        parseStrategy: 'symbolic',
        detectedFormat: 'symbolic',
        warnings: [],
      },
      inlineGateCriteria: ['Be concise'],
    };

    await stage.execute(context);

    expect(createTemporaryGate).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'execution',
        guidance: expect.stringContaining('Be concise'),
      }),
      expect.stringContaining('command')
    );
    expect(context.parsedCommand.inlineGateIds).toContain('temp_gate');
    expect(context.state.gates.temporaryGateIds).toEqual(['temp_gate']);
  });

  test('registers chain step gates with step scope and merges resolver output', async () => {
    const { registry, createTemporaryGate } = createRegistry();
    const { resolver, resolve } = createResolver(async (ref) => {
      if (ref === 'research-quality') {
        return { referenceType: 'registered', gateId: 'research-quality' };
      }
      return { referenceType: 'inline', criteria: ref };
    });
    const stage = createStage(registry, resolver);

    const context = new ExecutionContext({ command: '>>chain' });
    context.parsedCommand = {
      promptId: 'chain',
      rawArgs: '',
      format: 'symbolic',
      confidence: 0.9,
      metadata: {
        originalCommand: '>>chain',
        parseStrategy: 'symbolic',
        detectedFormat: 'symbolic',
        warnings: [],
      },
      commandType: 'chain',
      steps: [
        {
          stepNumber: 1,
          promptId: 'step_one',
          args: {},
          inlineGateCriteria: ['research-quality', 'Check dependencies'],
        },
      ],
    };

    await stage.execute(context);

    expect(resolve).toHaveBeenCalledWith('research-quality');
    expect(createTemporaryGate).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'step',
        description: expect.stringContaining('step 1'),
      }),
      expect.stringContaining('step_1')
    );
    const stepGates = context.parsedCommand?.steps?.[0].inlineGateIds ?? [];
    expect(stepGates).toEqual(expect.arrayContaining(['research-quality', 'temp_gate']));
    expect(context.state.gates.registeredInlineGateIds).toEqual(['research-quality']);
  });

  test('reuses registered temporary gate definitions when inline criteria matches gate ID', async () => {
    const gateDefinition = {
      id: 'custom_quality_gate',
      name: 'Custom Quality Gate',
      type: 'quality' as const,
      scope: 'execution' as const,
      description: 'Ensure bespoke structure',
      guidance: 'Follow the custom gate guidance',
      created_at: Date.now(),
      source: 'manual' as const,
    };

    const { registry, getTemporaryGate } = createRegistry({
      getTemporaryGate: jest.fn().mockReturnValue(gateDefinition),
    });
    const { resolver, resolve } = createResolver();
    const stage = createStage(registry, resolver);

    const context = new ExecutionContext({ command: '>>demo :: custom_quality_gate' });
    context.parsedCommand = {
      promptId: 'demo',
      rawArgs: '',
      format: 'symbolic',
      confidence: 0.9,
      metadata: {
        originalCommand: '>>demo',
        parseStrategy: 'symbolic',
        detectedFormat: 'symbolic',
        warnings: [],
      },
      inlineGateCriteria: ['custom_quality_gate'],
    };

    await stage.execute(context);

    expect(getTemporaryGate).toHaveBeenCalledWith('custom_quality_gate');
    expect(resolve).not.toHaveBeenCalled();
    expect(context.state.gates.registeredInlineGateIds).toEqual(['custom_quality_gate']);
    expect(context.parsedCommand?.inlineGateIds).toContain('custom_quality_gate');
  });

  test('skips string gate IDs from unified gates parameter (handled in gate-enhancement stage)', async () => {
    const { registry, createTemporaryGate } = createRegistry();
    const { resolver } = createResolver();
    const stage = createStage(registry, resolver);

    const context = new ExecutionContext({ command: '>>demo' });
    context.state.gates.requestedOverrides = {
      gates: ['toxicity', 'code-quality'],
    };
    context.parsedCommand = {
      promptId: 'demo',
      rawArgs: '',
      format: 'symbolic',
      confidence: 0.9,
      metadata: {
        originalCommand: '>>demo',
        parseStrategy: 'symbolic',
        detectedFormat: 'symbolic',
        warnings: [],
      },
    };

    await stage.execute(context);

    // String IDs are skipped in this stage (handled in gate-enhancement-stage)
    expect(createTemporaryGate).not.toHaveBeenCalled();
    expect(context.state.gates.temporaryGateIds).toEqual([]);
  });

  test('skips CustomCheck objects from unified gates parameter (converted in gate-enhancement stage)', async () => {
    const { registry, createTemporaryGate } = createRegistry();
    const { resolver } = createResolver();
    const stage = createStage(registry, resolver);

    const context = new ExecutionContext({ command: '>>demo' });
    context.state.gates.requestedOverrides = {
      gates: [{ name: 'red-team', description: 'Confirm exfil path' }],
    };
    context.parsedCommand = {
      promptId: 'demo',
      rawArgs: '',
      format: 'symbolic',
      confidence: 0.9,
      metadata: {
        originalCommand: '>>demo',
        parseStrategy: 'symbolic',
        detectedFormat: 'symbolic',
        warnings: [],
      },
    };

    await stage.execute(context);

    // CustomCheck objects are skipped in this stage (converted to temp gates in gate-enhancement-stage)
    expect(createTemporaryGate).not.toHaveBeenCalled();
    expect(context.state.gates.temporaryGateIds).toEqual([]);
  });

  test('skips TemporaryGateInput objects from unified gates parameter (now handled in gate-enhancement stage)', async () => {
    const { registry, createTemporaryGate } = createRegistry();
    const { resolver } = createResolver();
    const stage = createStage(registry, resolver);

    const context = new ExecutionContext({ command: '>>demo' });
    context.state.gates.requestedOverrides = {
      gates: [{ id: 'gdpr-check', criteria: ['no PII'], severity: 'high' }],
    };
    context.parsedCommand = {
      promptId: 'demo',
      rawArgs: '',
      format: 'symbolic',
      confidence: 0.9,
      metadata: {
        originalCommand: '>>demo',
        parseStrategy: 'symbolic',
        detectedFormat: 'symbolic',
        warnings: [],
      },
    };

    await stage.execute(context);

    // InlineGateExtractionStage now focuses only on inline :: gates
    // All gates from the 'gates' parameter are handled by GateEnhancementStage (GateEnhancementStage)
    expect(createTemporaryGate).not.toHaveBeenCalled();
    expect(context.state.gates.temporaryGateIds).toEqual([]);
  });

  test('skips all gate types from unified gates parameter (all handled in gate-enhancement stage)', async () => {
    const { registry, createTemporaryGate } = createRegistry();
    const { resolver } = createResolver();
    const stage = createStage(registry, resolver);

    const context = new ExecutionContext({ command: '>>demo' });
    context.state.gates.requestedOverrides = {
      gates: [
        'toxicity', // String ID
        { name: 'red-team', description: 'Confirm exfil path' }, // CustomCheck
        { id: 'gdpr-check', criteria: ['no PII'], severity: 'high' }, // TemporaryGateInput
      ],
    };
    context.parsedCommand = {
      promptId: 'demo',
      rawArgs: '',
      format: 'symbolic',
      confidence: 0.9,
      metadata: {
        originalCommand: '>>demo',
        parseStrategy: 'symbolic',
        detectedFormat: 'symbolic',
        warnings: [],
      },
    };

    await stage.execute(context);

    // InlineGateExtractionStage now focuses only on inline :: gates
    // ALL gates from the 'gates' parameter (strings, CustomChecks, and TemporaryGateInputs)
    // are handled by GateEnhancementStage (GateEnhancementStage) for unified processing
    expect(createTemporaryGate).not.toHaveBeenCalled();
    expect(context.state.gates.temporaryGateIds).toEqual([]);
  });

  // NOTE: Tests for canonical gate handling from 'gates' parameter were removed.
  // This functionality is now consolidated in GateEnhancementStage (GateEnhancementStage).
  // InlineGateExtractionStage focuses solely on extracting inline gates from the :: operator.
  // See tests/unit/execution/pipeline/gate-enhancement-stage.test.ts for canonical gate tests.

  test('creates named inline gates with explicit IDs from symbolic syntax', async () => {
    const { registry, createTemporaryGate } = createRegistry();
    const { resolver } = createResolver();
    const stage = createStage(registry, resolver);

    const context = new ExecutionContext({ command: '>>demo :: security:"no secrets"' });
    context.parsedCommand = {
      promptId: 'demo',
      rawArgs: '',
      format: 'symbolic',
      confidence: 0.9,
      metadata: {
        originalCommand: '>>demo :: security:"no secrets"',
        parseStrategy: 'symbolic',
        detectedFormat: 'symbolic',
        warnings: [],
      },
      namedInlineGates: [
        { gateId: 'security', criteria: ['no secrets'] },
        { gateId: 'perf', criteria: ['efficient algorithms'] },
      ],
    };

    await stage.execute(context);

    expect(createTemporaryGate).toHaveBeenCalledTimes(2);
    expect(createTemporaryGate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'security',
        name: 'security',
        pass_criteria: ['no secrets'],
      }),
      expect.any(String),
      { onIdCollision: 'fresh-id' }
    );
    expect(context.parsedCommand?.inlineGateIds).toContain('temp_gate');
    expect(context.state.gates.temporaryGateIds?.length).toBeGreaterThan(0);
  });

  test('sets up shell verification state for verify gates (Ralph Wiggum loops)', async () => {
    const { registry, createTemporaryGate } = createRegistry();
    const { resolver } = createResolver();
    const stage = createStage(registry, resolver);

    const context = new ExecutionContext({ command: '>>demo :: verify:"npm test"' });
    context.parsedCommand = {
      promptId: 'demo',
      rawArgs: '',
      format: 'symbolic',
      confidence: 0.9,
      metadata: {
        originalCommand: '>>demo :: verify:"npm test"',
        parseStrategy: 'symbolic',
        detectedFormat: 'symbolic',
        warnings: [],
      },
      namedInlineGates: [
        {
          gateId: 'shell-verify-12345',
          criteria: ['Shell verification: npm test'],
          shellVerify: {
            command: 'npm test',
            timeout: 60000,
          },
        },
      ],
    };

    await stage.execute(context);

    // Shell verification gates should NOT create regular inline gates
    expect(createTemporaryGate).not.toHaveBeenCalled();
    expect(context.parsedCommand?.inlineGateIds ?? []).toHaveLength(0);

    // Instead, they should set up pendingShellVerification state
    const pending = context.state.gates.pendingShellVerification;
    expect(pending).toBeDefined();
    expect(pending?.gateId).toBe('shell-verify-12345');
    expect(pending?.shellVerify.command).toBe('npm test');
    expect(pending?.shellVerify.timeout).toBe(60000);
    expect(pending?.attemptCount).toBe(0);
    expect(pending?.maxAttempts).toBe(5);
  });

  test('skips shell verification setup when shellVerify is missing', async () => {
    const { registry, createTemporaryGate } = createRegistry();
    const { resolver } = createResolver();
    const stage = createStage(registry, resolver);

    const context = new ExecutionContext({ command: '>>demo :: verify:"test"' });
    context.parsedCommand = {
      promptId: 'demo',
      rawArgs: '',
      format: 'symbolic',
      confidence: 0.9,
      metadata: {
        originalCommand: '>>demo :: verify:"test"',
        parseStrategy: 'symbolic',
        detectedFormat: 'symbolic',
        warnings: [],
      },
      // Note: namedInlineGates has gateId but NO shellVerify - should create regular gate
      namedInlineGates: [
        {
          gateId: 'verify',
          criteria: ['test'],
          // shellVerify is NOT present
        },
      ],
    };

    await stage.execute(context);

    // Should create a regular inline gate since shellVerify is missing
    expect(createTemporaryGate).toHaveBeenCalledTimes(1);
    expect(createTemporaryGate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'verify',
        name: 'verify',
      }),
      expect.any(String),
      { onIdCollision: 'fresh-id' }
    );

    // Should NOT set up shell verification
    expect(context.state.gates.pendingShellVerification).toBeUndefined();
  });
});

describe('an inline gate the client requested is refused or registered, never dropped (R11.8)', () => {
  const SYNTAX = 'Accepted forms: `:: "criterion"`, `:: id:"criterion"`, `:: verify:"command"`.';

  const commandWith = (gates: {
    inlineGateCriteria?: string[];
    namedInlineGates?: Array<{ gateId: string; criteria: string[] }>;
    steps?: Array<{ nodeId?: string; inlineGateCriteria: string[] }>;
  }) => {
    const context = new ExecutionContext({ command: '>>demo' });
    context.parsedCommand = {
      promptId: 'demo',
      rawArgs: '',
      format: 'symbolic',
      confidence: 0.9,
      metadata: {
        originalCommand: '>>demo',
        parseStrategy: 'symbolic',
        detectedFormat: 'symbolic',
        warnings: [],
      },
      ...(gates.inlineGateCriteria !== undefined
        ? { inlineGateCriteria: gates.inlineGateCriteria }
        : {}),
      ...(gates.namedInlineGates !== undefined ? { namedInlineGates: gates.namedInlineGates } : {}),
      ...(gates.steps !== undefined
        ? {
            commandType: 'chain' as const,
            steps: gates.steps.map((step, index) => ({
              stepNumber: index + 1,
              promptId: `step_${index + 1}`,
              args: {},
              ...step,
            })),
          }
        : {}),
    };
    return context;
  };

  const run = async (context: ExecutionContext) => {
    const { registry, createTemporaryGate } = createRegistry();
    await createStage(registry, createResolver().resolver).execute(context);
    return { createTemporaryGate, text: (context.response?.content[0] as { text: string })?.text };
  };

  test('an empty criterion on a step is refused, addressed to its node, and registers nothing', async () => {
    const context = commandWith({
      steps: [
        { nodeId: 'draft', inlineGateCriteria: ['cites sources'] },
        { nodeId: 'review', inlineGateCriteria: [''] },
      ],
    });
    const { createTemporaryGate, text } = await run(context);

    expect(context.response?.isError).toBe(true);
    expect(text).toContain(
      '• [gate-criteria-invalid] node "review": inline gate on step 2 has the criterion "", which is empty.'
    );
    expect(text).toContain(SYNTAX);
    // Nothing is created for the request: not even the valid step's gate.
    expect(createTemporaryGate).not.toHaveBeenCalled();
    expect(context.state.gates.temporaryGateIds).toEqual([]);
  });

  test('a blank criterion on the command is refused, quoting it', async () => {
    const context = commandWith({ inlineGateCriteria: ['Be concise', '   '] });
    const { createTemporaryGate, text } = await run(context);

    expect(context.response?.isError).toBe(true);
    expect(text).toContain(
      '• [gate-criteria-invalid] workflow: inline gate has the criterion "   ", which is blank.'
    );
    expect(text).toContain(SYNTAX);
    expect(createTemporaryGate).not.toHaveBeenCalled();
  });

  test('a named gate left with no criterion (`:: security:"  "`) is refused by name', async () => {
    const context = commandWith({ namedInlineGates: [{ gateId: 'security', criteria: [] }] });
    const { createTemporaryGate, text } = await run(context);

    expect(context.response?.isError).toBe(true);
    expect(text).toContain(
      '• [gate-criteria-invalid] workflow: named inline gate "security" carries no criterion: the text between its quotes is blank.'
    );
    expect(text).toContain(SYNTAX);
    expect(createTemporaryGate).not.toHaveBeenCalled();
  });

  test('control: valid criteria register and set no response', async () => {
    const context = commandWith({
      inlineGateCriteria: ['Be concise'],
      namedInlineGates: [{ gateId: 'security', criteria: ['no secrets'] }],
      steps: [{ nodeId: 'draft', inlineGateCriteria: ['cites sources'] }],
    });
    const { createTemporaryGate } = await run(context);

    expect(context.response).toBeUndefined();
    expect(createTemporaryGate).toHaveBeenCalledTimes(3);
  });

  test('control: an empty criteria list is no gate, not a refusal', async () => {
    // The command builder writes `[]` on a step that declared no gate.
    const context = commandWith({ steps: [{ nodeId: 'draft', inlineGateCriteria: [] }] });
    const { createTemporaryGate } = await run(context);

    expect(context.response).toBeUndefined();
    expect(createTemporaryGate).not.toHaveBeenCalled();
  });

  test.each([
    ['anonymous criteria', { inlineGateCriteria: ['Be concise'] }],
    ['a named gate', { namedInlineGates: [{ gateId: 'security', criteria: ['no secrets'] }] }],
  ])(
    '%s whose registration throws fails the call instead of running without it',
    async (_n, gates) => {
      const createTemporaryGate = jest.fn(() => {
        throw new Error('registry refused the gate');
      });
      const { registry } = createRegistry({ createTemporaryGate });
      const context = commandWith(gates);

      await expect(
        createStage(registry, createResolver().resolver).execute(context)
      ).rejects.toThrow('registry refused the gate');
      expect(createTemporaryGate).toHaveBeenCalledTimes(1);
    }
  );
});

describe('a request gate whose registration throws fails the call (R11.8)', () => {
  test('the registry error propagates instead of the gate being skipped', async () => {
    const createTemporaryGate = jest.fn<() => string>(() => {
      throw new Error('registry refused the gate');
    });
    const registry = {
      createTemporaryGate,
      getTemporaryGate: jest.fn(),
      resolveDeclared: jest.fn(),
      getRunGates: jest.fn(() => []),
    } as unknown as TemporaryGateRegistry;
    const context = new ExecutionContext({ command: '>>demo' });
    context.state.gates.requestedOverrides = {
      gates: [{ id: 'rg-1', name: 'rg-1', criteria: ['REQUEST'] }],
    };
    const registrar = new TemporaryGateRegistrar(registry, undefined, createLogger());

    await expect(registrar.registerTemporaryGates(context)).rejects.toThrow(
      'registry refused the gate'
    );
    // Control: once the registry accepts, the same call registers the gate.
    createTemporaryGate.mockImplementation(() => 'rg-1');
    expect((await registrar.registerTemporaryGates(context)).temporaryGateIds).toEqual(['rg-1']);
  });
});

describe("stage 05 refuses the call's own gate requests before anything registers", () => {
  const callWith = (
    gates: unknown[],
    extra: { modifiers?: { clean?: boolean }; operators?: unknown[] } = {}
  ): ExecutionContext => {
    const context = new ExecutionContext({ command: '>>demo', gates: gates as never });
    context.state.gates.requestedOverrides = { gates };
    context.parsedCommand = {
      promptId: 'demo',
      rawArgs: '',
      format: 'symbolic',
      confidence: 0.9,
      metadata: {
        originalCommand: '>>demo',
        parseStrategy: 'symbolic',
        detectedFormat: 'symbolic',
        warnings: [],
      },
      inlineGateCriteria: ['Be concise'],
      ...(extra.modifiers !== undefined ? { modifiers: extra.modifiers } : {}),
      ...(extra.operators !== undefined
        ? { operators: { operators: extra.operators } as never }
        : {}),
    };
    return context;
  };
  const textOf = (context: ExecutionContext): string =>
    (context.response?.content[0] as { text: string } | undefined)?.text ?? '';

  test('a blank request gate refuses the call by entry, and no inline gate registers', async () => {
    const { registry, createTemporaryGate } = createRegistry();
    const context = callWith([
      { id: 'cites', criteria: ['Cites a source'] },
      { name: 'Tone', description: '   ' },
    ]);

    await createStage(registry, createResolver().resolver).execute(context);

    expect(context.response?.isError).toBe(true);
    expect(textOf(context)).toContain(
      '• [gate-criteria-invalid] workflow: request gate 2 (name "Tone")'
    );
    expect(textOf(context)).toContain('Nothing was executed and no run was created.');
    expect(createTemporaryGate).not.toHaveBeenCalled();
  });

  test("a `::` criterion under the call's own %clean is refused, naming the modifier", async () => {
    const { registry, createTemporaryGate } = createRegistry();
    const context = callWith([], {
      modifiers: { clean: true },
      operators: [{ type: 'gate', criteria: 'Be concise' }],
    });

    await createStage(registry, createResolver().resolver).execute(context);

    expect(context.response?.isError).toBe(true);
    expect(textOf(context)).toContain('• [gate-suppressed] workflow: %clean runs without gates');
    expect(textOf(context)).toContain(':: "Be concise"');
    expect(createTemporaryGate).not.toHaveBeenCalled();
  });

  test.each([
    ['configuration', { configEnabled: false }, 'gates are disabled by configuration'],
    ['the runtime switch', { runtimeEnabled: false }, 'the gate system is disabled'],
  ])('a request gate with gates off by %s is refused', async (_, switches, cause) => {
    const { registry } = createRegistry();
    const context = callWith([{ id: 'cites', criteria: ['Cites a source'] }]);

    await createStage(registry, createResolver().resolver, switches).execute(context);

    expect(context.response?.isError).toBe(true);
    expect(textOf(context)).toContain('[gate-suppressed]');
    expect(textOf(context)).toContain(cause);
  });

  test('control: a valid request gate is admitted, and the inline gate registers', async () => {
    const { registry, createTemporaryGate } = createRegistry();
    const context = callWith([{ id: 'cites', criteria: ['Cites a source'] }]);

    await createStage(registry, createResolver().resolver).execute(context);

    expect(context.response).toBeUndefined();
    expect(createTemporaryGate).toHaveBeenCalledTimes(1);
  });

  test('control: %clean with no requested gate is admitted (stage 11 skips it)', async () => {
    const { registry } = createRegistry();
    const context = callWith([], { modifiers: { clean: true } });
    context.parsedCommand!.inlineGateCriteria = [];

    await createStage(registry, createResolver().resolver).execute(context);

    expect(context.response).toBeUndefined();
  });
});
