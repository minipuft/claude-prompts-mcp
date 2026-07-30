// @lifecycle canonical - Unit tests for inline gate definition registration (plan item 3.2)
import { describe, expect, it, jest } from '@jest/globals';

import { GateSetResolver } from '../../../../src/engine/gates/services/gate-set-resolver.js';
import { TemporaryGateRegistrar } from '../../../../src/engine/gates/services/temporary-gate-registrar.js';

import type { ConvertedPrompt } from '../../../../src/engine/execution/types.js';

const createLogger = () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
});

/** Minimal in-memory stand-in for TemporaryGateRegistry, honouring id assignment and lookup. */
const createRegistry = () => {
  const gates = new Map<string, Record<string, unknown>>();
  let autoId = 0;

  return {
    gates,
    createTemporaryGate: jest.fn((definition: Record<string, unknown>) => {
      autoId += 1;
      const id = typeof definition['id'] === 'string' ? definition['id'] : `temp_${autoId}`;
      gates.set(id, { ...definition, id });
      return id;
    }),
    getTemporaryGate: jest.fn((id: string) => gates.get(id)),
  };
};

const createContext = () => ({
  state: { gates: {} as Record<string, unknown> },
  mcpRequest: { chain_id: undefined as string | undefined },
  getSessionId: () => 'session-1',
});

const buildRegistrar = (registry: unknown, logger: ReturnType<typeof createLogger>) =>
  new TemporaryGateRegistrar(registry as never, undefined, logger as never);

/**
 * Register with the release-N+1 flag ON. The flag itself is covered separately below; every other
 * test here is about what happens once it is armed.
 */
const register = (
  registrar: TemporaryGateRegistrar,
  context: unknown,
  prompts: unknown[]
): string[] => registrar.registerInlineGateDefinitions(context as never, prompts as never, true);

const promptWith = (definitions: unknown, id = 'demo'): ConvertedPrompt =>
  ({
    id,
    name: 'Demo',
    description: 'demo',
    category: 'development',
    userMessageTemplate: 'hi',
    gateConfiguration: { inline_gate_definitions: definitions },
  }) as unknown as ConvertedPrompt;

const validDefinition = (overrides: Record<string, unknown> = {}) => ({
  name: 'Section Contract',
  type: 'validation',
  scope: 'execution',
  description: 'Checks the section contract holds',
  guidance: 'Verify every declared section is present',
  ...overrides,
});

describe('TemporaryGateRegistrar.registerInlineGateDefinitions', () => {
  it('registers a definition and returns its canonical id', () => {
    const registry = createRegistry();
    const registrar = buildRegistrar(registry, createLogger());

    const ids = register(registrar, createContext() as never, [
      promptWith([validDefinition({ id: 'section-contract' })]),
    ]);

    expect(ids).toEqual(['section-contract']);
    expect(registry.gates.get('section-contract')).toMatchObject({
      name: 'Section Contract',
      type: 'validation',
      scope: 'execution',
    });
  });

  it('accepts a definition with no declared id, taking a registry-assigned one', () => {
    const registry = createRegistry();
    const registrar = buildRegistrar(registry, createLogger());

    const ids = register(registrar, createContext() as never, [promptWith([validDefinition()])]);

    expect(ids).toHaveLength(1);
    expect(ids[0]).toMatch(/^temp_/);
  });

  it('records the registered ids on pipeline state', () => {
    const registry = createRegistry();
    const context = createContext();

    register(buildRegistrar(registry, createLogger()), context as never, [
      promptWith([validDefinition({ id: 'g1' })]),
    ]);

    expect(context.state.gates['temporaryGateIds']).toEqual(['g1']);
  });

  it('registers every step prompt in a chain', () => {
    const registry = createRegistry();
    const registrar = buildRegistrar(registry, createLogger());

    const ids = register(registrar, createContext() as never, [
      promptWith([validDefinition({ id: 'step-one-gate' })], 'step_one'),
      promptWith([validDefinition({ id: 'step-two-gate' })], 'step_two'),
    ]);

    expect(ids).toEqual(['step-one-gate', 'step-two-gate']);
  });

  it('tolerates an undefined step prompt without dropping its siblings', () => {
    const registry = createRegistry();
    const registrar = buildRegistrar(registry, createLogger());

    const ids = register(registrar, createContext() as never, [
      undefined,
      promptWith([validDefinition({ id: 'survivor' })]),
    ]);

    expect(ids).toEqual(['survivor']);
  });

  it('returns nothing for a prompt with no definitions', () => {
    const registry = createRegistry();
    const registrar = buildRegistrar(registry, createLogger());

    expect(register(registrar, createContext() as never, [promptWith(undefined)])).toEqual([]);
    expect(registry.createTemporaryGate).not.toHaveBeenCalled();
  });

  describe('the release-N default (ADR 0001 (d))', () => {
    it('registers nothing when execution is not enabled', () => {
      // This is the shipped default. Definitions are display-only for one release while the
      // loader's warnings give operators visibility into what would arm.
      const registry = createRegistry();
      const registrar = buildRegistrar(registry, createLogger());
      const context = createContext();

      const ids = registrar.registerInlineGateDefinitions(
        context as never,
        [promptWith([validDefinition({ id: 'section-contract' })])] as never,
        false
      );

      expect(ids).toEqual([]);
      expect(registry.createTemporaryGate).not.toHaveBeenCalled();
      expect(context.state.gates['temporaryGateIds']).toBeUndefined();
    });
  });

  describe('per-field body override on an id collision (ADR 0001 (b))', () => {
    it('merges over an already-registered body, narrowing its criteria', () => {
      const registry = createRegistry();
      registry.gates.set('shared', {
        id: 'shared',
        name: 'Shared',
        description: 'registry description',
        guidance: 'registry guidance',
        pass_criteria: ['one', 'two', 'three'],
      });
      const registrar = buildRegistrar(registry, createLogger());

      register(registrar, createContext() as never, [
        promptWith([
          validDefinition({ id: 'shared', guidance: 'prompt guidance', pass_criteria: ['one'] }),
        ]),
      ]);

      const stored = registry.gates.get('shared');
      // Declared fields replace; the array replaces rather than appending.
      expect(stored?.['guidance']).toBe('prompt guidance');
      expect(stored?.['pass_criteria']).toEqual(['one']);
    });
  });

  describe('containment', () => {
    it('warns and skips a definition with no name rather than throwing', () => {
      const registry = createRegistry();
      const logger = createLogger();
      const registrar = buildRegistrar(registry, logger);

      const ids = register(registrar, createContext() as never, [
        promptWith([{ type: 'validation', scope: 'execution' }]),
      ]);

      expect(ids).toEqual([]);
      expect(logger.warn).toHaveBeenCalled();
    });

    it('keeps sibling definitions when one fails to register', () => {
      const registry = createRegistry();
      let call = 0;
      registry.createTemporaryGate = jest.fn((definition: Record<string, unknown>) => {
        call += 1;
        if (call === 1) {
          throw new Error('registry rejected this gate');
        }
        return String(definition['id'] ?? 'generated');
      }) as never;
      const logger = createLogger();

      const ids = register(buildRegistrar(registry, logger), createContext() as never, [
        promptWith([validDefinition({ id: 'boom' }), validDefinition({ id: 'fine' })]),
      ]);

      // One registration failure must not take the prompt's other gates out of service.
      expect(ids).toEqual(['fine']);
      expect(logger.warn).toHaveBeenCalled();
    });

    it('warns and returns nothing when no registry is available', () => {
      const logger = createLogger();
      const registrar = new TemporaryGateRegistrar(undefined, undefined, logger as never);

      const ids = register(registrar, createContext() as never, [promptWith([validDefinition()])]);

      expect(ids).toEqual([]);
      expect(logger.warn).toHaveBeenCalled();
    });
  });
});

describe('inline definitions reach the resolved gate set at rank 60', () => {
  // The T3 gate criterion: the names appear in the EXECUTED set, not only in response text.

  const buildResolver = () => new GateSetResolver(createLogger() as never, undefined, undefined);

  const baseInput = (overrides: Record<string, unknown> = {}) =>
    ({
      prompt: promptWith(undefined),
      category: 'development',
      frameworkInjected: true,
      autoAssignCategoryGates: false,
      ...overrides,
    }) as never;

  it('includes registered inline ids, attributed to prompt-config', async () => {
    const result = await buildResolver().resolve(
      baseInput({ inlineDefinitionGateIds: ['section-contract'] })
    );

    expect(result.gateIds).toContain('section-contract');
    expect(result.accepted.find((gate) => gate.id === 'section-contract')?.source).toBe(
      'prompt-config'
    );
  });

  it('does not outrank a caller-supplied gate of the same id', async () => {
    // Rank 60, deliberately not 80: an inline definition must not displace the attribution of a
    // gate the person invoking the prompt asked for.
    const result = await buildResolver().resolve(
      baseInput({
        inlineDefinitionGateIds: ['shared'],
        callerGateIds: ['shared'],
      })
    );

    expect(result.accepted.filter((gate) => gate.id === 'shared')).toHaveLength(1);
    expect(result.accepted.find((gate) => gate.id === 'shared')?.source).toBe('temporary-request');
  });

  it('is removable by a prompt-level exclude, which binds rank 60', async () => {
    const result = await buildResolver().resolve(
      baseInput({
        prompt: {
          ...(promptWith(undefined) as unknown as Record<string, unknown>),
          gateConfiguration: { exclude: ['section-contract'] },
        },
        inlineDefinitionGateIds: ['section-contract'],
      })
    );

    expect(result.gateIds).not.toContain('section-contract');
    expect(result.vetoed.get('section-contract')).toBe('exclude');
  });

  it('resolves byte-identically when a prompt declares none', async () => {
    const withField = await buildResolver().resolve(baseInput({ inlineDefinitionGateIds: [] }));
    const withoutField = await buildResolver().resolve(baseInput());

    expect(withField.gateIds).toEqual(withoutField.gateIds);
  });
});
