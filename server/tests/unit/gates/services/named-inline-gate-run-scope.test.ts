// @lifecycle canonical - P6.97 / R43: a named inline gate belongs to the run that declared it. P6.110: one name in two segments is two gates.
/**
 * MEASURED 2026-09-25 on `a5ea0338` (driven, one server): `>>sv_chain :: g97:"CRIT-ONE"`, then a
 * second run `>>sv_chain :: g97:"CRIT-TWO"` rendered and reviewed `CRIT-ONE`. The registry threw
 * "Temporary gate ID already exists", `createNamedInlineGate` swallowed it, and each step's folded
 * `g97` then resolved to the first run's gate by name. Nothing removes that gate at the end of a
 * call (stage 22 never runs after stage 21 sets the response), so the collision is the normal case.
 *
 * Now the named path registers with `onIdCollision: 'fresh-id'`, and the steps resolve the name
 * through the run's own declaration before the registry.
 */
import { describe, expect, jest, test } from '@jest/globals';

import { ExecutionContext } from '../../../../src/engine/execution/context/execution-context.js';
import { TemporaryGateRegistry } from '../../../../src/engine/gates/core/temporary-gate-registry.js';
import { InlineGateProcessor } from '../../../../src/engine/gates/services/inline-gate-processor.js';

import type { ParsedCommand } from '../../../../src/engine/execution/context/index.js';
import type { GateReferenceResolver } from '../../../../src/engine/gates/services/gate-reference-resolver.js';
import type { Logger } from '../../../../src/infra/logging/index.js';

const logger = (): Logger => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
});

const inlineResolver = {
  resolve: async (ref: string) => ({ referenceType: 'inline', criteria: ref }),
} as unknown as GateReferenceResolver;

const newGate = (criteria: string[]) => ({
  name: 'g',
  type: 'validation' as const,
  scope: 'execution' as const,
  description: 'd',
  guidance: 'g',
  pass_criteria: criteria,
  source: 'automatic' as const,
  id: 'g97',
});

/** A chain-prompt command after the P6.78 fold: the named gate's id on every step's criteria. */
const foldedChain = (criteria: string): ParsedCommand =>
  ({
    promptId: 'sv_chain',
    rawArgs: '',
    format: 'symbolic',
    confidence: 1,
    metadata: {
      originalCommand: '',
      parseStrategy: 'symbolic',
      detectedFormat: 'symbolic',
      warnings: [],
    },
    namedInlineGates: [{ gateId: 'g97', criteria: [criteria] }],
    steps: [1, 2].map((stepNumber) => ({
      stepNumber,
      promptId: stepNumber === 1 ? 'sv_a' : 'sv_b',
      args: {},
      inlineGateIds: ['sv-block'],
      inlineGateCriteria: ['g97'],
    })),
  }) as unknown as ParsedCommand;

describe('TemporaryGateRegistry: a caller-chosen id already held', () => {
  test('throws by default', () => {
    const registry = new TemporaryGateRegistry(logger());
    registry.createTemporaryGate(newGate(['ONE']));
    expect(() => registry.createTemporaryGate(newGate(['TWO']))).toThrow(
      'Temporary gate ID already exists: g97'
    );
  });

  test("'fresh-id' registers under the first free suffix and leaves the held gate untouched", () => {
    const registry = new TemporaryGateRegistry(logger());
    const fresh = { onIdCollision: 'fresh-id' } as const;
    expect(registry.createTemporaryGate(newGate(['ONE']), undefined, fresh)).toBe('g97');
    expect(registry.createTemporaryGate(newGate(['TWO']), undefined, fresh)).toBe('g97-2');
    expect(registry.createTemporaryGate(newGate(['THREE']), undefined, fresh)).toBe('g97-3');
    expect(registry.getTemporaryGate('g97')?.pass_criteria).toEqual(['ONE']);
    expect(registry.getTemporaryGate('g97-2')?.pass_criteria).toEqual(['TWO']);
  });
});

describe('InlineGateProcessor: two runs declaring one named gate id', () => {
  test("each run's steps bind the gate that run declared", async () => {
    const registry = new TemporaryGateRegistry(logger());
    const processor = new InlineGateProcessor(registry, inlineResolver, logger());

    const first = foldedChain('CRIT-ONE');
    await processor.processInlineGates(new ExecutionContext({ command: 'run 1' }), first);
    const second = foldedChain('CRIT-TWO');
    await processor.processInlineGates(new ExecutionContext({ command: 'run 2' }), second);

    expect(first.steps?.map((step) => step.inlineGateIds)).toEqual([
      ['sv-block', 'g97'],
      ['sv-block', 'g97'],
    ]);
    expect(second.inlineGateIds).toEqual(['g97-2']);
    expect(second.steps?.map((step) => step.inlineGateIds)).toEqual([
      ['sv-block', 'g97-2'],
      ['sv-block', 'g97-2'],
    ]);
    expect(registry.getTemporaryGate('g97')?.pass_criteria).toEqual(['CRIT-ONE']);
    expect(registry.getTemporaryGate('g97-2')?.pass_criteria).toEqual(['CRIT-TWO']);
  });
});

/**
 * P6.110: one named id in two arrow-chain segments with different criteria. MEASURED 2026-09-26
 * on `35959ffb` (driven): both registered (`g110`, `g110-2`), and both segments bound `g110-2`,
 * because the declared-name map kept the last. The parser now writes `g110` on the first segment
 * and `g110#2` on the second (`namedGateBindingKey`), and the processor keys by occurrence.
 */
describe('InlineGateProcessor: one name declared in two segments', () => {
  const twoSegments = (secondKey: string): ParsedCommand =>
    ({
      promptId: 'sv_a',
      rawArgs: '',
      format: 'symbolic',
      confidence: 1,
      metadata: {
        originalCommand: '',
        parseStrategy: 'symbolic',
        detectedFormat: 'symbolic',
        warnings: [],
      },
      namedInlineGates: [
        { gateId: 'g110', criteria: ['ONE'] },
        { gateId: 'g110', criteria: ['TWO'] },
      ],
      steps: [
        { stepNumber: 1, promptId: 'sv_a', args: {}, inlineGateCriteria: ['g110'] },
        { stepNumber: 2, promptId: 'sv_b', args: {}, inlineGateCriteria: [secondKey] },
      ],
    }) as unknown as ParsedCommand;

  test('each segment binds the gate it declared', async () => {
    const registry = new TemporaryGateRegistry(logger());
    const processor = new InlineGateProcessor(registry, inlineResolver, logger());
    const command = twoSegments('g110#2');
    await processor.processInlineGates(new ExecutionContext({ command: 'run' }), command);

    expect(command.steps?.map((step) => step.inlineGateIds)).toEqual([['g110'], ['g110-2']]);
    expect(registry.getTemporaryGate('g110')?.pass_criteria).toEqual(['ONE']);
    expect(registry.getTemporaryGate('g110-2')?.pass_criteria).toEqual(['TWO']);
  });

  test('control: a second segment naming the plain id binds the first declaration', async () => {
    const registry = new TemporaryGateRegistry(logger());
    const processor = new InlineGateProcessor(registry, inlineResolver, logger());
    const command = twoSegments('g110');
    await processor.processInlineGates(new ExecutionContext({ command: 'run' }), command);

    expect(command.steps?.map((step) => step.inlineGateIds)).toEqual([['g110'], ['g110']]);
  });
});
