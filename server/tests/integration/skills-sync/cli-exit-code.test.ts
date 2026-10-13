/**
 * Skills-sync CLI exit status
 *
 * `scripts/skills-sync.ts` is the process boundary, so its exit status is only observable by
 * spawning it. A usage error (an unknown client, a flag on the wrong command) exits 2, and every
 * other failure exits 1 — `SkillsSyncCommandError.exitCode` carries the 2 from the service, and
 * only the wrapper turns it into a status.
 *
 * Every run is hermetic: `HOME` and `MCP_RUNTIME_ROOT` are temp directories, and `MCP_SERVER_ROOT`
 * names a temp package root holding one prompt and its own `skills-sync.yaml`, so no run reads or
 * writes the real `server/skills-sync.yaml` or a real client directory.
 */
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildServerEnv,
  createHermeticRoots,
  type HermeticRoots,
} from '../../../scripts/lib/hermetic-server-env.js';

const SERVER_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const TSX = path.join(SERVER_ROOT, 'node_modules', '.bin', 'tsx');
const SCRIPT = path.join(SERVER_ROOT, 'scripts', 'skills-sync.ts');

/** Every path under `root`, relative and sorted: the probe for "this run wrote nothing". */
function listTree(root: string): string[] {
  return readdirSync(root, { recursive: true, encoding: 'utf-8' })
    .map((entry) => entry.split(path.sep).join('/'))
    .sort();
}

describe('skills-sync CLI exit status', () => {
  let roots: HermeticRoots;
  let packageRoot: string;

  beforeEach(() => {
    roots = createHermeticRoots('skills-sync-exit');
    packageRoot = path.join(roots.root, 'package');
    const promptDir = path.join(packageRoot, 'resources', 'prompts', 'general', 'probe');
    mkdirSync(promptDir, { recursive: true });
    writeFileSync(path.join(promptDir, 'user-message.md'), 'Do the thing.');
    writeFileSync(
      path.join(promptDir, 'prompt.yaml'),
      'id: probe\nname: probe\ndescription: probe description\ncategory: general\n' +
        'userMessageTemplateFile: user-message.md\n'
    );
    writeFileSync(path.join(packageRoot, 'skills-sync.yaml'), 'registrations:\n  codex: all\n');
  });

  afterEach(() => {
    roots.cleanup();
  });

  function run(...args: string[]): { status: number | null; stderr: string } {
    const result = spawnSync(TSX, [SCRIPT, ...args], {
      cwd: SERVER_ROOT,
      encoding: 'utf-8',
      env: buildServerEnv({ ...roots.env, MCP_SERVER_ROOT: packageRoot }),
      timeout: 60_000,
    });
    return { status: result.status, stderr: result.stderr };
  }

  it('exits 2 on an unknown client, before reading or writing anything', () => {
    const before = listTree(roots.root);

    const result = run('export', '--client', 'bogus');

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Unknown client: bogus');
    expect(listTree(roots.root)).toEqual(before);
  }, 60_000);

  it('writes the client skill when the same command names a real client', () => {
    // Positive control for the test above: one identifier differs, and the tree probe sees the write.
    const before = listTree(roots.root);

    const result = run('export', '--client', 'codex');

    expect(result.status).toBe(0);
    expect(listTree(roots.root).filter((entry) => !before.includes(entry))).toContain(
      'home/.codex/skills/probe/SKILL.md'
    );
  }, 60_000);

  it('exits 1 on a failure that is not a usage error', () => {
    rmSync(path.join(packageRoot, 'skills-sync.yaml'));

    const result = run('export', '--client', 'codex');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('No skills-sync.yaml found');
  }, 60_000);
});
