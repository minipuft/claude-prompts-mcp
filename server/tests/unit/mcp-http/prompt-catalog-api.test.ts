import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { ApiRouter } from '../../../src/mcp/http/api.js';

import type { Server } from 'node:http';
import type { ConvertedPrompt } from '../../../src/engine/execution/types.js';
import type { ConfigManager, Logger } from '../../../src/shared/types/index.js';

const logger: Logger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
};

const configManager = {} as ConfigManager;

function prompt(overrides: Partial<ConvertedPrompt> = {}): ConvertedPrompt {
  return {
    id: 'strategicImplement',
    name: 'Strategic Implementation',
    description: 'Implement a planned change',
    category: 'development',
    userMessageTemplate: 'Implement {{ task }}',
    arguments: [{ name: 'task', description: 'Work to execute', required: true }],
    composer: { inputArgument: 'task' },
    ...overrides,
  };
}

describe('prompt catalog HTTP API', () => {
  let server: Server | undefined;

  afterEach(
    () =>
      new Promise<void>((resolve, reject) => {
        if (server === undefined) return resolve();
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      })
  );

  async function start(
    prompts: ConvertedPrompt[],
    catalogReadToken: string | null = null,
    extra: { catalogWriteToken?: string | null; allowedOrigins?: readonly string[] } = {}
  ): Promise<string> {
    const router = new ApiRouter(logger, configManager, undefined, undefined, {
      catalogReadToken,
      ...extra,
    });
    router.updateData([], [], prompts);
    server = router.createApp().listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server?.once('listening', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('Expected TCP listener');
    return `http://127.0.0.1:${address.port}`;
  }

  it('keeps list payloads metadata-only and normalizes single and chain prompts', async () => {
    const origin = await start([
      prompt(),
      prompt({
        id: 'reviewChain',
        name: 'Review Chain',
        chainSteps: [{ promptId: 'review', stepName: 'Review' }],
      }),
    ]);

    const response = await fetch(`${origin}/prompts`);
    const body = (await response.json()) as { prompts: Array<Record<string, unknown>> };

    expect(response.status).toBe(200);
    expect(body.prompts).toHaveLength(2);
    expect(body.prompts.map((item) => item['executionType'])).toEqual(['single', 'chain']);
    expect(body.prompts[0]).toMatchObject({
      composerInputArgument: 'task',
      arguments: [
        {
          name: 'task',
          description: 'Work to execute',
          required: true,
          type: 'string',
        },
      ],
    });
    expect(body.prompts[0]).not.toHaveProperty('userMessageTemplate');
  });

  it('keeps the unauthenticated detail route metadata-only and returns not-found', async () => {
    const origin = await start([prompt({ systemMessage: 'Use the approved plan.' })]);

    const detailResponse = await fetch(`${origin}/prompts/strategicImplement`);
    const detail = (await detailResponse.json()) as Record<string, unknown>;
    const missingResponse = await fetch(`${origin}/prompts/missing`);

    expect(detailResponse.status).toBe(200);
    expect(detail).toMatchObject({
      id: 'strategicImplement',
      composerInputArgument: 'task',
    });
    expect(detail).not.toHaveProperty('userMessageTemplate');
    expect(detail).not.toHaveProperty('systemMessage');
    expect(missingResponse.status).toBe(404);
    await expect(missingResponse.json()).resolves.toEqual({ error: 'Prompt not found: missing' });
  });

  /**
   * `GET /api/v1/catalog/prompts` is the COLLECTION the agent-workbench prompt authority lists
   * from. Only the `:promptId` item route existed, so every per-prompt call succeeded while the
   * listing 404'd — which the workbench turns into `catalog_unavailable` and an empty catalog, and
   * t3code then shows no prompts at all. Measured 2026-08-30 against the running service.
   */
  describe('the catalog collection the workbench lists from', () => {
    it('returns summaries under a `prompts` key, without instruction bodies', async () => {
      const origin = await start(
        [
          prompt({ systemMessage: 'Use the approved plan.' }),
          prompt({
            id: 'reviewChain',
            name: 'Review Chain',
            chainSteps: [{ promptId: 'review', stepName: 'Review' }],
          }),
        ],
        'catalog-read-token'
      );

      const response = await fetch(`${origin}/api/v1/catalog/prompts`, {
        headers: { authorization: 'Bearer catalog-read-token' },
      });
      const body = (await response.json()) as { prompts: Array<Record<string, unknown>> };

      expect(response.status).toBe(200);
      // The shape `promptAuthorityHttp.listPrompts` requires: anything but an array under
      // `prompts` — a bare array included — is read as the catalog being unavailable.
      expect(Array.isArray(body.prompts)).toBe(true);
      expect(body.prompts).toHaveLength(2);
      expect(body.prompts[0]).toMatchObject({
        id: 'strategicImplement',
        name: 'Strategic Implementation',
        category: 'development',
        composerInputArgument: 'task',
        executionType: 'single',
      });
      expect(body.prompts[1]).toMatchObject({ executionType: 'chain' });
      // A listing names no prompt, so it must not hand back every prompt's instructions.
      expect(body.prompts[0]).not.toHaveProperty('userMessageTemplate');
      expect(body.prompts[0]).not.toHaveProperty('systemMessage');
    });

    it('authenticates the collection, not only the item beneath it', async () => {
      const origin = await start([prompt()], 'catalog-read-token');

      const unauthorized = await fetch(`${origin}/api/v1/catalog/prompts`);
      const badToken = await fetch(`${origin}/api/v1/catalog/prompts`, {
        headers: { authorization: 'Bearer wrong-token' },
      });

      expect(unauthorized.status).toBe(401);
      expect(badToken.status).toBe(401);
    });

    it('fails closed when no read credential is configured', async () => {
      const origin = await start([prompt()]);

      const response = await fetch(`${origin}/api/v1/catalog/prompts`);

      // Same posture as the item route: an unconfigured credential refuses rather than serving
      // the catalog openly.
      expect(response.status).toBe(503);
    });
  });

  it('fails closed when authenticated catalog detail is not configured', async () => {
    const origin = await start([prompt()]);

    const response = await fetch(`${origin}/api/v1/catalog/prompts/strategicImplement`);

    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({
      error: 'Catalog detail endpoint is unavailable',
    });
  });

  it('protects executable prompt detail and authenticates before lookup', async () => {
    const origin = await start(
      [prompt({ systemMessage: 'Use the approved plan.' })],
      'catalog-read-token'
    );

    const unauthorizedResponse = await fetch(`${origin}/api/v1/catalog/prompts/strategicImplement`);
    const badTokenResponse = await fetch(`${origin}/api/v1/catalog/prompts/missing`, {
      headers: { authorization: 'Bearer wrong-token' },
    });
    const detailResponse = await fetch(`${origin}/api/v1/catalog/prompts/strategicImplement`, {
      headers: { authorization: 'Bearer catalog-read-token' },
    });

    expect(unauthorizedResponse.status).toBe(401);
    await expect(unauthorizedResponse.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(badTokenResponse.status).toBe(401);
    await expect(badTokenResponse.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(detailResponse.status).toBe(200);
    expect(detailResponse.headers.get('cache-control')).toBe('no-store');
    await expect(detailResponse.json()).resolves.toMatchObject({
      summary: { id: 'strategicImplement' },
      userMessageTemplate: 'Implement {{ task }}',
      systemMessage: 'Use the approved plan.',
    });
    expect(JSON.stringify(jest.mocked(logger.debug).mock.calls)).not.toContain(
      'catalog-read-token'
    );
  });

  it('refuses a mutating tool route with no write token configured', async () => {
    const origin = await start([prompt()]);

    const deleteResponse = await fetch(`${origin}/api/v1/tools/prompts/strategicImplement`, {
      method: 'DELETE',
    });
    const reloadResponse = await fetch(`${origin}/api/v1/tools/reload_prompts`, {
      method: 'POST',
    });

    expect(deleteResponse.status).toBe(503);
    expect(reloadResponse.status).toBe(503);
  });

  it('authenticates mutating tool routes before the handler runs', async () => {
    const origin = await start([prompt()], null, { catalogWriteToken: 'write-token' });

    const noToken = await fetch(`${origin}/api/v1/tools/prompts/strategicImplement`, {
      method: 'DELETE',
    });
    const wrongToken = await fetch(`${origin}/api/v1/tools/prompts/strategicImplement`, {
      method: 'DELETE',
      headers: { authorization: 'Bearer nope' },
    });

    expect(noToken.status).toBe(401);
    expect(wrongToken.status).toBe(401);
  });

  it('does not accept the catalog READ token on a write route', async () => {
    // Least privilege: the read token is held by rendering adapters and must not delete.
    const origin = await start([prompt()], 'read-token', { catalogWriteToken: 'write-token' });

    const response = await fetch(`${origin}/api/v1/tools/prompts/strategicImplement`, {
      method: 'DELETE',
      headers: { authorization: 'Bearer read-token' },
    });

    expect(response.status).toBe(401);
  });

  it('rejects a present-but-unlisted Origin with 403 across every route', async () => {
    const origin = await start([prompt()]);

    for (const route of ['/health', '/prompts', '/api/v1/catalog/prompts/strategicImplement']) {
      const response = await fetch(`${origin}${route}`, {
        headers: { origin: 'https://evil.example.com' },
      });
      expect(response.status).toBe(403);
    }
  });

  it('allows a loopback Origin and echoes it instead of a wildcard', async () => {
    const origin = await start([prompt()]);

    const response = await fetch(`${origin}/prompts`, {
      headers: { origin: 'http://localhost:3000' },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
    expect(response.headers.get('access-control-allow-origin')).not.toBe('*');
    expect(response.headers.get('vary')).toBe('Origin');
  });

  it('passes a request carrying no Origin header, so non-browser clients still work', async () => {
    const origin = await start([prompt()]);

    const response = await fetch(`${origin}/prompts`);

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('replaces the loopback defaults when origins are configured explicitly', async () => {
    const origin = await start([prompt()], null, {
      allowedOrigins: ['https://app.example.com'],
    });

    const configured = await fetch(`${origin}/prompts`, {
      headers: { origin: 'https://app.example.com' },
    });
    const nowRejected = await fetch(`${origin}/prompts`, {
      headers: { origin: 'http://localhost:3000' },
    });

    expect(configured.status).toBe(200);
    expect(nowRejected.status).toBe(403);
  });
});
