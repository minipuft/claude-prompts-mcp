/**
 * A workspace header scopes each Streamable HTTP request to its own state.
 *
 * `x-workspace-id` (and its aliases) are documented as the way a gateway serves several
 * workspaces from one HTTP server. Measured 2026-09-22 against `dist/index.js`: a framework
 * switch sent under `x-workspace-id: ws-a` read back as switched under `ws-b` and under no header
 * too. SDK v2 hands a tool handler the originating request at `ctx.http.req` (a web `Request`,
 * whose `headers` is a `Headers` object) and auth at `ctx.http.authInfo`; the identity resolver
 * still read the v1 fields `requestInfo.headers` and `authInfo`, found nothing, and resolved
 * every request to the launch workspace.
 *
 * Unit tests of the resolver cannot see this: they build the handler context themselves, so they
 * agree with whatever shape they were written against. Only a real request through the SDK's
 * transport shows where the SDK actually puts the headers, and both protocol eras are driven
 * because they reach the handler through different transports.
 */

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  getAvailablePort,
  killServer,
  ModernMcpClient,
  startServerWithHttp,
  waitForHealth,
} from './helpers/http-mcp-client.js';

import type { ChildProcess } from 'node:child_process';

type ToolResult = { isError?: boolean; content?: Array<{ text?: string }> };

const textOf = (result: ToolResult): string =>
  (result.content ?? []).map((part) => part.text ?? '').join('\n');

/** `**Framework System**: ✅ Enabled (react)` or `🚫 Disabled (react selected)` → `react`. */
function activeFrameworkIn(statusText: string): string {
  const match = /\*\*Framework System\*\*: [^\n(]*\(([^)\s]+)(?: selected)?\)/.exec(statusText);
  if (match?.[1] == null) {
    throw new Error(`status reply names no framework:\n${statusText}`);
  }
  return match[1].toLowerCase();
}

describe.each([
  ['2026-07-28 request', false],
  ['2025-era request (stateless fallback)', true],
] as const)('Streamable HTTP, %s: a workspace header scopes the request', (_era, omitMeta) => {
  let proc: ChildProcess;
  let client: ModernMcpClient;
  let projectParent: string;
  let nextId = 1;

  const call = async (
    args: Record<string, unknown>,
    headers: Record<string, string> = {}
  ): Promise<ToolResult> =>
    (await client.callTool('system_control', args, nextId++, { omitMeta, headers })) as ToolResult;

  const frameworkUnder = async (headers: Record<string, string> = {}): Promise<string> =>
    activeFrameworkIn(textOf(await call({ action: 'status' }, headers)));

  beforeAll(async () => {
    // The launch workspace is derived from `CLAUDE_PROJECT_DIR`; pinned so a request with no
    // header lands in a known scope rather than whatever directory jest ran from.
    projectParent = mkdtempSync(path.join(tmpdir(), 'ws-header-scope-'));
    const port = await getAvailablePort();
    const baseUrl = `http://localhost:${port}`;
    proc = startServerWithHttp(port, {
      env: { CLAUDE_PROJECT_DIR: path.join(projectParent, 'launch-project') },
    });
    await waitForHealth(baseUrl, { timeout: 20000, interval: 200 });
    client = new ModernMcpClient(baseUrl);
  }, 30000);

  afterAll(async () => {
    await killServer(proc);
    rmSync(projectParent, { recursive: true, force: true });
  });

  it('a switch under workspace A is visible under A only', async () => {
    const initial = await frameworkUnder();
    // Precondition: the switch below must be a change, or "unchanged under B" proves nothing.
    expect(initial).not.toBe('react');

    const switched = await call(
      { action: 'framework', operation: 'switch', framework: 'react' },
      { 'x-workspace-id': 'ws-a' }
    );
    expect(switched.isError ?? false).toBe(false);
    expect(textOf(switched)).toContain('Framework Switch Successful');

    // Positive control: the probe observes a switch in the scope that made it.
    expect(await frameworkUnder({ 'x-workspace-id': 'ws-a' })).toBe('react');
    // Isolation: neither another workspace nor the launch workspace sees it.
    expect(await frameworkUnder({ 'x-workspace-id': 'ws-b' })).toBe(initial);
    expect(await frameworkUnder()).toBe(initial);
  });

  it('reads the workspace from any header spelling the resolver declares', async () => {
    // Header names are case-insensitive on the wire; `x-project-id` is a declared alias.
    expect(await frameworkUnder({ 'X-Workspace-Id': 'ws-a' })).toBe('react');
    expect(await frameworkUnder({ 'x-project-id': 'ws-a' })).toBe('react');
    expect(await frameworkUnder({ 'x-project-id': 'ws-b' })).not.toBe('react');
  });
});
