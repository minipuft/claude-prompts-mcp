// @lifecycle test - A refused gate request runs no script tool, through the composition root.
/**
 * A prompt's script tools run at stage 08 (and an `auto_execute` they emit at stage 09). A call the
 * server refuses replies "Nothing was executed", so every refusal of what the call asked for has
 * to land before stage 08: a script that ran under a refused call is a side effect the client was
 * told did not happen.
 *
 * The fixture's script writes a sentinel file named by its `go` argument, so each case observes
 * whether the script ran without reading any log. Each refusal case has a control that differs
 * only in the refused part and does write its sentinel, so "no sentinel" is never read from a
 * script that could not have run.
 *
 * The startup path is the composition root's (`composition-root.integration.test.ts` documents
 * the sequence); requests enter through the registered `prompt_engine` callback.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from '@jest/globals';

import { installIssuedReviewCloneFixture } from '../chain/issued-review-clone-fixture.js';

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { McpServer } from '@modelcontextprotocol/server';

import { SqliteEngine } from '../../../src/infra/database/index.js';
import { PromptAssetManager } from '../../../src/modules/prompts/index.js';
import { createConversationStore } from '../../../src/modules/text-refs/conversation.js';
import { TextReferenceStore } from '../../../src/modules/text-refs/index.js';
import { createRuntimeFoundation } from '../../../src/runtime/context.js';
import { loadPromptData } from '../../../src/runtime/data-loader.js';
import { initializeModules } from '../../../src/runtime/module-initializer.js';
import { testScratchPath } from '../../helpers/scratch-path.js';

import type { ConfigLoader } from '../../../src/infra/config/index.js';
import type { Logger } from '../../../src/infra/logging/index.js';
import type { RuntimeFoundation } from '../../../src/runtime/context.js';
import type { ModuleInitResult } from '../../../src/runtime/module-initializer.js';
import type { RuntimeLaunchOptions } from '../../../src/runtime/options.js';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
/** `MCP_RESOURCES_PATH` outranks the workspace, and a developer shell may export it. */
const PATH_ENV_KEYS = [
  'MCP_RUNTIME_ROOT',
  'MCP_WORKSPACE',
  'MCP_RESOURCES_PATH',
  'MCP_CONFIG_PATH',
];
const originalEnv = new Map(PATH_ENV_KEYS.map((key) => [key, process.env[key]]));
const BODY = 'BODY-sr_tool';

type ToolCallback = (args: Record<string, unknown>, extra: unknown) => Promise<unknown>;
interface Reply {
  isError: boolean;
  text: string;
}

const silentLogger = (): Logger =>
  ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }) as unknown as Logger;

let root: string;
let sentinelDir: string;
let foundation: RuntimeFoundation;
let modules: ModuleInitResult;
let promptManager: PromptAssetManager;
const tools = new Map<string, ToolCallback>();

async function promptEngine(args: Record<string, unknown>): Promise<Reply> {
  const callback = tools.get('prompt_engine');
  if (callback === undefined) throw new Error('prompt_engine was never registered');
  const result = (await callback(args, {})) as {
    isError?: boolean;
    content?: Array<{ text?: string }>;
  };
  return {
    isError: result.isError === true,
    text: (result.content ?? []).map((part) => part.text ?? '').join('\n'),
  };
}

/** Whether the script ran for the call whose `go` argument was `name`. */
const scriptRan = (name: string): boolean => existsSync(path.join(sentinelDir, name));

/**
 * One prompt with a prompt-local script tool, the only kind stage 08 runs. `schema_match` on a
 * required `go` plus `autoApproveOnValid` runs it on any call that passes `go`.
 */
function writeWorkspace(workspace: string): void {
  const dir = path.join(workspace, 'resources', 'prompts', 'general', 'sr_tool');
  const toolDir = path.join(dir, 'tools', 'sr_writer');
  mkdirSync(toolDir, { recursive: true });
  writeFileSync(
    path.join(dir, 'prompt.yaml'),
    [
      'id: sr_tool',
      'name: sr_tool',
      'category: general',
      'description: a prompt whose script tool writes a sentinel file',
      `userMessageTemplate: ${BODY}`,
      'tools:',
      '  - sr_writer',
      'arguments:',
      '  - name: go',
      '    type: string',
      '    description: the sentinel name',
      '    required: false',
      'gateConfiguration:',
      '  exclude:',
      '    - content-structure',
      '  framework_gates: false',
      '',
    ].join('\n')
  );
  writeFileSync(
    path.join(toolDir, 'tool.yaml'),
    [
      'id: sr_writer',
      'name: sr writer',
      'description: writes a sentinel file named by its input',
      'runtime: node',
      'script: script.mjs',
      'timeout: 15000',
      'enabled: true',
      'execution:',
      '  trigger: schema_match',
      '  strict: false',
      '  autoApproveOnValid: true',
      '',
    ].join('\n')
  );
  writeFileSync(
    path.join(toolDir, 'schema.json'),
    JSON.stringify({
      type: 'object',
      properties: { go: { type: 'string', description: 'the sentinel name' } },
      required: ['go'],
    })
  );
  writeFileSync(
    path.join(toolDir, 'script.mjs'),
    [
      'import { writeFileSync } from "node:fs";',
      'import path from "node:path";',
      'let raw = "";',
      'process.stdin.on("data", (c) => (raw += c));',
      'process.stdin.on("end", () => {',
      '  const { go } = JSON.parse(raw);',
      `  writeFileSync(path.join(${JSON.stringify(sentinelDir)}, String(go)), "ran");`,
      '  process.stdout.write(JSON.stringify({ valid: true }));',
      '});',
      '',
    ].join('\n')
  );
}

beforeAll(async () => {
  root = testScratchPath('script-tool-refusal-order');
  const workspace = path.join(root, 'workspace');
  const runtimeRoot = path.join(root, 'runtime');
  sentinelDir = path.join(root, 'sentinels');
  for (const dir of [workspace, runtimeRoot, sentinelDir]) mkdirSync(dir, { recursive: true });
  writeWorkspace(workspace);
  for (const key of PATH_ENV_KEYS) delete process.env[key];
  process.env['MCP_RUNTIME_ROOT'] = runtimeRoot;

  const logger = silentLogger();
  const runtimeOptions: RuntimeLaunchOptions = {
    args: [],
    verbose: false,
    quiet: true,
    startupTest: false,
    testEnvironment: true,
    transport: 'stdio',
    paths: { workspace },
    serverRoot: SERVER_ROOT,
    identityDefaults: { workspaceId: 'script-tool-refusal-order' },
  };
  foundation = await createRuntimeFoundation(runtimeOptions, { logger });
  const configManager = foundation.configManager as ConfigLoader;
  configManager.setTransportMode(foundation.transport);

  const textReferenceStore = new TextReferenceStore(logger);
  const config = configManager.getConfig();
  const mcpServer = new McpServer({ name: config.server.name, version: config.server.version });
  const register = mcpServer.registerTool.bind(mcpServer);
  mcpServer.registerTool = ((name: string, toolConfig: unknown, callback: ToolCallback) => {
    tools.set(name, callback);
    return register(name as never, toolConfig as never, callback as never);
  }) as typeof mcpServer.registerTool;

  promptManager = new PromptAssetManager(
    logger,
    textReferenceStore,
    createConversationStore(logger),
    configManager,
    mcpServer
  );
  const data = await loadPromptData({
    logger,
    configManager,
    promptManager,
    runtimeOptions,
    serverRoot: foundation.serverRoot,
    pathResolver: foundation.pathResolver,
  });
  modules = await initializeModules({
    logger,
    configManager,
    runtimeOptions,
    promptsData: data.promptsData,
    categories: data.categories,
    convertedPrompts: data.convertedPrompts,
    promptManager,
    textReferenceStore,
    mcpServer,
    serverRoot: foundation.serverRoot,
    pathResolver: foundation.pathResolver,
    callbacks: {
      fullServerRefresh: async () => {},
      restartServer: async () => {},
      handleFrameworkConfigChange: async () => {},
    },
  });
}, 60000);

afterAll(async () => {
  await modules?.frameworkStateStore.shutdown();
  await promptManager?.shutdown();
  await foundation?.serviceOrchestrator.stopAll();
  await modules?.mcpToolsManager.getChainSessionStore()?.cleanup();
  modules?.mcpToolsManager.shutdown();
  await SqliteEngine.shutdownInstance();
  rmSync(root, { recursive: true, force: true });
  for (const [key, value] of originalEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

let cloneFixture: ReturnType<typeof installIssuedReviewCloneFixture>;
beforeEach(() => {
  cloneFixture = installIssuedReviewCloneFixture();
});
afterEach(() => {
  cloneFixture.restore();
});

describe('a refused gate request runs no script tool', () => {
  test('control: the prompt runs its script and renders', async () => {
    const reply = await promptEngine({ command: '>>sr_tool go:"control-plain"' });
    expect(reply.isError).toBe(false);
    expect(reply.text).toContain(BODY);
    expect(scriptRan('control-plain')).toBe(true);
  });

  test.each([
    [
      'a blank quick request gate',
      { gates: [{ name: 'Tone', description: '   ' }] },
      { gates: [{ name: 'Tone', description: 'Plain and direct' }] },
      '[gate-criteria-invalid]',
    ],
    [
      'a request gate under a canonical gate id',
      { gates: [{ id: 'code-quality', criteria: ['REWRITTEN'] }] },
      { gates: ['code-quality'] },
      '[gate-id-canonical]',
    ],
  ])('%s is refused before the script runs', async (_, refused, control, reason) => {
    const tag = reason.slice(1, -1);
    const reply = await promptEngine({ command: `>>sr_tool go:"${tag}"`, ...refused });
    expect(reply.isError).toBe(true);
    expect(reply.text).toContain(reason);
    expect(reply.text).toContain('Nothing was executed');
    expect(scriptRan(tag)).toBe(false);

    const ran = await promptEngine({ command: `>>sr_tool go:"${tag}-control"`, ...control });
    expect(ran.isError).toBe(false);
    expect(scriptRan(`${tag}-control`)).toBe(true);
  });

  test('a requested gate under %clean is refused before the script runs', async () => {
    const reply = await promptEngine({
      command: '%clean >>sr_tool go:"suppressed" :: "MUST-CITE"',
    });
    expect(reply.isError).toBe(true);
    expect(reply.text).toContain('[gate-suppressed]');
    expect(reply.text).toContain('%clean runs without gates');
    expect(reply.text).toContain('Nothing was executed');
    expect(scriptRan('suppressed')).toBe(false);

    const ran = await promptEngine({ command: '%clean >>sr_tool go:"suppressed-control"' });
    expect(ran.isError).toBe(false);
    expect(scriptRan('suppressed-control')).toBe(true);
  });

  test('with the gate switch off, a requested gate is refused before the script runs', async () => {
    const systemControl = tools.get('system_control');
    if (systemControl === undefined) throw new Error('system_control was never registered');
    await systemControl({ action: 'gates', operation: 'disable' }, {});
    try {
      const reply = await promptEngine({
        command: '>>sr_tool go:"switch-off"',
        gates: ['code-quality'],
      });
      expect(reply.isError).toBe(true);
      expect(reply.text).toContain('[gate-suppressed]');
      expect(scriptRan('switch-off')).toBe(false);

      const ran = await promptEngine({ command: '>>sr_tool go:"switch-off-control"' });
      expect(ran.isError).toBe(false);
      expect(scriptRan('switch-off-control')).toBe(true);
    } finally {
      await systemControl({ action: 'gates', operation: 'enable' }, {});
    }
  });
});
