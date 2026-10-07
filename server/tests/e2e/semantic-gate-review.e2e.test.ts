// @lifecycle test - Registered source HTTP confirms semantic resources remain unavailable during custody staging.
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, test } from '@jest/globals';

import { createHermeticRoots } from './helpers/child-env.js';
import {
  getAvailablePort,
  killServer,
  ModernMcpClient,
  startServerWithHttp,
  waitForHealth,
} from './helpers/http-mcp-client.js';

describe('registered source HTTP: semantic gate runtime remains staged', () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    for (const dispose of cleanup.splice(0).reverse()) await dispose();
  });

  test('ordinary resource control succeeds while semantic_evaluation criteria are refused', async () => {
    const roots = createHermeticRoots('semantic-gate-staging-http');
    const workspace = path.join(roots.root, 'workspace');
    mkdirSync(workspace);
    cleanup.push(roots.cleanup);
    const port = await getAvailablePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const proc = startServerWithHttp(port, {
      source: true,
      env: { ...roots.env, MCP_WORKSPACE: workspace },
    });
    cleanup.push(() => killServer(proc));
    await waitForHealth(baseUrl, { timeout: 30000 });
    const client = new ModernMcpClient(baseUrl, 'semantic-staging-http');
    const base = {
      resource_type: 'gate',
      action: 'create',
      name: 'Staged criterion',
      description: 'Registration capability control',
      guidance: 'Review output.',
    };
    const ordinary = (await client.request(
      'tools/call',
      {
        name: 'resource_manager',
        arguments: {
          ...base,
          id: 'ordinary-control',
          pass_criteria: [{ type: 'inline_guidance' }],
        },
      },
      1,
      { toolName: 'resource_manager' }
    )) as { isError?: boolean };
    expect(ordinary.isError).not.toBe(true);
    const response = await client.send(
      'tools/call',
      {
        name: 'resource_manager',
        arguments: {
          ...base,
          id: 'unsupported-semantic-gate',
          pass_criteria: [
            {
              type: 'semantic_evaluation',
              id: 'criterion',
              target: { kind: 'step_output' },
              question: 'Is the contract preserved?',
              evidence_requirements: { min_items: 1 },
              result: { kind: 'boolean' },
              acceptance: { kind: 'equals', value: true },
            },
          ],
        },
      },
      2,
      { toolName: 'resource_manager' }
    );
    expect(response.status).toBe(200);
    expect(response.body).toMatch(/isError.*true|"error"/);
    expect(response.body).toMatch(/pass_criteria|inline_guidance|Invalid option/);
  }, 90000);
});
