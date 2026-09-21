/**
 * The active framework follows the frameworks a server actually has, over a real server: a
 * framework created while it runs can be selected, a selection survives a restart, and removing
 * the selected framework moves the selection to the configured default.
 *
 * The framework state store used to build a framework manager of its own before the framework
 * loader knew the workspace, so it only ever saw the bundled frameworks and none of the later
 * changes `resource_manager` or hot reload made to the manager every tool uses. Switching to a
 * framework the tools could see then left a selection the state store could not resolve: over
 * Streamable HTTP every later request failed until restart, `tools/list` included, and over
 * STDIO every render failed. A restart read the selection against the bundled frameworks and
 * replaced it with the first one available.
 *
 * The configured default here is `radiant`, which is neither the built-in default nor the first
 * framework available, so a fallback to either of those cannot pass for the configured one.
 */

import { afterEach, describe, expect, it } from '@jest/globals';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildServerEnv, createHermeticRoots } from './helpers/child-env.js';
import {
  getAvailablePort,
  killServer,
  startServerWithHttp,
  StreamableHttpMcpClient,
  waitForHealth,
} from './helpers/http-mcp-client.js';

const SERVER_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONFIGURED_DEFAULT = 'radiant';
const PROMPT_ID = 'framework_selection_probe';
const PROMPT_BODY = 'framework selection probe body';
const FRAMEWORK_ID = 'selection_probe_fw';
const FRAMEWORK_GUIDANCE = 'SELECTION-PROBE-FRAMEWORK-GUIDANCE';

interface FrameworkSpec {
  id: string;
  name: string;
  guidance: string;
  gateId: string;
}

const FIRST_FRAMEWORK: FrameworkSpec = {
  id: FRAMEWORK_ID,
  name: 'Selection probe framework',
  guidance: FRAMEWORK_GUIDANCE,
  gateId: 'selection-probe-gate',
};

const SECOND_FRAMEWORK: FrameworkSpec = {
  id: 'selection_probe_fw_second',
  name: 'Second selection probe framework',
  guidance: 'SECOND-SELECTION-PROBE-FRAMEWORK-GUIDANCE',
  gateId: 'second-selection-probe-gate',
};

interface ToolOutcome {
  isError: boolean;
  text: string;
}

interface McpSession {
  callTool(name: string, args: Record<string, unknown>): Promise<ToolOutcome>;
  countTools(): Promise<number | string>;
  stop(): Promise<void>;
}

type RawResult = { isError?: boolean; content?: Array<{ text?: string }>; tools?: unknown[] };

const toOutcome = (result: RawResult): ToolOutcome => ({
  isError: result.isError === true,
  text: (result.content ?? []).map((part) => part.text ?? '').join('\n'),
});

/** A protocol error is an outcome to assert on, not an exception that ends the test early. */
const failedOutcome = (error: unknown): ToolOutcome => ({
  isError: true,
  text: error instanceof Error ? error.message : String(error),
});

async function startHttpSession(env: Record<string, string>): Promise<McpSession> {
  const port = await getAvailablePort();
  const baseUrl = `http://localhost:${port}`;
  const proc = startServerWithHttp(port, { transport: 'streamable-http', env });
  await waitForHealth(baseUrl, { timeout: 15000, interval: 200 });
  const client = new StreamableHttpMcpClient(baseUrl);
  await client.initialize();
  let requestId = 1;

  const request = async (method: string, params: Record<string, unknown>): Promise<RawResult> =>
    (await client.request(method, params, ++requestId)) as RawResult;

  return {
    callTool: async (name, args) =>
      request('tools/call', { name, arguments: args }).then(toOutcome, failedOutcome),
    countTools: async () =>
      request('tools/list', {}).then(
        (result) => result.tools?.length ?? 0,
        (error: unknown) => failedOutcome(error).text
      ),
    stop: async () => {
      await client.close();
      await killServer(proc);
    },
  };
}

async function startStdioSession(env: Record<string, string>): Promise<McpSession> {
  // The HTTP sibling gets its pair from `startServerWithHttp`; a direct spawn has to ask.
  const roots = createHermeticRoots('framework-selection-stdio');
  const proc: ChildProcess = spawn(
    'node',
    [path.join(SERVER_ROOT, 'dist', 'index.js'), '--transport=stdio'],
    {
      env: buildServerEnv({ ...roots.env, ...env }),
      stdio: ['pipe', 'pipe', 'pipe'],
    }
  );
  const pending = new Map<number, (message: { result?: RawResult; error?: unknown }) => void>();
  let buffer = '';
  let seq = 0;
  proc.stdout?.on('data', (chunk: Buffer) => {
    buffer += chunk.toString();
    let idx: number;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line.startsWith('{')) continue;
      try {
        const message = JSON.parse(line) as { id?: number; result?: RawResult; error?: unknown };
        if (message.id !== undefined) {
          pending.get(message.id)?.(message);
          pending.delete(message.id);
        }
      } catch {
        // Non-JSON stdout noise is not a protocol message.
      }
    }
  });

  const request = (method: string, params: Record<string, unknown>): Promise<RawResult> =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, (message) =>
        message.error !== undefined
          ? reject(new Error(JSON.stringify(message.error)))
          : resolve(message.result ?? {})
      );
      proc.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });

  await request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'framework-selection-lifecycle-e2e', version: '1.0.0' },
  });
  proc.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);

  return {
    callTool: async (name, args) =>
      request('tools/call', { name, arguments: args }).then(toOutcome, failedOutcome),
    countTools: async () =>
      request('tools/list', {}).then(
        (result) => result.tools?.length ?? 0,
        (error: unknown) => failedOutcome(error).text
      ),
    stop: async () => {
      try {
        if (proc.exitCode === null) {
          const exited = new Promise((resolve) => proc.once('exit', resolve));
          proc.kill('SIGTERM');
          await exited;
        }
      } finally {
        roots.cleanup();
      }
    },
  };
}

interface Workspace {
  env: Record<string, string>;
  frameworkDir: string;
  /** Rewrites `frameworks.defaultFramework`; a server reads it when it starts. */
  setConfiguredDefault(frameworkId: string): Promise<void>;
  cleanup(): Promise<void>;
}

/** An empty workspace and runtime root, with a copy of the packaged config naming a default. */
async function createWorkspace(): Promise<Workspace> {
  const workspace = await mkdtemp(path.join(tmpdir(), 'framework-selection-ws-'));
  const runtimeRoot = await mkdtemp(path.join(tmpdir(), 'framework-selection-rt-'));
  const config = JSON.parse(readFileSync(path.join(SERVER_ROOT, 'config.json'), 'utf8')) as {
    frameworks?: Record<string, unknown>;
  };
  const configPath = path.join(runtimeRoot, 'config.json');
  const setConfiguredDefault = async (frameworkId: string): Promise<void> => {
    // The shipped config.json carries no sections — code owns the defaults — so `frameworks`
    // is absent until a test writes into it.
    config.frameworks ??= {};
    config.frameworks.defaultFramework = frameworkId;
    await writeFile(configPath, JSON.stringify(config, null, 2));
  };
  await setConfiguredDefault(CONFIGURED_DEFAULT);
  return {
    env: { MCP_WORKSPACE: workspace, MCP_RUNTIME_ROOT: runtimeRoot, MCP_CONFIG_PATH: configPath },
    frameworkDir: path.join(workspace, 'resources', 'frameworks', FRAMEWORK_ID),
    setConfiguredDefault,
    cleanup: async () => {
      await rm(workspace, { recursive: true, force: true });
      await rm(runtimeRoot, { recursive: true, force: true });
    },
  };
}

const render = (session: McpSession): Promise<ToolOutcome> =>
  session.callTool('prompt_engine', { command: `>>${PROMPT_ID}` });

/** The framework `system_control status` reports as active, or the failure text. */
async function activeFramework(session: McpSession): Promise<string> {
  const status = await session.callTool('system_control', { action: 'status' });
  if (status.isError) return `status failed: ${status.text}`;
  const match = /Framework System\*\*: [^\n(]*\(([^)\n]+)\)/.exec(status.text);
  return match?.[1]?.toLowerCase() ?? `no active framework in: ${status.text.slice(0, 200)}`;
}

async function createPromptAndFramework(session: McpSession): Promise<void> {
  const prompt = await session.callTool('resource_manager', {
    resource_type: 'prompt',
    action: 'create',
    id: PROMPT_ID,
    name: 'Framework selection probe',
    category: 'general',
    description: 'Renders under the active framework',
    user_message_template: PROMPT_BODY,
  });
  expect(prompt.isError).toBe(false);

  await createFramework(session, FIRST_FRAMEWORK);
}

async function createFramework(session: McpSession, spec: FrameworkSpec): Promise<void> {
  const framework = await session.callTool('resource_manager', {
    resource_type: 'framework',
    action: 'create',
    id: spec.id,
    name: spec.name,
    description: 'Created while the server runs',
    system_prompt_guidance: spec.guidance,
    phases: [{ id: 'probe', name: 'Probe', description: 'The only phase' }],
    framework_gates: [
      {
        id: spec.gateId,
        name: 'Probe gate',
        description: 'Validates the probe phase',
        frameworkArea: 'probe',
        priority: 'high',
        validationCriteria: ['probe criterion'],
      },
    ],
  });
  expect(framework.isError).toBe(false);
}

async function switchTo(session: McpSession, frameworkId: string): Promise<void> {
  const switched = await session.callTool('system_control', {
    action: 'framework',
    operation: 'switch',
    framework: frameworkId,
  });
  expect(switched.isError).toBe(false);
}

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()?.();
  }
}, 30000);

async function start(
  starter: (env: Record<string, string>) => Promise<McpSession>,
  workspace: Workspace
): Promise<McpSession> {
  const session = await starter(workspace.env);
  cleanups.push(() => session.stop());
  return session;
}

async function newWorkspace(): Promise<Workspace> {
  const workspace = await createWorkspace();
  cleanups.unshift(() => workspace.cleanup());
  return workspace;
}

describe.each([
  ['Streamable HTTP', startHttpSession],
  ['STDIO', startStdioSession],
] as const)('framework selection (%s)', (_transport, starter) => {
  it('control: switching to a bundled framework renders under it', async () => {
    const session = await start(starter, await newWorkspace());
    await createPromptAndFramework(session);
    await switchTo(session, 'react');

    const rendered = await render(session);
    expect(rendered.isError).toBe(false);
    expect(rendered.text).toContain('ReACT');
    expect(await session.countTools()).toBe(3);
  }, 90000);

  it('a framework created while the server runs can be switched to and rendered', async () => {
    const session = await start(starter, await newWorkspace());
    await createPromptAndFramework(session);
    await switchTo(session, FRAMEWORK_ID);

    const rendered = await render(session);
    expect(rendered.text).toContain(FRAMEWORK_GUIDANCE);
    expect(rendered.isError).toBe(false);
    expect(await session.countTools()).toBe(3);
    expect(await activeFramework(session)).toBe(FRAMEWORK_ID);
  }, 90000);

  it('a change to frameworks.defaultFramework while the server runs is what deletion falls back to', async () => {
    const workspace = await newWorkspace();
    const seed = await starter(workspace.env);
    try {
      await createPromptAndFramework(seed);
      await createFramework(seed, SECOND_FRAMEWORK);
    } finally {
      await seed.stop();
    }
    await workspace.setConfiguredDefault(FIRST_FRAMEWORK.id);
    const session = await start(starter, workspace);

    // Edit the config file under the running server. The delete refusal reads the setting when it
    // runs, so a refused preview of the new default shows the server has reloaded the file.
    await workspace.setConfiguredDefault(SECOND_FRAMEWORK.id);
    const previewDeletingNewDefault = (): Promise<ToolOutcome> =>
      session.callTool('resource_manager', {
        resource_type: 'framework',
        action: 'preview',
        preview_action: 'delete',
        id: SECOND_FRAMEWORK.id,
      });
    let preview = await previewDeletingNewDefault();
    const deadline = Date.now() + 20000;
    while (!preview.text.includes('frameworks.defaultFramework') && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      preview = await previewDeletingNewDefault();
    }
    expect(preview.isError).toBe(true);
    expect(preview.text).toContain('frameworks.defaultFramework');

    // The old default is now an ordinary framework: selecting it and deleting it must move the
    // selection to the new default, not to the default the server started with.
    await switchTo(session, FIRST_FRAMEWORK.id);
    const deleted = await session.callTool('resource_manager', {
      resource_type: 'framework',
      action: 'delete',
      id: FIRST_FRAMEWORK.id,
      confirm: true,
    });
    expect(deleted.text).not.toContain('frameworks.defaultFramework');
    expect(deleted.isError).toBe(false);

    expect(await activeFramework(session)).toBe(SECOND_FRAMEWORK.id);
    const rendered = await render(session);
    expect(rendered.isError).toBe(false);
    expect(rendered.text).toContain(SECOND_FRAMEWORK.guidance);
    expect(await session.countTools()).toBe(3);
  }, 150000);
});

describe('framework selection when the selected framework goes away (Streamable HTTP)', () => {
  it('deleting the active framework selects the configured default', async () => {
    const session = await start(startHttpSession, await newWorkspace());
    await createPromptAndFramework(session);
    await switchTo(session, FRAMEWORK_ID);

    const deleted = await session.callTool('resource_manager', {
      resource_type: 'framework',
      action: 'delete',
      id: FRAMEWORK_ID,
      confirm: true,
    });
    expect(deleted.isError).toBe(false);

    expect(await activeFramework(session)).toBe(CONFIGURED_DEFAULT);
    const rendered = await render(session);
    expect(rendered.isError).toBe(false);
    expect(rendered.text).toContain(PROMPT_BODY);
    expect(rendered.text).not.toContain(FRAMEWORK_GUIDANCE);
    expect(await session.countTools()).toBe(3);
  }, 90000);

  it('the configured default cannot be deleted while it is the active framework, and still renders', async () => {
    const workspace = await newWorkspace();
    const seed = await startHttpSession(workspace.env);
    try {
      await createPromptAndFramework(seed);
    } finally {
      await seed.stop();
    }
    await workspace.setConfiguredDefault(FRAMEWORK_ID);

    const session = await start(startHttpSession, workspace);
    await switchTo(session, FRAMEWORK_ID);

    const previewed = await session.callTool('resource_manager', {
      resource_type: 'framework',
      action: 'preview',
      preview_action: 'delete',
      id: FRAMEWORK_ID,
    });
    expect(previewed.isError).toBe(true);
    expect(previewed.text).toContain('frameworks.defaultFramework');

    const deleted = await session.callTool('resource_manager', {
      resource_type: 'framework',
      action: 'delete',
      id: FRAMEWORK_ID,
      confirm: true,
    });
    expect(deleted.isError).toBe(true);
    expect(deleted.text).toContain('frameworks.defaultFramework');

    expect(existsSync(workspace.frameworkDir)).toBe(true);
    expect(await activeFramework(session)).toBe(FRAMEWORK_ID);
    const rendered = await render(session);
    expect(rendered.isError).toBe(false);
    expect(rendered.text).toContain(FRAMEWORK_GUIDANCE);
    expect(await session.countTools()).toBe(3);
  }, 120000);

  it('a workspace framework selected before a restart is still selected after it', async () => {
    const workspace = await newWorkspace();
    const first = await startHttpSession(workspace.env);
    try {
      await createPromptAndFramework(first);
      await switchTo(first, FRAMEWORK_ID);
    } finally {
      await first.stop();
    }

    const second = await start(startHttpSession, workspace);
    expect(await activeFramework(second)).toBe(FRAMEWORK_ID);
    const rendered = await render(second);
    expect(rendered.isError).toBe(false);
    expect(rendered.text).toContain(FRAMEWORK_GUIDANCE);
  }, 120000);

  /**
   * Deleting the folder is a different route to the same outcome than deleting through the tool,
   * and it used to have a different result at EVERY timing. The file watcher saw the removal and
   * logged it, but the reload event it built carried no framework id, so the handler refused it
   * and the deleted framework stayed selected and kept rendering until a restart. The tool-driven
   * deletion above never exercised that path, because it calls the registry directly.
   *
   * WHY THIS WAITS BEFORE REMOVING. A workspace's `resources/frameworks/` does not exist when the
   * server starts; it is created by the first framework write. `FileObserver` cannot hand a
   * not-yet-existing path to chokidar (measured against chokidar 5.0.0: watching a path that does
   * not exist yet emits nothing at all, not even once it appears), so it polls for the directory
   * once a second and arms then. A removal inside that one-second window is never reported —
   * the watcher arms afterwards and snapshots the post-deletion state. That window is a separate,
   * still-open defect; closing it needs a reconcile-on-arm pass, not a faster poll. This test
   * waits past the window on purpose so it measures the reload path rather than the race.
   */
  it("removing the active framework's folder selects the configured default", async () => {
    const workspace = await newWorkspace();
    const session = await start(startHttpSession, workspace);
    await createPromptAndFramework(session);
    await switchTo(session, FRAMEWORK_ID);

    // Past the 1s pending-directory poll, so the watcher is armed on the frameworks folder.
    await new Promise((resolve) => setTimeout(resolve, 2500));

    await rm(workspace.frameworkDir, { recursive: true, force: true });

    let active = await activeFramework(session);
    const deadline = Date.now() + 20000;
    while (active !== CONFIGURED_DEFAULT && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      active = await activeFramework(session);
    }
    expect(active).toBe(CONFIGURED_DEFAULT);

    const rendered = await render(session);
    expect(rendered.isError).toBe(false);
    expect(rendered.text).toContain(PROMPT_BODY);
    expect(await session.countTools()).toBe(3);
  }, 90000);
});
