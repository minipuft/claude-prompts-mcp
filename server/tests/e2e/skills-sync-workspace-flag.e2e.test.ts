/**
 * A server started with `--workspace` and no `MCP_WORKSPACE` resolves skills sync through its
 * own live path resolver, over Streamable HTTP.
 *
 * `system_control`'s `skills_sync` action resolved its directories from the environment on
 * every call, independent of the `PathResolver` the rest of the server already builds from
 * `--workspace`. A server launched with the flag alone reported the package's own
 * `skills-sync.yaml` and could not see a resource the workspace held -- every other resource
 * type the server reads (prompts, gates, frameworks, styles) already follows `--workspace` the
 * same way it follows `MCP_WORKSPACE`; skills sync did not.
 */

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildServerEnv } from './helpers/child-env.js';
import {
  getAvailablePort,
  killServer,
  ModernMcpClient,
  waitForHealth,
} from './helpers/http-mcp-client.js';

const SERVER_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVER_ENTRY = path.join(SERVER_ROOT, 'dist', 'index.js');

const PROMPT_ID = 'workspace_flag_skills_sync_probe';

interface ToolResult {
  isError: boolean;
  text: string;
}

function toToolResult(result: unknown): ToolResult {
  const raw = result as { isError?: boolean; content?: Array<{ text?: string }> } | undefined;
  return {
    isError: raw?.isError === true,
    text: (raw?.content ?? []).map((part) => part.text ?? '').join('\n'),
  };
}

/**
 * Spawns the built server with `--workspace=<dir>` on the command line and no `MCP_WORKSPACE`
 * in its environment -- the shape the CLI flag alone produces. Distinct from
 * `startServerWithHttp`, which only ever sets the workspace through the environment.
 */
function spawnWithWorkspaceFlag(
  port: number,
  workspace: string,
  home: string,
  runtimeRoot: string
): ChildProcess {
  return spawn(
    'node',
    [SERVER_ENTRY, '--transport=streamable-http', '--quiet', `--workspace=${workspace}`],
    {
      cwd: SERVER_ROOT,
      env: buildServerEnv({ PORT: String(port), HOME: home, MCP_RUNTIME_ROOT: runtimeRoot }),
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
}

describe('a server started with --workspace and no MCP_WORKSPACE resolves skills sync over MCP', () => {
  let runDir: string;
  let workspace: string;
  let home: string;
  let proc: ChildProcess;
  let client: ModernMcpClient;
  let nextId = 1;

  beforeAll(async () => {
    runDir = await mkdtemp(path.join(tmpdir(), 'skills-sync-workspace-flag-e2e-'));
    workspace = path.join(runDir, 'workspace');
    home = path.join(runDir, 'home');
    const runtimeRoot = path.join(runDir, 'runtime');
    await mkdir(workspace, { recursive: true });
    await mkdir(home, { recursive: true });
    await mkdir(runtimeRoot, { recursive: true });

    const port = await getAvailablePort();
    proc = spawnWithWorkspaceFlag(port, workspace, home, runtimeRoot);
    const baseUrl = `http://localhost:${port}`;
    await waitForHealth(baseUrl, { timeout: 20000, interval: 200 });
    client = new ModernMcpClient(baseUrl);

    const createPrompt = toToolResult(
      await client.callTool(
        'resource_manager',
        {
          resource_type: 'prompt',
          action: 'create',
          id: PROMPT_ID,
          name: 'Workspace Flag Skills Sync Probe',
          category: 'general',
          description: 'Exists only under the --workspace flag, never under MCP_WORKSPACE',
          user_message_template: 'Say hello.',
        },
        nextId++
      )
    );
    expect(createPrompt.isError).toBe(false);

    await writeFile(
      path.join(workspace, 'skills-sync.yaml'),
      `exports:\n  - prompt:general/${PROMPT_ID}\n`
    );
  }, 30_000);

  afterAll(async () => {
    if (proc) await killServer(proc);
    if (runDir) await rm(runDir, { recursive: true, force: true, maxRetries: 5 });
  });

  it('reads the workspace skills-sync.yaml, not the package one', async () => {
    const result = toToolResult(
      await client.callTool(
        'system_control',
        { action: 'skills_sync', operation: 'status' },
        nextId++
      )
    );

    expect(result.isError).toBe(false);
    expect(result.text).toContain(path.join(workspace, 'skills-sync.yaml'));
  });

  it('previews the workspace prompt as an exportable skill, writing nothing under HOME', async () => {
    const result = toToolResult(
      await client.callTool(
        'system_control',
        { action: 'skills_sync', operation: 'export', preview: true, client: 'claude-code' },
        nextId++
      )
    );

    expect(result.isError).toBe(false);
    expect(result.text).toContain(`${PROMPT_ID}/SKILL.md`);

    let homeContents: string[] = [];
    try {
      homeContents = await readdir(home, { recursive: true });
    } catch {
      // ENOENT reading a directory nothing wrote into is the same "nothing was written" as [].
    }
    expect(homeContents).toEqual([]);
  });
});
