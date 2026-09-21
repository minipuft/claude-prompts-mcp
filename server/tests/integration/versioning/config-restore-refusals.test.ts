// @lifecycle canonical - Integration tests for O.9: every reason a config rollback refuses.
/**
 * A config rollback has no projection to fall back on, so every path that cannot produce the
 * recorded BYTES must refuse by name rather than produce a document.
 *
 * The four refusals below are the ones the CLI e2e cannot reach at the command: two of them need a
 * `state.db` in a state no writer here produces on demand (a row whose objects are gone, a schema
 * that predates v29), and one needs a workspace holding the other dialect's filename. Driving them
 * from here is what makes them testable at all; the two an operator CAN hit — an unknown version,
 * and bytes this build rejects — are driven at the command in
 * `tests/e2e/cpm-config-versions.e2e.test.ts`.
 *
 * Every case asserts what the config file holds AFTER the refusal, because "refused" and "refused
 * without writing" are different claims and only the second one is the contract.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { setConfigValueRecorded } from '../../../src/cli-shared/config-checkpoint.js';
import {
  loadConfigHistory,
  rollbackConfigVersion,
} from '../../../src/cli-shared/config-restore.js';
import { testScratchPath } from '../../helpers/scratch-path.js';
import { seedStateDbSchema } from '../../helpers/test-database.js';

const HAND_AUTHORED = `{
  // kept across a rollback — café ☕
  "version": 5,
  "gates": { "enabled": true }
}
`;

describe('a config rollback refuses rather than inventing a document', () => {
  let workspace: string;
  let configPath: string;
  let dbPath: string;
  let previousProjectDir: string | undefined;

  const openDb = (): DatabaseSync => new DatabaseSync(dbPath);

  beforeEach(async () => {
    previousProjectDir = process.env['CLAUDE_PROJECT_DIR'];
    workspace = testScratchPath(`config-restore-${Math.random().toString(36).slice(2)}`);
    rmSync(workspace, { recursive: true, force: true });
    mkdirSync(workspace, { recursive: true });
    process.env['CLAUDE_PROJECT_DIR'] = workspace;
    configPath = path.join(workspace, 'config.jsonc');
    dbPath = path.join(workspace, 'runtime-state', 'state.db');
    writeFileSync(configPath, HAND_AUTHORED, 'utf8');
    await seedStateDbSchema(workspace);
  });

  afterEach(() => {
    if (previousProjectDir === undefined) delete process.env['CLAUDE_PROJECT_DIR'];
    else process.env['CLAUDE_PROJECT_DIR'] = previousProjectDir;
    rmSync(workspace, { recursive: true, force: true });
  });

  it('restores version 1 byte for byte — the control every refusal below is measured against', async () => {
    await setConfigValueRecorded(workspace, 'gates.enabled', 'false');
    const result = await rollbackConfigVersion(workspace, 1);
    expect(result.ok).toBe(true);
    expect(readFileSync(configPath, 'utf8')).toBe(HAND_AUTHORED);
  });

  it('refuses a row whose recorded bytes are missing from the object store', async () => {
    await setConfigValueRecorded(workspace, 'gates.enabled', 'false');
    const before = readFileSync(configPath, 'utf8');

    // Remove the object v1's manifest points at, leaving the manifest row behind — the state the
    // startup referential repair normally prevents, and the one where a projection fallback would
    // silently restore something other than what the row advertises.
    const db = openDb();
    try {
      db.exec('PRAGMA foreign_keys = OFF');
      db.prepare(
        `DELETE FROM objects WHERE hash IN (
           SELECT object_hash FROM version_entries WHERE version_row_id =
             (SELECT id FROM version_history WHERE resource_type = 'config' AND version = 1)
         )`
      ).run();
    } finally {
      db.close();
    }

    const result = await rollbackConfigVersion(workspace, 1);
    expect(result.ok).toBe(false);
    expect(result.ok === false ? result.refusal : '').toMatch(/missing from the object store/);
    expect(readFileSync(configPath, 'utf8')).toBe(before);
  });

  it('refuses a row that recorded no bytes at all, naming the missing fallback', async () => {
    await setConfigValueRecorded(workspace, 'gates.enabled', 'false');
    const before = readFileSync(configPath, 'utf8');

    const db = openDb();
    try {
      db.prepare(
        `UPDATE version_history SET tree_hash = NULL WHERE resource_type = 'config' AND version = 1`
      ).run();
    } finally {
      db.close();
    }

    const result = await rollbackConfigVersion(workspace, 1);
    expect(result.ok).toBe(false);
    expect(result.ok === false ? result.refusal : '').toMatch(/no projected fallback/);
    expect(readFileSync(configPath, 'utf8')).toBe(before);
  });

  it('refuses to restore a .jsonc version into a workspace now holding a .json', async () => {
    await setConfigValueRecorded(workspace, 'gates.enabled', 'false');

    // The operator renamed their config. Restoring the recorded `config.jsonc` would leave both
    // names in one directory, which every reader here already refuses as ambiguous.
    rmSync(configPath);
    const jsonPath = path.join(workspace, 'config.json');
    writeFileSync(jsonPath, '{ "version": 5 }\n', 'utf8');

    const result = await rollbackConfigVersion(workspace, 1);
    expect(result.ok).toBe(false);
    expect(result.ok === false ? result.refusal : '').toMatch(/both names in one directory/);
    expect(readFileSync(jsonPath, 'utf8')).toBe('{ "version": 5 }\n');

    // Positive control: with the `.json` gone the same version restores, so the refusal is about
    // the collision rather than about a rollback path that cannot run.
    rmSync(jsonPath);
    const retry = await rollbackConfigVersion(workspace, 1);
    expect(retry.ok).toBe(true);
    expect(readFileSync(configPath, 'utf8')).toBe(HAND_AUTHORED);
  });

  it('preview resolves the same plan and writes nothing', async () => {
    await setConfigValueRecorded(workspace, 'gates.enabled', 'false');
    const before = readFileSync(configPath, 'utf8');

    const preview = await rollbackConfigVersion(workspace, 1, { preview: true });
    expect(readFileSync(configPath, 'utf8')).toBe(before);
    const applied = await rollbackConfigVersion(workspace, 1);
    expect(preview.ok && applied.ok).toBe(true);
    if (!preview.ok || !applied.ok) return;

    expect(JSON.stringify(preview.plan)).toBe(JSON.stringify(applied.plan));
    // Control: the compared value is not vacuously empty.
    expect(preview.plan.write.map((file) => file.path)).toEqual(['config.jsonc']);
    // And the preview genuinely wrote nothing: the file only moved once the apply ran.
    expect(before).not.toBe(HAND_AUTHORED);
    expect(readFileSync(configPath, 'utf8')).toBe(HAND_AUTHORED);
  });

  it('records the restore as a new version, so a rollback is itself undoable', async () => {
    await setConfigValueRecorded(workspace, 'gates.enabled', 'false');
    const result = await rollbackConfigVersion(workspace, 1);
    expect(result.ok && result.recorded).toBe(true);
    expect(result.ok ? result.savedVersion : 0).toBe(3);

    const history = loadConfigHistory(workspace);
    expect(history?.versions.map((entry) => entry.version).sort((a, b) => a - b)).toEqual([
      1, 2, 3,
    ]);
    expect(history?.versions.find((entry) => entry.version === 3)?.description).toBe(
      'Rollback to v1'
    );
  });
});
