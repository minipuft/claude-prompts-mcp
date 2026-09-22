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
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
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

  const callAs = async (
    tool: string,
    args: Record<string, unknown>,
    headers: Record<string, string> = {}
  ): Promise<string> =>
    textOf((await client.callTool(tool, args, nextId++, { omitMeta, headers })) as ToolResult);

  const A = { 'x-workspace-id': 'ws-a' };
  const B = { 'x-workspace-id': 'ws-b' };
  /** The framework whose system prompt a `prompt_engine` render carries. */
  const renderedFramework = async (headers: Record<string, string> = {}): Promise<string> => {
    const text = await callAs(
      'prompt_engine',
      { command: '>>quick_decision decision:"x"' },
      headers
    );
    const react = text.includes('ReACT Framework');
    const cageerf = text.includes('CAGEERF Framework');
    return react && !cageerf
      ? 'react'
      : cageerf && !react
        ? 'cageerf'
        : `ambiguous:${text.slice(0, 200)}`;
  };

  beforeAll(async () => {
    // The launch workspace is derived from `CLAUDE_PROJECT_DIR`; pinned so a request with no
    // header lands in a known scope rather than whatever directory jest ran from.
    projectParent = mkdtempSync(path.join(tmpdir(), 'ws-header-scope-'));
    const port = await getAvailablePort();
    const baseUrl = `http://localhost:${port}`;
    // A workspace of its own: the version-history row below CREATES a prompt, which would
    // otherwise land in the package's resource tree.
    const workspace = path.join(projectParent, 'workspace');
    mkdirSync(workspace, { recursive: true });
    proc = startServerWithHttp(port, {
      env: {
        CLAUDE_PROJECT_DIR: path.join(projectParent, 'launch-project'),
        MCP_WORKSPACE: workspace,
      },
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

  // R94 (2026-09-22): a header workspace is a full tenant. Each row below runs after the switch
  // to react under A in the first test, and asserts A (positive control) against B / no header.

  it('P4.129: prompt_engine renders with the framework the header workspace selected', async () => {
    expect(await renderedFramework(A)).toBe('react');
    expect(await renderedFramework(B)).toBe('cageerf');
    expect(await renderedFramework()).toBe('cageerf');
  });

  it('P4.130: a never-seen header workspace starts with the configured enabled flag', async () => {
    const launch = /\*\*Framework System\*\*: [^\n]*/.exec(
      textOf(await call({ action: 'status' }))
    );
    // Precondition: shipped config enables the framework system, so "Disabled" below is a defect.
    expect(launch?.[0]).toContain('Enabled');
    const fresh = /\*\*Framework System\*\*: [^\n]*/.exec(
      textOf(await call({ action: 'status' }, { 'x-workspace-id': 'ws-never-seen' }))
    );
    expect(fresh?.[0]).toBe(launch?.[0]);
  });

  it('P4.132: the switch history lists only the header workspace’s own switches', async () => {
    const entries = async (headers: Record<string, string> = {}): Promise<string | undefined> =>
      /\*\*History Entries\*\*: (\d+)/.exec(
        await callAs('system_control', { action: 'analytics', operation: 'history' }, headers)
      )?.[1];
    expect(await entries(A)).toBe('1');
    expect(await entries(B)).toBe('0');
    expect(await entries()).toBe('0');
  });

  it('P4.131: version history records under the header workspace and reads back only there', async () => {
    const created = await callAs(
      'resource_manager',
      {
        resource_type: 'prompt',
        action: 'create',
        id: 'ws_scoped_probe',
        name: 'ws scoped probe',
        category: 'general',
        description: 'probe',
        user_message_template: 'hello {{x}}',
        arguments: [{ name: 'x', type: 'string', description: 'x' }],
      },
      A
    );
    expect(created).not.toMatch(/^❌/);
    await callAs(
      'resource_manager',
      {
        resource_type: 'prompt',
        action: 'update',
        id: 'ws_scoped_probe',
        user_message_template: 'again {{x}}',
      },
      A
    );
    const history = (headers: Record<string, string> = {}) =>
      callAs(
        'resource_manager',
        { resource_type: 'prompt', action: 'history', id: 'ws_scoped_probe' },
        headers
      );
    expect(await history(A)).toContain('Version History');
    expect(await history(B)).toContain('No version history');
    expect(await history()).toContain('No version history');
  });

  it('P4.131: session list shows only the header workspace’s own runs', async () => {
    const list = (headers: Record<string, string>) =>
      callAs('system_control', { action: 'session', operation: 'list' }, headers);
    // Renders above opened sessions under A, B and no header; ws-c has run nothing.
    const sessionIds = (text: string) => [...text.matchAll(/Session: `([^`]+)`/g)].map((m) => m[1]);
    const underA = sessionIds(await list(A));
    expect(underA.length).toBeGreaterThan(0);
    const underB = sessionIds(await list(B));
    expect(underB.length).toBeGreaterThan(0);
    expect(underB.filter((id) => underA.includes(id))).toEqual([]);
    expect(await list({ 'x-workspace-id': 'ws-c' })).toContain('No Active Sessions');
  });
});
