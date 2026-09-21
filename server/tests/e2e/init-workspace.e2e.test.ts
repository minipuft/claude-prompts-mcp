/**
 * `--init` drives `initWorkspace` end to end, against the BUILT server.
 *
 * `initWorkspace` used to be defined twice: once here (`src/index.ts`, reached only through the
 * server's `--init` CLI flag) and once in `src/cli-shared/workspace-init.ts` (reached through the
 * `cpm`/`claude-prompts` CLI's `init` command, and covered by
 * `tests/unit/cli-shared/workspace-init.test.ts`). The two bodies were byte-identical once their
 * unicode escapes were normalized, so the server's `--init` flag was consolidated onto the
 * `cli-shared` copy — but nothing had ever driven the server's OWN `--init` flag through a spawned
 * process, so a divergence introduced by that consolidation (or a future edit to either copy)
 * would have gone unnoticed until an operator hit it. This is that missing coverage.
 *
 * Spawned rather than unit-tested because `main()`'s `--init` handling lives behind
 * `validateAndHandleEarlyExit`, which only runs when `src/index.ts` decides to call `main()` at
 * all — and it deliberately declines to under Jest (`NODE_ENV=test` / `JEST_WORKER_ID`). A unit
 * test importing the module would only prove the function computes the right value, not that the
 * CLI flag reaches it and writes.
 */

import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CONFIG_JSONC_TEMPLATE } from '../../src/cli-shared/_generated/config-template.js';
import { buildServerEnv, createHermeticRoots } from './helpers/child-env.js';

const SERVER_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST_ENTRY = path.join(SERVER_ROOT, 'dist', 'index.js');

interface Run {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

/** `--init` is a synchronous early-exit path: no transport starts, so the child exits on its own. */
async function runInit(args: string[]): Promise<Run> {
  const roots = createHermeticRoots('init-workspace-e2e');
  try {
    const proc = spawn('node', [DIST_ENTRY, ...args], {
      cwd: SERVER_ROOT,
      env: buildServerEnv(roots.env),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    return await new Promise<Run>((resolve, reject) => {
      const timer = setTimeout(() => {
        proc.kill();
        reject(new Error(`--init did not exit within 20s. stdout=${stdout} stderr=${stderr}`));
      }, 20_000);
      proc.on('exit', (code) => {
        clearTimeout(timer);
        resolve({ exitCode: code, stdout, stderr });
      });
    });
  } finally {
    roots.cleanup();
  }
}

describe('server --init spawns cli-shared initWorkspace and writes a starter workspace', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'init-workspace-e2e-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('creates the starter prompt tree and exits 0', async () => {
    const target = path.join(dir, 'new-workspace');

    const run = await runInit([`--init=${target}`]);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain(`Workspace created at: ${target}`);

    const promptsDir = path.join(target, 'resources', 'prompts');
    for (const id of ['quick_review', 'explain', 'improve']) {
      const promptDir = path.join(promptsDir, 'development', id);
      expect(existsSync(path.join(promptDir, 'prompt.yaml'))).toBe(true);
      expect(existsSync(path.join(promptDir, 'user-message.md'))).toBe(true);
    }
    const promptYaml = readFileSync(
      path.join(promptsDir, 'development', 'quick_review', 'prompt.yaml'),
      'utf8'
    );
    expect(promptYaml).toContain('id: quick_review');
  }, 30_000);

  it('refuses to overwrite an existing non-empty workspace and exits 1', async () => {
    const target = path.join(dir, 'existing-workspace');
    const first = await runInit([`--init=${target}`]);
    expect(first.exitCode).toBe(0);

    const second = await runInit([`--init=${target}`]);

    expect(second.exitCode).toBe(1);
    expect(second.stdout).toContain('Workspace already exists');
  }, 30_000);

  it('also writes config.jsonc, matching the generated template', async () => {
    const target = path.join(dir, 'config-workspace');

    const run = await runInit([`--init=${target}`]);

    expect(run.exitCode).toBe(0);
    const configPath = path.join(target, 'config.jsonc');
    expect(existsSync(configPath)).toBe(true);
    expect(readFileSync(configPath, 'utf8')).toBe(CONFIG_JSONC_TEMPLATE);
  }, 30_000);

  it('leaves an existing config.json untouched and writes no config.jsonc (positive control)', async () => {
    const target = path.join(dir, 'preconfigured-workspace');
    mkdirSync(target, { recursive: true });
    const existingConfigPath = path.join(target, 'config.json');
    const existingConfig = '{"$schema":"./config.schema.json","version":5}';
    writeFileSync(existingConfigPath, existingConfig, 'utf8');

    const run = await runInit([`--init=${target}`]);

    expect(run.exitCode).toBe(0);
    expect(readFileSync(existingConfigPath, 'utf8')).toBe(existingConfig);
    expect(existsSync(path.join(target, 'config.jsonc'))).toBe(false);
  }, 30_000);
});
