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

/**
 * P6.154 / R145. MEASURED 2026-09-28 on `1ace2bfef` (driven, Streamable HTTP): with ReACT
 * selected, an `analysis` prompt's render lists the `framework-compliance` gate under
 * "### Framework Compliance", followed by the ReACT guidance line alone, and names CAGEERF
 * nowhere. The title is the gate definition's `name`
 * (`resources/gates/framework-compliance/gate.yaml`), which names no framework.
 *
 * PIN (as of 2026-09-28 · flips when that `name` names a framework). The control switches the same
 * server to CAGEERF: the render then names CAGEERF under the same title (its guidance opens with
 * "**CAGEERF Framework Guidelines:**"), so the absence is something this probe can see.
 */
describe('P6.154: the framework-compliance title names no framework (Streamable HTTP)', () => {
  const COMPLIANCE_PROMPT = 'p154_analysis';
  const complianceTitles = (text: string): string[] =>
    text.split('\n').filter((line) => /^### .*Compliance/.test(line));

  it('a ReACT workspace reads the agnostic title and no CAGEERF; a CAGEERF control reads it', async () => {
    const session = await start(startHttpSession, await newWorkspace());
    const created = await session.callTool('resource_manager', {
      resource_type: 'prompt',
      action: 'create',
      id: COMPLIANCE_PROMPT,
      name: 'Compliance title probe',
      // The compliance gate activates on an analysis-family category only.
      category: 'analysis',
      description: 'An analysis prompt the framework-compliance gate activates on',
      user_message_template: 'P154-ANALYZE',
    });
    expect(created.isError).toBe(false);

    await switchTo(session, 'react');
    const react = await session.callTool('prompt_engine', { command: `>>${COMPLIANCE_PROMPT}` });
    expect(react.isError).toBe(false);
    expect(react.text).toContain('framework-compliance');
    expect(complianceTitles(react.text)).toEqual(['### Framework Compliance']);
    expect(react.text).toContain('- ReACT: Show clear Reasoning and Acting phases');
    expect(react.text).not.toContain('CAGEERF');

    await switchTo(session, 'cageerf');
    const control = await session.callTool('prompt_engine', { command: `>>${COMPLIANCE_PROMPT}` });
    expect(control.isError).toBe(false);
    expect(complianceTitles(control.text)).toEqual(['### Framework Compliance']);
    expect(control.text).toContain('**CAGEERF Framework Guidelines:**');
  }, 90000);
});

/**
 * P6.198 / R149. MEASURED 2026-09-28 on `6b6fff7aa` (driven, Streamable HTTP, framework system
 * disabled through `system_control framework disable`): under `^ReACT >>a` arrow-chain `>>b` the
 * planned steps rendered ReACT's required sections, while the investigation step a blocking
 * unknown inserted rendered no framework block and the remainder step `r1` rendered no required
 * sections. With the system enabled both carried ReACT. A step added mid-run resolves its
 * framework through the prompt executor's fallback, which returned nothing whenever the system was
 * disabled, override or not.
 *
 * Now a `^Framework` override applies to every step the run renders, planned or added, whether or
 * not the framework system is enabled; with no override a disabled system still renders none.
 */
describe('P6.198: a framework override needs no system toggle on a step added mid-run (Streamable HTTP)', () => {
  const REACT_SECTION = '- `## Reasoning` (required)';
  const SECTIONS = ['Reasoning', 'Action', 'Observation']
    .map(
      (header) =>
        `## ${header}\n${`The ${header.toLowerCase()} of this answer, in full. `.repeat(6)}`
    )
    .join('\n\n');
  const PASS = 'GATE_REVIEW: PASS - ok';

  /**
   * The framework system disabled, and a run grown by an inserted and a remainder step. Only the
   * remainder's `p198_a` keeps the framework's sections: the planned `p198_s1` and `p198_b` declare
   * none, so no answer is graded against a framework and both runs reach the remainder step.
   */
  async function runWithAddedSteps(command: string) {
    const session = await start(startHttpSession, await newWorkspace());
    for (const id of ['p198_s1', 'p198_b', 'p198_a']) {
      const created = await session.callTool('resource_manager', {
        resource_type: 'prompt',
        action: 'create',
        id,
        name: id,
        category: 'general',
        description: 'A step rendering under the run framework',
        user_message_template: `BODY-${id}`,
        ...(id === 'p198_a' ? {} : { gate_configuration: { framework_gates: false } }),
      });
      expect(created.isError).toBe(false);
    }
    const disabled = await session.callTool('system_control', {
      action: 'framework',
      operation: 'disable',
      reason: 'P6.198',
    });
    expect(disabled.isError).toBe(false);

    const planned = await session.callTool('prompt_engine', { command });
    expect(planned.isError).toBe(false);
    const chainId = /chain_id[=:] ?"(chain-[A-Za-z0-9_#-]+)"/.exec(planned.text)?.[1];
    const call = (args: Record<string, unknown>) =>
      session.callTool('prompt_engine', { chain_id: chainId, ...args });
    // Two planned answers first: the unknown raised on step 3 inserts its step at position 4,
    // where the every-3-steps frequency injects the framework block for the rendered step (R151).
    for (const answer of ['A1 out', 'A2 out']) {
      await call({ user_response: `${answer}\n${SECTIONS}`, gate_verdict: PASS });
    }
    const inserted = await call({
      user_response: `A out\n${SECTIONS}`,
      gate_verdict: PASS,
      observations: [
        { type: 'unknown_discovered', id: 'u-198', statement: 'rest undecided', blocking: true },
      ],
    });
    const plannedSecond = await call({
      user_response: 'investigated',
      gate_verdict: PASS,
      remainder: { mode: 'append', nodes: [{ id: 'r1', promptId: 'p198_a' }] },
    });
    const contributed = await call({ user_response: `B out\n${SECTIONS}`, gate_verdict: PASS });
    return { planned, inserted, plannedSecond, contributed };
  }

  it('(a) under ^ReACT the planned, inserted and remainder steps all render ReACT', async () => {
    const run = await runWithAddedSteps(
      '^ReACT >>p198_s1 --> >>p198_s1 --> >>p198_s1 --> >>p198_b'
    );
    expect(run.planned.text).toContain('ReACT Framework Active');
    expect(run.inserted.text).toContain('## Investigate: rest undecided');
    expect(run.inserted.text).toContain('ReACT Framework Active');
    expect(run.plannedSecond.text).toContain('BODY-p198_b');
    expect(run.contributed.text).not.toContain('BODY-p198_b');
    expect(run.contributed.text).toContain('BODY-p198_a');
    expect(run.contributed.text).toContain(REACT_SECTION);
  }, 120000);

  it('(b) control: with no override the steps added mid-run still render no framework', async () => {
    // Only the added steps: with the system disabled and no override, a PLANNED step renders the
    // active framework today (measured 2026-09-28, reported as a finding, not ruled here). The
    // one difference from (a) is the operator, so the bypass is keyed on the override alone:
    // the run still decides the active framework here, and an added step must not render it.
    const run = await runWithAddedSteps('>>p198_s1 --> >>p198_s1 --> >>p198_s1 --> >>p198_b');
    expect(run.inserted.text).toContain('## Investigate: rest undecided');
    expect(run.inserted.text).not.toContain('Framework Active');
    expect(run.contributed.text).not.toContain('BODY-p198_b');
    expect(run.contributed.text).toContain('BODY-p198_a');
    expect(run.contributed.text).not.toContain('**Required Sections**');
    expect(run.contributed.text).not.toContain('Framework Active');
  }, 120000);
});

/**
 * R158 (P6.270, P6.269). The framework toggle decides a run's framework at its first call, and
 * the run keeps that decision for its life. MEASURED 2026-09-29 on `1efa6988a` (driven, Streamable
 * HTTP, no override): with the system disabled BEFORE the run, every planned step still rendered
 * the active framework (its block, its required sections, a framework-compliance review) and stage
 * 19 graded a sectionless answer on one; with the system disabled after the first call, the
 * planned steps kept the framework while the inserted and remainder steps lost it and stage 19
 * stopped grading the remainder. Planned steps read a decision that ignored the toggle; added
 * steps read the toggle on every call.
 */
describe('R158: the framework toggle decides a run at its first call (Streamable HTTP)', () => {
  const SECTIONS = ['Context', 'Analysis', 'Goals', 'Execution']
    .map(
      (header) =>
        `## ${header}\n${`The ${header.toLowerCase()} of this answer, in full. `.repeat(6)}`
    )
    .join('\n\n');
  const PASS = 'GATE_REVIEW: PASS - ok';
  /** What any framework renders: its block, its required sections, its guideline gate. */
  const FRAMEWORK_MARKERS = [
    'Framework Active',
    '**Required Sections**',
    'Framework Guidelines',
    'Framework Compliance',
  ];
  const STRUCTURAL_REVIEW = '**Structural Review Required**';
  const rendersNoFramework = (text: string) =>
    FRAMEWORK_MARKERS.filter((marker) => text.includes(marker));

  /**
   * Four planned steps, a blocking unknown on step 3 inserting an investigation step, and a
   * remainder `r1`. Steps 2 and `r1` are answered with no sections, which stage 19 grades only
   * when the run applies a framework.
   */
  async function runToggled(disable: 'before-start' | 'after-first-call') {
    const session = await start(startHttpSession, await newWorkspace());
    for (const id of ['r158_s', 'r158_b', 'r158_a']) {
      const created = await session.callTool('resource_manager', {
        resource_type: 'prompt',
        action: 'create',
        id,
        name: id,
        category: 'general',
        description: 'A step rendering under the run framework',
        user_message_template: `BODY-${id}`,
      });
      expect(created.isError).toBe(false);
    }
    const disableSystem = async () => {
      const disabled = await session.callTool('system_control', {
        action: 'framework',
        operation: 'disable',
        reason: 'R158',
      });
      expect(disabled.isError).toBe(false);
    };
    if (disable === 'before-start') await disableSystem();

    const first = await session.callTool('prompt_engine', {
      command: '>>r158_s --> >>r158_s --> >>r158_s --> >>r158_b',
    });
    expect(first.isError).toBe(false);
    const chainId = /chain_id[=:] ?"(chain-[A-Za-z0-9_#-]+)"/.exec(first.text)?.[1];
    const call = (args: Record<string, unknown>) =>
      session.callTool('prompt_engine', { chain_id: chainId, ...args });
    const second = await call({ user_response: `A1 out\n${SECTIONS}`, gate_verdict: PASS });
    if (disable === 'after-first-call') await disableSystem();
    const sectionless = await call({ user_response: 'plain answer two', gate_verdict: PASS });
    const inserted = await call({
      user_response: `A3 out\n${SECTIONS}`,
      gate_verdict: PASS,
      observations: [
        { type: 'unknown_discovered', id: 'u-158', statement: 'rest undecided', blocking: true },
      ],
    });
    const fourth = await call({
      user_response: 'investigated',
      gate_verdict: PASS,
      remainder: { mode: 'append', nodes: [{ id: 'r1', promptId: 'r158_a' }] },
    });
    const contributed = await call({ user_response: `B out\n${SECTIONS}`, gate_verdict: PASS });
    const contributedAnswered = await call({ user_response: 'plain r1', gate_verdict: PASS });
    return { first, second, sectionless, inserted, fourth, contributed, contributedAnswered };
  }

  it('P6.270 (a) a run started with the system off renders no framework on any step and grades no phase', async () => {
    const run = await runToggled('before-start');
    expect(run.inserted.text).toContain('## Investigate: rest undecided');
    expect(run.contributed.text).toContain('BODY-r158_a');
    for (const render of [
      run.first,
      run.second,
      run.sectionless,
      run.inserted,
      run.fourth,
      run.contributed,
    ]) {
      expect(rendersNoFramework(render.text)).toEqual([]);
    }
    expect(run.sectionless.text).not.toContain(STRUCTURAL_REVIEW);
    expect(run.contributedAnswered.text).not.toContain(STRUCTURAL_REVIEW);
  }, 120000);

  it('P6.270 (b) control: a run started with the system on keeps its framework on planned steps after it is switched off', async () => {
    const run = await runToggled('after-first-call');
    expect(run.first.text).toContain('Framework Active');
    expect(run.sectionless.text).toContain('**Required Sections**');
    expect(run.fourth.text).toContain('BODY-r158_b');
    expect(run.fourth.text).toContain('**Required Sections**');
  }, 120000);

  it('P6.269 a run started with the system on keeps its framework on added steps and in the phase grading after it is switched off', async () => {
    const run = await runToggled('after-first-call');
    // Stage 19 grades a planned step answered after the switch on the run's framework.
    expect(run.sectionless.text).toContain(STRUCTURAL_REVIEW);
    expect(run.inserted.text).toContain('## Investigate: rest undecided');
    expect(run.inserted.text).toContain('Framework Active');
    expect(run.contributed.text).toContain('BODY-r158_a');
    expect(run.contributed.text).toContain('**Required Sections**');
    // ...and the remainder step, whose sections the added-step fallback declared.
    expect(run.contributedAnswered.text).toContain(STRUCTURAL_REVIEW);
  }, 120000);
});

/**
 * P6.272 / R156 (amended). MEASURED 2026-09-29 on `abadca951` (driven, Streamable HTTP): on a
 * chain whose every step carries a blocking gate, the gate-guidance frequency (first step only,
 * every step, every 2nd step) changed nothing: every render carried the gate's guidance. The call
 * answering a gated step decides while that step's review is open, and a gate review is never
 * thinned by the frequency, so the step it renders next names the gates it will be graded on.
 *
 * PIN: in a fully blocking-gated chain every render carries its gate's guidance at every
 * frequency. CONTROL: the frequency still thins a gated step rendered by a call that answered an
 * ungated step (the P6.151 shape: a request gate on step 1 makes step 3 the second gated step).
 */
describe('P6.272: gate-guidance frequency never thins a fully blocking-gated chain (Streamable HTTP)', () => {
  const FREQUENCIES = [0, 1, 2] as const;
  const PASS = 'GATE_REVIEW: PASS - ok';
  const OPT_OUT = { exclude: ['content-structure'], framework_gates: false };

  /** A server whose config sets the gate-guidance frequency, with three plain step prompts. */
  async function serverAt(frequency: number) {
    const workspace = await newWorkspace();
    const configPath = workspace.env['MCP_CONFIG_PATH'] as string;
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
      frameworks?: Record<string, unknown>;
    };
    config.frameworks = {
      ...config.frameworks,
      injection: { gateGuidance: { frequency, target: 'both' } },
    };
    await writeFile(configPath, JSON.stringify(config, null, 2));
    const session = await start(startHttpSession, workspace);
    for (const id of ['p272_a', 'p272_b', 'p272_c']) {
      const created = await session.callTool('resource_manager', {
        resource_type: 'prompt',
        action: 'create',
        id,
        name: id,
        category: 'general',
        description: 'A plain chain step',
        user_message_template: `BODY-${id}`,
        gate_configuration: OPT_OUT,
      });
      expect(created.isError).toBe(false);
    }
    return session;
  }

  async function createChain(
    session: McpSession,
    id: string,
    steps: Array<Record<string, unknown>>
  ): Promise<void> {
    const created = await session.callTool('resource_manager', {
      resource_type: 'prompt',
      action: 'create',
      id,
      name: id,
      category: 'general',
      description: 'P6.272 chain',
      user_message_template: 'CHAIN',
      gate_configuration: OPT_OUT,
      chain_steps: steps,
    });
    expect(created.isError).toBe(false);
  }

  const chainIdOf = (text: string) => /chain_id[=:] ?"(chain-[A-Za-z0-9_#-]+)"/.exec(text)?.[1];

  it('pin: every render of a fully blocking-gated chain carries its guidance, at every frequency', async () => {
    const observed: Record<number, boolean[]> = {};
    for (const frequency of FREQUENCIES) {
      const session = await serverAt(frequency);
      const gateId = `p272-block-f${frequency}`;
      const gate = await session.callTool('resource_manager', {
        resource_type: 'gate',
        action: 'create',
        id: gateId,
        name: gateId,
        description: 'blocking',
        guidance: `GUIDANCE-${gateId}`,
        enforcement_mode: 'blocking',
      });
      expect(gate.isError).toBe(false);
      await createChain(session, 'p272_gated', [
        { promptId: 'p272_a', stepName: 'A', inlineGateIds: [gateId] },
        { promptId: 'p272_b', stepName: 'B', inlineGateIds: [gateId] },
        { promptId: 'p272_c', stepName: 'C', inlineGateIds: [gateId] },
      ]);
      const first = await session.callTool('prompt_engine', { command: '>>p272_gated' });
      const chainId = chainIdOf(first.text);
      const call = (answer: string) =>
        session.callTool('prompt_engine', {
          chain_id: chainId,
          user_response: answer,
          gate_verdict: PASS,
        });
      const second = await call('A out');
      const third = await call('B out');
      expect(third.text).toContain('BODY-p272_c');
      observed[frequency] = [first, second, third].map((render) =>
        render.text.includes(`GUIDANCE-${gateId}`)
      );
    }
    const everyRender = [true, true, true];
    expect(observed).toEqual({ 0: everyRender, 1: everyRender, 2: everyRender });
  }, 180000);

  it('control: a gated step rendered by a call that answered an ungated step follows the frequency', async () => {
    const observed: Record<number, boolean> = {};
    for (const frequency of FREQUENCIES) {
      const session = await serverAt(frequency);
      const gateId = `p272-late-f${frequency}`;
      const gate = await session.callTool('resource_manager', {
        resource_type: 'gate',
        action: 'create',
        id: gateId,
        name: gateId,
        description: 'blocking',
        guidance: `GUIDANCE-${gateId}`,
        enforcement_mode: 'blocking',
      });
      expect(gate.isError).toBe(false);
      await createChain(session, 'p272_late', [
        { promptId: 'p272_a', stepName: 'A' },
        { promptId: 'p272_b', stepName: 'B' },
        { promptId: 'p272_c', stepName: 'C', inlineGateIds: [gateId] },
      ]);
      const first = await session.callTool('prompt_engine', {
        command: '>>p272_late',
        gates: [
          {
            id: `p272-req-f${frequency}`,
            name: 'request',
            criteria: [`CRIT-272-${frequency}`],
            target_step_id: 'a',
          },
        ],
      });
      const chainId = chainIdOf(first.text);
      await session.callTool('prompt_engine', {
        chain_id: chainId,
        user_response: 'A out',
        gate_verdict: PASS,
      });
      const stepBlock = await session.callTool('prompt_engine', {
        chain_id: chainId,
        user_response: 'B out',
      });
      expect(stepBlock.text).toContain('BODY-p272_c');
      observed[frequency] = stepBlock.text.includes(`GUIDANCE-${gateId}`);
    }
    // Step 3 is the run's second gated step: first-only and every-2nd skip it, every-step shows it.
    expect(observed).toEqual({ 0: false, 1: true, 2: false });
  }, 180000);
});
