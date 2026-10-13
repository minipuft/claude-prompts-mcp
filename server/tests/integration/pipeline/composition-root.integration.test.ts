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

import type { TemporaryGateRegistry } from '../../../src/engine/gates/core/temporary-gate-registry.js';
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

const PASS = { overall: 'PASS', rationale: 'ok' };
const FRAMEWORK_HEADER = 'C.A.G.E.E.R.F Framework Active';
const FWS2_FRAMEWORK_ID = 'fws2fw';

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
  // Ungated chains for per-step framework guidance. The system prompt injects on every step so a
  // later step's framework block is observable, not thinned away by the default frequency.
  const everyStepFramework = [
    'injection:',
    '  system-prompt:',
    '    frequency:',
    '      mode: every',
  ];
  // A chain step's injection block is its own prompt's, so the frequency sits on the step prompts.
  for (const id of ['fws_a', 'fws_b']) {
    prompt(id, [
      `description: ${id}`,
      `userMessageTemplate: BODY-${id}`,
      ...optOut,
      ...everyStepFramework,
    ]);
  }
  const fwSteps = (firstStepFramework: string | null): string[] => [
    'chainSteps:',
    '  - promptId: fws_a',
    '    stepName: A',
    ...(firstStepFramework === null ? [] : [`    framework: ${firstStepFramework}`]),
    '  - promptId: fws_b',
    '    stepName: B',
  ];
  prompt('fws_declared', [
    'description: ungated chain whose first step declares react',
    'userMessageTemplate: FWS-DECLARED-OWN',
    ...optOut,
    ...fwSteps('react'),
  ]);
  prompt('fws_plain', [
    'description: ungated chain with no step-level framework',
    'userMessageTemplate: FWS-PLAIN-OWN',
    ...optOut,
    ...fwSteps(null),
  ]);
  // A workspace framework whose guidance names template placeholders, so a builder that inserts
  // the guidance after substituting renders them literally. `type` lowercases to `id` because the
  // guidance service resolves a framework by its type.
  const fws2FrameworkDir = path.join(workspace, 'resources', 'frameworks', FWS2_FRAMEWORK_ID);
  mkdirSync(fws2FrameworkDir, { recursive: true });
  writeFileSync(
    path.join(fws2FrameworkDir, 'framework.yaml'),
    [
      `id: ${FWS2_FRAMEWORK_ID}`,
      'name: FWS2 Probe',
      'type: FWS2FW',
      'version: 1.0.0',
      'enabled: true',
      'description: single-prompt guidance probe',
      'systemPromptGuidance: FWS2-GUIDANCE for {PROMPT_NAME} in {PROMPT_CATEGORY}',
      '',
    ].join('\n')
  );
  prompt('fws2_single', ['description: fws2 single', 'userMessageTemplate: BODY-fws2', ...optOut]);
  // A system message that already carries a framework's guidance: the framework block is not
  // injected a second time.
  prompt('fws2_carries_react', [
    'description: fws2 single whose system message already applies react',
    'systemMessage: Apply the ReACT framework systematically, as the author wrote it.',
    'userMessageTemplate: BODY-fws2-carries',
    ...optOut,
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

/**
 * R11.8: a gate the call requested is enforced as written or refused with a reason. MEASURED
 * 2026-10-12 on `0a0c2e3d` through this composition root: `%clean` and `%framework` with a `::`
 * criterion, a named `::` gate or a `gates` entry, and `gates.enabled: false` or the runtime switch
 * off with a `::` criterion or a `gates` entry, each ran the prompt with no gate and `isError: false`
 * — stage 11 skipped, and nothing told the client.
 */
describe('a gate the call requested while a switch withholds every gate', () => {
  const refusedFor = (reply: Reply, cause: string, address: string): void => {
    expect(reply.isError).toBe(true);
    expect(reply.text).toContain('[gate-suppressed] workflow:');
    expect(reply.text).toContain(cause);
    expect(reply.text).toContain(address);
    expect(reply.text).toContain('no run was created');
    expect(reply.text).not.toContain('BODY-cr_a');
  };
  const QUICK_GATE = [{ name: 'Tone', description: 'PLAIN-DIRECT' }];

  test.each([
    ['%clean with a `::` criterion', { command: '%clean >>cr_a :: "MUST-CITE"' }, ':: "MUST-CITE"'],
    ['%clean with a named `::` gate', { command: '%clean >>cr_a :: tone:"be plain"' }, ':: tone:'],
    [
      '%clean with a quick request gate',
      { command: '%clean >>cr_a', gates: QUICK_GATE },
      'request gate 1 (name "Tone")',
    ],
    [
      '%clean with a criterion on an arrow-chain step',
      { command: '%clean >>cr_a --> >>cr_b :: "STEP-B"' },
      ':: "STEP-B"',
    ],
  ])('%s is refused, naming the clean modifier and the gate', async (_, args, address) => {
    refusedFor(await promptEngine(args), '%clean runs without gates', address);
  });

  test.each([
    ['a `::` criterion', { command: '%framework >>cr_a :: "MUST-CITE"' }, ':: "MUST-CITE"'],
    [
      'a canonical request gate',
      { command: '%framework >>cr_a', gates: ['code-quality'] },
      'request gate 1 ("code-quality")',
    ],
  ])(
    'the framework modifier with %s is refused, naming it and the gate',
    async (_, args, address) => {
      refusedFor(await promptEngine(args), '%framework runs the framework without gates', address);
    }
  );

  test('control: %lean keeps the requested gate', async () => {
    const reply = await promptEngine({ command: '%lean >>cr_a :: "MUST-CITE"' });
    expect(reply.isError).toBe(false);
    expect(reply.text).toContain('BODY-cr_a');
    expect(reply.text).toContain('MUST-CITE');
  });

  test('control: %clean with no requested gate runs, and withholds the chain author gates', async () => {
    const single = await promptEngine({ command: '%clean >>cr_a' });
    expect(single.isError).toBe(false);
    expect(single.text).toContain('BODY-cr_a');

    const chain = await promptEngine({ command: '%clean >>cr_chain' });
    expect(chain.isError).toBe(false);
    expect(chain.text).toContain('BODY-cr_a');
    expect(chain.text).not.toContain('GUIDANCE-cr-block');
  });

  test('control: a `verify:` gate under %clean is not refused (stage 17 runs it)', async () => {
    const reply = await promptEngine({ command: '%clean >>cr_a :: verify:"true"' });
    expect(reply.isError).toBe(false);
    expect(reply.text).toContain('Verification: `true`');
  });

  describe('with `gates.enabled: false` in config', () => {
    let previous: boolean;
    beforeEach(() => {
      const gates = foundation.configManager.getConfig().gates;
      previous = gates.enabled;
      gates.enabled = false;
    });
    afterEach(() => {
      foundation.configManager.getConfig().gates.enabled = previous;
    });
    const CAUSE = 'gates are disabled by configuration (`gates.enabled: false`)';

    test('a `::` criterion is refused', async () => {
      refusedFor(await promptEngine({ command: '>>cr_a :: "MUST-CITE"' }), CAUSE, ':: "MUST-CITE"');
    });

    test('a request gate is refused', async () => {
      refusedFor(
        await promptEngine({ command: '>>cr_a', gates: QUICK_GATE }),
        CAUSE,
        'request gate 1 (name "Tone")'
      );
    });

    test('a gate on a submitted workflow node is refused', async () => {
      const reply = await promptEngine({
        workflow: {
          version: 1,
          nodes: [{ id: 'one', promptId: 'cr_a', inlineGateIds: ['cr-block'] }],
        },
      });
      refusedFor(reply, CAUSE, 'node "one" gate "cr-block"');
    });

    test('control: a call with no requested gate runs', async () => {
      const reply = await promptEngine({ command: '>>cr_a' });
      expect(reply.isError).toBe(false);
      expect(reply.text).toContain('BODY-cr_a');
    });
  });

  describe('with the runtime gate switch off', () => {
    const systemControl = (args: Record<string, unknown>): Promise<unknown> => {
      const callback = tools.get('system_control');
      if (callback === undefined) throw new Error('system_control was never registered');
      return callback(args, {});
    };
    beforeEach(async () => {
      await systemControl({ action: 'gates', operation: 'disable' });
    });
    afterEach(async () => {
      await systemControl({ action: 'gates', operation: 'enable' });
    });

    test('a `::` criterion is refused', async () => {
      refusedFor(
        await promptEngine({ command: '>>cr_a :: "MUST-CITE"' }),
        'the gate system is disabled for this workspace',
        ':: "MUST-CITE"'
      );
    });

    test('control: a call with no requested gate runs', async () => {
      const reply = await promptEngine({ command: '>>cr_a' });
      expect(reply.isError).toBe(false);
      expect(reply.text).toContain('BODY-cr_a');
    });
  });
});

/**
 * R11.13 made a full temporary gate registry a refusal, and a run-owned gate has no expiry: it
 * lives as long as its run. So an abandoned run must give its gates back when the stale-session
 * sweep prunes it (`chainSessions.timeoutMinutes`), or abandoned runs could hold the 100-gate
 * registry full and refuse every gated call after them. Driven through the composed wiring:
 * `ChainSessionStore.cleanupStaleSessions` → `onRunEnded` → `TemporaryGateRegistry.releaseRun`.
 */
describe('a run the stale-session sweep prunes gives its temporary gates back', () => {
  test('a registry held full by an abandoned run frees when the run is pruned; a live run keeps its gate', async () => {
    const executor = (modules.mcpToolsManager as unknown as { promptExecutor: unknown })
      .promptExecutor as {
      lightweightGateSystem: { getTemporaryGateRegistry(): TemporaryGateRegistry | undefined };
    };
    const registry = executor.lightweightGateSystem.getTemporaryGateRegistry();
    const store = modules.mcpToolsManager.getChainSessionStore();
    if (registry === undefined || store === undefined) throw new Error('no registry or store');
    const sessionOf = (chainId: string) => {
      const session = store.getSessionByChainIdentifier(chainId);
      if (session === undefined) throw new Error(`no session for ${chainId}`);
      return session;
    };
    const gate = (description: string) => [{ name: 'Sweep', description }];

    const live = sessionOf(
      chainIdOf(await promptEngine({ command: '>>cr_chain', gates: gate('LIVE-GATE') }), 'cr_chain')
    );
    const abandoned = sessionOf(
      chainIdOf(await promptEngine({ command: '>>cr_chain', gates: gate('OLD-GATE') }), 'cr_chain')
    );
    const liveGateIds = registry.getRunGates(live.sessionId).map((held) => held.id);
    expect(liveGateIds).toHaveLength(1);

    // Fill the registry with gates the abandoned run owns, until a new gated call is refused.
    const filler: string[] = [];
    for (let index = 0; index < 100; index += 1) {
      try {
        filler.push(
          registry.createTemporaryGate(
            {
              name: `fill-${index}`,
              type: 'validation',
              scope: 'execution',
              description: 'filler',
              guidance: 'filler',
              source: 'manual',
            },
            'fill'
          )
        );
      } catch {
        break;
      }
    }
    registry.adoptIntoRun(abandoned.sessionId, filler);
    const full = await promptEngine({ command: '>>cr_a', gates: gate('NEW-GATE') });
    expect(full.isError).toBe(true);
    expect(full.text).toContain('Temporary gate registry is full');

    // Past the sweep's threshold: the run is abandoned, and the sweep prunes it.
    abandoned.lastActivity = Date.now() - 48 * 60 * 60 * 1000;
    expect(await store.cleanupStaleSessions()).toBeGreaterThanOrEqual(1);

    expect(registry.getRunGates(abandoned.sessionId)).toEqual([]);
    expect(filler.filter((id) => registry.getTemporaryGate(id) !== undefined)).toEqual([]);
    expect(registry.getRunGates(live.sessionId).map((held) => held.id)).toEqual(liveGateIds);

    const freed = await promptEngine({ command: '>>cr_a', gates: gate('NEW-GATE') });
    expect(freed.isError).toBe(false);
    expect(freed.text).toContain('NEW-GATE');
  });
});

/**
 * Stage 12 resolves a framework per chain step (operator `@framework` > the step's own
 * `framework:` > the active framework), and the step's required sections and phase guard follow
 * it. The framework guidance block a step renders must name that same framework: before
 * 2026-10-12 stage 15 injected the run-wide framework into every step, so an ungated step that
 * declared `react` rendered "operating under the C.A.G.E.E.R.F Framework".
 */
describe('a chain step renders the framework guidance of the framework it runs under', () => {
  const OPERATING_UNDER = /You are operating under the (\S+) Framework for (\S+)\./g;
  const APPLY_HEADING = /Apply the \S+ framework systematically:/g;

  /** Every framework block in one reply, as `framework@prompt`. */
  const frameworkBlocks = (text: string): string[] =>
    [...text.matchAll(OPERATING_UNDER)].map((match) => `${match[1]}@${match[2]}`);

  const expectOneBlock = (reply: Reply, expected: string): void => {
    expect(reply.isError).toBe(false);
    expect(frameworkBlocks(reply.text)).toEqual([expected]);
    expect(reply.text.match(APPLY_HEADING) ?? []).toHaveLength(1);
  };

  async function runBothSteps(command: string, promptId: string): Promise<[Reply, Reply]> {
    const first = await promptEngine({ command });
    const second = await promptEngine({
      chain_id: chainIdOf(first, promptId),
      user_response: 'ANSWER-A',
    });
    return [first, second];
  }

  test('an ungated step that declares react renders ReACT; the undeclared step renders the active framework', async () => {
    const [first, second] = await runBothSteps('>>fws_declared', 'fws_declared');
    expectOneBlock(first, 'ReACT@fws_a');
    expect(first.text).toContain('BODY-fws_a');
    expect(first.text).not.toContain('C.A.G.E.E.R.F');
    expectOneBlock(second, 'C.A.G.E.E.R.F@fws_b');
    expect(second.text).toContain('BODY-fws_b');
  });

  test('control: a chain with no step-level framework renders the active framework on every step', async () => {
    const [first, second] = await runBothSteps('>>fws_plain', 'fws_plain');
    expectOneBlock(first, 'C.A.G.E.E.R.F@fws_a');
    expectOneBlock(second, 'C.A.G.E.E.R.F@fws_b');
  });

  test('control: an `@react` override renders ReACT on every step, the declared one included', async () => {
    const [first, second] = await runBothSteps('@react >>fws_plain', 'fws_plain');
    expectOneBlock(first, 'ReACT@fws_a');
    expectOneBlock(second, 'ReACT@fws_b');

    const declared = await promptEngine({ command: '@react >>fws_declared' });
    expectOneBlock(declared, 'ReACT@fws_a');
  });
});

/**
 * A single prompt's framework system prompt has one builder, `PromptGuidanceService` (stage 15).
 * Before 2026-10-12 stage 12 also built it through `FrameworkManager`, stage 18 rendered that copy,
 * and a flag told stage 15 to stand down. The two builders disagreed: the manager substituted the
 * template's placeholders BEFORE inserting the framework's guidance, so a placeholder the guidance
 * itself names rendered literally, and a template without `{FRAMEWORK_GUIDANCE}` lost the guidance
 * outright where the service appends it under a heading.
 */
describe('a single prompt renders its framework guidance through one builder', () => {
  const FWS2_GUIDANCE = 'FWS2-GUIDANCE for fws2_single in general';
  const FWS2_HEADING = '## FWS2FW Framework';

  const count = (text: string, needle: string): number => text.split(needle).length - 1;

  test('guidance that names template placeholders renders them substituted, once', async () => {
    const reply = await promptEngine({ command: `@${FWS2_FRAMEWORK_ID} >>fws2_single` });
    expect(reply.isError).toBe(false);
    expect(count(reply.text, FWS2_GUIDANCE)).toBe(1);
    expect(reply.text).not.toContain('{PROMPT_NAME}');
    expect(reply.text).toContain(
      'You are operating under the FWS2 Probe framework for fws2_single.'
    );
    expect(reply.text).toContain('BODY-fws2');
  });

  test('a framework template without `{FRAMEWORK_GUIDANCE}` renders the same guidance once, under its heading', async () => {
    // No loaded framework reaches this shape — every definition's template is generated with the
    // placeholder — so the definition the server holds is edited in place and restored.
    const definition = modules.mcpToolsManager
      .getFrameworkManager()
      ?.getFramework(FWS2_FRAMEWORK_ID);
    if (definition === undefined) throw new Error(`${FWS2_FRAMEWORK_ID} was never loaded`);
    const withPlaceholder = await promptEngine({ command: `@${FWS2_FRAMEWORK_ID} >>fws2_single` });
    const original = definition.systemPromptTemplate;
    definition.systemPromptTemplate = 'FWS2-TEMPLATE-WITHOUT-PLACEHOLDER for {PROMPT_NAME}.';
    try {
      const reply = await promptEngine({ command: `@${FWS2_FRAMEWORK_ID} >>fws2_single` });
      expect(reply.isError).toBe(false);
      expect(count(reply.text, 'FWS2-TEMPLATE-WITHOUT-PLACEHOLDER for fws2_single.')).toBe(1);
      expect(count(reply.text, FWS2_HEADING)).toBe(1);
      expect(count(reply.text, FWS2_GUIDANCE)).toBe(1);
      // The same guidance text the placeholder template renders.
      expect(count(withPlaceholder.text, FWS2_GUIDANCE)).toBe(1);
      expect(count(withPlaceholder.text, FWS2_HEADING)).toBe(0);
    } finally {
      definition.systemPromptTemplate = original;
    }
  });

  test('`@react` renders ReACT once; `%clean` renders none', async () => {
    const react = await promptEngine({ command: '@react >>fws2_single' });
    expect(react.isError).toBe(false);
    expect(count(react.text, 'You are operating under the ReACT Framework for fws2_single.')).toBe(
      1
    );
    expect(count(react.text, 'Apply the ReACT framework systematically:')).toBe(1);
    expect(react.text).not.toContain(FWS2_GUIDANCE);

    const clean = await promptEngine({ command: '%clean >>fws2_single' });
    expect(clean.isError).toBe(false);
    expect(clean.text).toContain('BODY-fws2');
    expect(clean.text).not.toContain('You are operating under');
    expect(clean.text).not.toMatch(/Apply the \S+ framework systematically/);
  });

  test('a system message that already applies a framework is not given the block again', async () => {
    const reply = await promptEngine({ command: '@react >>fws2_carries_react' });
    expect(reply.isError).toBe(false);
    expect(reply.text).toContain('BODY-fws2-carries');
    expect(count(reply.text, 'Apply the ReACT framework systematically')).toBe(1);
    expect(reply.text).not.toContain('You are operating under');
  });

  test('with the framework system disabled, a single prompt renders no framework guidance', async () => {
    await modules.frameworkStateStore.disableFrameworkSystem('fws2 probe');
    try {
      const reply = await promptEngine({ command: '>>fws2_single' });
      expect(reply.isError).toBe(false);
      expect(reply.text).toContain('BODY-fws2');
      expect(reply.text).not.toContain('You are operating under');
      expect(reply.text).not.toMatch(/Apply the \S+ framework systematically/);
    } finally {
      await modules.frameworkStateStore.enableFrameworkSystem('fws2 probe');
    }
  });
});

/**
 * A run's temporary gates can leave the registry while the run lives: the registry releases an idle
 * run's gates to admit a new one when it is full. The run's next call must find them again — stage
 * 05 re-registers a restored run's missing gates under the ids its blueprint recorded — so a
 * released gate still renders, still opens a review, and a FAIL on it still holds the step.
 */
describe('a run whose temporary gates were released gets them back when it resumes', () => {
  const FAIL = 'GATE_REVIEW: FAIL - the answer misses the criterion';
  const registryAndStore = () => {
    const executor = (modules.mcpToolsManager as unknown as { promptExecutor: unknown })
      .promptExecutor as {
      lightweightGateSystem: { getTemporaryGateRegistry(): TemporaryGateRegistry | undefined };
    };
    const registry = executor.lightweightGateSystem.getTemporaryGateRegistry();
    const store = modules.mcpToolsManager.getChainSessionStore();
    if (registry === undefined || store === undefined) throw new Error('no registry or store');
    return { registry, store };
  };

  const drive = async (release: boolean) => {
    const { registry, store } = registryAndStore();
    const started = await promptEngine({
      command: '>>cr_a :: "RESTORE-CRIT" --> >>cr_b',
      gates: [{ name: 'Restore', description: 'RESTORE-REQUEST-GATE' }],
    });
    expect(started.isError).toBe(false);
    expect(started.text).toContain('RESTORE-CRIT');
    expect(started.text).toContain('RESTORE-REQUEST-GATE');
    const chainId = /chain-[A-Za-z0-9_]+#\d+/.exec(started.text)?.[0];
    if (chainId === undefined) throw new Error(`no chain id in:\n${started.text}`);
    const sessionId = store.getSessionByChainIdentifier(chainId)?.sessionId;
    if (sessionId === undefined) throw new Error(`no session for ${chainId}`);
    const heldAtStart = registry.getRunGates(sessionId).map((gate) => gate.id);
    expect(heldAtStart.length).toBeGreaterThanOrEqual(2);

    if (release) expect(registry.releaseRun(sessionId)).toBe(heldAtStart.length);
    const answered = await promptEngine({ chain_id: chainId, user_response: 'ANSWER-A' });
    if (release) expect(registry.releaseRun(sessionId)).toBeGreaterThanOrEqual(2);
    const failed = await promptEngine({ chain_id: chainId, gate_verdict: FAIL });
    const held = registry.getRunGates(sessionId).map((gate) => gate.id);
    if (release) registry.releaseRun(sessionId);
    const satisfied = JSON.parse(
      /"satisfied": (\[[^\]]*\])/.exec(failed.text)?.[1] ?? '[]'
    ) as string[];
    const passed = await promptEngine({
      chain_id: chainId,
      gate_verdict: {
        overall: 'PASS',
        rationale: 'ok',
        reminders: { satisfied, not_applicable: [] },
      },
    });
    return { answered, failed, passed, held };
  };

  for (const release of [true, false]) {
    test(`${release ? '' : 'control: '}a run ${release ? 'released before each call' : 'never released'} renders its gates, and a FAIL holds the step`, async () => {
      const { answered, failed, passed, held } = await drive(release);
      expect(answered.isError).toBe(false);
      expect(answered.text).toContain('Gate Review Required');
      expect(answered.text).toContain('RESTORE-CRIT');
      expect(answered.text).toContain('RESTORE-REQUEST-GATE');
      expect(failed.text).not.toContain('BODY-cr_b');
      expect(failed.text).toContain('RESTORE-CRIT');
      expect(held.length).toBeGreaterThanOrEqual(2);
      expect(passed.isError).toBe(false);
      expect(passed.text).toContain('BODY-cr_b');
    });
  }

  test('a full registry releases a run idle past the threshold, and the run resumes with its gates', async () => {
    const { registry, store } = registryAndStore();
    const started = await promptEngine({
      command: '>>cr_a :: "IDLE-CRIT" --> >>cr_b',
      gates: [{ name: 'Idle', description: 'IDLE-REQUEST-GATE' }],
    });
    const chainId = /chain-[A-Za-z0-9_]+#\d+/.exec(started.text)?.[0];
    if (chainId === undefined) throw new Error(`no chain id in:\n${started.text}`);
    const sessionId = store.getSessionByChainIdentifier(chainId)?.sessionId;
    if (sessionId === undefined) throw new Error(`no session for ${chainId}`);
    const heldAtStart = registry.getRunGates(sessionId).map((gate) => gate.id);
    expect(heldAtStart.length).toBeGreaterThanOrEqual(2);

    // Two hours on, every run this suite started is idle past the server's one-hour threshold.
    const realNow = Date.now.bind(Date);
    const clock = jest.spyOn(Date, 'now').mockImplementation(() => realNow() + 2 * 60 * 60 * 1000);
    const filler: string[] = [];
    try {
      for (let index = 0; index < 200; index += 1) {
        try {
          filler.push(
            registry.createTemporaryGate(
              {
                name: `idle-fill-${index}`,
                type: 'validation',
                scope: 'execution',
                description: 'filler',
                guidance: 'filler',
                source: 'manual',
              },
              'idle-fill'
            )
          );
        } catch {
          break;
        }
      }
      // Filling past capacity released the idle runs, this one among them.
      expect(registry.getRunGates(sessionId)).toEqual([]);
      expect(heldAtStart.filter((id) => registry.getTemporaryGate(id) !== undefined)).toEqual([]);
      registry.releaseUnowned(filler);

      const answered = await promptEngine({ chain_id: chainId, user_response: 'ANSWER-A' });
      expect(answered.isError).toBe(false);
      expect(answered.text).toContain('Gate Review Required');
      expect(answered.text).toContain('IDLE-CRIT');
      expect(answered.text).toContain('IDLE-REQUEST-GATE');
      const failed = await promptEngine({ chain_id: chainId, gate_verdict: FAIL });
      expect(failed.text).toContain('IDLE-CRIT');
      expect(failed.text).not.toContain('BODY-cr_b');
      expect(registry.getRunGates(sessionId).length).toBeGreaterThanOrEqual(2);
    } finally {
      registry.releaseUnowned(filler);
      clock.mockRestore();
    }
  });
});
