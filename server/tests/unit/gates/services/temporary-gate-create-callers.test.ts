// @lifecycle canonical - P6.120: every caller of `createTemporaryGate` passing a caller-chosen id resolves it through the run first.
/**
 * R49 (P6.113) made a run's declared gate ids resolve through `TemporaryGateRegistry.resolveDeclared`
 * before any fresh-id decision, at the three callers that pass a caller-chosen id. MEASURED
 * 2026-09-27 on `327dcbce` (`rg -n "createTemporaryGate\(" src`): four callers.
 *
 * | caller | site | caller-chosen id | resolves through |
 * | --- | --- | --- | --- |
 * | request gate | `temporary-gate-registrar.ts` `registerTemporaryGates` | `gates[].id` | `resolveHeldForThisRun` |
 * | inline definition | `temporary-gate-registrar.ts` `registerOneInlineDefinition` | `inline_gate_definitions[].id` | `resolveHeldForThisRun` |
 * | named inline gate | `inline-gate-processor.ts` `createNamedInlineGate` | `:: name:"…"` | `declaredNamedGates` |
 * | anonymous criteria | `inline-gate-processor.ts` `createInlineGate` | none | exempt: the registry mints `temp_…` |
 * | claimed named gate | `inline-gate-processor.ts` `restoreRunGates` | the recorded id | `resolveDeclared` (P6.129, R60) |
 *
 * Each non-exempt row drives its real caller twice on one run holding the id: the second call must
 * not reach `createTemporaryGate` with that id. The call-site count is asserted against this
 * table, so a fifth caller fails until it is classified here.
 */
import { describe, expect, jest, test } from '@jest/globals';

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ExecutionContext } from '../../../../src/engine/execution/context/execution-context.js';
import { TemporaryGateRegistry } from '../../../../src/engine/gates/core/temporary-gate-registry.js';
import { InlineGateProcessor } from '../../../../src/engine/gates/services/inline-gate-processor.js';
import { TemporaryGateRegistrar } from '../../../../src/engine/gates/services/temporary-gate-registrar.js';

import type { ParsedCommand } from '../../../../src/engine/execution/context/index.js';
import type { GateReferenceResolver } from '../../../../src/engine/gates/services/gate-reference-resolver.js';
import type { Logger } from '../../../../src/infra/logging/index.js';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../src');

const logger = (): Logger =>
  ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) as never;

const inlineResolver = {
  resolve: async (ref: string) => ({ referenceType: 'inline', criteria: ref }),
} as unknown as GateReferenceResolver;

/** A call of `runId` (undefined: the call that starts a run) carrying request `gates`. */
const callOf = (runId: string | undefined, gates: unknown[] = []): ExecutionContext => {
  const context = new ExecutionContext({ command: '>>demo' });
  context.state.gates.requestedOverrides = { gates };
  if (runId !== undefined) context.state.session.resumeSessionId = runId;
  return context;
};

const namedCommand = (): ParsedCommand =>
  ({
    promptId: 'sv_chain',
    rawArgs: '',
    format: 'symbolic',
    confidence: 1,
    metadata: { originalCommand: '', parseStrategy: 'symbolic', detectedFormat: 'symbolic' },
    namedInlineGates: [{ gateId: 'g120', criteria: ['NAMED-120'] }],
    steps: [{ stepNumber: 1, promptId: 'sv_a', args: {}, inlineGateCriteria: ['g120'] }],
  }) as unknown as ParsedCommand;

interface CreateCaller {
  readonly name: string;
  /** The file holding the call, relative to `src/`. */
  readonly site: string;
  /** Why this caller passes no caller-chosen id; absent for the rows driven below. */
  readonly exempt?: string;
  /** The id the caller chooses. */
  readonly heldId?: string;
  /** One call of the caller on `runId` (undefined starts a run); returns the ids it registered. */
  readonly call?: (registry: TemporaryGateRegistry, runId?: string) => Promise<string[]>;
}

const CALLERS: readonly CreateCaller[] = [
  {
    name: 'request gate',
    site: 'engine/gates/services/temporary-gate-registrar.ts',
    heldId: 'rg120',
    call: async (registry, runId) =>
      (
        await new TemporaryGateRegistrar(registry, undefined, logger()).registerTemporaryGates(
          callOf(runId, [{ id: 'rg120', name: 'rg120', criteria: ['REQUEST-120'] }])
        )
      ).temporaryGateIds,
  },
  {
    name: 'inline definition',
    site: 'engine/gates/services/temporary-gate-registrar.ts',
    heldId: 'def120',
    call: async (registry, runId) =>
      new TemporaryGateRegistrar(registry, undefined, logger()).registerInlineGateDefinitions(
        callOf(runId),
        [
          {
            id: 'demo',
            gateConfiguration: {
              inline_gate_definitions: [
                { id: 'def120', name: 'def120', type: 'validation', guidance: 'G' },
              ],
            },
          },
        ],
        true
      ),
  },
  {
    name: 'named inline gate',
    site: 'engine/gates/services/inline-gate-processor.ts',
    heldId: 'g120',
    call: async (registry, runId) => {
      const processor = new InlineGateProcessor(registry, inlineResolver, logger());
      const parsed = namedCommand();
      await processor.processInlineGates(callOf(runId), parsed);
      return parsed.inlineGateIds ?? [];
    },
  },
  {
    name: 'claimed named gate',
    site: 'engine/gates/services/inline-gate-processor.ts',
    heldId: 'g120',
    // A restore runs only on a resume, so the first call is already the run's.
    call: async (registry, runId) => {
      const processor = new InlineGateProcessor(registry, inlineResolver, logger());
      const context = callOf(runId ?? 'run-120');
      context.state.session.isBlueprintRestored = true;
      return processor.restoreRunGates(context, { ...namedCommand(), inlineGateIds: ['g120'] });
    },
  },
  {
    name: 'anonymous criteria',
    site: 'engine/gates/services/inline-gate-processor.ts',
    exempt: 'passes no id: the registry mints `temp_…`, so there is no caller-chosen id to resolve',
  },
];

/** The callers whose second call on a run holding their id still reached the create with it. */
async function unresolved(callers: readonly CreateCaller[]): Promise<string[]> {
  const names: string[] = [];
  for (const caller of callers) {
    if (caller.call === undefined || caller.heldId === undefined) continue;
    const registry = new TemporaryGateRegistry(logger());
    const create = jest.spyOn(registry, 'createTemporaryGate');
    registry.adoptIntoRun('run-120', await caller.call(registry));
    // Positive control: the first call did reach the create with the id
    expect(create.mock.calls.some(([gate]) => gate.id === caller.heldId)).toBe(true);
    create.mockClear();
    await caller.call(registry, 'run-120');
    if (create.mock.calls.some(([gate]) => gate.id === caller.heldId)) names.push(caller.name);
  }
  return names;
}

function callSites(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return callSites(full);
    if (!entry.name.endsWith('.ts')) return [];
    // A receiver is required: the registry's own definition has none
    const count = readFileSync(full, 'utf8').match(/\.createTemporaryGate\(/g)?.length ?? 0;
    return Array.from({ length: count }, () => path.relative(SRC, full));
  });
}

describe('every createTemporaryGate caller resolves a caller-chosen id through the run (P6.120)', () => {
  test('the call sites in src/ are exactly the enumerated callers', () => {
    const found = callSites(SRC).sort();
    // Positive control: the scan reaches the callers the table names
    expect(found.length).toBeGreaterThanOrEqual(4);
    expect(found).toEqual(CALLERS.map((caller) => caller.site).sort());
  });

  test('every caller is driven below or exempt with a reason', () => {
    for (const caller of CALLERS) {
      expect(caller.call !== undefined || (caller.exempt ?? '').length > 0).toBe(true);
    }
  });

  test.each(CALLERS.filter((caller) => caller.call !== undefined).map((c) => [c.name, c] as const))(
    '%s: a run re-declaring the id it holds does not create it again',
    async (_name, caller) => {
      expect(await unresolved([caller])).toEqual([]);
    }
  );

  test('control: a planted caller passing a held id unresolved is named', async () => {
    const planted: CreateCaller = {
      name: 'planted-unresolved',
      site: 'planted',
      heldId: 'p120',
      call: async (registry) => [
        registry.createTemporaryGate(
          {
            id: 'p120',
            name: 'p120',
            type: 'validation',
            scope: 'execution',
            description: 'd',
            guidance: 'g',
            source: 'automatic',
          },
          undefined,
          { onIdCollision: 'fresh-id' }
        ),
      ],
    };
    expect(await unresolved([...CALLERS, planted])).toEqual(['planted-unresolved']);
  });
});
