/**
 * `skills_sync pull` and `clone` count the files they write (B.52) — this test drives both
 * over MCP against a hermetic server (temp HOME/workspace/runtime root, never the real home) and
 * asserts the reported count against a FILESYSTEM measurement, not just a non-zero reply.
 *
 * A manual drive recorded in a commit message is not a closure condition: nothing re-runs it, so
 * a later refactor of `summarizeRunReport` or the pull/clone counters could regress silently. This
 * is the regression test CI re-runs. Follows the hermetic-spawn pattern in
 * `skills-sync-workspace-flag.e2e.test.ts` and the temp-dir pattern in
 * `tests/integration/skills-sync/{pull,clone}-command.test.ts`.
 */

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
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

const PULL_PROMPT_ID = 'pull_count_probe';
const CLONE_ID = 'clone_count_probe';

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

function spawnHermetic(
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

async function readWorkspacePromptYaml(workspace: string, id: string): Promise<string> {
  return readFile(
    path.join(workspace, 'resources', 'prompts', 'general', id, 'prompt.yaml'),
    'utf8'
  );
}

describe('skills_sync pull/clone report a count matching the filesystem', () => {
  let runDir: string;
  let workspace: string;
  let home: string;
  let proc: ChildProcess;
  let client: ModernMcpClient;
  let nextId = 1;

  beforeAll(async () => {
    runDir = await mkdtemp(path.join(tmpdir(), 'pull-clone-count-e2e-'));
    workspace = path.join(runDir, 'workspace');
    home = path.join(runDir, 'home');
    const runtimeRoot = path.join(runDir, 'runtime');
    await mkdir(workspace, { recursive: true });
    await mkdir(home, { recursive: true });
    await mkdir(runtimeRoot, { recursive: true });

    const port = await getAvailablePort();
    proc = spawnHermetic(port, workspace, home, runtimeRoot);
    const baseUrl = `http://localhost:${port}`;
    await waitForHealth(baseUrl, { timeout: 20000, interval: 200 });
    client = new ModernMcpClient(baseUrl);

    const createPrompt = toToolResult(
      await client.callTool(
        'resource_manager',
        {
          resource_type: 'prompt',
          action: 'create',
          id: PULL_PROMPT_ID,
          name: 'Pull Count Probe',
          category: 'general',
          description: 'Exists only for the pull write-count regression test',
          user_message_template: 'Say hello.',
        },
        nextId++
      )
    );
    expect(createPrompt.isError).toBe(false);

    await writeFile(
      path.join(workspace, 'skills-sync.yaml'),
      `exports:\n  - prompt:general/${PULL_PROMPT_ID}\n`
    );

    // Export once so a SKILL.md exists under the temp HOME for `pull` to read back.
    const exportResult = toToolResult(
      await client.callTool(
        'system_control',
        { action: 'skills_sync', operation: 'export', client: 'claude-code' },
        nextId++
      )
    );
    expect(exportResult.isError).toBe(false);
  }, 30_000);

  afterAll(async () => {
    if (proc) await killServer(proc);
    if (runDir) await rm(runDir, { recursive: true, force: true, maxRetries: 5 });
  });

  it('reports 1 and rewrites exactly 1 file when one prose field changed', async () => {
    const skillPath = path.join(home, '.claude', 'skills', PULL_PROMPT_ID, 'SKILL.md');
    const original = await readFile(skillPath, 'utf8');
    const edited = original.replace(
      'Exists only for the pull write-count regression test',
      'Exists only for the pull write-count regression test (edited before pull)'
    );
    expect(edited).not.toBe(original);
    await writeFile(skillPath, edited);

    const before = await readWorkspacePromptYaml(workspace, PULL_PROMPT_ID);

    const pullResult = toToolResult(
      await client.callTool(
        'system_control',
        { action: 'skills_sync', operation: 'pull', client: 'claude-code' },
        nextId++
      )
    );
    expect(pullResult.isError).toBe(false);
    expect(pullResult.text).toContain('Files written (client: claude-code): 1');

    const after = await readWorkspacePromptYaml(workspace, PULL_PROMPT_ID);
    // The measured filesystem delta: exactly the one prompt.yaml this pull could touch.
    expect(after).not.toBe(before);
  });

  it('positive control: reports 0 and changes nothing when SKILL.md is unedited', async () => {
    // Re-export so the SKILL.md reflects the now-edited prompt.yaml from the prior test —
    // this run has nothing left for `pull` to find, which is the scenario under test.
    const reExport = toToolResult(
      await client.callTool(
        'system_control',
        { action: 'skills_sync', operation: 'export', client: 'claude-code' },
        nextId++
      )
    );
    expect(reExport.isError).toBe(false);

    const before = await readWorkspacePromptYaml(workspace, PULL_PROMPT_ID);

    const pullResult = toToolResult(
      await client.callTool(
        'system_control',
        { action: 'skills_sync', operation: 'pull', client: 'claude-code' },
        nextId++
      )
    );
    expect(pullResult.isError).toBe(false);
    expect(pullResult.text).toContain('Files written (client: claude-code): 0');

    const after = await readWorkspacePromptYaml(workspace, PULL_PROMPT_ID);
    expect(after).toBe(before);
  });

  it('clone reports a count matching the number of files it actually wrote', async () => {
    const sourceDir = path.join(runDir, 'clone-source');
    await mkdir(sourceDir, { recursive: true });
    const sourceSkillPath = path.join(sourceDir, 'SKILL.md');
    await writeFile(
      sourceSkillPath,
      [
        '---',
        'name: Clone Count Probe',
        'description: Exists only for the clone write-count regression test',
        '---',
        '',
        '## Instructions',
        '',
        'You are a helpful assistant for this regression test.',
        '',
      ].join('\n')
    );

    const cloneResult = toToolResult(
      await client.callTool(
        'system_control',
        {
          action: 'skills_sync',
          operation: 'clone',
          file: sourceSkillPath,
          id: CLONE_ID,
          category: 'general',
        },
        nextId++
      )
    );
    expect(cloneResult.isError).toBe(false);

    const writtenMatch = cloneResult.text.match(/Files written: (\d+)/);
    expect(writtenMatch).not.toBeNull();
    const reportedCount = Number(writtenMatch?.[1]);

    const targetDir = path.join(workspace, 'resources', 'prompts', 'general', CLONE_ID);
    const writtenFiles = await readdir(targetDir, { recursive: true });

    expect(reportedCount).toBeGreaterThan(0);
    expect(reportedCount).toBe(writtenFiles.length);
  });
});
