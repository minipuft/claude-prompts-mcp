// @lifecycle canonical - P6.112 / R54: a run resumed in a process that never registered its temporary gates re-registers them under the ids its blueprint recorded.
/**
 * Two registries stand for two server processes: the command is processed against the first, its
 * JSON clone (what `chain_runs.state` carries) is restored against the second. Driven across two
 * servers in `tests/e2e/claimed-run-gates.e2e.test.ts`.
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

/** The run store's remap writer (R60 amended), recording what each restore handed it. */
const runGateStore = (): {
  remapRunGates: jest.Mock<(runId: string, remap: ReadonlyMap<string, string>) => Promise<void>>;
} => ({
  remapRunGates: jest.fn(async () => undefined),
});

/** `sv-block` is canonical; everything else is criteria text. */
const resolver = {
  resolve: async (ref: string) =>
    ref === 'sv-block'
      ? { referenceType: 'registered', gateId: 'sv-block' }
      : { referenceType: 'inline', criteria: ref },
} as unknown as GateReferenceResolver;

/** `>>sv_chain :: g112:"NAMED" :: "ANON"` after the P6.78 fold. */
const gatedChain = (): ParsedCommand =>
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
    namedInlineGates: [{ gateId: 'g112', criteria: ['NAMED'] }],
    steps: [1, 2].map((stepNumber) => ({
      stepNumber,
      promptId: stepNumber === 1 ? 'sv_a' : 'sv_b',
      args: {},
      inlineGateIds: ['sv-block'],
      inlineGateCriteria: ['ANON', 'g112'],
    })),
  }) as unknown as ParsedCommand;

/** The blueprint as a new process reads it back, on the context of a resume of `runId`. */
const restoredOn = (
  started: ParsedCommand,
  runId: string
): { context: ExecutionContext; parsed: ParsedCommand } => {
  const context = new ExecutionContext({ chain_id: 'chain-sv_chain#1', user_response: 'out' });
  context.state.session.resumeSessionId = runId;
  context.state.session.isBlueprintRestored = true;
  return { context, parsed: JSON.parse(JSON.stringify(started)) as ParsedCommand };
};

async function startRun(registry: TemporaryGateRegistry): Promise<ParsedCommand> {
  const processor = new InlineGateProcessor(registry, resolver, logger(), runGateStore());
  const started = gatedChain();
  await processor.processInlineGates(new ExecutionContext({ command: 'start' }), started);
  return started;
}

describe('InlineGateProcessor.restoreRunGates', () => {
  test('(a) a new process registers every gate the blueprint references, under its recorded id', async () => {
    const started = await startRun(new TemporaryGateRegistry(logger()));
    const stepTemps = (started.steps ?? []).map((step) => step.inlineGateIds?.[2]);
    expect(stepTemps.every((id) => /^temp_\d+_[a-z0-9]+$/.test(id ?? ''))).toBe(true);

    const registry = new TemporaryGateRegistry(logger());
    const processor = new InlineGateProcessor(registry, resolver, logger(), runGateStore());
    const { context, parsed } = restoredOn(started, 'run-1');
    const restored = await processor.restoreRunGates(context, parsed);

    expect(restored.sort()).toEqual(['g112', ...stepTemps].sort());
    expect(registry.getTemporaryGate('g112')?.pass_criteria).toEqual(['NAMED']);
    expect(registry.getTemporaryGate('g112')?.declared_key).toBe('g112');
    for (const id of stepTemps) {
      expect(registry.getTemporaryGate(id ?? '')?.pass_criteria).toEqual(['ANON']);
    }
    // The blueprint is not rewritten: its ids are the ones that now resolve.
    expect(parsed.steps?.map((step) => step.inlineGateIds)).toEqual(
      started.steps?.map((step) => step.inlineGateIds)
    );
  });

  test('(b) control: in the process that holds them, nothing registers', async () => {
    const registry = new TemporaryGateRegistry(logger());
    const started = await startRun(registry);
    // The pipeline's `finally` hands the start call's gates to the run it created (R47).
    registry.adoptIntoRun('run-1', [
      ...(started.inlineGateIds ?? []),
      ...(started.steps ?? []).flatMap((step) => step.inlineGateIds ?? []),
    ]);
    const store = runGateStore();
    const processor = new InlineGateProcessor(registry, resolver, logger(), store);
    const { context, parsed } = restoredOn(started, 'run-1');

    expect(await processor.restoreRunGates(context, parsed)).toEqual([]);
    expect(registry.getTemporaryGate('g112-2')).toBeUndefined();
    // P6.140 control: nothing remapped, so the run's reviews are handed an empty map.
    expect(store.remapRunGates.mock.calls).toEqual([['run-1', new Map()]]);
  });

  test('(c) a named gate recorded under a fresh id is restored under that id', async () => {
    const first = new TemporaryGateRegistry(logger());
    first.createTemporaryGate({
      id: 'g112',
      name: 'g112',
      type: 'validation',
      scope: 'execution',
      description: 'another run',
      guidance: 'OTHER',
      source: 'automatic',
    });
    const started = await startRun(first);
    expect(started.inlineGateIds).toEqual(['g112-2']);

    const registry = new TemporaryGateRegistry(logger());
    const processor = new InlineGateProcessor(registry, resolver, logger(), runGateStore());
    const { context, parsed } = restoredOn(started, 'run-1');
    await processor.restoreRunGates(context, parsed);

    expect(registry.getTemporaryGate('g112-2')?.pass_criteria).toEqual(['NAMED']);
    expect(registry.getTemporaryGate('g112')).toBeUndefined();
  });

  test('P6.129 (f) a recorded id another run holds here restores under a fresh id the restored command references', async () => {
    const started = await startRun(new TemporaryGateRegistry(logger()));
    expect(started.inlineGateIds).toEqual(['g112']);

    const registry = new TemporaryGateRegistry(logger());
    registry.adoptIntoRun('run-other', [
      registry.createTemporaryGate({
        id: 'g112',
        name: 'g112',
        type: 'validation',
        scope: 'execution',
        description: 'the claiming server run',
        guidance: 'OTHER',
        pass_criteria: ['OTHER'],
        source: 'automatic',
      }),
    ]);
    const store = runGateStore();
    const processor = new InlineGateProcessor(registry, resolver, logger(), store);
    const { context, parsed } = restoredOn(started, 'run-1');
    const restored = await processor.restoreRunGates(context, parsed);

    expect(restored).toContain('g112-2');
    // P6.140: the run's store is handed the same remap its restored command carries.
    expect(store.remapRunGates.mock.calls).toEqual([['run-1', new Map([['g112', 'g112-2']])]]);
    expect(registry.getTemporaryGate('g112-2')?.pass_criteria).toEqual(['NAMED']);
    expect(registry.getTemporaryGate('g112-2')?.declared_key).toBe('g112');
    expect(registry.getTemporaryGate('g112')?.pass_criteria).toEqual(['OTHER']);
    expect(parsed.inlineGateIds).toEqual(['g112-2']);
    expect(parsed.steps?.map((step) => step.inlineGateIds?.slice(0, 2))).toEqual([
      ['sv-block', 'g112-2'],
      ['sv-block', 'g112-2'],
    ]);
    // The blueprint keeps the recorded id; the next call re-reads the run's own gate by its key.
    expect(started.inlineGateIds).toEqual(['g112']);
    registry.adoptIntoRun('run-1', restored);
    const next = restoredOn(started, 'run-1');
    expect(await processor.restoreRunGates(next.context, next.parsed)).toEqual([]);
    expect(next.parsed.inlineGateIds).toEqual(['g112-2']);
    expect(registry.getTemporaryGate('g112-3')).toBeUndefined();
  });

  test('(e) a criterion naming another gate by its generated id stays a reference', async () => {
    const first = new TemporaryGateRegistry(logger());
    const referenced = first.createTemporaryGate({
      name: 'elsewhere',
      type: 'validation',
      scope: 'execution',
      description: 'd',
      guidance: 'ELSEWHERE',
      source: 'automatic',
    });
    const started = gatedChain();
    for (const step of started.steps ?? []) {
      (step as unknown as { inlineGateCriteria: string[] }).inlineGateCriteria = [
        referenced,
        'ANON',
      ];
    }
    await new InlineGateProcessor(first, resolver, logger(), runGateStore()).processInlineGates(
      new ExecutionContext({ command: 'start' }),
      started
    );
    const own = started.steps?.[0]?.inlineGateIds?.at(-1) ?? '';
    expect(started.steps?.[0]?.inlineGateIds).toEqual(['sv-block', referenced, own]);

    const registry = new TemporaryGateRegistry(logger());
    const { context, parsed } = restoredOn(started, 'run-1');
    await new InlineGateProcessor(registry, resolver, logger(), runGateStore()).restoreRunGates(
      context,
      parsed
    );

    expect(registry.getTemporaryGate(own)?.pass_criteria).toEqual(['ANON']);
    expect(registry.getTemporaryGate(referenced)).toBeUndefined();
  });

  test("(d) the start call's request gates go back to stage 11 only while the run owns none", async () => {
    const started = await startRun(new TemporaryGateRegistry(logger()));
    started.requestGates = [{ id: 'rq112', name: 'rq112', criteria: ['REQ'] }];

    const registry = new TemporaryGateRegistry(logger());
    const processor = new InlineGateProcessor(registry, resolver, logger(), runGateStore());
    const claimed = restoredOn(started, 'run-1');
    await processor.restoreRunGates(claimed.context, claimed.parsed);
    expect(claimed.context.state.gates.requestedOverrides?.gates).toEqual(started.requestGates);

    // Stage 11 registered it and the pipeline adopted it: the next call finds the run's own.
    const id = registry.createTemporaryGate({
      id: 'rq112',
      name: 'rq112',
      type: 'validation',
      scope: 'execution',
      description: 'd',
      guidance: 'REQ',
      source: 'automatic',
      origin: 'request',
    });
    registry.adoptIntoRun('run-1', [id]);
    const next = restoredOn(started, 'run-1');
    await processor.restoreRunGates(next.context, next.parsed);
    expect(next.context.state.gates.requestedOverrides).toBeUndefined();
  });
});
