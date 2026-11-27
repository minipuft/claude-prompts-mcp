// @lifecycle test - `^` is the framework operator; `@<framework>` is refused naming `^`, over a real server.
/**
 * Over a real server (Streamable HTTP): a command that spells the framework operator `^ReACT`
 * renders the prompt with the framework; the same command spelled `@ReACT` is refused, the prompt
 * does not render, and the reply names `^ReACT`. An `@word` that names no framework is ordinary
 * argument text and the prompt renders.
 *
 * The refusal is `parseCommand`'s (`retired-operators.ts`), the one parse entry both transports
 * reach; the unit seam is `retired-operators.test.ts`. This proves the refusal reaches the caller
 * of the built server.
 */
import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';

import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { createHermeticRoots } from './helpers/child-env.js';
import {
  getAvailablePort,
  killServer,
  ModernMcpClient,
  startServerWithHttp,
  waitForHealth,
} from './helpers/http-mcp-client.js';

const BODY = 'SPELLING-PROBE-BODY';

describe('Streamable HTTP: the framework operator is `^`, and `@<framework>` is refused', () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  let client: ModernMcpClient;
  let nextId = 1;

  const tool = async (
    name: string,
    args: Record<string, unknown>
  ): Promise<{ isError: boolean; text: string }> => {
    const outcome = await client.callToolWithNotifications(name, args, nextId++);
    const result = outcome.result as
      { isError?: boolean; content?: Array<{ text?: string }> } | undefined;
    return {
      isError: result?.isError === true,
      text: (result?.content ?? []).map((part) => part.text ?? '').join('\n'),
    };
  };

  beforeAll(async () => {
    const roots = createHermeticRoots('framework-operator-spelling-e2e');
    cleanup.push(roots.cleanup);
    const workspace = path.join(roots.root, 'workspace');
    mkdirSync(workspace, { recursive: true });
    const port = await getAvailablePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const proc = startServerWithHttp(port, {
      env: { HOME: roots.home, MCP_WORKSPACE: workspace, MCP_RUNTIME_ROOT: roots.runtimeRoot },
    });
    cleanup.push(() => killServer(proc));
    await waitForHealth(baseUrl, { timeout: 45000, interval: 200 });
    client = new ModernMcpClient(baseUrl, 'framework-operator-spelling-e2e');

    const created = await tool('resource_manager', {
      resource_type: 'prompt',
      action: 'create',
      id: 'spelling_probe',
      category: 'general',
      name: 'spelling_probe',
      description: 'a prompt the framework operator spelling probe renders',
      user_message_template: BODY,
      gate_configuration: { exclude: ['content-structure'], framework_gates: false },
    });
    expect(created.isError).toBe(false);
  }, 90000);

  afterAll(async () => {
    for (const step of cleanup.reverse()) await step();
  });

  test('`^ReACT >>p` renders the prompt with the framework', async () => {
    const reply = await tool('prompt_engine', { command: '^ReACT >>spelling_probe' });

    expect(reply.isError).toBe(false);
    expect(reply.text).toContain(BODY);
    expect(reply.text).toContain('Re-run: `^react >>spelling_probe`');
  }, 120000);

  test('`@ReACT >>p` is refused, renders nothing, and names `^ReACT`', async () => {
    const reply = await tool('prompt_engine', { command: '@ReACT >>spelling_probe' });

    expect(reply.isError).toBe(true);
    expect(reply.text).not.toContain(BODY);
    expect(reply.text).toContain('Use the `^` framework operator (`^<framework id>`): `^ReACT`.');
  }, 120000);

  test('an `@word` that names no framework is argument text, and the prompt renders', async () => {
    const reply = await tool('prompt_engine', { command: '>>spelling_probe ask @someone' });

    expect(reply.isError).toBe(false);
    expect(reply.text).toContain(BODY);
  }, 120000);
});
