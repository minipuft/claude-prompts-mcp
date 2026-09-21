/**
 * A framework created while the server runs is usable through the `@id` inline override, over a
 * real server — the same path a client takes.
 *
 * The command parser only treats `@word` as a framework operator when the word names a registered
 * framework, so `@docs/`-style text stays literal. It used to hold a copy of the framework ids
 * taken once at startup. `resource_manager` then created a framework that every other surface
 * could see, while `@<new id> >>prompt` was parsed as literal text and failed with a parse error
 * until the server restarted.
 *
 * Each case pairs with a control that must hold on either side of that change: a bundled
 * framework is recognized, and a word that names no framework, or names one that was deleted,
 * stays literal. Without the negative controls a parser that accepted every `@word` would pass.
 */

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  getAvailablePort,
  killServer,
  startServerWithHttp,
  StreamableHttpMcpClient,
  waitForHealth,
} from './helpers/http-mcp-client.js';

const PROMPT_ID = 'mid_session_framework_probe';
const PROMPT_BODY = 'mid-session framework probe body';
const FRAMEWORK_ID = 'mid_session_fw';
const FRAMEWORK_GUIDANCE = 'MID-SESSION-FRAMEWORK-GUIDANCE';

interface ToolOutcome {
  isError: boolean;
  text: string;
}

describe('framework created mid-session (Streamable HTTP)', () => {
  let proc: ChildProcess | null = null;
  let client: StreamableHttpMcpClient | null = null;
  let workspace = '';
  let runtimeRoot = '';
  let requestId = 1;

  const callTool = async (name: string, args: Record<string, unknown>): Promise<ToolOutcome> => {
    if (!client) throw new Error('client not initialized');
    const result = (await client.request('tools/call', { name, arguments: args }, ++requestId)) as {
      isError?: boolean;
      content?: Array<{ text?: string }>;
    };
    return {
      isError: result.isError === true,
      text: (result.content ?? []).map((part) => part.text ?? '').join('\n'),
    };
  };

  const render = (command: string): Promise<ToolOutcome> => callTool('prompt_engine', { command });

  beforeAll(async () => {
    const port = await getAvailablePort();
    const baseUrl = `http://localhost:${port}`;
    workspace = await mkdtemp(path.join(tmpdir(), 'framework-mid-session-ws-'));
    runtimeRoot = await mkdtemp(path.join(tmpdir(), 'framework-mid-session-rt-'));
    proc = startServerWithHttp(port, {
      transport: 'streamable-http',
      env: { MCP_WORKSPACE: workspace, MCP_RUNTIME_ROOT: runtimeRoot },
    });
    await waitForHealth(baseUrl, { timeout: 15000, interval: 200 });
    client = new StreamableHttpMcpClient(baseUrl);
    await client.initialize();

    const prompt = await callTool('resource_manager', {
      resource_type: 'prompt',
      action: 'create',
      id: PROMPT_ID,
      name: 'Mid-session framework probe',
      category: 'general',
      description: 'Renders under whichever framework the command names',
      user_message_template: PROMPT_BODY,
    });
    expect(prompt.isError).toBe(false);
  }, 60000);

  afterAll(async () => {
    if (client) await client.close();
    if (proc) await killServer(proc);
    if (workspace) await rm(workspace, { recursive: true, force: true });
    if (runtimeRoot) await rm(runtimeRoot, { recursive: true, force: true });
  }, 20000);

  it('control: a bundled framework named with @ applies', async () => {
    const outcome = await render(`@cageerf >>${PROMPT_ID}`);
    expect(outcome.isError).toBe(false);
    expect(outcome.text).toContain('C.A.G.E.E.R.F');
  }, 45000);

  it('control: an @word that names no framework stays literal text', async () => {
    const outcome = await render(`@not_a_framework >>${PROMPT_ID}`);
    expect(outcome.isError).toBe(true);
    expect(outcome.text).not.toContain(FRAMEWORK_GUIDANCE);
  }, 45000);

  it('a framework created after startup applies through @id', async () => {
    const created = await callTool('resource_manager', {
      resource_type: 'framework',
      action: 'create',
      id: FRAMEWORK_ID,
      name: 'Mid-session framework',
      description: 'Created while the server runs',
      system_prompt_guidance: FRAMEWORK_GUIDANCE,
      phases: [{ id: 'probe', name: 'Probe', description: 'The only phase' }],
      framework_gates: [
        {
          id: 'mid-session-probe-gate',
          name: 'Probe gate',
          description: 'Validates the probe phase',
          frameworkArea: 'probe',
          priority: 'high',
          validationCriteria: ['probe criterion'],
        },
      ],
    });
    expect(created.isError).toBe(false);

    const outcome = await render(`@${FRAMEWORK_ID} >>${PROMPT_ID}`);
    expect(outcome.text).not.toContain('Parse error');
    expect(outcome.isError).toBe(false);
    expect(outcome.text).toContain(FRAMEWORK_GUIDANCE);
    expect(outcome.text).toContain(PROMPT_BODY);
  }, 45000);

  it('after the framework is deleted, @id is literal text again', async () => {
    const deleted = await callTool('resource_manager', {
      resource_type: 'framework',
      action: 'delete',
      id: FRAMEWORK_ID,
      confirm: true,
    });
    expect(deleted.isError).toBe(false);

    const outcome = await render(`@${FRAMEWORK_ID} >>${PROMPT_ID}`);
    expect(outcome.isError).toBe(true);
    expect(outcome.text).not.toContain(FRAMEWORK_GUIDANCE);
  }, 45000);
});
