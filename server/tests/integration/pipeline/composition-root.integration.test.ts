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

import type { McpRequestExtra } from '../../../src/shared/utils/request-identity-resolver.js';
import type { IdentityConfig } from '../../../src/shared/types/core-config.js';
import type { McpNotificationEmitterPort } from '../../../src/shared/types/index.js';
import { hasStructuralFinding } from '../../../src/engine/execution/pipeline/decisions/gates/structural-review-composition.js';
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

const PASS = 'GATE_REVIEW: PASS - ok';
const FRAMEWORK_HEADER = 'C.A.G.E.E.R.F Framework Active';
const FWS2_FRAMEWORK_ID = 'fws2fw';

type ToolCallback = (args: Record<string, unknown>, extra: unknown) => Promise<unknown>;
interface Reply {
  isError: boolean;
  text: string;
  structured: Record<string, unknown> | undefined;
}

const silentLogger = (): Logger =>
  ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }) as unknown as Logger;

let root: string;
let foundation: RuntimeFoundation;
let modules: ModuleInitResult;
let promptManager: PromptAssetManager;
let textReferenceStore: TextReferenceStore;
const tools = new Map<string, ToolCallback>();

let stepCompleteObserver: McpNotificationEmitterPort['emitChainStepComplete'] | undefined;
const capturedTransportNotifications: McpNotificationEmitterPort = {
  canSend: () => stepCompleteObserver !== undefined,
  setServer: () => {},
  emitGateFailed: () => {},
  emitResponseBlocked: () => {},
  emitRetryExhausted: () => {},
  emitFrameworkChanged: () => {},
  emitChainStepComplete: (notification) => {
    stepCompleteObserver?.(notification);
  },
  emitChainComplete: () => {},
};

async function promptEngine(
  args: Record<string, unknown>,
  sdkExtra: McpRequestExtra = {}
): Promise<Reply> {
  const callback = tools.get('prompt_engine');
  if (callback === undefined) throw new Error('prompt_engine was never registered');
  const result = (await callback(args, sdkExtra)) as {
    isError?: boolean;
    content?: Array<{ text?: string }>;
    structuredContent?: Record<string, unknown>;
  };
  return {
    isError: result.isError === true,
    text: (result.content ?? []).map((part) => part.text ?? '').join('\n'),
    structured: result.structuredContent,
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
  prompt('cr_guard', [
    'description: declares actual framework response headers',
    'userMessageTemplate: BODY-cr_guard',
    'gateConfiguration:',
    '  exclude:',
    '    - content-structure',
    '    - creed-fidelity',
    '    - framework-compliance',
    '  framework_gates: true',
  ]);
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
  // Pipeline construction captures this transport port on the first callback in any test group.
  modules.mcpToolsManager.setNotificationEmitter(capturedTransportNotifications);
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

describe('composition-root request-continuity handoff', () => {
  let identity: IdentityConfig;
  let transport: ReturnType<ConfigLoader['getTransportMode']>;

  beforeEach(() => {
    const config = foundation.configManager.getConfig();
    identity = config.identity;
    transport = foundation.configManager.getTransportMode();
    config.identity = {
      mode: 'permissive',
      allowPerRequestOverride: true,
      launchDefaults: { workspaceId: 'composition-root' },
    };
    (foundation.configManager as ConfigLoader).setTransportMode('streamable-http');
  });
  afterEach(() => {
    foundation.configManager.getConfig().identity = identity;
    (foundation.configManager as ConfigLoader).setTransportMode(transport);
  });

  const sdk = (workspaceId: string, organizationId?: string): McpRequestExtra => ({
    http: {
      req: {
        headers: {
          'x-workspace-id': workspaceId,
          ...(organizationId === undefined ? {} : { 'x-organization-id': organizationId }),
        },
      },
    },
  });
  const store = () => {
    const value = modules.mcpToolsManager.getChainSessionStore();
    if (value === undefined) throw new Error('composition root did not wire a chain store');
    return value;
  };
  const database = () =>
    SqliteEngine.getInstance(silentLogger(), {
      dbPath: foundation.pathResolver.getStateDatabasePath(),
    });

  const runFacts = async (sessionId: string) => {
    const db = await database();
    const row = db.queryOne<{
      chain_id: string;
      run_owner_pid: string;
      workspace_id: string;
      handoff_token: string | null;
      run_status: string;
      current_node_id: string;
      state: string;
    }>(
      `SELECT chain_id, run_owner_pid, workspace_id, handoff_token, run_status,
              current_node_id, state FROM chain_runs WHERE session_id = ?`,
      [sessionId]
    );
    if (row === null) throw new Error(`no persisted run ${sessionId}`);
    const residual = JSON.parse(row.state) as {
      continuityScopeId: string;
      lifecycle: string;
      reviews?: Record<
        string,
        {
          attemptCount: number;
          status: string;
          nodeId: string;
        }
      >;
    };
    const session = store().getSession(sessionId);
    if (session === undefined) throw new Error(`no loaded run ${sessionId}`);
    return {
      chainId: row.chain_id,
      owner: row.run_owner_pid,
      storageWorkspace: row.workspace_id,
      token: row.handoff_token,
      status: row.run_status,
      currentNode: row.current_node_id,
      continuity: residual.continuityScopeId,
      lifecycle: residual.lifecycle,
      reviews: Object.entries(residual.reviews ?? {}).map(([id, review]) => ({
        id,
        attemptCount: review.attemptCount,
        status: review.status,
        nodeId: review.nodeId,
      })),
      nodes: db.query(
        `SELECT node_id, prompt_id, position, milestone, responded_at, completed_at
                        FROM chain_run_nodes WHERE session_id = ? ORDER BY position`,
        [sessionId]
      ),
      captures: textReferenceStore.buildChainVariables(sessionId, row.chain_id),
    };
  };

  const mint = async (extra: McpRequestExtra, qualified = false) => {
    const firstPrompt = qualified ? 'implementation_plan/plan_table' : 'cr_a';
    const started = await promptEngine(
      {
        workflow: {
          version: 1,
          nodes: [
            {
              id: 'one',
              promptId: firstPrompt,
              args: { feature: 'scope proof' },
              inlineGateIds: ['cr-block'],
            },
            { id: 'two', promptId: 'cr_b', inlineGateIds: ['cr-block'] },
          ],
        },
      },
      extra
    );
    expect(started.isError).toBe(false);
    const chainId = /chain-[A-Za-z0-9_/-]+#\d+/.exec(started.text)?.[0];
    if (chainId === undefined) throw new Error(`no returned run token in:\n${started.text}`);
    const answered = await promptEngine(
      { chain_id: chainId, user_response: 'SCOPE-CAPTURE' },
      extra
    );
    expect(answered.isError).toBe(false);
    expect(answered.text).toContain('Gate Review Required');
    const minted = await promptEngine({ chain_id: chainId, handoff: true }, extra);
    expect(minted.isError).toBe(false);
    const token = /hnd_[A-Za-z0-9_-]+/.exec(minted.text)?.[0];
    if (token === undefined) throw new Error(`no handoff token in:\n${minted.text}`);
    const session = store().getSessionByChainIdentifier(chainId, { includeDormant: true });
    if (session === undefined) throw new Error(`no session for ${chainId}`);
    const before = await runFacts(session.sessionId);
    expect(before.token).toBe(token);
    expect(before.owner).toBe(String(process.pid));
    expect(before.storageWorkspace).toBe('composition-root');
    expect(JSON.stringify(before.captures)).toContain('SCOPE-CAPTURE');
    expect(before.reviews.length).toBeGreaterThan(0);
    return { chainId, token, sessionId: session.sessionId, before };
  };
  const claim = async (run: Awaited<ReturnType<typeof mint>>, extra: McpRequestExtra) => {
    const reply = await promptEngine({ claim_token: run.token }, extra);
    expect(reply.isError).toBe(false);
    expect(reply.text).toContain(`Chain: ${run.chainId}`);
    const after = await runFacts(run.sessionId);
    expect(after.token).toBeNull();
    expect(after.owner).toBe(run.before.owner);
    expect(after.storageWorkspace).toBe(run.before.storageWorkspace);
    expect(after.continuity).toBe(run.before.continuity);
    expect(after.currentNode).toBe(run.before.currentNode);
    expect(JSON.stringify(after.captures)).toContain('SCOPE-CAPTURE');
  };

  test.each([
    ['launch defaults with no SDK headers', {}, 'composition-root'],
    ['explicit nondefault HTTP identity', sdk('scope-explicit'), 'scope-explicit'],
  ] as const)(
    'claims under %s with the same stage03 continuity',
    async (_name, extra, expected) => {
      const run = await mint(extra);
      expect(run.before.continuity).toBe(expected);
      await claim(run, extra);
    }
  );

  test.each([
    ['nondefault run without headers', sdk('scope-noheader'), {}, false],
    ['root run with foreign headers', {}, sdk('scope-foreign'), false],
    ['qualified run with foreign headers', {}, sdk('scope-qualified-foreign'), true],
  ] as const)(
    'refuses %s before burning its token, then accepts the original scope',
    async (_name, original, foreign, qualified) => {
      const run = await mint(original, qualified);
      if (qualified) expect(run.chainId).toMatch(/^chain-implementation_plan\/plan_table#\d+$/);
      const refused = await promptEngine({ claim_token: run.token }, foreign);
      expect(refused.isError).toBe(true);
      expect(refused.text).toContain('Claim Refused**: request continuity');
      expect(await runFacts(run.sessionId)).toEqual(run.before);
      await claim(run, original);
    }
  );

  test.each(['locked', 'override-disabled', 'stdio'] as const)(
    '%s policy keeps both stage03 and claim on launch continuity despite foreign headers',
    async (policy) => {
      const config = foundation.configManager.getConfig().identity;
      if (policy === 'locked') config.mode = 'locked';
      if (policy === 'override-disabled') config.allowPerRequestOverride = false;
      if (policy === 'stdio') (foundation.configManager as ConfigLoader).setTransportMode('stdio');
      const run = await mint({});
      expect(run.before.continuity).toBe('composition-root');
      await claim(run, sdk(`scope-${policy}`));
    }
  );

  test('default workspace with a known organization uses normalized organization continuity', async () => {
    const extra = sdk('default', 'scope-org');
    const run = await mint(extra);
    expect(run.before.continuity).toBe('scope-org');
    const refused = await promptEngine(
      { claim_token: run.token },
      sdk('default', 'scope-other-org')
    );
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain('Claim Refused**: request continuity');
    expect(await runFacts(run.sessionId)).toEqual(run.before);
    await claim(run, extra);
  });

  test('effective default identity retains the unfiltered claim policy', async () => {
    foundation.configManager.getConfig().identity.launchDefaults = {};
    const run = await mint(sdk('scope-unfiltered'));
    expect(run.before.continuity).toBe('scope-unfiltered');
    const claimed = await promptEngine({ claim_token: run.token }, {});
    const after = await runFacts(run.sessionId);
    expect(claimed.text).not.toContain('Claim Refused');
    expect(after.token).toBeNull();
    expect(after.owner).toBe(run.before.owner);
    expect(after.storageWorkspace).toBe(run.before.storageWorkspace);
    expect(after.continuity).toBe(run.before.continuity);
  });
});

describe('composition-root blocking-unknown capture and resume', () => {
  const store = () => {
    const value = modules.mcpToolsManager.getChainSessionStore();
    if (value === undefined) throw new Error('composition root did not wire a chain store');
    return value;
  };
  const gateSwitch = async (enabled: boolean) => {
    const callback = tools.get('system_control');
    if (callback === undefined) throw new Error('system_control was never registered');
    const reply = (await callback(
      { action: 'gates', operation: enabled ? 'enable' : 'disable' },
      {}
    )) as { isError?: boolean };
    expect(reply.isError).not.toBe(true);
  };
  let priorPhaseMode: ReturnType<ConfigLoader['getConfig']>['phaseGuards']['mode'];
  let priorNoticeObserver: typeof stepCompleteObserver;
  beforeEach(() => {
    priorPhaseMode = foundation.configManager.getConfig().phaseGuards.mode;
    priorNoticeObserver = stepCompleteObserver;
  });
  afterEach(async () => {
    await gateSwitch(true);
    foundation.configManager.getConfig().phaseGuards.mode = priorPhaseMode;
    stepCompleteObserver = priorNoticeObserver;
    jest.restoreAllMocks();
  });
  const discovery = [
    {
      type: 'unknown_discovered',
      id: 'capture-gap',
      statement: 'Which investigation resolves the captured root?',
      blocking: true,
      target_step_id: 'next',
    },
  ];
  const start = async (enabled: boolean, gated = false, pause = true, rootPrompt = 'cr_a') => {
    await gateSwitch(enabled);
    const reply = await promptEngine({
      workflow: {
        version: 1,
        budget: { pauseOnBlocking: pause },
        nodes: [
          { id: 'root', promptId: rootPrompt, ...(gated ? { inlineGateIds: ['cr-block'] } : {}) },
          { id: 'next', promptId: 'cr_b' },
        ],
      },
    });
    expect(reply.isError).toBe(false);
    const chainId = chainIdOf(reply, rootPrompt);
    const session = store().getSessionByChainIdentifier(chainId);
    if (session === undefined) throw new Error(`no session for ${chainId}`);
    const captures = jest.spyOn(store(), 'updateSessionState');
    return { chainId, sessionId: session.sessionId, captures };
  };
  type Run = Awaited<ReturnType<typeof start>>;
  const current = (run: Run) => {
    const session = store().getSession(run.sessionId);
    if (session === undefined) throw new Error(`no run ${run.sessionId}`);
    return session;
  };
  const records = async (run: Run) => {
    const db = await SqliteEngine.getInstance(silentLogger(), {
      dbPath: foundation.pathResolver.getStateDatabasePath(),
    });
    return db.query<{ node_id: string; prompt_id: string; status: string }>(
      'SELECT node_id, prompt_id, status FROM execution_records WHERE session_id = ? ORDER BY execution_id',
      [run.sessionId]
    );
  };
  const rootCaptures = (run: Run) =>
    run.captures.mock.calls.filter(
      ([, nodeId, , metadata]) => nodeId === 'root' && metadata?.['source'] === 'user_response'
    ).length;
  const passForReply = (reply: Reply) => {
    const emitted = /"satisfied": (\[[^\]]*\])/.exec(reply.text)?.[1];
    if (emitted === undefined) throw new Error(`no issued reminder template in:\n${reply.text}`);
    const satisfied = JSON.parse(emitted) as string[];
    expect(satisfied).toEqual(['cr-block']);
    return {
      overall: 'PASS',
      rationale: 'The captured fixture marker was reviewed',
      reminders: { satisfied, not_applicable: [] },
    };
  };
  const fail = { overall: 'FAIL', rationale: 'The fixture needs another pass', per_gate: [] };
  const captureAndDiscover = (run: Run) =>
    promptEngine({ chain_id: run.chainId, user_response: 'CAPTURE-ROOT', observations: discovery });
  const review = (run: Run) => store().getReview(run.sessionId, 'root');
  const paused = async (run: Run, reply: Reply) => {
    expect(reply.isError).toBe(false);
    expect(reply.structured?.['chain_interrupt']).toMatchObject({ paused: true });
    expect(review(run)?.gateIds).toEqual(['__unknown_interrupt__']);
    expect(current(run).state.currentNodeId).toBe('root');
    expect(current(run).state.nodes.map((node) => node.id)).toEqual([
      'root',
      'inv-capture-gap',
      'next',
    ]);
    return records(run);
  };
  const resumeCaptured = async (run: Run) => {
    const captured = { ...store().getStepState(run.sessionId, 'root') };
    const output = store().getChainContext(run.sessionId)['step_results'];
    expect(rootCaptures(run)).toBe(1);
    expect(JSON.stringify(output)).toContain('CAPTURE-ROOT');
    const resumed = await promptEngine({ chain_id: run.chainId, gate_action: 'resume' });
    expect(resumed.isError).toBe(false);
    expect(resumed.structured?.['chain_interrupt']).toMatchObject({ paused: false });
    expect(current(run).state.currentNodeId).toBe('inv-capture-gap');
    expect(captured).toMatchObject({ state: 'completed', isPlaceholder: false });
    expect(
      current(run).unknownsLedger?.some(
        (unknown) => unknown.id === 'capture-gap' && unknown.state === 'active'
      )
    ).toBe(true);
    expect(store().getStepState(run.sessionId, 'root')).toEqual(captured);
    expect(store().getChainContext(run.sessionId)['step_results']).toEqual(output);
    expect(rootCaptures(run)).toBe(1);
    const rows = await records(run);
    expect(
      rows.filter(
        (row) =>
          row.node_id === 'inv-capture-gap' &&
          row.prompt_id === 'investigate_unknown' &&
          row.status === 'working'
      )
    ).toHaveLength(1);
    expect(rows.filter((row) => row.node_id === 'root' && row.status === 'working')).toHaveLength(
      1
    );
  };

  test.each([
    ['gates OFF, ungated root', false, false],
    ['gates ON, ungated root', true, false],
    ['gates ON, ordinary review settled by PASS', true, true],
  ] as const)(
    '%s keeps capture immutable while paused and resumes the investigation once',
    async (_name, enabled, gated) => {
      const run = await start(enabled, gated);
      let reply = await captureAndDiscover(run);
      if (gated) {
        const ordinaryAfterDiscovery = review(run);
        const discoveryInterrupt = reply.structured?.['chain_interrupt'];
        reply = await promptEngine({ chain_id: run.chainId, gate_verdict: passForReply(reply) });
        expect(ordinaryAfterDiscovery?.gateIds).toEqual(['cr-block']);
        expect(discoveryInterrupt).toMatchObject({ paused: false });
      }
      const pauseRows = await paused(run, reply);
      await resumeCaptured(run);
      expect(reply.text).not.toContain('BODY-cr_a');
      expect(pauseRows.filter((row) => row.status === 'working')).toHaveLength(1);
    }
  );

  test.each([false, true])(
    'gates %s resumes an uncaptured paused root without fabricating completion',
    async (enabled) => {
      const run = await start(enabled);
      const reply = await promptEngine({ chain_id: run.chainId, observations: discovery });
      const pauseRows = await paused(run, reply);
      expect(rootCaptures(run)).toBe(0);
      const resumed = await promptEngine({ chain_id: run.chainId, gate_action: 'resume' });
      expect(resumed.isError).toBe(false);
      expect(current(run).state.currentNodeId).toBe('root');
      expect(store().getStepState(run.sessionId, 'root')?.completedAt).toBeUndefined();
      expect(rootCaptures(run)).toBe(0);
      expect((await records(run)).some((row) => row.node_id === 'inv-capture-gap')).toBe(false);
      expect(reply.text).not.toContain('BODY-cr_a');
      expect(pauseRows.filter((row) => row.status === 'working')).toHaveLength(1);
    }
  );

  test.each(['no verdict', 'FAIL', 'resume'] as const)(
    'ordinary review retains its binding and attempts after discovery with %s',
    async (action) => {
      const run = await start(true, true);
      const before = review(run);
      expect(before?.gateIds).toEqual(['cr-block']);
      const reply = await captureAndDiscover(run);
      expect(reply.isError).toBe(false);
      const afterDiscovery = review(run);
      if (action !== 'no verdict') {
        const acted = await promptEngine({
          chain_id: run.chainId,
          ...(action === 'FAIL' ? { gate_verdict: fail } : { gate_action: 'resume' }),
        });
        expect(acted.isError).toBe(action === 'resume');
        expect(review(run)?.gateIds).toEqual(['cr-block']);
        expect(review(run)?.createdAt).toBe(before?.createdAt);
        expect(review(run)?.attemptCount).toBe(
          (before?.attemptCount ?? 0) + (action === 'FAIL' ? 1 : 0)
        );
      }
      expect(afterDiscovery?.gateIds).toEqual(['cr-block']);
      expect(afterDiscovery?.createdAt).toBe(before?.createdAt);
      expect(afterDiscovery?.attemptCount).toBe(before?.attemptCount);
      expect(reply.structured?.['chain_interrupt']).toMatchObject({ paused: false });
      expect(current(run).state.currentNodeId).toBe('root');
      expect(rootCaptures(run)).toBe(1);
      expect(JSON.stringify(store().getChainContext(run.sessionId)['step_results'])).toContain(
        'CAPTURE-ROOT'
      );
    }
  );

  test.each([false, true])(
    'gates %s soft discovery advances a real captured root once',
    async (enabled) => {
      const run = await start(enabled, false, false);
      const reply = await captureAndDiscover(run);
      expect(reply.isError).toBe(false);
      expect(reply.structured?.['chain_interrupt']).toMatchObject({ paused: false });
      expect(current(run).state.currentNodeId).toBe('inv-capture-gap');
      expect(rootCaptures(run)).toBe(1);
      expect(
        (await records(run)).filter(
          (row) => row.node_id === 'inv-capture-gap' && row.status === 'working'
        )
      ).toHaveLength(1);
    }
  );

  test('abort retains the captured paused run without rendering or advancing a node', async () => {
    const run = await start(false);
    await captureAndDiscover(run);
    const before = await records(run);
    const output = store().getChainContext(run.sessionId)['step_results'];
    const aborted = await promptEngine({ chain_id: run.chainId, gate_action: 'abort' });
    expect(aborted.isError).toBe(false);
    expect(current(run).runStatus).toBe('cancelled');
    expect(current(run).state.currentNodeId).toBe('root');
    expect(store().getChainContext(run.sessionId)['step_results']).toEqual(output);
    expect(rootCaptures(run)).toBe(1);
    expect((await records(run)).filter((row) => row.status === 'working')).toEqual(
      before.filter((row) => row.status === 'working')
    );
  });

  test.each(['arrow', 'structured'] as const)(
    'F25 command-only qualified %s append refreshes full progress without recapturing root',
    async (form) => {
      const run = await start(false);
      await paused(run, await captureAndDiscover(run));
      await resumeCaptured(run);
      const db = await SqliteEngine.getInstance(silentLogger(), {
        dbPath: foundation.pathResolver.getStateDatabasePath(),
      });
      const rootTimes = () =>
        db.query<{ responded_at: number; completed_at: number }>(
          "SELECT responded_at, completed_at FROM chain_run_nodes WHERE session_id = ? AND node_id = 'root'",
          [run.sessionId]
        );
      const beforeTimes = rootTimes();
      const beforeState = { ...store().getStepState(run.sessionId, 'root') };
      const beforeOutput = store().getChainContext(run.sessionId)['step_results'];
      const beforeRootRecords = (await records(run)).filter((row) => row.node_id === 'root');
      expect(beforeTimes[0]?.responded_at).toEqual(expect.any(Number));
      expect(beforeTimes[0]?.completed_at).toEqual(expect.any(Number));
      expect(current(run).state.nodes).toHaveLength(3);
      const promptId = 'implementation_plan/plan_table';
      const feature = 'F25 keep / path --> ==> + ? %clean exactly';
      const tailIds =
        form === 'arrow'
          ? ['implementation-plan-plan-table', 'implementation-plan-plan-table-2']
          : ['qualified-one', 'qualified-two'];
      const request =
        form === 'arrow'
          ? {
              command: `--> >>${promptId} feature="${feature}" --> >>${promptId} feature="${feature}"`,
            }
          : {
              remainder: {
                mode: 'append',
                nodes: tailIds.map((id) => ({ id, promptId, args: { feature } })),
              },
            };
      const appended = await promptEngine({ chain_id: run.chainId, ...request });
      expect(appended.isError).toBe(false);
      expect(current(run).state.nodes.map((node) => node.id)).toEqual([
        'root',
        'inv-capture-gap',
        'next',
        ...tailIds,
      ]);
      expect(
        current(run)
          .state.nodes.slice(3)
          .map(({ id, promptId, args, origin }) => ({
            id,
            promptId,
            args,
            origin,
          }))
      ).toEqual(tailIds.map((id) => ({ id, promptId, args: { feature }, origin: 'remainder' })));
      expect(current(run).state.currentNodeId).toBe('inv-capture-gap');
      expect(current(run).executionOrder).toEqual(['root']);
      expect(store().getStepState(run.sessionId, 'root')).toEqual(beforeState);
      expect(store().getChainContext(run.sessionId)['step_results']).toEqual(beforeOutput);
      expect(rootTimes()).toEqual(beforeTimes);
      expect(rootCaptures(run)).toBe(1);
      expect((await records(run)).filter((row) => row.node_id === 'root')).toEqual(
        beforeRootRecords
      );
      expect(appended.structured?.['chain_interrupt']).toMatchObject({
        paused: false,
        remaining_nodes: [{ id: 'next' }, ...tailIds.map((id) => ({ id, promptId }))],
      });
      expect(appended.text).toContain('→ Progress 2/5');
    }
  );

  test('the answering remainder drops target-step gates before ordinary grading of an investigation', async () => {
    await gateSwitch(true);
    const started = await promptEngine({
      workflow: {
        version: 1,
        nodes: [
          { id: 'root', promptId: 'cr_a' },
          { id: 'next', promptId: 'cr_b', inlineGateIds: ['cr-block'] },
        ],
      },
    });
    const chainId = chainIdOf(started, 'cr_a');
    const session = store().getSessionByChainIdentifier(chainId);
    if (session === undefined) throw new Error('no remainder run');
    await promptEngine({ chain_id: chainId, user_response: 'ROOT-ORDER', observations: discovery });
    expect(store().getSession(session.sessionId)?.state.currentNodeId).toBe('inv-capture-gap');
    const answered = await promptEngine({
      chain_id: chainId,
      user_response: 'INVESTIGATION-ORDER',
      remainder: { mode: 'replace', nodes: [{ id: 'replacement', promptId: 'cr_a' }] },
    });
    expect(answered.isError).toBe(false);
    expect(answered.text).not.toContain('GUIDANCE-cr-block');
    expect(
      Object.values(store().getSession(session.sessionId)?.reviews ?? {}).some((value) =>
        value.gateIds.includes('cr-block')
      )
    ).toBe(false);
    expect(
      store()
        .getSession(session.sessionId)
        ?.state.nodes.some((node) => node.id === 'next')
    ).toBe(false);
  });
  const exhaust = async (run: Run) => {
    const maximum = review(run)?.maxAttempts;
    if (maximum === undefined) throw new Error('ordinary review has no attempt budget');
    for (let attempt = 0; attempt < maximum; attempt += 1) {
      const reply = await promptEngine({ chain_id: run.chainId, gate_verdict: fail });
      expect(reply.isError).toBe(false);
    }
    expect(review(run)).toMatchObject({ phase: 'exhausted', attemptCount: maximum });
  };

  test('exhausted ordinary retry retains its review and defers the unknown pause', async () => {
    const run = await start(true, true);
    await captureAndDiscover(run);
    await exhaust(run);
    const exhausted = review(run);
    const output = store().getChainContext(run.sessionId)['step_results'];
    const retried = await promptEngine({ chain_id: run.chainId, gate_action: 'retry' });
    expect(retried.isError).toBe(false);
    expect(review(run)?.gateIds).toEqual(['cr-block']);
    expect(review(run)?.phase).toBe('awaiting-verdict');
    expect(review(run)?.attemptCount).toBe(0);
    expect(review(run)?.maxAttempts).toBe(exhausted?.maxAttempts);
    expect(review(run)?.history?.slice(0, exhausted?.history?.length)).toEqual(exhausted?.history);
    expect(review(run)?.history?.at(-1)?.status).toBe('reset');
    expect(retried.structured?.['chain_interrupt']).toMatchObject({ paused: false });
    expect(current(run).state.currentNodeId).toBe('root');
    expect(store().getChainContext(run.sessionId)['step_results']).toEqual(output);
    expect(rootCaptures(run)).toBe(1);
  });

  test('ordinary skip announces failed before pausing the unanswered investigation, whose resume does not advance', async () => {
    const notices: Array<{ chainId: string; stepIndex: number; status: string }> = [];
    stepCompleteObserver = (notice) => {
      notices.push(notice);
    };
    const run = await start(true, true);
    await captureAndDiscover(run);
    await exhaust(run);
    const output = store().getChainContext(run.sessionId)['step_results'];
    const skipped = await promptEngine({ chain_id: run.chainId, gate_action: 'skip' });
    expect(skipped.isError).toBe(false);
    expect(notices).toEqual([{ chainId: run.chainId, stepIndex: 1, status: 'failed' }]);
    expect(current(run).state.currentNodeId).toBe('inv-capture-gap');
    expect(current(run).reviews?.['inv-capture-gap']?.gateIds).toEqual(['__unknown_interrupt__']);
    expect(skipped.structured?.['chain_interrupt']).toMatchObject({ paused: true });
    expect(skipped.text).not.toContain('BODY-cr_a');
    expect(store().getStepState(run.sessionId, 'inv-capture-gap')).toBeUndefined();
    expect((await records(run)).some((row) => row.node_id === 'inv-capture-gap')).toBe(false);
    const resumed = await promptEngine({ chain_id: run.chainId, gate_action: 'resume' });
    expect(resumed.isError).toBe(false);
    expect(current(run).state.currentNodeId).toBe('inv-capture-gap');
    expect(store().getChainContext(run.sessionId)['step_results']).toEqual(output);
    expect(rootCaptures(run)).toBe(1);
    expect(notices).toHaveLength(1);
    expect(
      (await records(run)).filter(
        (row) => row.node_id === 'inv-capture-gap' && row.status === 'working'
      )
    ).toHaveLength(1);
  });

  test('an actual declared-header phase failure keeps ordinary review priority over the inserted unknown', async () => {
    foundation.configManager.getConfig().phaseGuards.mode = 'enforce';
    const run = await start(true, false, true, 'cr_guard');
    const declared = store().getStepState(run.sessionId, 'root')?.declaredSections;
    expect(declared?.some((header) => header.replace(/^#+\s*/, '') === 'Context')).toBe(true);
    expect(review(run)).toBeUndefined();
    const answered = await captureAndDiscover(run);
    expect(answered.isError).toBe(false);
    expect(review(run)?.gateIds).toContain('__phase_guard__');
    expect(review(run)?.gateIds).not.toContain('__unknown_interrupt__');
    expect(hasStructuralFinding(review(run))).toBe(true);
    expect(answered.structured?.['chain_interrupt']).toMatchObject({ paused: false });
    const before = review(run);
    const resumed = await promptEngine({ chain_id: run.chainId, gate_action: 'resume' });
    expect(resumed.isError).toBe(true);
    expect(review(run)).toEqual(before);
    expect(current(run).state.currentNodeId).toBe('root');
    expect(rootCaptures(run)).toBe(1);
  });

  test('a completed real pause without retained capture output cannot force an advance', async () => {
    const run = await start(false);
    await captureAndDiscover(run);
    expect(store().getStepState(run.sessionId, 'root')).toMatchObject({
      state: 'completed',
      isPlaceholder: false,
    });
    textReferenceStore.clearChainStepResults(run.sessionId);
    expect(store().getChainContext(run.sessionId)['step_results']).toEqual({});
    const resumed = await promptEngine({ chain_id: run.chainId, gate_action: 'resume' });
    expect(resumed.isError).toBe(false);
    expect(current(run).state.currentNodeId).toBe('root');
    expect(rootCaptures(run)).toBe(1);
    expect((await records(run)).some((row) => row.node_id === 'inv-capture-gap')).toBe(false);
  });
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

  test('abort stops the run, and a later resume is told it is over', async () => {
    const chainId = chainIdOf(await promptEngine({ command: '>>cr_chain' }), 'cr_chain');

    const cancelled = await promptEngine({ chain_id: chainId, gate_action: 'abort' });
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
