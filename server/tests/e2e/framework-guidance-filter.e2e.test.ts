// @lifecycle test - P6.290 / R178: the gate guidance filter matches a framework whatever casing its id arrives in, over Streamable HTTP and STDIO.
/**
 * P6.290 / R178. MEASURED 2026-10-04 on `ebe8936fb` (this harness's fixtures, Streamable HTTP): a
 * gate whose guidance names frameworks only in their authored casing (`- ReACT:`, `- Radiant:`)
 * rendered both lines, unfiltered and unheaded, under ReACT and under RADIANT alike. The filter's
 * line match was case-insensitive, but `hasFrameworkSpecificContent` compared the upper-cased
 * identifiers (`REACT`, `RADIANT`) case-sensitively, so the filter never ran on that guidance. The
 * shipped `framework-compliance` guidance hid it: its upper-case `- CAGEERF:` line let the check
 * pass for every framework.
 *
 * Now every comparison in the filter ignores case: under ReACT the gate renders ReACT's line
 * alone, under its authored heading. Control: under CAGEERF, which the guidance never names, the
 * render keeps both lines unheaded, so the probe can see the unfiltered shape it rules out.
 */
import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildServerEnv, createHermeticRoots } from './helpers/child-env.js';
import {
  getAvailablePort,
  killServer,
  ModernMcpClient,
  startServerWithHttp,
  waitForHealth,
} from './helpers/http-mcp-client.js';

const SERVER_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST_ENTRY = path.join(SERVER_ROOT, 'dist', 'index.js');

type Tool = (
  name: string,
  args: Record<string, unknown>
) => Promise<{ isError: boolean; text: string }>;

const MIXED_GATE = 'p290-mixed';
const MIXED_PROMPT = 'p290_probe';

/** The fixtures every transport authors: a gate naming two frameworks in mixed case, a prompt. */
const authorFixtures = async (tool: Tool): Promise<void> => {
  const author = async (args: Record<string, unknown>): Promise<void> => {
    const result = await tool('resource_manager', args);
    if (result.isError) throw new Error(result.text);
  };
  await author({
    resource_type: 'gate',
    action: 'create',
    id: MIXED_GATE,
    name: 'P290 Mixed',
    description: 'guidance naming frameworks only in their authored casing',
    guidance: '- ReACT: REACT-LINE-290\n- Radiant: RADIANT-LINE-290',
  });
  await author({
    resource_type: 'prompt',
    action: 'create',
    id: MIXED_PROMPT,
    category: 'general',
    name: MIXED_PROMPT,
    description: 'renders the mixed-case gate',
    user_message_template: 'P290-BODY',
    gate_configuration: { framework_gates: false },
  });
};

/** The twins every transport runs, over that transport's `tool`. */
const harness = (tool: Tool) => {
  const switchTo = async (framework: string): Promise<void> => {
    const switched = await tool('system_control', {
      action: 'framework',
      operation: 'switch',
      framework,
    });
    if (switched.isError) throw new Error(switched.text);
  };

  /** The mixed gate's section, from its title to the first blank line. */
  const mixedSection = async (): Promise<string> => {
    const rendered = await tool('prompt_engine', {
      command: `>>${MIXED_PROMPT}`,
      gates: [MIXED_GATE],
    });
    expect(rendered.isError).toBe(false);
    const lines = rendered.text.split('\n');
    const start = lines.indexOf('### P290 Mixed');
    expect(start).toBeGreaterThanOrEqual(0);
    const end = lines.findIndex((line, i) => i > start && line.trim() === '');
    return lines.slice(start, end).join('\n');
  };

  /** Twin: a framework whose authored casing differs from its id gets its own line, headed. */
  const filteredUnder = async (framework: string, heading: string, line: string, other: string) => {
    await switchTo(framework);
    expect(await mixedSection()).toBe(
      `### P290 Mixed\n**${heading} Framework Guidelines:**\n- ${line}`
    );
    expect(await mixedSection()).not.toContain(other);
  };

  /** Control: a framework the guidance never names leaves both lines unfiltered and unheaded. */
  const unfilteredUnderUnnamed = async () => {
    await switchTo('cageerf');
    expect(await mixedSection()).toBe(
      '### P290 Mixed\n- ReACT: REACT-LINE-290\n- Radiant: RADIANT-LINE-290'
    );
  };

  return { filteredUnder, unfilteredUnderUnnamed };
};

describe('Streamable HTTP: the guidance filter matches a framework in any casing (P6.290, R178)', () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  let client: ModernMcpClient;
  let nextId = 1;

  const tool: Tool = async (name, args) => {
    const outcome = await client.callToolWithNotifications(name, args, nextId++);
    const result = outcome.result as
      { isError?: boolean; content?: Array<{ text?: string }> } | undefined;
    return {
      isError: result?.isError === true,
      text: (result?.content ?? []).map((part) => part.text ?? '').join('\n'),
    };
  };
  const twins = harness(tool);

  beforeAll(async () => {
    const roots = createHermeticRoots('framework-guidance-filter-e2e');
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
    client = new ModernMcpClient(baseUrl, 'framework-guidance-filter-e2e');
    await authorFixtures(tool);
  }, 90000);

  afterAll(async () => {
    for (const step of cleanup.reverse()) await step();
  });

  test('under ReACT the mixed-case gate renders ReACT line alone, headed as authored', async () => {
    await twins.filteredUnder('react', 'ReACT', 'REACT-LINE-290', 'RADIANT-LINE-290');
  }, 120000);

  test('under RADIANT the mixed-case gate renders the Radiant line alone, headed as authored', async () => {
    await twins.filteredUnder('radiant', 'Radiant', 'RADIANT-LINE-290', 'REACT-LINE-290');
  }, 120000);

  test('control: under CAGEERF, which the guidance never names, both lines stay unheaded', async () => {
    await twins.unfilteredUnderUnnamed();
  }, 120000);
});

describe('STDIO: the guidance filter matches a framework in any casing (P6.290, R178 transport parity)', () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  let proc: ChildProcess;
  let nextId = 1;
  let stderr = '';
  const pending = new Map<number, (message: Record<string, unknown>) => void>();

  const request = (method: string, params: Record<string, unknown>): Promise<unknown> => {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`STDIO ${method} (id ${id}) got no answer in 45s\n${stderr}`));
      }, 45000);
      pending.set(id, (message) => {
        clearTimeout(timer);
        pending.delete(id);
        if (message['error'] != null) reject(new Error(JSON.stringify(message['error'])));
        else resolve(message['result']);
      });
      proc.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  };

  const tool: Tool = async (name, args) => {
    const result = (await request('tools/call', { name, arguments: args })) as
      { isError?: boolean; content?: Array<{ text?: string }> } | undefined;
    return {
      isError: result?.isError === true,
      text: (result?.content ?? []).map((part) => part.text ?? '').join('\n'),
    };
  };
  const twins = harness(tool);

  beforeAll(async () => {
    const roots = createHermeticRoots('framework-guidance-filter-stdio-e2e');
    cleanup.push(roots.cleanup);
    const workspace = path.join(roots.root, 'workspace');
    mkdirSync(workspace, { recursive: true });
    proc = spawn('node', [DIST_ENTRY, '--transport=stdio', '--quiet'], {
      cwd: SERVER_ROOT,
      env: buildServerEnv({
        HOME: roots.home,
        MCP_WORKSPACE: workspace,
        MCP_RUNTIME_ROOT: roots.runtimeRoot,
      }),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    cleanup.push(() => killServer(proc));
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    let buffer = '';
    proc.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
        if (!line.startsWith('{')) continue;
        const message = JSON.parse(line) as Record<string, unknown>;
        if (typeof message['id'] === 'number') pending.get(message['id'])?.(message);
      }
    });
    await request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'framework-guidance-filter-stdio-e2e', version: '1.0.0' },
    });
    proc.stdin?.write(
      `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`
    );
    await authorFixtures(tool);
  }, 90000);

  afterAll(async () => {
    for (const step of cleanup.reverse()) await step();
  });

  test('over STDIO under ReACT the mixed-case gate renders ReACT line alone, headed as authored', async () => {
    await twins.filteredUnder('react', 'ReACT', 'REACT-LINE-290', 'RADIANT-LINE-290');
  }, 120000);

  test('control over STDIO: under CAGEERF both lines stay unheaded', async () => {
    await twins.unfilteredUnderUnnamed();
  }, 120000);
});
