/**
 * The three run indexes `ChainSessionStore` keeps agree after every public mutator (row 0C2.3).
 *
 * `chainSessionMapping` (run chain id -> session ids), `baseChainMapping` (base chain id -> run
 * history) and `runChainToBase` (run chain id -> base) are indexes over the chain ids the held
 * sessions carry. The invariant, checked after EVERY operation:
 *
 *  1. every held session is listed under its own chain id, and every listed session is held
 *     under that chain id; no chain id keeps an empty set;
 *  2. the keys of `runChainToBase` are exactly the keys of `chainSessionMapping`, and each maps
 *     to `stripRunNumber(key)`;
 *  3. the run histories list every key of `chainSessionMapping` exactly once, under
 *     `stripRunNumber(key)`, and nothing else; no history is empty.
 *
 * History ORDER is not part of it: a run is appended when registered (a re-registered id moves to
 * the end) and sorted by run number only when a load or a claim inserts it.
 *
 * The operations are a seeded pseudo-random sequence over a real SQLite `DatabasePort`: run
 * creation (production-minted, a reused chain id that the persist reserves away or that another
 * scope shares, and a bare base id), history pruning past the cap, session and chain clears
 * (scoped and unscoped, base and run ids), stale cleanup, eviction of a run another server
 * claimed, a claim of a run another server minted, and a cold reload.
 */
import { afterAll, beforeAll, describe, expect, jest, test } from '@jest/globals';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { SqliteEngine } from '../../../src/infra/database/index.js';
import { ChainSessionStore } from '../../../src/modules/chains/manager.js';
import { DirectChainRunRegistry } from '../../../src/modules/chains/run-registry.js';
import {
  formatChainId,
  nextRunNumber,
  parseRunNumber,
  stripRunNumber,
} from '../../../src/shared/utils/chain-id-codec.js';

import type { Logger } from '../../../src/infra/logging/index.js';
import type { ChainSession } from '../../../src/shared/types/chain-session.js';
import type { StateStoreOptions } from '../../../src/shared/types/persistence.js';

const createLogger = (): Logger =>
  ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }) as unknown as Logger;

class StubTextReferenceStore {
  storeChainStepResult = jest.fn();
  buildChainVariables = jest.fn().mockReturnValue({});
  clearChainStepResults = jest.fn();
}

/** mulberry32: a fixed seed replays the same operation sequence on every run. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface RunIndexes {
  activeSessions: Map<string, ChainSession>;
  chainSessionMapping: Map<string, Set<string>>;
  baseChainMapping: Map<string, string[]>;
  runChainToBase: Map<string, string>;
}

const indexesOf = (store: ChainSessionStore): RunIndexes => store as unknown as RunIndexes;

/** Every way the three indexes disagree with the held sessions or with each other. */
function invariantViolations(store: ChainSessionStore): string[] {
  const { activeSessions, chainSessionMapping, baseChainMapping, runChainToBase } =
    indexesOf(store);
  const violations: string[] = [];

  for (const [sessionId, session] of activeSessions) {
    if (chainSessionMapping.get(session.chainId)?.has(sessionId) !== true) {
      violations.push(`session ${sessionId} (${session.chainId}) is missing from its chain id`);
    }
  }
  for (const [chainId, sessionIds] of chainSessionMapping) {
    if (sessionIds.size === 0) violations.push(`${chainId} keeps an empty session set`);
    for (const sessionId of sessionIds) {
      const held = activeSessions.get(sessionId)?.chainId;
      if (held !== chainId) {
        violations.push(`${chainId} lists session ${sessionId}, held under ${String(held)}`);
      }
    }
    if (runChainToBase.get(chainId) !== stripRunNumber(chainId)) {
      violations.push(`runChainToBase(${chainId}) is ${String(runChainToBase.get(chainId))}`);
    }
  }
  for (const runChainId of runChainToBase.keys()) {
    if (!chainSessionMapping.has(runChainId)) {
      violations.push(`runChainToBase keeps ${runChainId}, which no session holds`);
    }
  }

  const listed = new Set<string>();
  for (const [baseChainId, history] of baseChainMapping) {
    if (history.length === 0) violations.push(`history of ${baseChainId} is empty`);
    for (const entry of history) {
      if (stripRunNumber(entry) !== baseChainId) {
        violations.push(`history of ${baseChainId} lists ${entry} of another base`);
      }
      if (listed.has(entry)) violations.push(`history lists ${entry} twice`);
      listed.add(entry);
      if (!chainSessionMapping.has(entry)) {
        violations.push(`history of ${baseChainId} lists ${entry}, which no session holds`);
      }
    }
  }
  for (const chainId of chainSessionMapping.keys()) {
    if (!listed.has(chainId)) {
      violations.push(`${chainId} is held but missing from the history of its base`);
    }
  }
  return violations;
}

/** chain id -> sorted session ids, the part of the indexes a reload must reproduce. */
function membershipOf(store: ChainSessionStore): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [chainId, ids] of [...indexesOf(store).chainSessionMapping].sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    out[chainId] = [...ids].sort();
  }
  return out;
}

interface Tally {
  created: number;
  renamed: number;
  shared: number;
  bare: number;
  rejected: number;
  pruned: number;
  sessionsCleared: number;
  chainClears: number;
  staleCleaned: number;
  evicted: number;
  claimed: number;
  claimRefused: number;
  reloads: number;
}

const OPS = [
  ['create', 22],
  ['burst', 6],
  ['reuse', 8],
  ['bare', 4],
  ['clearSession', 12],
  ['clearChainBase', 5],
  ['clearChainRun', 8],
  ['stale', 4],
  ['evict', 7],
  ['claim', 7],
  ['reload', 4],
] as const;
type OpKind = (typeof OPS)[number][0];
const OP_WEIGHT_TOTAL = OPS.reduce((sum, [, weight]) => sum + weight, 0);

describe('ChainSessionStore run indexes stay consistent across every mutator', () => {
  let tmpDir: string;
  let engine: SqliteEngine;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'run-index-invariant-'));
    engine = await SqliteEngine.getInstance(createLogger(), {
      dbPath: path.join(tmpDir, 'runtime-state', 'state.db'),
    });
    await engine.initialize();
  });

  afterAll(async () => {
    await engine.shutdown();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function runSequence(seed: number, opCount: number): Promise<Tally> {
    const random = seededRandom(seed);
    const pick = <T>(items: readonly T[]): T | undefined =>
      items.length === 0 ? undefined : items[Math.floor(random() * items.length)];
    const logger = createLogger();
    // Each seed owns its rows: the owner is the run scope's continuity id, so a reload loads only
    // this seed's runs and a persist rewrites only them.
    const owner = `owner-inv-${seed}`;
    const bases = ['a', 'b', 'c'].map((suffix) => `chain-inv${seed}${suffix}`);
    const scopes: StateStoreOptions[] = [
      { continuityScopeId: `scope-${seed}-1` },
      { continuityScopeId: `scope-${seed}-2` },
    ];
    const tally: Tally = {
      created: 0,
      renamed: 0,
      shared: 0,
      bare: 0,
      rejected: 0,
      pruned: 0,
      sessionsCleared: 0,
      chainClears: 0,
      staleCleaned: 0,
      evicted: 0,
      claimed: 0,
      claimRefused: 0,
      reloads: 0,
    };
    let counter = 0;
    const nextSessionId = (): string => `inv${seed}-s${++counter}`;

    const openStore = async (): Promise<ChainSessionStore> => {
      const opened = new ChainSessionStore(
        logger,
        new StubTextReferenceStore() as never,
        { cleanupIntervalMs: 60_000, defaultScope: { continuityScopeId: owner } },
        engine
      );
      await (opened as unknown as { initPromise: Promise<void> }).initPromise;
      return opened;
    };
    let store = await openStore();

    const heldIds = (): string[] => [...indexesOf(store).activeSessions.keys()];
    const historyEntries = (): string[] => bases.flatMap((base) => store.getRunHistory(base));
    const scopeOrNone = (): StateStoreOptions | undefined =>
      random() < 0.4 ? undefined : pick(scopes);

    let attempting = '';
    // No production caller creates a bare base id (the session stage always mints `#n`), but the
    // store accepts one and indexes it under itself. A second bare id in one scope collides with
    // the hook projection's unique key (the persist reserves only numbered ids away); that save is
    // rejected and memory restored, which the invariant check after the op then reads. A collision
    // on a numbered id is not expected and fails the run.
    const create = async (chainId: string, scope: StateStoreOptions): Promise<string> => {
      attempting = `${chainId} in ${String(scope.continuityScopeId)}`;
      try {
        const created = await store.createSession(nextSessionId(), chainId, 2, {}, scope);
        tally.created++;
        if (created.chainId !== chainId) tally.renamed++;
        if (parseRunNumber(chainId) === undefined) tally.bare++;
        return `${chainId} -> ${created.chainId} in ${String(scope.continuityScopeId)}`;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const bare = parseRunNumber(chainId) === undefined;
        if (!bare || !/UNIQUE constraint failed: chain_sessions/.test(message)) throw error;
        tally.rejected++;
        return `${attempting} rejected by the hook projection's unique key`;
      }
    };
    const mintedFor = (base: string): string =>
      formatChainId(base, nextRunNumber(store.getRunHistory(base)));

    const ops: Record<OpKind, () => Promise<string>> = {
      create: () => create(mintedFor(pick(bases)!), pick(scopes)!),
      burst: async () => {
        const base = pick(bases)!;
        const scope = pick(scopes)!;
        const steps: string[] = [];
        for (let i = 0; i < 4; i++) steps.push(await create(mintedFor(base), scope));
        return steps.join(', ');
      },
      reuse: async () => {
        const chainId = pick(historyEntries());
        if (chainId === undefined) return 'no run to reuse';
        const scope = pick(scopes)!;
        const sharedBefore = indexesOf(store).chainSessionMapping.get(chainId)?.size ?? 0;
        const detail = await create(chainId, scope);
        if ((indexesOf(store).chainSessionMapping.get(chainId)?.size ?? 0) > sharedBefore) {
          tally.shared++;
        }
        return detail;
      },
      bare: () => create(pick(bases)!, pick(scopes)!),
      clearSession: async () => {
        const sessionId = random() < 0.1 ? 'inv-missing' : pick(heldIds());
        if (sessionId === undefined) return 'no session to clear';
        const scope = scopeOrNone();
        const cleared = await store.clearSession(sessionId, scope);
        if (cleared) tally.sessionsCleared++;
        return `${sessionId} in ${String(scope?.continuityScopeId)}: ${String(cleared)}`;
      },
      clearChainBase: async () => {
        const base = pick(bases)!;
        const scope = scopeOrNone();
        await store.clearSessionsForChain(base, scope);
        tally.chainClears++;
        return `${base} in ${String(scope?.continuityScopeId)}`;
      },
      clearChainRun: async () => {
        const chainId = random() < 0.15 ? formatChainId(pick(bases)!, 99) : pick(historyEntries());
        if (chainId === undefined) return 'no run to clear';
        const scope = scopeOrNone();
        await store.clearSessionsForChain(chainId, scope);
        tally.chainClears++;
        return `${chainId} in ${String(scope?.continuityScopeId)}`;
      },
      stale: async () => {
        const held = indexesOf(store).activeSessions;
        for (const sessionId of heldIds()) {
          if (random() < 0.3) held.get(sessionId)!.lastActivity = 1;
        }
        const cleaned = await store.cleanupStaleSessions();
        tally.staleCleaned += cleaned;
        return `${cleaned} cleaned`;
      },
      evict: async () => {
        const sessionId = pick(heldIds());
        if (sessionId === undefined) return 'no run to hand off';
        const minted = await store.mintHandoffToken(sessionId);
        expect(minted).toBeDefined();
        const claim = new DirectChainRunRegistry(engine).claimRunByToken(minted!.token, {
          continuityScopeId: `claimer-${seed}-${counter}`,
        });
        expect(claim.status).toBe('claimed');
        // The next persist reports the run as claimed elsewhere and evicts it.
        const trigger = pick(heldIds().filter((id) => id !== sessionId));
        if (trigger === undefined) await create(mintedFor(pick(bases)!), pick(scopes)!);
        else await store.mintHandoffToken(trigger);
        expect(store.hasActiveSession(sessionId)).toBe(false);
        tally.evicted++;
        return `${sessionId} (${minted!.chainId}) claimed elsewhere and evicted`;
      },
      claim: async () => {
        const base = pick(bases)!;
        const chainId = formatChainId(
          base,
          1 + Math.floor(random() * (nextRunNumber(store.getRunHistory(base)) + 2))
        );
        const scope = pick(scopes)!.continuityScopeId!;
        const sessionId = nextSessionId();
        const token = `hnd_inv_${seed}_${counter}`;
        const donated: ChainSession = {
          sessionId,
          chainId,
          state: {
            currentNodeId: 'n1',
            nodes: [
              { id: 'n1', promptId: 'p1', stepName: 'one' },
              { id: 'n2', promptId: 'p2', stepName: 'two' },
            ] as ChainSession['state']['nodes'],
            lastUpdated: 1,
            stepStates: new Map(),
          },
          executionOrder: [],
          startTime: Date.now(),
          lastActivity: Date.now(),
          originalArgs: {},
          continuityScopeId: scope,
          lifecycle: 'canonical',
          runStatus: 'working',
          blueprint: { parsedCommand: { promptId: 'p1' } } as unknown as ChainSession['blueprint'],
          handoffToken: token,
        };
        await new DirectChainRunRegistry(engine).save([donated], {
          continuityScopeId: `donor-${seed}-${counter}`,
        });
        const result = await store.claimHandoff(token);
        if (result.status === 'claimed') tally.claimed++;
        else if (result.status === 'chain-id-held') tally.claimRefused++;
        else throw new Error(`unexpected claim result ${JSON.stringify(result)}`);
        return `${chainId} in ${scope}: ${result.status}`;
      },
      reload: async () => {
        const before = membershipOf(store);
        await store.cleanup();
        store = await openStore();
        expect(membershipOf(store)).toEqual(before);
        tally.reloads++;
        return `${Object.keys(before).length} chain ids reloaded`;
      },
    };

    const trail: string[] = [];
    try {
      for (let i = 0; i < opCount; i++) {
        let roll = random() * OP_WEIGHT_TOTAL;
        const kind = OPS.find(([, weight]) => (roll -= weight) < 0)?.[0] ?? 'create';
        const label = `#${i} ${kind}: ${await ops[kind]().catch((error: unknown) => {
          throw new Error(
            `seed ${seed}: op #${i} ${kind} (creating ${attempting}) threw ${String(error)}\n` +
              `preceding ops:\n  ${trail.slice(-6).join('\n  ')}`
          );
        })}`;
        trail.push(label);
        const violations = invariantViolations(store);
        if (violations.length > 0) {
          throw new Error(
            `seed ${seed}: run indexes disagree after ${label}\n  ${violations.join('\n  ')}\n` +
              `preceding ops:\n  ${trail.slice(-6, -1).join('\n  ')}`
          );
        }
      }
    } finally {
      await store.cleanup();
    }
    tally.pruned = (logger.info as jest.Mock).mock.calls.filter(([message]) =>
      String(message).startsWith('Pruned oldest run')
    ).length;
    return tally;
  }

  test.each([1, 7, 42, 2026])(
    'seed %i: 300 operations leave the indexes in agreement after each one',
    async (seed) => {
      const tally = await runSequence(seed, 300);

      // Positive controls for the sequence itself: every mutator path actually ran.
      expect(tally.created).toBeGreaterThan(0);
      expect(tally.renamed).toBeGreaterThan(0);
      expect(tally.shared).toBeGreaterThan(0);
      expect(tally.pruned).toBeGreaterThan(0);
      expect(tally.sessionsCleared).toBeGreaterThan(0);
      expect(tally.chainClears).toBeGreaterThan(0);
      expect(tally.staleCleaned).toBeGreaterThan(0);
      expect(tally.evicted).toBeGreaterThan(0);
      expect(tally.claimed).toBeGreaterThan(0);
      expect(tally.reloads).toBeGreaterThan(0);
      expect(tally.bare + tally.rejected).toBeGreaterThan(0);
    },
    120_000
  );
});
