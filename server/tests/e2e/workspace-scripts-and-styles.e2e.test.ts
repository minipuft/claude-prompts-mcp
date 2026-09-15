/**
 * A workspace script tool and a workspace style resolve the way every other workspace resource
 * does, over a real server.
 *
 * `prompt-executor.ts` built the script-tool and style search directories from the package root
 * directly, so with a custom workspace configured — the shape the Claude Code plugin always
 * runs in — a script placed under `<workspace>/resources/scripts/<id>/` was never found, and a
 * style placed under `<workspace>/resources/styles/<id>/` matched nothing and rendered no
 * guidance, silently. Both are documented, reachable paths: `docs/guides/script-tools.md`
 * documents the workspace scripts tier, and `cpm create style <id> -w <workspace>` writes exactly
 * that styles path.
 *
 * Each case below asserts what a real `prompt_engine` run produces, not the resolved path alone —
 * a unit test on the path join cannot show whether the loader that reads it ever runs. The style
 * case also asserts the bundled `analytical` style still renders, so a fix that pointed the styles
 * loader at the workspace ALONE (dropping the bundled tree) would fail it — that regression is
 * exactly what the equivalent fix for prompts/gates/frameworks/styles discovery already guards
 * against elsewhere (`bundled-resource-fallback.e2e.test.ts`).
 */

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ChildProcess } from 'node:child_process';

import {
  getAvailablePort,
  killServer,
  ModernMcpClient,
  startServerWithHttp,
  waitForHealth,
} from './helpers/http-mcp-client.js';

const SCRIPT_MARKER = 'B30-E2E-WORKSPACE-SCRIPT-OUTPUT';
const STYLE_GUIDANCE_MARKER = 'B30-E2E-WORKSPACE-STYLE-GUIDANCE';

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

async function writeWorkspaceFixtures(workspace: string): Promise<void> {
  const scriptDir = path.join(workspace, 'resources', 'scripts', 'probe-script');
  await mkdir(scriptDir, { recursive: true });
  await writeFile(
    path.join(scriptDir, 'tool.yaml'),
    [
      'id: probe-script',
      'name: Probe Script',
      'description: workspace script resolution probe',
      'script: script.js',
      'runtime: node',
      'timeout: 5000',
      'execution:',
      '  trigger: explicit',
      '  confirm: false',
      '',
    ].join('\n')
  );
  await writeFile(
    path.join(scriptDir, 'script.js'),
    `console.log(JSON.stringify({ marker: "${SCRIPT_MARKER}" }));\n`
  );

  const styleDir = path.join(workspace, 'resources', 'styles', 'probe-style');
  await mkdir(styleDir, { recursive: true });
  await writeFile(
    path.join(styleDir, 'style.yaml'),
    [
      'id: probe-style',
      'name: Probe Style',
      'description: workspace style resolution probe',
      'guidanceFile: guidance.md',
      'priority: 0',
      'enabled: true',
      'enhancementMode: prepend',
      '',
    ].join('\n')
  );
  await writeFile(path.join(styleDir, 'guidance.md'), `${STYLE_GUIDANCE_MARKER}\n`);
}

describe('a workspace script and a workspace style resolve over a real server', () => {
  let workspace: string;
  let proc: ChildProcess;
  let client: ModernMcpClient;
  let nextId = 1;

  beforeAll(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), 'b30-workspace-scripts-styles-e2e-'));
    await writeWorkspaceFixtures(workspace);

    const runtimeRoot = path.join(workspace, 'runtime');
    await mkdir(runtimeRoot, { recursive: true });

    const port = await getAvailablePort();
    proc = startServerWithHttp(port, {
      env: { MCP_WORKSPACE: workspace, MCP_RUNTIME_ROOT: runtimeRoot },
    });
    const baseUrl = `http://localhost:${port}`;
    await waitForHealth(baseUrl, { timeout: 20000, interval: 200 });
    client = new ModernMcpClient(baseUrl);

    const createScriptPrompt = toToolResult(
      await client.callTool(
        'resource_manager',
        {
          resource_type: 'prompt',
          action: 'create',
          id: 'b30_e2e_script_probe',
          name: 'B30 E2E Script Probe',
          category: 'general',
          description: 'Workspace-tier script probe',
          user_message_template: 'Script: {{script:probe-script}}',
        },
        nextId++
      )
    );
    expect(createScriptPrompt.isError).toBe(false);

    const createStylePrompt = toToolResult(
      await client.callTool(
        'resource_manager',
        {
          resource_type: 'prompt',
          action: 'create',
          id: 'b30_e2e_style_probe',
          name: 'B30 E2E Style Probe',
          category: 'general',
          description: 'Style probe',
          user_message_template: 'Say hello.',
        },
        nextId++
      )
    );
    expect(createStylePrompt.isError).toBe(false);
  }, 60_000);

  afterAll(async () => {
    if (proc) await killServer(proc);
    if (workspace) await rm(workspace, { recursive: true, force: true, maxRetries: 5 });
  });

  it('finds and runs a script tool that lives only under the workspace', async () => {
    const result = toToolResult(
      await client.callTool('prompt_engine', { command: '>>b30_e2e_script_probe' }, nextId++)
    );

    expect(result.text).not.toContain('not found');
    expect(result.text).toContain(SCRIPT_MARKER);
  });

  it('renders guidance for a style that lives only under the workspace', async () => {
    const result = toToolResult(
      await client.callTool(
        'prompt_engine',
        { command: '#probe-style >>b30_e2e_style_probe' },
        nextId++
      )
    );

    expect(result.text).toContain('**Response Style:**');
    expect(result.text).toContain(STYLE_GUIDANCE_MARKER);
  });

  it('still renders the bundled analytical style alongside the workspace one', async () => {
    const result = toToolResult(
      await client.callTool(
        'prompt_engine',
        { command: '#analytical >>b30_e2e_style_probe' },
        nextId++
      )
    );

    expect(result.text).toContain('**Response Style:**');
    expect(result.text).not.toContain(STYLE_GUIDANCE_MARKER);
  });
});
