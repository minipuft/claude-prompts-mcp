// @lifecycle test - The pipeline the server's own composition root builds, driven through prompt_engine in-process.
/**
 * Every other in-process suite hand-wires stages "the way `pipeline-builder.ts` wires it"
 * (`step-lifecycle`, `delegation-detached`, `chain-lifecycle-emission`). Those are copies of the
 * composition root, so a closure the real builder drops or mis-wires is invisible to them and is
 * caught only by e2e.
 *
 * This suite runs the startup path itself: `createRuntimeFoundation` → `PromptAssetManager` →
 * `loadPromptData` → `initializeModules`, the same sequence `runtime/application.ts` runs before it
 * starts a transport. That builds the real `McpToolRouter`, which builds `PromptExecutor` with a
 * database and a `FrameworkManager`, and the executor builds the pipeline through
 * `PipelineBuilder.build()`. Requests enter through the registered `prompt_engine` callback, so the
 * router's argument allowlist sits on the path too. Only the transport is absent: the callback is
 * captured at `registerTool` and called directly.
 *
 * Boundaries replaced: the workspace and runtime root are temp directories, the logger is silent,
 * and `Application`'s refresh/restart callbacks are no-ops (nothing here edits resources). The
 * framework-config callback is a no-op because `Application`'s own is one at this point of startup:
 * its framework state store is assigned only after `initializeModules` returns.
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

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { McpServer } from '@modelcontextprotocol/server';

import { SqliteEngine } from '../../../src/infra/database/index.js';
import { PromptExecutor } from '../../../src/mcp/tools/prompt-engine/core/prompt-executor.js';
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

const PASS = 'GATE_REVIEW: PASS - ok';
const FRAMEWORK_HEADER = 'C.A.G.E.E.R.F Framework Active';

type ToolCallback = (args: Record<string, unknown>, extra: unknown) => Promise<unknown>;
interface Reply {
  isError: boolean;
  text: string;
}

const silentLogger = (): Logger =>
  ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }) as unknown as Logger;

let root: string;
let foundation: RuntimeFoundation;
let modules: ModuleInitResult;
let promptManager: PromptAssetManager;
let textReferenceStore: TextReferenceStore;
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

function chainIdOf(reply: Reply, promptId: string): string {
  const match = new RegExp(`chain-${promptId}#\\d+`).exec(reply.text);
  if (match === null) throw new Error(`no chain id for ${promptId} in:\n${reply.text}`);
  return match[0];
}

function writeWorkspace(workspace: string): void {
  const gateDir = path.join(workspace, 'resources', 'gates', 'cr-block');
  mkdirSync(gateDir, { recursive: true });
  writeFileSync(
    path.join(gateDir, 'gate.yaml'),
    [
      'id: cr-block',
      'name: cr-block',
      'type: validation',
      'description: composition root blocking gate',
      'severity: high',
      'enforcementMode: blocking',
      'guidance: GUIDANCE-cr-block',
      '',
    ].join('\n')
  );
  const prompt = (id: string, lines: string[]): void => {
    const dir = path.join(workspace, 'resources', 'prompts', 'general', id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, 'prompt.yaml'),
      [`id: ${id}`, `name: ${id}`, 'category: general', ...lines, ''].join('\n')
    );
  };
  // The default content gate and framework gates are opted out so each step's review holds only
  // the gate these scenarios name.
  const optOut = [
    'gateConfiguration:',
    '  exclude:',
    '    - content-structure',
    '  framework_gates: false',
  ];
  const steps = (gateId: string): string[] => [
    'chainSteps:',
    ...['cr_a', 'cr_b'].flatMap((stepId, index) => [
      `  - promptId: ${stepId}`,
      `    stepName: ${index === 0 ? 'A' : 'B'}`,
      '    inlineGateIds:',
      `      - ${gateId}`,
    ]),
  ];
  prompt('cr_a', ['description: step a', 'userMessageTemplate: BODY-cr_a', ...optOut]);
  prompt('cr_b', ['description: step b', 'userMessageTemplate: BODY-cr_b', ...optOut]);
  prompt('cr_chain', [
    'description: chain with a blocking canonical gate on every step',
    'userMessageTemplate: CHAIN-OWN-TEMPLATE',
    ...optOut,
    ...steps('cr-block'),
  ]);
  prompt('cr_def_chain', [
    'description: chain whose step gate is a definition it declares',
    'userMessageTemplate: DEF-CHAIN-OWN-TEMPLATE',
    ...optOut,
    '  inline_gate_definitions:',
    '    - name: CR Def',
    '      type: validation',
    '      scope: step',
    '      description: a gate the chain declares itself',
    '      guidance: GUIDANCE-CR-DEF',
    '      pass_criteria:',
    '        - DEF-CRITERION',
    ...steps('CR Def'),
  ]);
  // A workspace config overlays the packaged one key by key. This switch is what sends a chain's
  // own gate definitions through registration and the run's gate remap.
  writeFileSync(
    path.join(workspace, 'config.json'),
    JSON.stringify({ gates: { executeInlineGateDefinitions: true } })
  );
}

beforeAll(async () => {
  root = testScratchPath('composition-root');
  const workspace = path.join(root, 'workspace');
  const runtimeRoot = path.join(root, 'runtime');
  mkdirSync(workspace, { recursive: true });
  mkdirSync(runtimeRoot, { recursive: true });
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
    identityDefaults: { workspaceId: 'composition-root' },
  };
  foundation = await createRuntimeFoundation(runtimeOptions, { logger });
  const configManager = foundation.configManager as ConfigLoader;
  configManager.setTransportMode(foundation.transport);

  textReferenceStore = new TextReferenceStore(logger);
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
  // `Application.shutdown` order, minus the transport this suite never started.
  await modules?.frameworkStateStore.shutdown();
  await promptManager?.shutdown();
  await foundation?.serviceOrchestrator.stopAll();
  await modules?.mcpToolsManager.getChainSessionStore()?.cleanup();
  modules?.mcpToolsManager.shutdown();
  // Its 30s memory interval holds the process open; `Application.shutdown` never stops it.
  modules?.mcpToolsManager.getMetricsCollector().shutdown();
  await SqliteEngine.shutdownInstance();
  rmSync(root, { recursive: true, force: true });
  for (const [key, value] of originalEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

// The jest realm makes `structuredClone` output fail the canonical-JSON plain-object check an
// issued review runs; the fixture restores issued definitions to this realm and nothing else.
let cloneFixture: ReturnType<typeof installIssuedReviewCloneFixture>;
beforeEach(() => {
  cloneFixture = installIssuedReviewCloneFixture();
});
afterEach(() => {
  cloneFixture.restore();
});

describe('prompt_engine over the pipeline the composition root builds', () => {
  test('a gated chain starts under the active framework, holds for a verdict, and advances on PASS', async () => {
    const started = await promptEngine({ command: '>>cr_chain' });
    expect(started.isError).toBe(false);
    const chainId = chainIdOf(started, 'cr_chain');
    expect(started.text).toContain(FRAMEWORK_HEADER);
    expect(started.text).toContain('BODY-cr_a');
    expect(started.text).toContain('GUIDANCE-cr-block');
    expect(started.text).toContain('Progress 1/2');

    const answered = await promptEngine({ chain_id: chainId, user_response: 'ANSWER-A' });
    expect(answered.isError).toBe(false);
    expect(answered.text).toContain('Gate Review Required');
    expect(answered.text).toContain('Progress 1/2');

    const advanced = await promptEngine({ chain_id: chainId, gate_verdict: PASS });
    expect(advanced.isError).toBe(false);
    expect(advanced.text).toContain('BODY-cr_b');
    expect(advanced.text).toContain('Progress 2/2');
  });

  test('a single prompt renders under the active framework, and `@react` overrides it', async () => {
    const single = await promptEngine({ command: '>>cr_a' });
    expect(single.isError).toBe(false);
    expect(single.text).toContain('You are operating under the C.A.G.E.E.R.F Framework for cr_a.');
    expect(single.text).toContain('BODY-cr_a');

    const overridden = await promptEngine({ command: '@react >>cr_a' });
    expect(overridden.isError).toBe(false);
    expect(overridden.text).toContain('You are operating under the ReACT Framework for cr_a.');
    expect(overridden.text).not.toContain('C.A.G.E.E.R.F');
  });

  test('a chain-declared gate definition is registered and remapped onto the run', async () => {
    const started = await promptEngine({ command: '>>cr_def_chain' });
    expect(started.isError).toBe(false);
    const chainId = chainIdOf(started, 'cr_def_chain');

    // The resume re-registers the definition against a live run, which composes the run's
    // current gate remap through the builder's remap provider.
    const answered = await promptEngine({ chain_id: chainId, user_response: 'DEF-ANSWER' });
    expect(answered.isError).toBe(false);
    expect(answered.text).toContain('GUIDANCE-CR-DEF');
    expect(answered.text).toContain('"satisfied": ["cr-def"]');

    const advanced = await promptEngine({ chain_id: chainId, gate_verdict: PASS });
    expect(advanced.isError).toBe(false);
    expect(advanced.text).toContain('BODY-cr_b');
    expect(advanced.text).toContain('GUIDANCE-CR-DEF');
  });

  test('a minted handoff token claims the run once and resumes its current step', async () => {
    const chainId = chainIdOf(await promptEngine({ command: '>>cr_chain' }), 'cr_chain');

    const minted = await promptEngine({ chain_id: chainId, handoff: true });
    expect(minted.isError).toBe(false);
    expect(minted.text).toContain(`Handoff Token Minted**: \`${chainId}\``);
    const token = /hnd_[A-Za-z0-9_-]+/.exec(minted.text)?.[0];
    expect(token).toBeDefined();

    const claimed = await promptEngine({ claim_token: token });
    expect(claimed.isError).toBe(false);
    expect(claimed.text).toContain(`Chain: ${chainId}`);
    expect(claimed.text).toContain('BODY-cr_a');

    const again = await promptEngine({ claim_token: token });
    expect(again.isError).toBe(true);
    expect(again.text).toContain('Claim Refused**: no run carries this token');
  });

  test('cancel stops the run, and a later resume is told it is over', async () => {
    const chainId = chainIdOf(await promptEngine({ command: '>>cr_chain' }), 'cr_chain');

    const cancelled = await promptEngine({ chain_id: chainId, cancel: true });
    expect(cancelled.isError).toBe(false);
    expect(cancelled.text).toContain(`Chain Cancelled**: \`${chainId}\``);

    const resumed = await promptEngine({ chain_id: chainId, user_response: 'too late' });
    expect(resumed.text).toContain('Status: cancelled');
    expect(resumed.text).not.toContain('BODY-cr_b');
  });

  test('>>guide answers from the prompt engine guide', async () => {
    const guide = await promptEngine({ command: '>>guide gates' });
    expect(guide.isError).toBe(false);
    expect(guide.text).toContain('Gates Syntax Guide');
  });

  test('>>listprompts is answered by the resource_manager router the composition root built', async () => {
    const listed = await promptEngine({ command: '>>listprompts cr_' });
    expect(listed.isError).toBe(false);
    expect(listed.text).toContain('**general**: cr_a, cr_b, cr_chain, cr_def_chain');
  });

  test('%judge lists the live frameworks and the workspace gate', async () => {
    const menu = await promptEngine({ command: '%judge >>cr_a' });
    expect(menu.isError).toBe(false);
    expect(menu.text).toContain('Resource Selection Required');
    expect(menu.text).toMatch(/#### Frameworks[\s\S]*\*\*cageerf\*\*/);
    expect(menu.text).toContain('**cr-block**: composition root blocking gate');
  });
});

describe('an anonymous inline criterion through the composition root', () => {
  test.each([
    ['empty double-quoted', '>>cr_a :: ""', '""'],
    ['blank double-quoted', '>>cr_a :: "   "', '"   "'],
    ['blank single-quoted', ">>cr_a :: '  '", '"  "'],
  ])('%s is refused as gate-criteria-invalid, naming the criterion', async (_, command, quoted) => {
    const reply = await promptEngine({ command });
    expect(reply.isError).toBe(true);
    expect(reply.text).toContain('[gate-criteria-invalid]');
    expect(reply.text).toContain(`inline gate has the criterion ${quoted}`);
    expect(reply.text).not.toContain('Unknown prompt');
    expect(reply.text).not.toContain('BODY-cr_a');
  });

  test('a blank criterion on an arrow-chain step is refused on that step', async () => {
    const reply = await promptEngine({ command: '>>cr_a :: "  " --> >>cr_b' });
    expect(reply.isError).toBe(true);
    expect(reply.text).toContain('[gate-criteria-invalid]');
    expect(reply.text).toContain('inline gate on step 1 has the criterion "  ", which is blank');
    expect(reply.text).not.toContain('BODY-cr_a');
  });

  test('a criterion with text renders under its gate (positive control)', async () => {
    const reply = await promptEngine({ command: '>>cr_a :: "output names the contract"' });
    expect(reply.isError).toBe(false);
    expect(reply.text).toContain('BODY-cr_a');
    expect(reply.text).toContain('output names the contract');
  });

  // The response lists each criterion as its own numbered item; R11.14: `,` `;` `|` separate
  // criteria inside one quote, and `and` does not.
  const criteriaItems = (text: string): string[] =>
    [...text.matchAll(/^\d+\. (.+)$/gm)].map((match) => match[1] ?? '');

  test('a criterion containing the letters "and" reaches the review whole', async () => {
    const reply = await promptEngine({ command: '>>cr_a :: "handle errors"' });
    expect(reply.isError).toBe(false);
    expect(criteriaItems(reply.text)).toEqual(['handle errors']);
  });

  test('a comma lists two criteria, each rendered as its own item', async () => {
    const reply = await promptEngine({ command: '>>cr_a :: "cite sources, note confidence"' });
    expect(reply.isError).toBe(false);
    expect(criteriaItems(reply.text)).toEqual(['cite sources', 'note confidence']);
  });

  test('the word "and" leaves one criterion, rendered as one item', async () => {
    const reply = await promptEngine({ command: '>>cr_a :: "errors and warnings are logged"' });
    expect(reply.isError).toBe(false);
    expect(criteriaItems(reply.text)).toEqual(['errors and warnings are logged']);
  });
});

/**
 * R11.8 through the router's `gates` normalization. MEASURED 2026-10-12 on `0881c79f` (built server,
 * STDIO and HTTP): a `{name, description}` quick gate with either field blank was turned into `null`
 * and filtered out in `mcp/tools/index.ts` before the pipeline, so stage 11 never saw it and the
 * prompt ran with no gate and no warning.
 */
describe('a request gate the server cannot register, sent through prompt_engine', () => {
  test.each([
    [
      'a quick gate with a blank description',
      [{ name: 'Tone', description: '   ' }],
      'request gate 1 (name "Tone")',
    ],
    [
      'a quick gate with a blank name',
      [{ name: '  ', description: 'Plain and direct' }],
      'request gate 1 (name "  ")',
    ],
    [
      'a blank quick gate beside a canonical one',
      [{ name: 'Tone', description: '   ' }, 'code-quality'],
      'request gate 1 (name "Tone")',
    ],
  ])('%s is refused by entry, and the prompt does not run', async (_, gates, address) => {
    const reply = await promptEngine({ command: '>>cr_a', gates });
    expect(reply.isError).toBe(true);
    expect(reply.text).toContain(`[gate-criteria-invalid] workflow: ${address}`);
    expect(reply.text).toContain('{name:"…", description:"…"}');
    expect(reply.text).not.toContain('BODY-cr_a');
  });

  test('control: a quick gate with text, and a canonical gate, render', async () => {
    const reply = await promptEngine({
      command: '>>cr_a',
      gates: [{ name: 'Tone', description: 'Plain and direct' }, 'code-quality'],
    });
    expect(reply.isError).toBe(false);
    expect(reply.text).toContain('BODY-cr_a');
    expect(reply.text).toContain('Plain and direct');
    expect(reply.text).toMatch(/code.quality/i);
  });
});

describe('a routed command before the composition root assigns the resource_manager router', () => {
  test('is refused as an ordering defect rather than answered from a second catalog', async () => {
    const early = new PromptExecutor(
      silentLogger(),
      promptManager,
      foundation.configManager,
      textReferenceStore,
      modules.gateManager,
      { getResourceManagerHandler: () => null }
    );
    try {
      const reply = await early.executePromptCommand({ command: '>>listprompts' }, {});
      expect(reply.isError).toBe(true);
      const text = reply.content.map((part) => ('text' in part ? part.text : '')).join('\n');
      expect(text).toContain('resource_manager router is not assigned yet');
      expect(text).toContain('startup ordering defect');
    } finally {
      // Not `early.cleanup()`: that shuts down the config and prompt managers this file shares.
      await early.getChainSessionStore().cleanup();
    }
  });
});
