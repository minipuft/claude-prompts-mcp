/**
 * A workspace resource directory OVERLAYS the bundled tree; it does not replace it.
 *
 * This has to drive a real server. `resolveResourceSubdir` returns the first existing candidate
 * and stops, so once a workspace has `resources/<type>/` the bundled tree was never read — and the
 * consequence is only observable at startup, differently per resource type:
 *
 *   - frameworks: `FrameworkRegistry.loadBuiltInGuides` throws `FATAL: Framework 'cageerf' not
 *     found` and the process EXITS NON-ZERO. No unit test reaches that; it needs a real boot.
 *   - prompts: the catalog silently shrinks to whatever the workspace holds.
 *   - styles: an empty workspace `styles/` serves zero styles.
 *
 * Measured 2026-08-28 against `dist/index.js` before the fix — one framework in a workspace was
 * enough to make the server refuse to start.
 *
 * Each case asserts BOTH halves: the workspace entry is served AND the bundled entries survive.
 * Asserting only the first passes against the replacement behavior this test exists to forbid.
 */

import { describe, expect, it, beforeAll, afterAll } from '@jest/globals';
import { spawn } from 'node:child_process';
import { readFile, cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PACKAGE_RESOURCES = path.join(SERVER_ROOT, 'resources');

/**
 * `src/index.ts` refuses to run `main()` when `NODE_ENV === 'test'` or `JEST_WORKER_ID` is set, so
 * a child spawned with a plain `...process.env` from inside jest starts, does nothing and exits 0.
 */
function buildChildEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
  const env = { ...process.env, ...overrides };
  delete env['NODE_ENV'];
  delete env['JEST_WORKER_ID'];
  return env;
}

interface Startup {
  exitCode: number | null;
  stderr: string;
  inventory: string;
}

/** Boot a server against `workspace`, let it settle, then stop it and return what it logged. */
async function bootAndCapture(workspace: string): Promise<Startup> {
  const runtimeRoot = path.join(workspace, 'runtime');
  await mkdir(runtimeRoot, { recursive: true });

  const proc = spawn('node', [path.join(SERVER_ROOT, 'dist', 'index.js'), '--transport=stdio'], {
    env: buildChildEnv({ MCP_WORKSPACE: workspace, MCP_RUNTIME_ROOT: runtimeRoot }),
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stderr = '';
  proc.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  // Resolve on the process's own exit (the crash case) or once it has stayed up long enough to
  // have written its inventory (the healthy case). A crash must not be reported as a timeout.
  const exitCode = await new Promise<number | null>((resolve) => {
    const settle = setTimeout(() => {
      proc.kill();
      resolve(0);
    }, 45_000);
    proc.on('exit', (code) => {
      clearTimeout(settle);
      resolve(code);
    });
  });

  const logPath = path.join(runtimeRoot, 'logs', 'mcp-server.log');
  const inventory = await readFile(logPath, 'utf8').catch(() => '');
  return { exitCode, stderr, inventory };
}

/** The `📂 <resource>: <count>` figure the server logged, or null when it logged no such line. */
function servedCount(inventory: string, resource: string): number | null {
  const match = new RegExp(`📂 ${resource}: (\\d+)`).exec(inventory);
  return match?.[1] !== undefined ? Number(match[1]) : null;
}

describe('a workspace resource directory overlays the bundled tree (P1.0a)', () => {
  let workspace: string;
  let startup: Startup;
  let bundledFrameworkIds: string[];

  beforeAll(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), 'bundled-fallback-e2e-'));

    // A workspace holding ONE of each resource type and nothing else. This is the shape that
    // broke: not a copy of the bundled tree (which masks the defect by containing everything),
    // but a genuine personal library with a single entry.
    const wsResources = path.join(workspace, 'resources');
    await mkdir(path.join(wsResources, 'prompts', 'probecat', 'probe_prompt'), { recursive: true });
    await writeFile(
      path.join(wsResources, 'prompts', 'probecat', 'probe_prompt', 'prompt.yaml'),
      [
        'id: probe_prompt',
        'name: Probe Prompt',
        'category: probecat',
        'description: Workspace-only prompt for the bundled-fallback check',
        'userMessageTemplate: probe body',
        '',
      ].join('\n')
    );

    // One bundled framework, copied verbatim, deliberately NOT cageerf — cageerf is the one the
    // registry hard-requires, so copying it would hide the failure this test is about.
    bundledFrameworkIds = ['cageerf', '5w1h'];
    await mkdir(path.join(wsResources, 'frameworks'), { recursive: true });
    await cp(
      path.join(PACKAGE_RESOURCES, 'frameworks', '5w1h'),
      path.join(wsResources, 'frameworks', '5w1h'),
      { recursive: true }
    );

    // An EMPTY styles directory: enough to become the primary root, holding nothing to serve.
    await mkdir(path.join(wsResources, 'styles'), { recursive: true });

    startup = await bootAndCapture(workspace);
  }, 120_000);

  afterAll(async () => {
    if (workspace) await rm(workspace, { recursive: true, force: true });
  });

  it('starts, rather than dying on a bundled framework the workspace does not carry', () => {
    // The regression's signature. Before the fix this exited 1 with a FATAL naming cageerf.
    expect(startup.stderr).not.toContain('FATAL: Framework');
    expect(startup.exitCode).toBe(0);
  });

  it('serves the bundled frameworks alongside the workspace one', () => {
    // `>= bundled count` rather than an exact number: the assertion is that nothing was LOST, and
    // pinning the total would make this fail every time a framework ships.
    const served = servedCount(startup.inventory, 'frameworks');
    expect(served).not.toBeNull();
    expect(served as number).toBeGreaterThanOrEqual(bundledFrameworkIds.length);
  });

  it('serves the bundled prompts plus the workspace prompt, not the workspace prompt alone', () => {
    // The silent half of the defect: this read `1` before the fix, and a count with no root beside
    // it cannot be told from a healthy start.
    const served = servedCount(startup.inventory, 'prompts');
    expect(served).not.toBeNull();
    expect(served as number).toBeGreaterThan(1);
  });

  it('serves the bundled styles despite an empty workspace styles directory', () => {
    expect(servedCount(startup.inventory, 'styles')).toBeGreaterThan(0);
  });

  it('names the bundled base in the inventory, so the count and its sources agree', () => {
    // Without this line the count is unattributable — the exact failure the startup inventory was
    // added to remove, reintroduced one level up by merging two roots into one number.
    expect(startup.inventory).toContain('over bundled base:');
  });
});
