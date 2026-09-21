/**
 * `cpm config history` / `cpm config rollback`, driven at the COMMAND.
 *
 * Everything here runs through the BUILT binary (`server/dist/cpm.js`) in a hermetic temp
 * workspace, because two of the three defects the previous workers on this arc shipped were only
 * observable at the command: a flag read at the call site but never declared to `parseArgs`
 * (`strict: true` rejects it before any code runs), and a SELECT naming a column an older schema
 * does not have. Neither is visible to a test that imports the function.
 *
 * The fixture config is HAND-AUTHORED: a leading comment, a blank line, an inline trailing comment
 * and a non-ASCII character. A fixture the writer under test produced could only prove idempotence
 * — it would carry no comment to lose. Every byte-identity claim is checked against a digest this
 * file computes itself from the fixture constant, never against a value read back out of the thing
 * being tested.
 */

import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildServerEnv } from './helpers/child-env.js';
import { seedStateDbSchema } from '../helpers/test-database.js';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CPM_ENTRY = path.join(SERVER_ROOT, 'dist', 'cpm.js');

/** A config a human wrote. Comments, a blank line, and a character outside ASCII. */
const HAND_AUTHORED = `{
  // the operator's own note — café ☕ · do not lose me
  "$schema": "https://example.invalid/config.schema.json",
  "version": 5,

  "gates": { "enabled": true } // inline, deliberately
}
`;

/** Computed here, from the constant — never read back out of the code under test. */
const digestOf = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
const fileDigest = (file: string): string =>
  createHash('sha256').update(readFileSync(file)).digest('hex');

interface CpmRun {
  status: number;
  stdout: string;
  stderr: string;
}

describe('cpm config history and rollback (built binary)', () => {
  let root = '';
  let workspace = '';
  let configPath = '';

  const cpm = (...args: string[]): CpmRun => {
    const run = spawnSync('node', [CPM_ENTRY, ...args, '-w', workspace], {
      env: buildServerEnv({
        HOME: root,
        MCP_WORKSPACE: workspace,
        MCP_RUNTIME_ROOT: workspace,
        CLAUDE_PROJECT_DIR: workspace,
      }),
      cwd: workspace,
      encoding: 'utf8',
    });
    return {
      status: run.status ?? -1,
      stdout: run.stdout ?? '',
      stderr: run.stderr ?? '',
    };
  };

  const cpmJson = (...args: string[]): { run: CpmRun; json: Record<string, unknown> } => {
    const run = cpm(...args, '--json');
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(run.stdout) as Record<string, unknown>;
    } catch {
      json = {};
    }
    return { run, json };
  };

  beforeEach(async () => {
    root = mkdtempSync(path.join(tmpdir(), 'cpm-config-versions-'));
    workspace = path.join(root, 'ws');
    mkdirSync(workspace, { recursive: true });
    configPath = path.join(workspace, 'config.jsonc');
    writeFileSync(configPath, HAND_AUTHORED, 'utf8');
    await seedStateDbSchema(workspace);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('says so when a workspace has recorded nothing', () => {
    const run = cpm('config', 'history');
    expect(run.status).toBe(0);
    expect(run.stdout).toMatch(/No config versions recorded/);
    // Positive control: the same command DOES render a table once a version exists.
    cpm('config', 'set', 'gates.enabled', 'false');
    expect(cpm('config', 'history').stdout).toMatch(/Version History: config/);
  });

  it('records one produced row for two identical sets', () => {
    const first = cpmJson('config', 'set', 'gates.enabled', 'false');
    expect(first.run.status).toBe(0);
    expect(first.json['recorded']).toBe(true);
    expect(first.json['version']).toBe(2);

    const repeat = cpmJson('config', 'set', 'gates.enabled', 'false');
    expect(repeat.run.status).toBe(0);
    expect(repeat.json['recorded']).toBe(false);
    expect(String(repeat.json['recordNote'])).toContain('already matches version 2');

    const history = cpmJson('config', 'history');
    expect((history.json['versions'] as unknown[]).length).toBe(2);
  });

  it('restores version 1 byte for byte, comments and all', () => {
    expect(fileDigest(configPath)).toBe(digestOf(HAND_AUTHORED));
    cpm('config', 'set', 'gates.enabled', 'false');
    expect(fileDigest(configPath)).not.toBe(digestOf(HAND_AUTHORED));

    const rollback = cpmJson('config', 'rollback', '1');
    expect(rollback.run.status).toBe(0);
    expect(rollback.json['files_written']).toEqual(['config.jsonc']);

    // The whole claim, against a digest computed from the fixture constant in this file.
    expect(fileDigest(configPath)).toBe(digestOf(HAND_AUTHORED));
    const text = readFileSync(configPath, 'utf8');
    expect(text).toContain(`// the operator's own note — café ☕ · do not lose me`);
    expect(text).toContain('// inline, deliberately');
  });

  it('restores after a reset, which replaced the whole document', () => {
    const reset = cpmJson('config', 'reset', '--force');
    expect(reset.run.status).toBe(0);
    expect(reset.json['recorded']).toBe(true);
    // A reset writes the template — the operator's comment is gone from disk.
    expect(readFileSync(configPath, 'utf8')).not.toContain('café ☕');

    const rollback = cpmJson('config', 'rollback', '1');
    expect(rollback.run.status).toBe(0);
    expect(fileDigest(configPath)).toBe(digestOf(HAND_AUTHORED));
  });

  it('--preview writes nothing, and its plan equals the applied plan as one value', () => {
    cpm('config', 'set', 'gates.enabled', 'false');
    const beforeDigest = fileDigest(configPath);

    const preview = cpmJson('config', 'rollback', '1', '--preview');
    expect(preview.run.status).toBe(0);
    expect(preview.json['preview']).toBe(true);
    expect(preview.json['recorded']).toBe(false);
    // Nothing moved.
    expect(fileDigest(configPath)).toBe(beforeDigest);

    const applied = cpmJson('config', 'rollback', '1');
    expect(applied.run.status).toBe(0);

    // ONE value, compared as one value. The fields that differ are the ones that MUST differ
    // between a plan and its execution; everything describing the action itself is identical.
    const planOf = (json: Record<string, unknown>): unknown => ({
      restored_version: json['restored_version'],
      files_written: json['files_written'],
      files_unchanged: json['files_unchanged'],
      files_left_in_place: json['files_left_in_place'],
    });
    expect(JSON.stringify(planOf(preview.json))).toBe(JSON.stringify(planOf(applied.json)));
    // Control: the plan is not vacuously empty, so the equality above is a real comparison.
    expect(preview.json['files_written']).toEqual(['config.jsonc']);
  });

  it('refuses a version whose bytes this build no longer accepts, and writes nothing', () => {
    // v1 = the hand-authored config (bridge), v2 = the same with gates off. Both valid.
    cpm('config', 'set', 'gates.enabled', 'false');

    // Now put a document on disk that PARSES but is out of range for this build's key table —
    // the shape of a version recorded before a bound changed. The next set bridges it as v3.
    const outOfRange = HAND_AUTHORED.replace(
      '"version": 5,',
      '"version": 5,\n  "chainSessions": { "timeoutMinutes": 999999 },'
    );
    writeFileSync(configPath, outOfRange, 'utf8');
    cpm('config', 'set', 'gates.enabled', 'false');
    const beforeDigest = fileDigest(configPath);

    const refused = cpm('config', 'rollback', '3');
    expect(refused.status).toBe(1);
    expect(refused.stderr).toMatch(/not valid configuration for this build/);
    expect(refused.stderr).toMatch(/chainSessions\.timeoutMinutes/);
    expect(fileDigest(configPath)).toBe(beforeDigest);

    // Positive control, differing in ONE thing — the version number. v1 holds bytes this build
    // accepts, and the same command restores it, so the refusal above is about the BYTES rather
    // than about a rollback path that cannot succeed at all.
    const ok = cpm('config', 'rollback', '1');
    expect(ok.status).toBe(0);
    expect(fileDigest(configPath)).toBe(digestOf(HAND_AUTHORED));
  });

  it('refuses an unknown version by number', () => {
    cpm('config', 'set', 'gates.enabled', 'false');
    const refused = cpm('config', 'rollback', '99');
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain('config version 99 not found');
  });

  it('declares --preview to parseArgs — the flag is not rejected before the command runs', () => {
    cpm('config', 'set', 'gates.enabled', 'false');
    const run = cpm('config', 'rollback', '1', '--preview');
    expect(run.stderr).not.toMatch(/Unknown option/);
    expect(run.status).toBe(0);
  });

  it('writes the config and says it recorded nothing when the workspace has no state.db', () => {
    rmSync(path.join(workspace, 'runtime-state'), { recursive: true, force: true });
    const set = cpmJson('config', 'set', 'gates.enabled', 'false');
    expect(set.run.status).toBe(0);
    expect(set.json['recorded']).toBe(false);
    expect(String(set.json['recordNote'])).toMatch(/state\.db/);
    expect(readFileSync(configPath, 'utf8')).toContain('"enabled": false');
    expect(existsSync(configPath)).toBe(true);
  });

  it('keeps a second workspace history out of this one', async () => {
    cpm('config', 'set', 'gates.enabled', 'false');

    // A second workspace with its OWN config, its OWN tenant, and the SAME state.db file.
    const other = path.join(root, 'other');
    mkdirSync(other, { recursive: true });
    const otherConfig = path.join(other, 'config.jsonc');
    writeFileSync(otherConfig, HAND_AUTHORED.replace('café ☕', 'a different workspace'), 'utf8');
    await seedStateDbSchema(other);

    const otherRun = spawnSync(
      'node',
      [CPM_ENTRY, 'config', 'set', 'gates.enabled', 'false', '-w', other, '--json'],
      {
        env: buildServerEnv({
          HOME: root,
          MCP_WORKSPACE: other,
          MCP_RUNTIME_ROOT: workspace, // one state.db, two workspaces
          CLAUDE_PROJECT_DIR: other,
        }),
        cwd: other,
        encoding: 'utf8',
      }
    );
    expect(JSON.parse(otherRun.stdout ?? '{}')['recorded']).toBe(true);

    // Each workspace sees two rows — its own bridge and its own set — never four.
    const mine = cpmJson('config', 'history');
    expect((mine.json['versions'] as unknown[]).length).toBe(2);
    // And the bridge row it sees is THIS workspace's bytes, not the other's.
    const oldest = (mine.json['versions'] as Array<{ snapshot: { hash: string } }>).at(-1);
    expect(oldest?.snapshot.hash).toBe(`sha256:${digestOf(HAND_AUTHORED)}`);
    // Control: the other workspace's rows DO exist in that same file, so "two" above is a
    // statement about scoping rather than about a write that never happened.
    const rowCount = spawnSync(
      'node',
      [
        '-e',
        `const {DatabaseSync}=require('node:sqlite');` +
          `const db=new DatabaseSync(process.argv[1]);` +
          `console.log(db.prepare("SELECT COUNT(*) c FROM version_history WHERE resource_type='config'").get().c);`,
        path.join(workspace, 'runtime-state', 'state.db'),
      ],
      { encoding: 'utf8' }
    );
    expect(Number((rowCount.stdout ?? '0').trim())).toBe(4);
  });
});
