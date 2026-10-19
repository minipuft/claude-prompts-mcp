// @lifecycle canonical - Integration tests for one version_history.resource_type vocabulary (R13/R14).
/**
 * `version_history.resource_type` is one `TEXT` column with two writers, the server and `cpm`.
 * Each types it with its own union, and both unions are derived from `StoredResourceType`, the
 * column's whole vocabulary. These cases pin three things an operator would see go wrong:
 *
 *   1. Neither surface can be typed to hold a value the column never holds. This is a COMPILE-time
 *      check: jest transpiles without type-checking (`isolatedModules`), so a widened union fails
 *      `typecheck:tests:ratchet` on this file, not the jest run.
 *   2. A type with no resource files (`config`) is refused at byte restore by name, instead of
 *      reaching `resourceFileSet` and failing there with a message about an undefined filename.
 *   3. A config row the SERVER writes is a row `cpm config history` reads.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { loadConfigHistory } from '../../../src/cli-shared/config-restore.js';
import { createSafeConfigWriter } from '../../../src/mcp/tools/config-utils.js';
import {
  isByteRestorable,
  notByteRestorableReason,
} from '../../../src/modules/versioning/byte-restore.js';
import { seedStateDbSchema } from '../../helpers/test-database.js';
import { testScratchPath } from '../../helpers/scratch-path.js';

import type { HistoryResourceType } from '../../../src/cli-shared/version-history-types.js';
import type { ResourceType } from '../../../src/modules/versioning/types.js';
import type {
  FileBackedResourceType,
  StoredResourceType,
} from '../../../src/shared/types/version-history.js';

/** `true` exactly when every member of `A` is a member of `B`. Tuple-wrapped so it does not distribute. */
type IsSubset<A, B> = [A] extends [B] ? true : false;

/** Every value the column holds, written out here rather than read from the type under test. */
const STORED: readonly StoredResourceType[] = ['prompt', 'gate', 'framework', 'category', 'config'];

describe('version_history.resource_type has one vocabulary', () => {
  it('derives both surfaces from the stored vocabulary, each excluding what it does not write', () => {
    // A failing line here is a COMPILE error (`true` into a `false` slot), seen by the tests typecheck.
    const subsets: [
      IsSubset<HistoryResourceType, StoredResourceType>,
      IsSubset<ResourceType, StoredResourceType>,
      IsSubset<FileBackedResourceType, StoredResourceType>,
    ] = [true, true, true];
    // R53: the server's union gains no config write surface. R14a: cpm reads no category history.
    const exclusions: [
      IsSubset<'config', ResourceType>,
      IsSubset<'category', HistoryResourceType>,
      IsSubset<'config', FileBackedResourceType>,
    ] = [false, false, false];
    // Positive control for the helper itself: a member it should accept, it accepts.
    const members: [IsSubset<'config', HistoryResourceType>, IsSubset<'category', ResourceType>] = [
      true,
      true,
    ];

    expect([...subsets, ...exclusions, ...members]).toEqual([
      true,
      true,
      true,
      false,
      false,
      false,
      true,
      true,
    ]);
  });

  it('admits to byte restore exactly the stored types that have resource files', () => {
    const admitted = STORED.filter((type) => isByteRestorable(type));
    // `category` is admitted: `resource_manager` byte-restores categories
    // (`category-versioning-processor.ts`), and cpm cannot hold one (`HistoryResourceType`).
    expect(admitted).toEqual(['prompt', 'gate', 'framework', 'category']);
    expect(isByteRestorable('config')).toBe(false);
    expect(notByteRestorableReason('config')).toBe(
      'a config has no resource file set, so it cannot be restored byte for byte'
    );
  });
});

describe('a config row the server writes is one cpm reads', () => {
  let workspace: string;
  let previousProjectDir: string | undefined;

  beforeEach(async () => {
    previousProjectDir = process.env['CLAUDE_PROJECT_DIR'];
    workspace = testScratchPath(`stored-resource-type-${Math.random().toString(36).slice(2)}`);
    rmSync(workspace, { recursive: true, force: true });
    mkdirSync(workspace, { recursive: true });
    process.env['CLAUDE_PROJECT_DIR'] = workspace;
    writeFileSync(
      path.join(workspace, 'config.jsonc'),
      '{\n  "version": 5,\n  "gates": { "enabled": true }\n}\n',
      'utf8'
    );
    await seedStateDbSchema(workspace);
  });

  afterEach(() => {
    if (previousProjectDir === undefined) delete process.env['CLAUDE_PROJECT_DIR'];
    else process.env['CLAUDE_PROJECT_DIR'] = previousProjectDir;
    rmSync(workspace, { recursive: true, force: true });
  });

  it('records it under the stored value `config`, and cpm config history lists it', async () => {
    // Positive control: before any write, the reader sees nothing.
    expect(loadConfigHistory(workspace)?.versions ?? []).toEqual([]);

    // `SafeConfigWriter` is the object `system_control`'s persist path holds.
    const writer = createSafeConfigWriter(
      {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
        debug: () => undefined,
      } as never,
      { loadConfig: () => Promise.resolve() } as never,
      path.join(workspace, 'config.jsonc')
    );
    const written = await writer.updateConfigValue('gates.enabled', 'false');
    expect(written.success).toBe(true);
    expect(written.recordedVersion).toBe(2);

    const db = new DatabaseSync(path.join(workspace, 'runtime-state', 'state.db'));
    let stored: string[];
    try {
      stored = (
        db.prepare(`SELECT DISTINCT resource_type FROM version_history`).all() as unknown as Array<{
          resource_type: string;
        }>
      ).map((row) => row.resource_type);
    } finally {
      db.close();
    }
    expect(stored).toEqual(['config']);
    expect(STORED).toContain(stored[0]);

    // `loadConfigHistory` is what `cpm config history` calls.
    const versions = loadConfigHistory(workspace)?.versions ?? [];
    expect(versions.map((entry) => entry.version).sort()).toEqual([1, 2]);
    expect(versions.find((entry) => entry.version === 2)?.description).toBe('Set gates.enabled');
  });
});
