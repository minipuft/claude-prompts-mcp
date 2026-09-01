import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { ApiRouter } from '../../../src/mcp/http/api.js';

import type { Server } from 'node:http';
import type { ConvertedPrompt } from '../../../src/engine/execution/types.js';
import type { McpToolRouter } from '../../../src/mcp/tools/index.js';
import type { ConfigManager, Logger, ToolResponse } from '../../../src/shared/types/index.js';

const logger: Logger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
};
const configManager = {} as ConfigManager;
const prompt: ConvertedPrompt = {
  id: 'governed_prompt',
  name: 'Governed Prompt',
  description: 'Authority test prompt',
  category: 'tests',
  userMessageTemplate: 'Version two',
  systemMessage: 'Be precise.',
  arguments: [],
};

describe('prompt authority HTTP API', () => {
  let server: Server | undefined;
  let currentVersion = 2;
  const action = jest.fn<(args: Record<string, unknown>) => Promise<ToolResponse>>();

  afterEach(
    () =>
      new Promise<void>((resolve, reject) => {
        action.mockReset();
        currentVersion = 2;
        if (server === undefined) return resolve();
        server.close((error) => (error === undefined ? resolve() : reject(error)));
        server = undefined;
      })
  );

  async function start(
    options: {
      readToken?: string | null;
      writeToken?: string | null;
      allowedOrigins?: string[];
    } = {}
  ): Promise<string> {
    action.mockImplementation(async (args) => respond(args));
    const tools = {
      getResourceManagerHandler: () => action,
    } as unknown as McpToolRouter;
    const router = new ApiRouter(logger, configManager, undefined, tools, {
      catalogReadToken: options.readToken ?? 'read-token',
      catalogWriteToken: options.writeToken ?? 'write-token',
      allowedOrigins: options.allowedOrigins,
    });
    router.updateData([], [], [prompt]);
    server = router.createApp().listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server?.once('listening', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('Expected TCP listener');
    return `http://127.0.0.1:${address.port}`;
  }

  it('authenticates before prompt lookup and rejects untrusted browser origins', async () => {
    const origin = await start({ allowedOrigins: ['https://trusted.example'] });
    const unauthorized = await fetch(`${origin}/api/v1/authority/prompts/missing`);
    const untrusted = await fetch(`${origin}/api/v1/authority/prompts/governed_prompt`, {
      headers: { authorization: 'Bearer read-token', origin: 'https://hostile.example' },
    });

    expect(unauthorized.status).toBe(401);
    expect(untrusted.status).toBe(403);
    expect(action).not.toHaveBeenCalled();
  });

  it('exposes detail, history, and compare with the read credential', async () => {
    const origin = await start();
    const headers = { authorization: 'Bearer read-token' };
    const detail = await fetch(`${origin}/api/v1/authority/prompts/governed_prompt`, { headers });
    const history = await fetch(`${origin}/api/v1/authority/prompts/governed_prompt/history`, {
      headers,
    });
    const compare = await fetch(
      `${origin}/api/v1/authority/prompts/governed_prompt/compare?from_version=1&to_version=2`,
      { headers }
    );

    expect(detail.status).toBe(200);
    await expect(detail.json()).resolves.toMatchObject({
      current_version: 2,
      prompt: { summary: { id: 'governed_prompt' }, userMessageTemplate: 'Version two' },
    });
    await expect(history.json()).resolves.toMatchObject({ action: 'history', current_version: 2 });
    await expect(compare.json()).resolves.toMatchObject({ action: 'compare', has_changes: true });
  });

  it('requires the distinct write credential, confirmation, and current revision', async () => {
    const origin = await start();
    const readOnly = await fetch(`${origin}/api/v1/authority/prompts/governed_prompt/dry-run`, {
      method: 'POST',
      headers: { authorization: 'Bearer read-token', 'content-type': 'application/json' },
      body: JSON.stringify({ expected_version: 2, user_message_template: 'Version three' }),
    });
    const unconfirmed = await fetch(`${origin}/api/v1/authority/prompts/governed_prompt/apply`, {
      method: 'POST',
      headers: { authorization: 'Bearer write-token', 'content-type': 'application/json' },
      body: JSON.stringify({ expected_version: 2, user_message_template: 'Version three' }),
    });
    const dryRun = await fetch(`${origin}/api/v1/authority/prompts/governed_prompt/dry-run`, {
      method: 'POST',
      headers: { authorization: 'Bearer write-token', 'content-type': 'application/json' },
      body: JSON.stringify({ expected_version: 2, user_message_template: 'Version three' }),
    });
    const apply = await fetch(`${origin}/api/v1/authority/prompts/governed_prompt/apply`, {
      method: 'POST',
      headers: { authorization: 'Bearer write-token', 'content-type': 'application/json' },
      body: JSON.stringify({
        expected_version: 2,
        confirmed: true,
        user_message_template: 'Version three',
      }),
    });
    const staleRollback = await fetch(
      `${origin}/api/v1/authority/prompts/governed_prompt/rollback`,
      {
        method: 'POST',
        headers: { authorization: 'Bearer write-token', 'content-type': 'application/json' },
        body: JSON.stringify({ version: 1, expected_version: 2, confirmed: true }),
      }
    );

    expect(readOnly.status).toBe(401);
    expect(unconfirmed.status).toBe(400);
    expect(dryRun.status).toBe(200);
    await expect(dryRun.json()).resolves.toMatchObject({ dry_run: true, mutated: false });
    expect(apply.status).toBe(200);
    await expect(apply.json()).resolves.toMatchObject({
      receipt: { current_version: 3 },
      mutated: true,
    });
    expect(staleRollback.status).toBe(409);
  });

  it('fails closed when read and write credentials are accidentally identical', async () => {
    const origin = await start({ readToken: 'shared-token', writeToken: 'shared-token' });
    const response = await fetch(`${origin}/api/v1/authority/prompts/governed_prompt/dry-run`, {
      method: 'POST',
      headers: { authorization: 'Bearer shared-token', 'content-type': 'application/json' },
      body: JSON.stringify({ expected_version: 2, user_message_template: 'change' }),
    });
    expect(response.status).toBe(503);
    expect(action).not.toHaveBeenCalled();
  });

  async function respond(args: Record<string, unknown>): Promise<ToolResponse> {
    if (args['action'] === 'history') {
      return {
        content: [{ type: 'text', text: 'history' }],
        structuredContent: {
          action: 'history',
          id: args['id'],
          current_version: currentVersion,
          versions: [
            {
              version: currentVersion,
              date: '2026-08-26T00:00:00.000Z',
              description: 'current',
              diff_summary: '+1/-1',
            },
          ],
        },
      };
    }
    if (args['action'] === 'compare') {
      return {
        content: [{ type: 'text', text: 'compare' }],
        structuredContent: { action: 'compare', id: args['id'], has_changes: true, diff: 'diff' },
      };
    }
    if (args['action'] === 'update' && args['expected_version'] !== currentVersion) {
      return {
        content: [{ type: 'text', text: 'conflict' }],
        isError: true,
        structuredContent: { action: 'update', conflict: true, current_version: currentVersion },
      };
    }
    if (args['action'] === 'update' && args['dry_run'] === true) {
      return {
        content: [{ type: 'text', text: 'dry run' }],
        structuredContent: {
          action: 'update',
          dry_run: true,
          valid: true,
          mutated: false,
          has_changes: true,
          diff: 'diff',
        },
      };
    }
    if (args['action'] === 'update') {
      currentVersion += 1;
      return {
        content: [{ type: 'text', text: 'applied' }],
        structuredContent: {
          action: 'update',
          receipt: { current_version: currentVersion },
          mutated: true,
        },
      };
    }
    if (args['action'] === 'rollback') {
      currentVersion += 1;
      return {
        content: [{ type: 'text', text: 'rolled back' }],
        structuredContent: {
          action: 'rollback',
          current_version: currentVersion,
          restored_version: args['version'],
          mutated: true,
        },
      };
    }
    return { content: [{ type: 'text', text: 'unexpected' }], isError: true };
  }
});
