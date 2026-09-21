/**
 * An auto-execute the tool refuses FAILS the `prompt_engine` run (P4.98).
 *
 * P4.93 closed one class at stage 09 — an undeclared parameter — by refusing before the call.
 * Every other way `resource_manager` says no came back as a `ToolResponse` with `isError: true`,
 * was written into `autoExecuteResults`, and was reported only through `context.diagnostics.info`,
 * which nothing downstream reads (`18-execution-stage.ts` never consults it). So the mutation did
 * not happen and `prompt_engine` told the caller it had.
 *
 * Measured 2026-09-20 by drive, before the fix — all four `isError: false`, all four rendering the
 * prompt normally:
 *
 *   unset on resource_type "gate"      → ownership refusal, reported as success
 *   delete of a missing prompt         → handler error, reported as success
 *   limit: "not-a-number"              → not even validated: the in-process path ran `as any`
 *   list (control)                     → genuinely fine
 *
 * The third is its own finding. The registered path is parsed against `resourceManagerInputSchema`
 * by the MCP SDK before the handler runs; the in-process path had nothing, so a script could send
 * a shape no MCP client could. `getResourceManagerHandler` now runs that same schema — one
 * `safeParse`, the same SSOT, no second validator.
 *
 * Driven through `prompt_engine` on purpose. A unit test on the stage cannot show whether the
 * throw reaches the tool's reply, and that reply IS the defect: the stage was already "reporting"
 * the failure, into a channel with no reader.
 */

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ChildProcess } from 'node:child_process';

import {
  getAvailablePort,
  killServer,
  ModernMcpClient,
  startServerWithHttp,
  waitForHealth,
} from './helpers/http-mcp-client.js';

interface ToolResult {
  isError: boolean;
  text: string;
}

function toToolResult(result: unknown): ToolResult {
  const raw = result as { isError?: boolean; content?: Array<{ text?: string }> } | undefined;
  return {
    isError: raw?.isError === true,
    text: (raw?.content ?? []).map((part) => part.text ?? '').join('\n'),
  };
}

const ACCEPTED_MARKER = 'P498-AUTO-EXECUTE-ACCEPTED';

/**
 * A PROMPT-LOCAL script tool — the only shape that reaches the auto-execute stage. A tool under
 * `<workspace>/resources/scripts/` is loaded for `{{script:id}}` references but never enters
 * `convertedPrompt.scriptTools`, so it cannot auto-execute (recorded as a finding, not fixed).
 */
async function plantPrompt(
  workspace: string,
  id: string,
  emittedParams: Record<string, unknown>
): Promise<void> {
  const dir = path.join(workspace, 'resources', 'prompts', 'p498', id);
  const toolDir = path.join(dir, 'tools', `${id}_builder`);
  await mkdir(toolDir, { recursive: true });

  await writeFile(
    path.join(dir, 'prompt.yaml'),
    [
      `id: ${id}`,
      `name: ${id}`,
      'category: p498',
      `description: P4.98 auto-execute fixture ${id}.`,
      'userMessageTemplateFile: user-message.md',
      'tools:',
      `  - ${id}_builder`,
      'arguments:',
      '  - name: go',
      '    type: string',
      '    description: trigger',
      '    required: false',
      '',
    ].join('\n'),
    'utf8'
  );
  await writeFile(path.join(dir, 'user-message.md'), `${ACCEPTED_MARKER} for ${id}.\n`, 'utf8');
  await writeFile(
    path.join(toolDir, 'tool.yaml'),
    [
      `id: ${id}_builder`,
      `name: ${id} builder`,
      'description: emits an auto_execute block',
      'runtime: node',
      'script: script.mjs',
      'timeout: 15000',
      'enabled: true',
      'execution:',
      '  trigger: schema_match',
      '  strict: false',
      '  autoApproveOnValid: true',
      '',
    ].join('\n'),
    'utf8'
  );
  await writeFile(
    path.join(toolDir, 'schema.json'),
    JSON.stringify(
      {
        type: 'object',
        properties: { go: { type: 'string', description: 'trigger' } },
        required: ['go'],
      },
      null,
      2
    ),
    'utf8'
  );
  await writeFile(
    path.join(toolDir, 'script.mjs'),
    [
      'let raw = "";',
      'process.stdin.on("data", (c) => (raw += c));',
      'process.stdin.on("end", () => {',
      '  process.stdout.write(JSON.stringify({',
      '    valid: true,',
      `    auto_execute: { tool: "resource_manager", params: ${JSON.stringify(emittedParams)} },`,
      '  }));',
      '});',
      '',
    ].join('\n'),
    'utf8'
  );
}

/** Each case's `expected` names WHICH guard must have answered, not merely that one did. */
const CASES = [
  {
    id: 'owned',
    what: 'a parameter the resource type does not own',
    params: { resource_type: 'gate', action: 'update', id: 'some-gate', unset: ['description'] },
    expected: `'unset' is not a parameter of resource_type:"gate"`,
  },
  {
    id: 'missing',
    what: 'a handler error response (target does not exist)',
    params: { resource_type: 'prompt', action: 'delete', id: 'p498/does-not-exist' },
    expected: 'Prompt not found',
  },
  {
    id: 'badtype',
    what: 'a shape the registered schema rejects but the in-process path never checked',
    params: { resource_type: 'prompt', action: 'list', limit: 'not-a-number' },
    expected: 'limit: Invalid input: expected number, received string',
  },
] as const;

describe('a refused auto_execute fails the prompt_engine run', () => {
  let workspace: string;
  let proc: ChildProcess;
  let client: ModernMcpClient;
  let nextId = 1;

  beforeAll(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), 'p498-auto-execute-e2e-'));
    for (const testCase of CASES) await plantPrompt(workspace, testCase.id, testCase.params);
    await plantPrompt(workspace, 'accepted', { resource_type: 'prompt', action: 'list' });

    const runtimeRoot = path.join(workspace, 'runtime');
    const home = path.join(workspace, 'home');
    await mkdir(runtimeRoot, { recursive: true });
    await mkdir(home, { recursive: true });

    const port = await getAvailablePort();
    proc = startServerWithHttp(port, {
      env: { HOME: home, MCP_WORKSPACE: workspace, MCP_RUNTIME_ROOT: runtimeRoot },
    });
    await waitForHealth(`http://localhost:${port}`, { timeout: 20000, interval: 200 });
    client = new ModernMcpClient(`http://localhost:${port}`);
  }, 60_000);

  afterAll(async () => {
    if (proc) await killServer(proc);
    if (workspace) await rm(workspace, { recursive: true, force: true, maxRetries: 5 });
  });

  it('CONTROL: an accepted auto_execute still succeeds and its prompt still renders', async () => {
    // The positive control every negative below depends on. Without it, a server that failed
    // every prompt_engine call — or one where the fixture never reached auto-execute at all —
    // would read as three passing refusals.
    const result = toToolResult(
      await client.callTool('prompt_engine', { command: '>>accepted go:"yes"' }, nextId++)
    );

    expect(result.isError).toBe(false);
    expect(result.text).toContain(ACCEPTED_MARKER);
  }, 30_000);

  it.each(CASES)(
    'fails the run on $what',
    async ({ id, expected }) => {
      const result = toToolResult(
        await client.callTool('prompt_engine', { command: `>>${id} go:"yes"` }, nextId++)
      );

      expect(result.isError).toBe(true);
      // Names the script, so an operator knows which file to open…
      expect(result.text).toContain(`Script tool '${id}_builder'`);
      // …and carries the tool's OWN message verbatim, rather than a second vocabulary for it.
      expect(result.text).toContain(expected);
      // And the prompt did NOT render as if nothing were wrong — the old behaviour exactly.
      expect(result.text).not.toContain(ACCEPTED_MARKER);
    },
    30_000
  );
});
