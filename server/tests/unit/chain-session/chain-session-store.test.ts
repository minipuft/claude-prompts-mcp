import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

import { ChainSessionStore, type SessionBlueprint } from '../../../src/modules/chains/manager.js';

import type { Logger } from '../../../src/infra/logging/index.js';
import type { ConvertedPrompt } from '../../../src/shared/types/index.js';

class StubTextReferenceStore {
  storeChainStepResult = jest.fn();
  buildChainVariables = jest.fn().mockReturnValue({});
  clearChainStepResults = jest.fn();
  getChainStepMetadata = jest.fn().mockReturnValue({});
}

const createLogger = (): Logger =>
  ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }) as unknown as Logger;

describe('ChainSessionStore', () => {
  let manager: ChainSessionStore;
  let saveSpy: jest.SpyInstance;
  let loadSpy: jest.SpyInstance;
  let schedulerSpy: jest.SpyInstance;

  beforeEach(() => {
    saveSpy = jest
      .spyOn(ChainSessionStore.prototype as any, 'saveSessions')
      .mockResolvedValue(undefined);
    loadSpy = jest
      .spyOn(ChainSessionStore.prototype as any, 'loadSessions')
      .mockResolvedValue(undefined);
    schedulerSpy = jest
      .spyOn(ChainSessionStore.prototype as any, 'startCleanupScheduler')
      .mockImplementation(() => {});
  });

  afterEach(async () => {
    if (manager) {
      await manager.cleanup();
    }
    saveSpy.mockRestore();
    loadSpy.mockRestore();
    schedulerSpy.mockRestore();
  });

  test('cleans review sessions faster than chain sessions', async () => {
    manager = new ChainSessionStore(createLogger(), new StubTextReferenceStore() as any, {
      serverRoot: '/tmp/test-chain-sessions',
      reviewSessionTimeoutMs: 5 * 60 * 1000,
      defaultSessionTimeoutMs: 60 * 60 * 1000,
      cleanupIntervalMs: 1000,
    });

    await manager.createSession('review-session', 'prompt-review-chain', 1);
    await manager.createSession('chain-session', 'chain-alpha', 3);

    const activeSessions = (manager as any).activeSessions as Map<string, any>;
    activeSessions.get('review-session')!.lastActivity = Date.now() - 10 * 60 * 1000;
    activeSessions.get('chain-session')!.lastActivity = Date.now() - 2 * 60 * 1000;

    const cleaned = await manager.cleanupStaleSessions();

    expect(cleaned).toBe(1);
    expect(manager.hasActiveSession('review-session')).toBe(false);
    expect(manager.hasActiveSession('chain-session')).toBe(true);
  });

  test('does not advance currentStep when completing placeholders', async () => {
    manager = new ChainSessionStore(createLogger(), new StubTextReferenceStore() as any, {
      serverRoot: '/tmp/test-chain-sessions-placeholder',
      cleanupIntervalMs: 1000,
    });

    await manager.createSession('session-placeholder', 'chain-placeholder', 2);
    manager.setStepState('session-placeholder', 'n1', 'rendered', true);

    await manager.completeStep('session-placeholder', 'n1', { preservePlaceholder: true });

    const session = (manager as any).activeSessions.get('session-placeholder');

    expect(session.state.currentNodeId).toBe('n1');
    expect(session.executionOrder).toEqual([]);
  });

  test('includes blueprint metadata and inline gates inside chain context', async () => {
    const textReferenceStore = new StubTextReferenceStore();
    textReferenceStore.buildChainVariables.mockReturnValue({
      step_results: { '1': 'Stored result' },
    });

    manager = new ChainSessionStore(createLogger(), textReferenceStore as any, {
      serverRoot: '/tmp/test-chain-sessions-context',
      cleanupIntervalMs: 1000,
    });

    const convertedPrompt: ConvertedPrompt = {
      id: 'chain-alpha',
      name: 'Chain Alpha',
      description: 'Restores metadata banners for symbolic chains',
      category: 'code',
      userMessageTemplate: 'Do work: {{input}}',
      systemMessage: 'You are reliable',
      arguments: [],
    };

    const blueprint: SessionBlueprint = {
      parsedCommand: {
        promptId: 'chain-alpha',
        rawArgs: '',
        format: 'symbolic',
        confidence: 1,
        metadata: {
          originalCommand: 'run chain-alpha',
          parseStrategy: 'unit-test',
          detectedFormat: 'symbolic',
          warnings: [],
        },
        commandType: 'chain',
        convertedPrompt,
        inlineGateIds: ['inline_gate_focus'],
        steps: [
          {
            stepNumber: 1,
            promptId: 'chain-alpha:step1',
            args: { input: 'alpha' },
            inlineGateIds: ['inline_gate_focus_step'],
          },
        ] as any,
      },
      executionPlan: {
        strategy: 'chain',
        gates: ['framework-compliance'],
        requiresFramework: true,
        requiresSession: true,
      },
    };

    await manager.createSession(
      'session-chain-context',
      'chain-alpha',
      2,
      { priority: 'high' },
      { blueprint }
    );
    const context = manager.getChainContext('session-chain-context');

    expect(context.chain_run_id).toBe('session-chain-context');
    expect(context.total_steps).toBe(2);
    expect(context.currentStepArgs).toEqual({ input: 'alpha' });
    // {{input}} exposes current step's arguments for template access
    expect(context.input).toEqual({ input: 'alpha' });
    expect(context.chain_metadata).toEqual(
      expect.objectContaining({
        chainId: 'chain-alpha',
        promptId: 'chain-alpha',
        name: 'Chain Alpha',
        description: 'Restores metadata banners for symbolic chains',
        category: 'code',
        gates: ['framework-compliance'],
        inlineGateIds: ['inline_gate_focus', 'inline_gate_focus_step'],
        chainRunId: 'session-chain-context',
      })
    );
  });

  test('updateSessionBlueprint stores snapshot independently', async () => {
    manager = new ChainSessionStore(createLogger(), new StubTextReferenceStore() as any, {
      serverRoot: '/tmp/test-chain-sessions-blueprint',
      cleanupIntervalMs: 1000,
    });

    await manager.createSession('session-blueprint', 'chain-blueprint', 1);

    const blueprint: SessionBlueprint = {
      parsedCommand: {
        promptId: 'chain-blueprint',
        rawArgs: '',
        format: 'symbolic',
        confidence: 1,
        metadata: {
          originalCommand: 'run chain-blueprint',
          parseStrategy: 'unit-test',
          detectedFormat: 'symbolic',
          warnings: [],
        },
        commandType: 'chain',
      },
      executionPlan: {
        strategy: 'chain',
        gates: ['framework-compliance'],
        requiresFramework: true,
        requiresSession: true,
      },
      gateInstructions: 'Persisted gate instructions',
    };

    manager.updateSessionBlueprint('session-blueprint', blueprint);

    const stored = manager.getSessionBlueprint('session-blueprint');
    expect(stored?.gateInstructions).toBe('Persisted gate instructions');

    blueprint.gateInstructions = 'mutated';
    expect(stored?.gateInstructions).toBe('Persisted gate instructions');
  });
});

describe('ChainSessionStore — run-status lifecycle (Tier 2)', () => {
  let manager: ChainSessionStore;
  let saveSpy: jest.SpyInstance;
  let loadSpy: jest.SpyInstance;
  let schedulerSpy: jest.SpyInstance;

  beforeEach(() => {
    saveSpy = jest
      .spyOn(ChainSessionStore.prototype as any, 'saveSessions')
      .mockResolvedValue(undefined);
    loadSpy = jest
      .spyOn(ChainSessionStore.prototype as any, 'loadSessions')
      .mockResolvedValue(undefined);
    schedulerSpy = jest
      .spyOn(ChainSessionStore.prototype as any, 'startCleanupScheduler')
      .mockImplementation(() => {});
  });

  afterEach(async () => {
    if (manager) {
      await manager.cleanup();
    }
    saveSpy.mockRestore();
    loadSpy.mockRestore();
    schedulerSpy.mockRestore();
  });

  const newManager = (suffix: string): ChainSessionStore =>
    new ChainSessionStore(createLogger(), new StubTextReferenceStore() as any, {
      serverRoot: `/tmp/test-runstatus-${suffix}`,
      cleanupIntervalMs: 1000,
    });

  test('createSession defaults runStatus to "working"', async () => {
    manager = newManager('default');
    const session = await manager.createSession('s1', 'chain-a', 2);
    expect(session.runStatus).toBe('working');
    expect(session.runCompletedAt).toBeUndefined();
  });

  test('transitionRunStatus accepts non-terminal transitions and stamps runCompletedAt on terminal', async () => {
    manager = newManager('transition');
    await manager.createSession('s1', 'chain-a', 2);

    const okWorking = await manager.transitionRunStatus('s1', 'input_required');
    expect(okWorking).toBe(true);

    const okComplete = await manager.transitionRunStatus('s1', 'completed');
    expect(okComplete).toBe(true);

    const session = (manager as any).activeSessions.get('s1');
    expect(session.runStatus).toBe('completed');
    expect(typeof session.runCompletedAt).toBe('number');
  });

  test('transitionRunStatus refuses transitions out of terminal states (stickiness)', async () => {
    manager = newManager('stickiness');
    for (const terminal of ['completed', 'failed', 'cancelled'] as const) {
      const sessionId = `s-${terminal}`;
      await manager.createSession(sessionId, `chain-${terminal}`, 1);
      const session = (manager as any).activeSessions.get(sessionId);
      session.runStatus = terminal;

      const result = await manager.transitionRunStatus(sessionId, 'working');
      expect(result).toBe(false);
      expect(session.runStatus).toBe(terminal);
    }
  });

  test('transitionRunStatus is idempotent on same status', async () => {
    manager = newManager('idempotent');
    await manager.createSession('s1', 'chain-a', 1);
    const result = await manager.transitionRunStatus('s1', 'working');
    expect(result).toBe(true);
  });

  test('transitionRunStatus returns false for unknown session', async () => {
    manager = newManager('missing');
    const result = await manager.transitionRunStatus('does-not-exist', 'completed');
    expect(result).toBe(false);
  });

  test('cancelChain transitions a working session to cancelled and stamps runCompletedAt', async () => {
    manager = newManager('cancel-working');
    await manager.createSession('s1', 'chain-a', 3);

    const result = await manager.cancelChain('s1');
    expect(result).toBe(true);

    const session = (manager as any).activeSessions.get('s1');
    expect(session.runStatus).toBe('cancelled');
    expect(typeof session.runCompletedAt).toBe('number');
  });

  test('cancelChain is idempotent on already-cancelled sessions', async () => {
    manager = newManager('cancel-idempotent');
    await manager.createSession('s1', 'chain-a', 1);
    const session = (manager as any).activeSessions.get('s1');
    session.runStatus = 'cancelled';
    session.runCompletedAt = 1234;

    const result = await manager.cancelChain('s1');
    expect(result).toBe(true);
    expect(session.runStatus).toBe('cancelled');
    // Idempotent path does not re-stamp the timestamp
    expect(session.runCompletedAt).toBe(1234);
  });

  test('cancelChain refuses sessions in completed or failed terminal states', async () => {
    manager = newManager('cancel-refuse');
    for (const terminal of ['completed', 'failed'] as const) {
      const sessionId = `s-${terminal}`;
      await manager.createSession(sessionId, `chain-${terminal}`, 1);
      const session = (manager as any).activeSessions.get(sessionId);
      session.runStatus = terminal;

      const result = await manager.cancelChain(sessionId);
      expect(result).toBe(false);
      expect(session.runStatus).toBe(terminal);
    }
  });

  test('transitionStepState refuses to overwrite a COMPLETED step', async () => {
    manager = newManager('step-stickiness');
    await manager.createSession('s1', 'chain-a', 2);
    manager.setStepState('s1', 'n1', 'completed', false);

    const result = await manager.transitionStepState('s1', 'n1', 'rendered');
    expect(result).toBe(false);

    const metadata = manager.getStepState('s1', 'n1');
    expect(metadata?.state).toBe('completed');
  });

  test('transitionStepState allows re-asserting the same terminal state (idempotent no-op)', async () => {
    manager = newManager('step-idempotent');
    await manager.createSession('s1', 'chain-a', 2);
    manager.setStepState('s1', 'n1', 'completed', false);

    const result = await manager.transitionStepState('s1', 'n1', 'completed');
    expect(result).toBe(true);
  });

  test('promoteSessionLifecycle refuses promotion of terminal sessions', async () => {
    manager = newManager('promote-refuse');
    await manager.createSession('s1', 'chain-a', 1);
    const session = (manager as any).activeSessions.get('s1');
    session.lifecycle = 'dormant';
    session.runStatus = 'cancelled';

    // getSession() invokes promoteSessionLifecycle internally with reason 'session-id lookup'.
    manager.getSession('s1');

    expect(session.lifecycle).toBe('dormant');
  });
});

describe('ChainSessionStore — unknowns ledger', () => {
  let manager: ChainSessionStore;
  let saveSpy: jest.SpiedFunction<() => Promise<void>>;
  let loadSpy: jest.SpiedFunction<() => Promise<void>>;
  let schedulerSpy: jest.SpiedFunction<() => void>;

  const newManager = (suffix: string): ChainSessionStore =>
    new ChainSessionStore(createLogger(), new StubTextReferenceStore() as any, {
      serverRoot: `/tmp/test-unknowns-${suffix}`,
      cleanupIntervalMs: 1000,
    });

  beforeEach(() => {
    saveSpy = jest
      .spyOn(ChainSessionStore.prototype as any, 'saveSessions')
      .mockResolvedValue(undefined) as unknown as jest.SpiedFunction<() => Promise<void>>;
    loadSpy = jest
      .spyOn(ChainSessionStore.prototype as any, 'loadSessions')
      .mockResolvedValue(undefined) as unknown as jest.SpiedFunction<() => Promise<void>>;
    schedulerSpy = jest
      .spyOn(ChainSessionStore.prototype as any, 'startCleanupScheduler')
      .mockImplementation(() => {}) as unknown as jest.SpiedFunction<() => void>;
  });

  afterEach(async () => {
    if (manager) {
      await manager.cleanup();
    }
    saveSpy.mockRestore();
    loadSpy.mockRestore();
    schedulerSpy.mockRestore();
  });

  test('applyUnknownObservations mutates the ledger and persists before returning', async () => {
    manager = newManager('apply');
    await manager.createSession('s1', 'chain-a', 3);
    saveSpy.mockClear();

    const ledger = await manager.applyUnknownObservations('s1', 'n2', [
      { type: 'unknown_discovered', id: 'cache-ttl', statement: 'TTL undecided', blocking: true },
    ]);

    expect(ledger).toEqual([
      {
        id: 'cache-ttl',
        statement: 'TTL undecided',
        state: 'active',
        blocking: true,
        discoveredAtStep: 2,
      },
    ]);
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(manager.getSession('s1')?.unknownsLedger).toEqual(ledger);
  });

  test('applyUnknownObservations returns copies, not live ledger rows', async () => {
    manager = newManager('copies');
    await manager.createSession('s1', 'chain-a', 3);

    const ledger = await manager.applyUnknownObservations('s1', 'n1', [
      { type: 'unknown_discovered', id: 'cache-ttl', statement: 'TTL undecided' },
    ]);
    ledger[0]!.statement = 'mutated by a caller';

    expect(manager.getSession('s1')?.unknownsLedger?.[0]?.statement).toBe('TTL undecided');
  });

  test('applyUnknownObservations rejects an invalid batch without mutating or persisting', async () => {
    manager = newManager('invalid');
    await manager.createSession('s1', 'chain-a', 3);
    saveSpy.mockClear();

    await expect(
      manager.applyUnknownObservations('s1', 'n2', [
        { type: 'unknown_discovered', id: 'cache-ttl', statement: 'TTL undecided' },
        { type: 'unknown_resolved', id: 'never-seen', statement: 'done', resolution: 'answered' },
      ])
    ).rejects.toThrow(/never-seen/);

    expect(saveSpy).not.toHaveBeenCalled();
    expect(manager.getSession('s1')?.unknownsLedger).toBeUndefined();
  });

  test('applyUnknownObservations throws when the session is gone', async () => {
    manager = newManager('missing');

    await expect(
      manager.applyUnknownObservations('nope', 'n1', [
        { type: 'unknown_discovered', id: 'cache-ttl', statement: 'TTL undecided' },
      ])
    ).rejects.toThrow(/session not found/);
  });

  test('applyUnknownObservations propagates a persist failure rather than reporting success', async () => {
    manager = newManager('persist-fail');
    await manager.createSession('s1', 'chain-a', 3);
    saveSpy.mockRejectedValueOnce(new Error('disk full'));

    await expect(
      manager.applyUnknownObservations('s1', 'n1', [
        { type: 'unknown_discovered', id: 'cache-ttl', statement: 'TTL undecided' },
      ])
    ).rejects.toThrow('disk full');
  });

  test('getChainContext omits unknowns_ledger while the ledger is empty', async () => {
    manager = newManager('context-empty');
    await manager.createSession('s1', 'chain-a', 3);

    expect(manager.getChainContext('s1')).not.toHaveProperty('unknowns_ledger');
  });

  test('getChainContext exposes unknowns_ledger once entries exist', async () => {
    manager = newManager('context-populated');
    await manager.createSession('s1', 'chain-a', 3);
    await manager.applyUnknownObservations('s1', 'n2', [
      { type: 'unknown_discovered', id: 'cache-ttl', statement: 'TTL undecided' },
    ]);

    const contextData = manager.getChainContext('s1');

    expect(contextData['unknowns_ledger']).toEqual([
      {
        id: 'cache-ttl',
        statement: 'TTL undecided',
        state: 'active',
        blocking: false,
        discoveredAtStep: 2,
      },
    ]);
  });
});

describe('ChainSessionStore — adaptive mutation (P4 Tier 2)', () => {
  let manager: ChainSessionStore;
  // Typed by what this block actually uses rather than as `jest.SpyInstance`: the sibling
  // describes above spell it that way and each costs a TS2694 against the ratchet baseline,
  // because @jest/globals does not export that namespace member.
  type RestorableSpy = { mockRestore: () => void };
  let saveSpy: RestorableSpy;
  let loadSpy: RestorableSpy;
  let schedulerSpy: RestorableSpy;

  beforeEach(() => {
    saveSpy = jest
      .spyOn(ChainSessionStore.prototype as any, 'saveSessions')
      .mockResolvedValue(undefined);
    loadSpy = jest
      .spyOn(ChainSessionStore.prototype as any, 'loadSessions')
      .mockResolvedValue(undefined);
    schedulerSpy = jest
      .spyOn(ChainSessionStore.prototype as any, 'startCleanupScheduler')
      .mockImplementation(() => {});
  });

  afterEach(async () => {
    if (manager) {
      await manager.cleanup();
    }
    saveSpy.mockRestore();
    loadSpy.mockRestore();
    schedulerSpy.mockRestore();
  });

  const newManager = (suffix: string): ChainSessionStore =>
    new ChainSessionStore(createLogger(), new StubTextReferenceStore() as any, {
      serverRoot: `/tmp/test-mutation-${suffix}`,
      cleanupIntervalMs: 1000,
    });

  const nodeIds = (mgr: ChainSessionStore, sessionId: string): string[] =>
    ((mgr as any).activeSessions.get(sessionId).state.nodes as Array<{ id: string }>).map(
      (node) => node.id
    );

  // --- insertNodeAfter ------------------------------------------------------------------

  test('insertNodeAfter places the node immediately after the anchor without renumbering', async () => {
    manager = newManager('insert-mid');
    await manager.createSession('s1', 'chain-a', 3);

    const inserted = await manager.insertNodeAfter('s1', 'n2', {
      stepName: 'Investigate: cache TTL',
      promptId: 'investigate',
      unknownId: 'cache-ttl',
    });

    expect(inserted).not.toBeNull();
    // Existing ids keep their spelling — every gate target and execution record addressed by
    // id survives the insertion. Only the new id is new.
    expect(nodeIds(manager, 's1')).toEqual(['n1', 'n2', inserted!.id, 'n3']);
    expect(inserted!.id).not.toMatch(/^n\d+$/);
  });

  test('insertNodeAfter stamps origin and the originating unknown on the new node', async () => {
    manager = newManager('insert-origin');
    await manager.createSession('s1', 'chain-a', 2);

    const inserted = await manager.insertNodeAfter('s1', 'n1', {
      stepName: 'Investigate: schema shape',
      promptId: 'investigate',
      unknownId: 'schema-shape',
    });

    expect(inserted?.origin).toBe('inserted');
    expect(inserted?.originUnknownId).toBe('schema-shape');
    expect(inserted?.promptId).toBe('investigate');
    // Its neighbours were normalized to 'planned' at creation, so nothing in the list is
    // ambiguous about its provenance.
    const nodes = (manager as any).activeSessions.get('s1').state.nodes;
    expect(nodes[0].origin).toBe('planned');
    expect(nodes[2].origin).toBe('planned');
  });

  test('the inserted node becomes what the run advances to next', async () => {
    manager = newManager('insert-next');
    await manager.createSession('s1', 'chain-a', 2);

    const inserted = await manager.insertNodeAfter('s1', 'n1', {
      stepName: 'Investigate',
      promptId: 'investigate',
      unknownId: 'u1',
    });
    const advanced = await manager.advanceStep('s1', 'n1');

    expect(advanced).toEqual({ nodeId: inserted!.id, ordinal: 2 });
  });

  test('insertNodeAfter returns null when the anchor is not in the run', async () => {
    manager = newManager('insert-absent');
    await manager.createSession('s1', 'chain-a', 2);

    expect(
      await manager.insertNodeAfter('s1', 'not-a-node', { stepName: 'X', promptId: 'p' })
    ).toBeNull();
    expect(nodeIds(manager, 's1')).toEqual(['n1', 'n2']);
  });

  test('insertNodeAfter returns null when the anchor sits behind the current node', async () => {
    manager = newManager('insert-behind');
    await manager.createSession('s1', 'chain-a', 3);
    await manager.advanceStep('s1', 'n1');

    // Anchoring at n1 would place the new node at ordinal 2, which traversal has already left.
    expect(
      await manager.insertNodeAfter('s1', 'n1', { stepName: 'Too late', promptId: 'p' })
    ).toBeNull();
    expect(nodeIds(manager, 's1')).toEqual(['n1', 'n2', 'n3']);
  });

  test('insertNodeAfter returns null once the run is terminal', async () => {
    manager = newManager('insert-terminal');
    await manager.createSession('s1', 'chain-a', 2);
    await manager.transitionRunStatus('s1', 'completed');

    expect(await manager.insertNodeAfter('s1', 'n1', { stepName: 'X', promptId: 'p' })).toBeNull();
  });

  test('insertNodeAfter returns null for an unknown session rather than no-opping silently', async () => {
    manager = newManager('insert-missing');
    expect(
      await manager.insertNodeAfter('nope', 'n1', { stepName: 'X', promptId: 'p' })
    ).toBeNull();
  });

  // --- markNodeSkipped ------------------------------------------------------------------

  test('markNodeSkipped retires a node ahead of the run and preserves its position', async () => {
    manager = newManager('skip-ahead');
    await manager.createSession('s1', 'chain-a', 3);

    expect(await manager.markNodeSkipped('s1', 'n3', 'irrelevant-unknown')).toBe(true);
    expect(manager.getStepState('s1', 'n3')?.state).toBe('skipped');
    // Retired, not deleted: the ordinals of everything around it must not shift.
    expect(nodeIds(manager, 's1')).toEqual(['n1', 'n2', 'n3']);
  });

  test('markNodeSkipped refuses the CURRENT node (OQ-P4-2 strictly-ahead rule)', async () => {
    manager = newManager('skip-current');
    await manager.createSession('s1', 'chain-a', 3);

    expect(await manager.markNodeSkipped('s1', 'n1', 'u1')).toBe(false);
    expect(manager.getStepState('s1', 'n1')?.state).toBeUndefined();
  });

  test('markNodeSkipped refuses a node that has already started', async () => {
    manager = newManager('skip-started');
    await manager.createSession('s1', 'chain-a', 3);
    manager.setStepState('s1', 'n2', 'rendered');

    expect(await manager.markNodeSkipped('s1', 'n2', 'u1')).toBe(false);
    expect(manager.getStepState('s1', 'n2')?.state).toBe('working');
  });

  test('markNodeSkipped refuses a node absent from the run', async () => {
    manager = newManager('skip-absent');
    await manager.createSession('s1', 'chain-a', 2);

    expect(await manager.markNodeSkipped('s1', 'ghost', 'u1')).toBe(false);
  });

  test('markNodeSkipped returns false for an unknown session rather than no-opping silently', async () => {
    manager = newManager('skip-missing');
    expect(await manager.markNodeSkipped('nope', 'n2', 'u1')).toBe(false);
  });

  test('markNodeSkipped is idempotent on an already-skipped node', async () => {
    manager = newManager('skip-idempotent');
    await manager.createSession('s1', 'chain-a', 3);

    expect(await manager.markNodeSkipped('s1', 'n3', 'u1')).toBe(true);
    expect(await manager.markNodeSkipped('s1', 'n3', 'u1')).toBe(true);
    expect(manager.getStepState('s1', 'n3')?.state).toBe('skipped');
  });

  test('a skipped node cannot be transitioned back out (terminal stickiness)', async () => {
    manager = newManager('skip-sticky');
    await manager.createSession('s1', 'chain-a', 3);
    await manager.markNodeSkipped('s1', 'n2', 'u1');

    expect(await manager.transitionStepState('s1', 'n2', 'rendered')).toBe(false);
    expect(manager.getStepState('s1', 'n2')?.state).toBe('skipped');
  });

  // --- advanceStep over skipped nodes ---------------------------------------------------

  test('advanceStep passes over a skipped node and lands on the next live one', async () => {
    manager = newManager('advance-skip');
    await manager.createSession('s1', 'chain-a', 3);
    await manager.markNodeSkipped('s1', 'n2', 'u1');

    const advanced = await manager.advanceStep('s1', 'n1');

    expect(advanced).toEqual({ nodeId: 'n3', ordinal: 3 });
    // The skipped node is not part of what the run executed — executionOrder is read to
    // reconstruct step results, so a node with no result in it would read as a missing response.
    expect((manager as any).activeSessions.get('s1').executionOrder).toEqual(['n1']);
  });

  test('advanceStep passes over a consecutive run of skipped nodes', async () => {
    manager = newManager('advance-skip-run');
    await manager.createSession('s1', 'chain-a', 4);
    await manager.markNodeSkipped('s1', 'n2', 'u1');
    await manager.markNodeSkipped('s1', 'n3', 'u2');

    expect(await manager.advanceStep('s1', 'n1')).toEqual({ nodeId: 'n4', ordinal: 4 });
  });

  test('the completion latch still fires when every trailing node is skipped', async () => {
    manager = newManager('advance-latch');
    await manager.createSession('s1', 'chain-a', 3);
    await manager.markNodeSkipped('s1', 'n2', 'u1');
    await manager.markNodeSkipped('s1', 'n3', 'u2');

    const advanced = await manager.advanceStep('s1', 'n1');

    // Without the skip-loop the run would park on n2 forever: nothing renders a skipped node,
    // so nothing would ever advance past it and the latch would never be reached.
    expect(advanced).toEqual({ nodeId: null, ordinal: 4 });
    expect((manager as any).activeSessions.get('s1').runStatus).toBe('completed');
  });

  test('the double-advance guard still short-circuits before the skip-loop runs', async () => {
    manager = newManager('advance-guard');
    await manager.createSession('s1', 'chain-a', 3);
    await manager.advanceStep('s1', 'n1');
    await manager.markNodeSkipped('s1', 'n3', 'u1');

    // Re-advancing past an already-passed node reports the current position and mutates nothing.
    expect(await manager.advanceStep('s1', 'n1')).toEqual({ nodeId: 'n2', ordinal: 2 });
    expect((manager as any).activeSessions.get('s1').state.currentNodeId).toBe('n2');
  });
});
