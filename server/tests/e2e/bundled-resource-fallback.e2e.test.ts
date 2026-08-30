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
import { existsSync } from 'node:fs';
import { readFile, cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import { buildServerEnv } from './helpers/child-env.js';

const SERVER_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PACKAGE_RESOURCES = path.join(SERVER_ROOT, 'resources');

interface Startup {
  exitCode: number | null;
  stderr: string;
  inventory: string;
  /** Every row the server wrote to `resource_index` — what the Python hooks will read. */
  indexed: { type: string; id: string }[];
}

/**
 * Read back the index the booted server produced.
 *
 * The log says what was SERVED; this says what was INDEXED. They are two separate derivations and
 * the whole point of the checks below is that nobody gets to assume they agree.
 */
function readIndex(runtimeRoot: string): { type: string; id: string }[] {
  const dbPath = path.join(runtimeRoot, 'runtime-state', 'state.db');
  if (!existsSync(dbPath)) return [];
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db.prepare('SELECT type, id FROM resource_index').all() as {
      type: string;
      id: string;
    }[];
  } finally {
    db.close();
  }
}

/** Boot a server against `workspace`, let it settle, then stop it and return what it logged. */
async function bootAndCapture(workspace: string): Promise<Startup> {
  const runtimeRoot = path.join(workspace, 'runtime');
  await mkdir(runtimeRoot, { recursive: true });

  const proc = spawn('node', [path.join(SERVER_ROOT, 'dist', 'index.js'), '--transport=stdio'], {
    env: buildServerEnv({ MCP_WORKSPACE: workspace, MCP_RUNTIME_ROOT: runtimeRoot }),
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
  return { exitCode, stderr, inventory, indexed: readIndex(runtimeRoot) };
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

  /**
   * Serving a resource and INDEXING it are two separate derivations, and for a day they disagreed
   * by 41 prompts with nothing failing. `resource_index` is what every Python hook reads, so the
   * gap was user-visible in the worst way: `>>strategicImplement` answered "Unknown prompt" for a
   * prompt `prompt_engine` executes.
   *
   * The last case here is the one that closes the CLASS rather than the three instances — it
   * fails on ANY future disagreement, including causes nobody has thought of yet. The four above
   * it exist so that when it fails, it fails somewhere that names the reason.
   */
  describe('the index describes the same catalog the server serves', () => {
    const idsOf = (type: string): string[] =>
      startup.indexed.filter((row) => row.type === type).map((row) => row.id);

    it('indexes the workspace prompt and the bundled prompts, not one or the other', () => {
      const prompts = idsOf('prompt');
      expect(prompts).toContain('probe_prompt');
      // A bundled prompt the workspace does not carry. Before the fix the indexer walked only the
      // primary root, so every one of these was absent while the server served them.
      expect(prompts).toContain('strategicImplement');
    });

    it('indexes gates, frameworks and styles rather than only prompts', () => {
      // These read ZERO against a workspace whose resources directory has no such subdirectory,
      // which is what made `get_valid_styles_from_db` return an empty list to the hooks.
      expect(idsOf('gate').length).toBeGreaterThan(0);
      expect(idsOf('framework').length).toBeGreaterThan(0);
      expect(idsOf('style').length).toBeGreaterThan(0);
    });

    it('indexes a chain step under the qualified id the tool answers to', () => {
      // Two failures in one: the scan stopped before this depth, and it keyed rows on the YAML
      // `id:` field, which the loader overwrites. A hook reading `initial_scan` hands the caller
      // an id `prompt_engine` rejects.
      expect(idsOf('prompt')).toContain('deep_analysis/initial_scan');
    });

    it('reports no disagreement between the index and the served catalog', () => {
      // The server compares the two itself at startup. Asserting on its own verdict means this
      // case covers divergences that have not been invented yet, rather than re-listing the three
      // that have. The bundled tree carries no unloadable prompt, so silence here is correct.
      expect(startup.inventory).not.toContain('missing from resource_index');
      expect(startup.inventory).not.toContain('are not served');
    });
  });
});
