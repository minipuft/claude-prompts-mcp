// @lifecycle test - `^` is the framework operator and `@` a deprecated spelling: both run, only `@` is told so.
/**
 * Over a real server (Streamable HTTP): a command that spells the framework operator `^ReACT`
 * renders the prompt with the framework and says nothing about the spelling; the same command
 * spelled `@ReACT` renders identically AND carries one advisory line naming `^ReACT`.
 *
 * `@` collides with the file-mention trigger in the harnesses that host this server, so the
 * registry (`operators.json`) names `^` canonical and keeps `@` as an alias until the next major.
 * The alias is never refused: the note rides on a successful reply. The advisory is per command,
 * so a chain's later steps (resumed with `chain_id`, not re-parsed) do not repeat it.
 *
 * The unit seam (real parser, stage 06 and ResponseAssembler) is `operator-validation-stage.test.ts`;
 * this proves the line reaches the caller of the built server.
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

const NOTE =
  'Deprecated spelling: `@ReACT` still works, but the framework operator is `^ReACT`; ' +
  '`@` is removed at the next major.';
const BODY = 'SPELLING-PROBE-BODY';

const occurrences = (text: string, needle: string): number => text.split(needle).length - 1;

describe('Streamable HTTP: the framework operator is `^`, and `@` is a deprecated alias', () => {
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

  test('`^ReACT >>p` renders the prompt with the framework and carries no spelling note', async () => {
    const reply = await tool('prompt_engine', { command: '^ReACT >>spelling_probe' });

    expect(reply.isError).toBe(false);
    expect(reply.text).toContain(BODY);
    expect(reply.text).toContain('ReACT');
    expect(reply.text).not.toContain('Deprecated spelling');
  }, 120000);

  test('`@ReACT >>p` renders the same prompt and carries the note exactly once, naming `^`', async () => {
    const reply = await tool('prompt_engine', { command: '@ReACT >>spelling_probe' });

    expect(reply.isError).toBe(false);
    expect(reply.text).toContain(BODY);
    expect(reply.text).toContain('ReACT');
    expect(occurrences(reply.text, NOTE)).toBe(1);
  }, 120000);

  test.each(['^ReACT >>spelling_probe', '@ReACT >>spelling_probe'])(
    'the re-run line for `%s` spells the framework `^`',
    async (command) => {
      const reply = await tool('prompt_engine', { command });

      expect(reply.isError).toBe(false);
      expect(reply.text).toContain('Re-run: `^react >>spelling_probe`');
    },
    120000
  );
});
