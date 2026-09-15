/**
 * system_control fields reach their handlers through the input schema the server registers.
 *
 * Zod strips the keys an input schema does not declare before a tool callback runs, so these calls
 * go over Streamable HTTP to the built server: a direct handler call skips the schema and cannot
 * see a stripped field. While the fields were undeclared, a skills_sync export with
 * `preview: true` wrote every registered client's skills, and an injection override answered
 * `Invalid injection type: undefined`.
 *
 * HOME, the workspace and the runtime root are temp directories, because an export writes client
 * skill folders under HOME. `skills-sync.yaml` is a local, gitignored file that skills_sync reads
 * from the workspace before the package, so the suite writes a fixture config into the temp
 * workspace and serves the bundled resources beneath it.
 */

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  getAvailablePort,
  killServer,
  startServerWithHttp,
  StreamableHttpMcpClient,
  waitForHealth,
} from './helpers/http-mcp-client.js';

import type { ChildProcess } from 'node:child_process';

/** Two registered clients, so an export limited to one can be seen leaving the other alone. */
const FIXTURE_CONFIG = [
  'registrations:',
  '  claude-code:',
  '    user:',
  '      - prompt:development/library_overview',
  '  opencode:',
  '    user:',
  '      - prompt:development/library_overview',
  '',
].join('\n');

interface ToolResult {
  isError: boolean;
  text: string;
}

interface RawToolResult {
  isError?: boolean;
  content?: Array<{ text?: string }>;
}

function countFiles(dir: string): number {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).reduce((total, entry) => {
    const entryPath = path.join(dir, entry);
    return total + (statSync(entryPath).isDirectory() ? countFiles(entryPath) : 1);
  }, 0);
}

describe('system_control fields over MCP', () => {
  let home = '';
  let workspace = '';
  let server: ChildProcess | undefined;
  let client: StreamableHttpMcpClient | undefined;
  let requestId = 1;

  async function callSystemControl(args: Record<string, unknown>): Promise<ToolResult> {
    if (client === undefined) throw new Error('MCP client not initialized');
    const result = (await client.request(
      'tools/call',
      { name: 'system_control', arguments: args },
      requestId++
    )) as RawToolResult | undefined;
    return {
      isError: result?.isError === true,
      text: (result?.content ?? []).map((part) => part.text ?? '').join('\n'),
    };
  }

  beforeAll(async () => {
    home = await mkdtemp(path.join(tmpdir(), 'system-control-fields-home-'));
    workspace = await mkdtemp(path.join(tmpdir(), 'system-control-fields-workspace-'));
    await writeFile(path.join(workspace, 'skills-sync.yaml'), FIXTURE_CONFIG);

    const port = await getAvailablePort();
    server = startServerWithHttp(port, {
      env: {
        HOME: home,
        MCP_WORKSPACE: workspace,
        MCP_RUNTIME_ROOT: workspace,
      },
    });
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForHealth(baseUrl, { timeout: 30000, interval: 200 });
    client = new StreamableHttpMcpClient(baseUrl);
    await client.initialize();
  }, 60000);

  afterAll(async () => {
    await client?.close();
    if (server) await killServer(server);
    await Promise.all(
      [home, workspace]
        .filter((dir) => dir !== '')
        .map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 5 }))
    );
  });

  it('a skills_sync export with preview: true lists its files and writes none', async () => {
    const result = await callSystemControl({
      action: 'skills_sync',
      operation: 'export',
      client: 'claude-code',
      preview: true,
    });

    expect(result.isError).toBe(false);
    expect(result.text).toContain('[preview]');
    expect(countFiles(home)).toBe(0);
  });

  it('the same export without preview writes the named client and no other', async () => {
    // The positive control for the case above: this count does see files an export writes.
    const result = await callSystemControl({
      action: 'skills_sync',
      operation: 'export',
      client: 'claude-code',
    });

    expect(result.isError).toBe(false);
    expect(countFiles(path.join(home, '.claude', 'skills'))).toBeGreaterThan(0);
    expect(countFiles(path.join(home, '.config', 'opencode', 'skills'))).toBe(0);
  });

  it('an injection override takes effect', async () => {
    const override = await callSystemControl({
      action: 'injection',
      operation: 'override',
      type: 'system-prompt',
      enabled: false,
    });
    const status = await callSystemControl({ action: 'injection', operation: 'status' });

    expect(override.text).toContain('Injection Override Set');
    expect(status.text).toContain('`system-prompt`: 🚫 Disabled');
  });

  it('an injection override refuses the scope values that belong to skills_sync', async () => {
    const result = await callSystemControl({
      action: 'injection',
      operation: 'override',
      type: 'system-prompt',
      enabled: false,
      scope: 'project',
    });

    expect(result.text).toContain('Invalid injection override scope: `project`');
  });

  it('confirm: true reaches analytics reset', async () => {
    const refused = await callSystemControl({ action: 'analytics', operation: 'reset' });
    const confirmed = await callSystemControl({
      action: 'analytics',
      operation: 'reset',
      confirm: true,
    });

    expect(refused.text).toContain('Metrics reset cancelled');
    expect(confirmed.text).toContain('Metrics Reset Completed');
  });
});
