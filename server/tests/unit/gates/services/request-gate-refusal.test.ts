// @lifecycle canonical - R11.8: a request gate (`gates` / `workflow.gates`) that cannot register is refused by entry, never skipped.
/**
 * MEASURED 2026-10-12 on `ca0df3bf`: `registerTemporaryGates` logged "Skipping gate with no usable
 * content" and went on for `{id:"cites", description:""}` and `{name:"Tone", description:"   "}`
 * (the schema's `min(1)` admits whitespace), skipped a blank string gate `"   "` without a word, and
 * registered `{id:"no-such-gate"}` — an id naming no gate, carrying nothing — as a placeholder whose
 * only guidance was the server's own default text, "Temporary gate criteria". Each time the run
 * started without the gate the client asked for.
 *
 * Now `invalidRequestGates` names each such entry (position, id or name) and what a valid entry
 * looks like, so stage 11 refuses the call before anything registers, and the registration loop
 * throws if it ever meets one regardless.
 */
import { describe, expect, jest, test } from '@jest/globals';

import { PromptRequestContext } from '../../../../src/engine/execution/context/prompt-request-context.js';
import { TemporaryGateRegistry } from '../../../../src/engine/gates/core/temporary-gate-registry.js';
import { InlineGateProcessor } from '../../../../src/engine/gates/services/inline-gate-processor.js';
import { TemporaryGateRegistrar } from '../../../../src/engine/gates/services/temporary-gate-registrar.js';

import type { ParsedCommand } from '../../../../src/engine/execution/context/index.js';

import type { GateReferenceResolver } from '../../../../src/engine/gates/services/gate-reference-resolver.js';
import type { Logger } from '../../../../src/infra/logging/index.js';

const logger = (): Logger =>
  ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) as never;

/** `code-quality` is the one registered gate; anything else is inline criteria. */
const resolver = {
  resolve: async (ref: string) =>
    ref.trim() === 'code-quality'
      ? { referenceType: 'registered', gateId: 'code-quality' }
      : { referenceType: 'inline', criteria: ref },
} as unknown as GateReferenceResolver;

const newRegistry = (): TemporaryGateRegistry =>
  new TemporaryGateRegistry(logger(), { isCanonicalGateId: (id) => id === 'code-quality' });

/** A call of the run `runId` (undefined: the call that starts a run) carrying request `gates`. */
const callOf = (gates: unknown[], runId?: string): PromptRequestContext => {
  const context = new PromptRequestContext({ command: '>>demo' });
  context.state.gates.requestedOverrides = { gates };
  if (runId !== undefined) context.state.session.resumeSessionId = runId;
  return context;
};

describe('a request gate that cannot register is refused, by entry (R11.8)', () => {
  test.each([
    ['a blank string', ['   '], 'request gate 1 ("   ")', 'blank'],
    [
      'an id whose only content is blank',
      [{ id: 'cites', description: '' }],
      'request gate 1 (id "cites")',
      'carries no criterion, guidance or description',
    ],
    [
      'a quick gate whose description is blank',
      ['Cites a source', { name: 'Tone', description: '   ' }],
      'request gate 2 (name "Tone")',
      'carries no criterion, guidance or description',
    ],
    [
      'a blank criteria entry',
      [{ id: 'cites', criteria: ['Cites a source', '  '] }],
      'request gate 1 (id "cites")',
      'has the criteria entry "  ", which is blank',
    ],
    [
      'a blank id beside real criteria',
      [{ id: '  ', criteria: ['Cites a source'] }],
      'request gate 1 (id "  ")',
      'has a blank id',
    ],
    [
      'an id naming no gate and carrying nothing',
      [{ id: 'no-such-gate' }],
      'request gate 1 (id "no-such-gate")',
      'names no registered gate and no gate this run holds',
    ],
  ])('%s', async (_, gates, address, problem) => {
    const registry = newRegistry();
    const registrar = new TemporaryGateRegistrar(registry, resolver, logger());
    const context = callOf(gates);

    const refusals = await registrar.invalidRequestGates(context);

    expect(refusals).toHaveLength(1);
    expect(refusals[0]?.detail).toContain(address);
    expect(refusals[0]?.detail).toContain(problem);
    // What to send instead travels with every refusal.
    expect(refusals[0]?.detail).toContain('criteria:["');
    // And the loop never skips one quietly if a caller registers without asking first.
    await expect(registrar.registerTemporaryGates(context)).rejects.toThrow(
      /request gate 1|R11\.8/
    );
  });

  test('control: valid request gates are not refused, and register', async () => {
    const registry = newRegistry();
    const registrar = new TemporaryGateRegistrar(registry, resolver, logger());
    const context = callOf([
      'Cites a source',
      'code-quality',
      { id: 'code-quality' },
      { id: 'cites', criteria: ['Every claim cites a primary source'] },
      { name: 'Tone', description: 'Neutral register' },
    ]);

    expect(await registrar.invalidRequestGates(context)).toEqual([]);
    const result = await registrar.registerTemporaryGates(context);

    expect(result.canonicalGateIds).toEqual(['code-quality']);
    expect(registry.getTemporaryGate('cites')?.pass_criteria).toEqual([
      'Every claim cites a primary source',
    ]);
    expect(result.temporaryGateIds).toHaveLength(3);
  });

  test('control: an id-only entry naming a gate this run holds is that gate, even with a blank description', async () => {
    const registry = newRegistry();
    const registrar = new TemporaryGateRegistrar(registry, resolver, logger());
    const started = await registrar.registerTemporaryGates(
      callOf([{ id: 'cites', criteria: ['Every claim cites a primary source'] }])
    );
    registry.adoptIntoRun('run-1', started.temporaryGateIds);

    for (const resent of [
      { id: 'cites' },
      { id: 'cites', description: '' },
      { id: 'cites', criteria: ['  '] },
    ]) {
      const resume = callOf([resent], 'run-1');
      expect(await registrar.invalidRequestGates(resume)).toEqual([]);
      expect((await registrar.registerTemporaryGates(resume)).temporaryGateIds).toEqual(['cites']);
    }
  });

  test('a blank guidance does not shadow a description that says something', async () => {
    const registry = newRegistry();
    const registrar = new TemporaryGateRegistrar(registry, resolver, logger());
    const context = callOf([{ id: 'cites', guidance: '   ', description: 'Cites a source' }]);

    expect(await registrar.invalidRequestGates(context)).toEqual([]);
    await registrar.registerTemporaryGates(context);

    expect(registry.getTemporaryGate('cites')?.guidance).toBe('Cites a source');
  });

  test('with no registry, a gate that must register fails the call instead of vanishing', async () => {
    const registrar = new TemporaryGateRegistrar(undefined, resolver, logger());

    await expect(registrar.registerTemporaryGates(callOf(['Cites a source']))).rejects.toThrow(
      /no temporary gate registry/
    );
    // Control: a canonical reference needs no registry.
    await expect(registrar.registerTemporaryGates(callOf(['code-quality']))).resolves.toEqual({
      temporaryGateIds: [],
      canonicalGateIds: ['code-quality'],
    });
  });
});

/**
 * R11.13 ruling 3: a claimed run (R54) resumes in a process that never registered its request
 * gates, so stage 05 (`restoreRequestGates`) hands the blueprint's recorded `requestGates` back to
 * stage 11. A run started before R11.8 recorded the entries it then skipped or registered with
 * nothing to review; they were accepted when the run started, so the resume is not refused for
 * them, and each registers what the run held then.
 */
describe('a claimed run resumes with the request gates it recorded (R11.13)', () => {
  const recorded = () => [
    '   ',
    { id: 'no-such-gate' },
    { id: 'cites', criteria: ['Every claim cites a primary source'] },
  ];

  const claimedResume = async (registry: TemporaryGateRegistry) => {
    const parsed = {
      promptId: 'demo_chain',
      rawArgs: '',
      format: 'symbolic',
      confidence: 1,
      metadata: { originalCommand: '', parseStrategy: 'symbolic', detectedFormat: 'symbolic' },
      steps: [{ stepNumber: 1, promptId: 'demo', args: {} }],
      requestGates: recorded(),
    } as unknown as ParsedCommand;
    const context = new PromptRequestContext({ chain_id: 'chain-demo#1', user_response: 'out' });
    context.state.session.resumeSessionId = 'run-1';
    context.state.session.isBlueprintRestored = true;
    context.parsedCommand = parsed;
    const processor = new InlineGateProcessor(registry, resolver, logger(), {
      remapRunGates: async () => undefined,
    });
    await processor.restoreRunGates(context, parsed);
    return context;
  };

  test('a recorded gate that a new request would be refused for does not refuse the resume', async () => {
    const registry = newRegistry();
    const registrar = new TemporaryGateRegistrar(registry, resolver, logger());
    const context = await claimedResume(registry);
    // Positive control: stage 05 really handed the recorded entries to stage 11's channel.
    expect(context.state.gates.requestedOverrides?.gates).toHaveLength(3);

    expect(await registrar.invalidRequestGates(context)).toEqual([]);
    const result = await registrar.registerTemporaryGates(context);

    // What the run held when it started: the placeholder under its id, and its real gate.
    expect(result.temporaryGateIds).toEqual(['no-such-gate', 'cites']);
    expect(registry.getTemporaryGate('cites')?.pass_criteria).toEqual([
      'Every claim cites a primary source',
    ]);
  });

  test('control: the same entries sent by the client on that resume are still refused', async () => {
    const registry = newRegistry();
    const registrar = new TemporaryGateRegistrar(registry, resolver, logger());
    const context = await claimedResume(registry);
    // A string is its value: re-sending the recorded `'   '` would be the recorded gate, so the
    // client's own blank entry differs from it in its whitespace.
    const own = [' ', { id: 'other-unknown' }];
    context.state.gates.requestedOverrides = {
      gates: [...(context.state.gates.requestedOverrides?.gates ?? []), ...own],
    };

    const refusals = await registrar.invalidRequestGates(context);

    expect(refusals).toHaveLength(2);
    expect(refusals[0]?.detail).toContain('request gate 1 (" ") is blank.');
    expect(refusals[1]?.detail).toContain(
      'request gate 2 (id "other-unknown") names no registered gate'
    );
  });
});
