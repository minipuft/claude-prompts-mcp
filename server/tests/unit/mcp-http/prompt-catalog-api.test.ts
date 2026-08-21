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

  async function start(prompts: ConvertedPrompt[]): Promise<string> {
    const router = new ApiRouter(logger, configManager);
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
});
