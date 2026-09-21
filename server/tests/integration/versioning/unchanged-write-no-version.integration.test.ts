// @lifecycle canonical - Integration tests for S1.3: an unchanged write creates no version row.
/**
 * `version_history` has TWO accepted writers against ONE file, and they must agree on what
 * "unchanged" means.
 *
 * Before this row they did not. `VersionHistoryService` compared with `isDeepStrictEqual` and used
 * the answer only to decide whether to write a BRIDGE row — the produced state was inserted
 * unconditionally, so an update that changed nothing still spent a version. `cli-shared` compared
 * `JSON.stringify(...) === JSON.stringify(...)`, which is order-SENSITIVE, so a snapshot the
 * server had written with its own key order read as different data to `cpm`. CHANGELOG 4.0.0
 * claims "version comparison now ignores JSON key order" for the system; it held on one writer.
 *
 * Every test here runs against a REAL `state.db` written by the real `SqliteEngine`, with both
 * writers pointed at that one file under one tenant — which is the whole point: the agreement is
 * only meaningful when the row one writer left is the row the other one reads.
 *
 * Absences are asserted with positive controls throughout: each "no row was written" case is
 * paired with a genuinely-different write on the same resource, so a probe that could never
 * observe a row cannot pass by observing nothing.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import {
  recordResourceWrite as cliRecordResourceWrite,
  loadHistory as cliLoadHistory,
  rollbackVersion as cliRollbackVersion,
  saveVersion as cliSaveVersion,
} from '../../../src/cli-shared/version-history.js';
import { VersionHistoryService } from '../../../src/modules/versioning/version-history-service.js';
import { createTestDatabaseManager } from '../../helpers/test-database.js';

import type { TestDatabaseContext } from '../../helpers/test-database.js';
import type { VersioningConfigProvider } from '../../../src/modules/versioning/version-history-service.js';

/**
 * One tenant for both writers.
 *
 * The CLI derives its tenant from `CLAUDE_PROJECT_DIR`'s basename; the server resolves it from the
 * scope it was constructed with. Naming the same value on both sides is what puts their rows in
 * the same bucket — without it each would read an empty history and every assertion below would
 * pass for the wrong reason.
 */
const TENANT_DIR = '/srv/identity-agreement';
const TENANT = 'identity-agreement';

class FixedVersioningConfig implements VersioningConfigProvider {
  constructor(private readonly root: string) {}
  getVersioningConfig() {
    return { enabled: true, maxVersions: 50, autoVersion: true };
  }
  getServerRoot(): string {
    return this.root;
  }
}

/** A snapshot with several keys, so permuting them is a meaningful permutation. */
const SNAPSHOT = {
  id: 'shared-gate',
  name: 'Shared gate',
  description: 'original description',
  severity: 'medium',
  tags: ['a', 'b'],
};

/** The same data, every key emitted in a different order and the ARRAY left alone. */
const PERMUTED = {
  tags: ['a', 'b'],
  severity: 'medium',
  description: 'original description',
  name: 'Shared gate',
  id: 'shared-gate',
};

/** Rows only: this fixture has a `state.db` and no resource files, so every row is projection-only. */
const ROWS_ONLY_RESTORE = {
  enumerate: (): Promise<never> => Promise.reject(new Error('no resource files in this fixture')),
  targets: [],
  // Returns the snapshot it was handed: this fixture writes no files, so the state the restore
  // produced IS the target state.
  apply: (snapshot: Record<string, unknown>): Promise<Record<string, unknown>> =>
    Promise.resolve(snapshot),
};

describe('an unchanged write creates no version row', () => {
  let dbCtx: TestDatabaseContext;
  let service: VersionHistoryService;
  /** What the CLI writer is handed to locate `state.db` — it walks UP to `runtime-state/`. */
  let resourceDir: string;
  let previousProjectDir: string | undefined;

  const countRows = (): number =>
    cliLoadHistory(resourceDir, { resourceType: 'gate', resourceId: 'shared-gate' })?.versions
      .length ?? 0;

  beforeEach(async () => {
    previousProjectDir = process.env['CLAUDE_PROJECT_DIR'];
    process.env['CLAUDE_PROJECT_DIR'] = TENANT_DIR;

    dbCtx = await createTestDatabaseManager('unchanged-write');
    resourceDir = path.join(dbCtx.testDir, 'resources', 'gates');
    mkdirSync(resourceDir, { recursive: true });

    service = new VersionHistoryService({
      logger: dbCtx.logger,
      configManager: new FixedVersioningConfig(dbCtx.testDir),
      dbManager: dbCtx.dbManager,
      scope: { workspaceId: TENANT },
    });
  });

  afterEach(async () => {
    if (previousProjectDir === undefined) delete process.env['CLAUDE_PROJECT_DIR'];
    else process.env['CLAUDE_PROJECT_DIR'] = previousProjectDir;
    await dbCtx.cleanup();
  });

  describe('server writer', () => {
    it('records the first state, then nothing for an identical repeat', async () => {
      const first = await service.saveVersion('gate', 'shared-gate', SNAPSHOT);
      expect(first).toEqual({ success: true, version: 1, recorded: true });

      const repeat = await service.saveVersion('gate', 'shared-gate', SNAPSHOT);
      expect(repeat).toEqual({ success: true, version: 1, recorded: false });
      expect(countRows()).toBe(1);

      // Positive control: the probe CAN see a row appear.
      const changed = await service.saveVersion('gate', 'shared-gate', {
        ...SNAPSHOT,
        description: 'edited',
      });
      expect(changed.recorded).toBe(true);
      expect(countRows()).toBe(2);
    });

    it('ignores key order, and sees a permuted ARRAY as a real change', async () => {
      await service.saveVersion('gate', 'shared-gate', SNAPSHOT);

      const permuted = await service.saveVersion('gate', 'shared-gate', PERMUTED);
      expect(permuted.recorded).toBe(false);

      // Array order IS content — the control that the equality rule is canonicalising keys, not
      // flattening everything into an order-blind bag.
      const reordered = await service.saveVersion('gate', 'shared-gate', {
        ...SNAPSHOT,
        tags: ['b', 'a'],
      });
      expect(reordered.recorded).toBe(true);
      expect(countRows()).toBe(2);
    });

    it('records one row per edit, and nothing for an edit that produces the prior state', async () => {
      await service.saveVersion('gate', 'shared-gate', SNAPSHOT);

      const edit = await service.recordEditResult('gate', 'shared-gate', SNAPSHOT, {
        ...SNAPSHOT,
        description: 'edited',
      });
      expect(edit).toMatchObject({ version: 2, recorded: true, bridged: false });
      expect(countRows()).toBe(2);

      const noop = await service.recordEditResult(
        'gate',
        'shared-gate',
        { ...SNAPSHOT, description: 'edited' },
        { ...SNAPSHOT, description: 'edited' }
      );
      expect(noop).toMatchObject({ version: 2, recorded: false, bridged: false });
      expect(countRows()).toBe(2);
    });

    it('still bridges an unrecorded prior live state', async () => {
      // The bridge is not a casualty of the skip: an out-of-band state that was never recorded
      // must still become rollback-reachable.
      await service.saveVersion('gate', 'shared-gate', SNAPSHOT);
      const edit = await service.recordEditResult(
        'gate',
        'shared-gate',
        { ...SNAPSHOT, description: 'changed on disk' },
        { ...SNAPSHOT, description: 'then edited' }
      );
      expect(edit.bridged).toBe(true);
      expect(edit.recorded).toBe(true);
      expect(countRows()).toBe(3);
    });
  });

  describe('cpm writer', () => {
    it('records the first state, then nothing for an identical repeat', () => {
      expect(cliSaveVersion(resourceDir, 'gate', 'shared-gate', SNAPSHOT)).toMatchObject({
        version: 1,
        recorded: true,
      });
      expect(cliSaveVersion(resourceDir, 'gate', 'shared-gate', SNAPSHOT)).toMatchObject({
        version: 1,
        recorded: false,
      });
      expect(countRows()).toBe(1);

      // Positive control.
      expect(
        cliSaveVersion(resourceDir, 'gate', 'shared-gate', { ...SNAPSHOT, description: 'edited' })
      ).toMatchObject({ recorded: true });
      expect(countRows()).toBe(2);
    });

    it('ignores key order — the half of the CHANGELOG 4.0.0 claim that was never true here', () => {
      cliSaveVersion(resourceDir, 'gate', 'shared-gate', SNAPSHOT);

      // RED before this row: `JSON.stringify` preserves insertion order, so the permuted payload
      // compared unequal and `cpm` wrote a second row holding identical data.
      expect(cliSaveVersion(resourceDir, 'gate', 'shared-gate', PERMUTED)).toMatchObject({
        recorded: false,
      });
      expect(countRows()).toBe(1);
    });

    it('rolling back to the state already current records nothing', async () => {
      cliSaveVersion(resourceDir, 'gate', 'shared-gate', SNAPSHOT);
      cliSaveVersion(resourceDir, 'gate', 'shared-gate', { ...SNAPSHOT, description: 'v2' });
      expect(countRows()).toBe(2);

      const toCurrent = await cliRollbackVersion(
        resourceDir,
        { resourceType: 'gate', resourceId: 'shared-gate' },
        2,
        { ...SNAPSHOT, description: 'v2' },
        ROWS_ONLY_RESTORE
      );
      expect(toCurrent.success).toBe(true);
      expect(toCurrent.recorded).toBe(false);
      expect(toCurrent.saved_version).toBe(2);
      expect(countRows()).toBe(2);

      // Positive control: a rollback to a DIFFERENT version records exactly one row.
      const real = await cliRollbackVersion(
        resourceDir,
        { resourceType: 'gate', resourceId: 'shared-gate' },
        1,
        { ...SNAPSHOT, description: 'v2' },
        ROWS_ONLY_RESTORE
      );
      expect(real.recorded).toBe(true);
      expect(real.saved_version).toBe(3);
      expect(countRows()).toBe(3);
    });
  });

  describe('the two writers agree', () => {
    /**
     * The agreement assertion, on ONE db: whichever writer goes first, the other recognises its
     * row as the same state and writes nothing — even when the payload arrives key-permuted.
     *
     * This is a stronger claim than "both call the same function", because it is made against the
     * PERSISTED row rather than against two in-memory objects: it fails if the writers disagree
     * about the tenant, about what the column stores, or about the comparison itself.
     */
    it('cpm adds no row for a permuted state the server recorded', async () => {
      const server = await service.saveVersion('gate', 'shared-gate', SNAPSHOT);
      expect(server).toMatchObject({ version: 1, recorded: true });

      // Through `recordResourceWrite`, the writer a `cpm` edit actually reaches: it performs the
      // write and records what the write produced, so the "write" here is the identity — the
      // permuted state, already on disk — and the claim is that neither the bridge nor the
      // produced append adds a row for it.
      const cli = await cliRecordResourceWrite(
        resourceDir,
        { resourceType: 'gate', resourceId: 'shared-gate' },
        {
          enumerate: () => Promise.reject(new Error('no bytes — this row is projection-only')),
          targets: [],
          priorSnapshot: PERMUTED,
          write: () => Promise.resolve(PERMUTED),
          description: 'cpm edit producing the same state',
        }
      );
      expect(cli).toMatchObject({ written: true, recorded: false });
      expect(countRows()).toBe(1);
    });

    it('the server adds no row for a permuted state cpm recorded', async () => {
      const cli = cliSaveVersion(resourceDir, 'gate', 'shared-gate', PERMUTED);
      expect(cli).toMatchObject({ version: 1, recorded: true });

      const server = await service.saveVersion('gate', 'shared-gate', SNAPSHOT);
      expect(server).toMatchObject({ version: 1, recorded: false });
      expect(countRows()).toBe(1);
    });

    it('and both DO record a genuine change from the other — the control for the pair above', async () => {
      await service.saveVersion('gate', 'shared-gate', SNAPSHOT);
      const cli = cliSaveVersion(resourceDir, 'gate', 'shared-gate', {
        ...PERMUTED,
        description: 'genuinely different',
      });
      expect(cli).toMatchObject({ version: 2, recorded: true });

      const server = await service.saveVersion('gate', 'shared-gate', {
        ...SNAPSHOT,
        description: 'different again',
      });
      expect(server).toMatchObject({ version: 3, recorded: true });
      expect(countRows()).toBe(3);
    });
  });
});
