/**
 * A prompt hot reload must recompute the exported-prompt set from `skills-sync.yaml`, not just at
 * startup.
 *
 * WHY THIS TEST EXISTS
 * `Application.handlePromptHotReload` is the path every filesystem-triggered hot reload actually
 * takes. It reloaded prompt content and re-registered every prompt, but never recomputed which
 * prompts `skills-sync.yaml` exports — that computation lived only in `loadPromptData` (startup,
 * and the manual `fullServerRefresh` path). A prompt newly registered for export therefore stayed
 * in `prompts/list` until a restart, and one unregistered stayed hidden until a restart too.
 *
 * WHY STREAMABLE HTTP
 * HTTP builds a fresh `McpServer` per request and re-registers every prompt against the CURRENT
 * exported set on each connection, which is what makes the defect observable without racing the
 * MCP SDK's per-shell registration dedup guard. There is no prompt-unregistration API in this SDK
 * version, so a long-lived STDIO shell cannot un-list an already-bound prompt regardless of this
 * fix — that is a separate, pre-existing constraint, not something this test can exercise.
 *
 * Both arms read CONTENT, never a catalog count, and the reload itself is proven with a positive
 * control (the trigger prompt's edited body) before the exported-prompt assertion is trusted.
 */

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { ChildProcess } from 'node:child_process';
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import {
  getAvailablePort,
  killServer,
  ModernMcpClient,
  startServerWithHttp,
  waitForHealth,
} from './helpers/http-mcp-client.js';

const CATEGORY = 'probecat';
const EXPORTED_ID = 'reload_probe_exported';
const TRIGGER_ID = 'reload_probe_trigger';
const RELOAD_POLL_TIMEOUT_MS = 20000;
const RELOAD_POLL_INTERVAL_MS = 500;

interface PromptsListResult {
  prompts: Array<{ name: string }>;
}

interface PromptGetResult {
  messages: Array<{ content?: { text?: string } }>;
}

async function createFixturePrompt(
  client: ModernMcpClient,
  id: string,
  bodyMarker: string,
  nextId: () => number
): Promise<void> {
  const response = (await client.callTool(
    'resource_manager',
    {
      resource_type: 'prompt',
      action: 'create',
      id,
      name: id,
      category: CATEGORY,
      description: `Fixture prompt ${id}`,
      user_message_template: `Body of ${id} ${bodyMarker}`,
    },
    nextId()
  )) as { isError?: boolean };
  expect(response.isError ?? false).toBe(false);
}

async function listPromptNames(client: ModernMcpClient, nextId: () => number): Promise<string[]> {
  const result = (await client.request('prompts/list', {}, nextId())) as PromptsListResult;
  return result.prompts.map((prompt) => prompt.name);
}

async function promptBody(
  client: ModernMcpClient,
  name: string,
  nextId: () => number
): Promise<string> {
  const result = (await client.request('prompts/get', { name, arguments: {} }, nextId(), {
    toolName: name,
  })) as PromptGetResult;
  return result.messages[0]?.content?.text ?? '';
}

describe('a prompt hot reload recomputes the exported-prompt set (Streamable HTTP)', () => {
  let workspace: string;
  let promptDir: string;
  let server: ChildProcess;
  let client: ModernMcpClient;
  let idCounter = 1;
  const nextId = (): number => idCounter++;

  beforeAll(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), 'exported-prompts-reload-e2e-'));
    promptDir = path.join(workspace, 'resources', 'prompts', CATEGORY);
    await mkdir(workspace, { recursive: true });
    // Registers neither fixture prompt at startup.
    await writeFile(path.join(workspace, 'skills-sync.yaml'), 'registrations: {}\n', 'utf8');

    const port = await getAvailablePort();
    server = startServerWithHttp(port, {
      env: {
        MCP_WORKSPACE: workspace,
        MCP_RUNTIME_ROOT: path.join(workspace, '.runtime'),
        HOME: path.join(workspace, '.home'),
      },
    });
    await waitForHealth(`http://localhost:${port}`, { timeout: 20000, interval: 200 });
    client = new ModernMcpClient(`http://localhost:${port}`);

    await createFixturePrompt(client, EXPORTED_ID, 'v1', nextId);
    await createFixturePrompt(client, TRIGGER_ID, 'v1', nextId);
  }, 60000);

  afterAll(async () => {
    await killServer(server);
    await rm(workspace, { recursive: true, force: true, maxRetries: 5 });
  });

  /** Edits the trigger prompt's body and waits for the new content to be served. */
  async function fireReloadAndWait(marker: string): Promise<void> {
    const entries = await readdir(path.join(promptDir, TRIGGER_ID));
    const bodyFile = entries.find((entry) => entry.endsWith('.md'));
    if (!bodyFile)
      throw new Error(`no markdown body file found for ${TRIGGER_ID}: ${entries.join(', ')}`);
    await writeFile(
      path.join(promptDir, TRIGGER_ID, bodyFile),
      `Body of ${TRIGGER_ID} ${marker}\n`,
      'utf8'
    );

    const deadline = Date.now() + RELOAD_POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sleep(RELOAD_POLL_INTERVAL_MS);
      const body = await promptBody(client, TRIGGER_ID, nextId);
      if (body.includes(marker)) return;
    }
    throw new Error(
      `reload did not observe trigger marker "${marker}" within ${RELOAD_POLL_TIMEOUT_MS}ms`
    );
  }

  it('lists both fixture prompts before anything is exported — the starting state', async () => {
    const names = await listPromptNames(client, nextId);
    expect(names).toEqual(expect.arrayContaining([EXPORTED_ID, TRIGGER_ID]));
  });

  it('drops the newly exported prompt after a hot reload it did not cause directly', async () => {
    await writeFile(
      path.join(workspace, 'skills-sync.yaml'),
      `registrations:\n  claude-code:\n    user:\n      - "prompt:${CATEGORY}/${EXPORTED_ID}"\n`,
      'utf8'
    );

    // Positive control: proves the reload this edit triggers actually ran, before trusting the
    // exported-prompt assertion below.
    await fireReloadAndWait('v2-reload-one');

    const names = await listPromptNames(client, nextId);
    expect(names).not.toContain(EXPORTED_ID);
    expect(names).toContain(TRIGGER_ID);
  });

  it('returns the prompt once it is unregistered and another reload runs', async () => {
    await writeFile(path.join(workspace, 'skills-sync.yaml'), 'registrations: {}\n', 'utf8');

    await fireReloadAndWait('v3-reload-two');

    const names = await listPromptNames(client, nextId);
    expect(names).toContain(EXPORTED_ID);
    expect(names).toContain(TRIGGER_ID);
  });
});
