import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SqliteEngine } from '../../../../src/infra/database/sqlite-engine.js';

import { PromptExecutor } from '../../../../src/mcp/tools/prompt-engine/core/prompt-executor.js';
import { hashBytes } from '../../../../src/shared/utils/hash.js';

import type { ConfigManager } from '../../../../src/shared/types/config-manager.js';
import type { Logger } from '../../../../src/infra/logging/index.js';
import type { PromptAssetManager } from '../../../../src/modules/prompts/index.js';
import type { TextReferenceStore } from '../../../../src/modules/text-refs/index.js';
import type { McpToolRequest } from '../../../../src/shared/types/execution.js';
import type { GateVerdictSubmission } from '../../../../src/shared/types/gate-evaluation.js';

const mockLogger: Logger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as any;

const mockPromptAssetManager: PromptAssetManager = {
  loadAndConvertPrompts: jest.fn().mockResolvedValue([]),
  processTemplateAsync: jest.fn().mockResolvedValue('mocked result'),
  convertedPrompts: [],
  promptsData: [],
} as any;

const mockConfigManager: ConfigManager = {
  getConfig: jest.fn().mockReturnValue({
    server: { name: 'test', version: '1.0.0' },
    gates: {},
    frameworks: {},
    identity: { mode: 'permissive', allowPerRequestOverride: true, launchDefaults: {} },
  }),
  getFrameworksConfig: jest.fn().mockReturnValue({}),
  getTransportMode: jest.fn().mockReturnValue('streamable-http'),
  getChainSessionConfig: jest.fn().mockReturnValue(undefined),
  getServerRoot: jest.fn().mockReturnValue(process.cwd()),
  // Never the package directory: an unwritable path makes any unexpected write fail loudly.
  getRuntimeStateDirectory: jest.fn().mockReturnValue('/nonexistent-runtime-root/runtime-state'),
  getSchemaValidation: () => undefined,
  getConfigValueWithSource: jest.fn().mockReturnValue({
    key: 'server.port',
    value: undefined,
    source: 'default',
  }),
  listConfigKeys: jest.fn().mockResolvedValue([]),
  on: jest.fn(),
  off: jest.fn(),
} as any;

const mockTextReferenceStore: TextReferenceStore = {
  storeChainStepResult: jest.fn(),
  getChainStepResults: jest.fn().mockReturnValue({}),
  buildChainVariables: jest.fn().mockReturnValue({}),
  clearChainStepResults: jest.fn(),
  getChainStats: jest.fn().mockReturnValue({ totalChains: 0, totalSteps: 0, chainsWithSteps: [] }),
  getStats: jest.fn().mockReturnValue({ totalChains: 0, totalSteps: 0, chainsWithSteps: [] }),
} as any;

const mockFrameworkManager = {
  generateExecutionContext: jest.fn().mockReturnValue({
    selectedFramework: { framework: 'CAGEERF', name: 'CAGEERF' },
    systemPrompt: 'Use the CAGEERF framework',
  }),
  listFrameworks: jest.fn().mockReturnValue([]),
} as any;

const mockFrameworkStateStore = {
  isFrameworkSystemEnabled: jest.fn().mockReturnValue(false),
  getActiveFramework: jest.fn().mockReturnValue({
    framework: 'CAGEERF',
    name: 'CAGEERF',
  }),
  shutdown: jest.fn(),
} as any;

describe('PromptEngine Validation', () => {
  let engine: PromptExecutor;
  let abortRuntimeDir: string | undefined;
  let abortDatabase: SqliteEngine | undefined;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.mocked(mockConfigManager.getTransportMode).mockReturnValue('streamable-http');
    jest.mocked(mockConfigManager.getConfig).mockReturnValue({
      server: { name: 'test', version: '1.0.0' },
      gates: {},
      frameworks: {},
      identity: { mode: 'permissive', allowPerRequestOverride: true, launchDefaults: {} },
    } as ReturnType<ConfigManager['getConfig']>);
    if (expect.getState().currentTestName?.startsWith('PromptEngine Validation abort')) {
      abortRuntimeDir = mkdtempSync(join(tmpdir(), 'prompt-validation-abort-'));
      abortDatabase = await SqliteEngine.getInstance(mockLogger, {
        dbPath: join(abortRuntimeDir, 'state.db'),
      });
      await abortDatabase.initialize();
      jest.mocked(mockConfigManager.getRuntimeStateDirectory).mockReturnValue(abortRuntimeDir);
    }
    engine = new PromptExecutor(
      mockLogger,
      mockPromptAssetManager,
      mockConfigManager,
      mockTextReferenceStore,
      undefined, // gateManager
      undefined,
      undefined,
      abortDatabase
    );
  });

  afterEach(async () => {
    try {
      if (engine) await engine.getChainSessionStore().cleanup();
    } finally {
      await abortDatabase?.shutdown();
      abortDatabase = undefined;
      if (abortRuntimeDir !== undefined) {
        rmSync(abortRuntimeDir, { recursive: true, force: true });
        abortRuntimeDir = undefined;
        jest
          .mocked(mockConfigManager.getRuntimeStateDirectory)
          .mockReturnValue('/nonexistent-runtime-root/runtime-state');
      }
    }
  });

  describe('Parameter Validation', () => {
    test('should reject conflicting force_restart and chain_id parameters', async () => {
      const result = await engine.executePromptCommand(
        {
          command: '>>analyze_code test code',
          force_restart: true,
          chain_id: 'chain-analyze_code',
        },
        {}
      );

      expect(result.isError).toBe(true);
      expect(result.content).toHaveLength(1);
      const message = result.content[0];
      expect(message.type).toBe('text');
      expect(message.text).toContain('Conflicting parameters detected');
      expect(message.text).toContain('force_restart=true');
      expect(message.text).toContain('chain_id');
      expect(message.text).toContain('cannot be used together');
    });

    // Note: Positive cases (force_restart alone, chain_id alone, neither)
    // are tested in integration tests via Node.js scripts.
    // These unit tests require extensive mocking that is brittle and low value.
  });

  test('forwards structured inputs to the pipeline without command-string serialization', async () => {
    const execute = jest.fn(async (_request?: unknown) => ({
      content: [{ type: 'text' as const, text: 'ok' }],
      isError: false,
    }));
    jest
      .spyOn(
        engine as unknown as { getPromptExecutionPipeline: () => unknown },
        'getPromptExecutionPipeline'
      )
      .mockReturnValue({ execute });
    const inputs = {
      palette: ['ochre', 'ultramarine'],
      composition: { weights: { edge: 0.7 }, references: [{ id: 'r1' }] },
      note: String.raw`C:\art\refs and "quotes"`,
    };

    await engine.executePromptCommand(
      { command: '>>art_prompt mode="inline"', inputs, options: { mode: 'legacy' } },
      {}
    );

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        command: '>>art_prompt mode="inline"',
        inputs,
        options: { mode: 'legacy' },
      })
    );
    const forwardedRequest = execute.mock.calls[0]?.[0] as { command: string } | undefined;
    expect(forwardedRequest?.command).not.toContain('[object Object]');
  });

  describe('gate verdict custody at the executor pipeline boundary', () => {
    function stubPipeline() {
      const execute = jest.fn(async (_request: McpToolRequest) => ({
        content: [{ type: 'text' as const, text: 'ok' }],
        isError: false,
      }));
      jest
        .spyOn(
          engine as unknown as { getPromptExecutionPipeline: () => unknown },
          'getPromptExecutionPipeline'
        )
        .mockReturnValue({ execute });
      return execute;
    }

    test.each(['chain_id', 'command'] as const)(
      'forwards a rich report intact for a %s resume without serializing it',
      async (source) => {
        const execute = stubPipeline();
        const target = 'A😀e\u0301 Z';
        const targetDigest = hashBytes(target);
        const verdict: GateVerdictSubmission = {
          overall: 'PASS',
          rationale: 'Criterion reviewed',
          per_gate: [
            {
              index: 1,
              passed: true,
              rationale: 'Target evidence supplied',
              evaluation: {
                binding: {
                  gate_id: 'contract-gate',
                  node_id: 'n1',
                  attempt_id: 'attempt-1',
                  definition_digest: hashBytes('frozen definition'),
                  target_digest: targetDigest,
                },
                observations: [
                  {
                    criterion_id: 'preserves-contract',
                    state: 'met',
                    value: true,
                    evidence: [
                      { target_digest: targetDigest, start: 1, end: 5, quote: '😀e\u0301' },
                    ],
                    rationale: 'Unicode evidence retained.\nThis report rationale is multiline.',
                  },
                ],
                reviewer: {
                  provenance: 'client_reported',
                  provider: 'claimed-provider',
                  model: 'claimed-model',
                  revision: 'claimed-revision',
                  context: 'isolated_judge',
                },
              },
            },
          ],
          reminders: { satisfied: ['review-notes'], not_applicable: [] },
        };
        const original = structuredClone(verdict);

        await engine.executePromptCommand(
          { [source]: 'chain-contract#4', gate_verdict: verdict },
          {}
        );

        expect(execute).toHaveBeenCalledTimes(1);
        const request = execute.mock.calls[0]?.[0];
        expect(request?.chain_id).toBe('chain-contract#4');
        expect(request?.command).toBeUndefined();
        expect(request?.gate_verdict).toBe(verdict);
        expect(request?.gate_verdict).toEqual(original);
        expect(typeof request?.gate_verdict).toBe('object');
        expect(verdict).toEqual(original);
      }
    );

    test('an absent verdict does not trigger a command resume', async () => {
      const execute = stubPipeline();

      await engine.executePromptCommand({ command: 'chain-contract#4' }, {});

      const request = execute.mock.calls[0]?.[0];
      expect(request?.command).toBe('chain-contract#4');
      expect(request?.chain_id).toBeUndefined();
      expect(request).not.toHaveProperty('gate_verdict');
    });
  });

  /**
   * The APPEND hop (row A.3, OQ-A1).
   *
   * This is the hop the plan's own record says gets forgotten: `remainder` was typechecked at
   * every layer and dead twice — once at the argument allowlist, once at THIS request build
   * (DEV-T2-4). A string append that never reaches `request.remainder` would look exactly like a
   * silent resume, so the assertions below read the forwarded request rather than the response.
   */
  describe('a leading `-->` command with chain_id becomes an append remainder', () => {
    function stubPipeline(): jest.Mock<(request?: unknown) => Promise<unknown>> {
      const execute = jest.fn(async (_request?: unknown) => ({
        content: [{ type: 'text' as const, text: 'ok' }],
        isError: false,
      }));
      jest
        .spyOn(
          engine as unknown as { getPromptExecutionPipeline: () => unknown },
          'getPromptExecutionPipeline'
        )
        .mockReturnValue({ execute });
      return execute as never;
    }

    test('reaches request.remainder, and the command is dropped so the call is a plain resume', async () => {
      const execute = stubPipeline();

      await engine.executePromptCommand(
        { chain_id: 'chain-demo#1', command: '--> >>write_summary' },
        {}
      );

      const request = execute.mock.calls[0]?.[0] as {
        command?: string;
        chain_id?: string;
        remainder?: unknown;
      };
      expect(request.chain_id).toBe('chain-demo#1');
      expect(request.command).toBeUndefined();
      expect(request.remainder).toEqual({
        mode: 'append',
        nodes: [{ id: 'write-summary', promptId: 'write_summary' }],
      });
    });

    test('OQ-A1: both spellings of one append forward an IDENTICAL remainder', async () => {
      const execute = stubPipeline();

      await engine.executePromptCommand(
        { chain_id: 'chain-demo#1', command: '--> >>write_summary' },
        {}
      );
      await engine.executePromptCommand(
        {
          chain_id: 'chain-demo#1',
          remainder: {
            mode: 'append',
            nodes: [{ id: 'write-summary', promptId: 'write_summary' }],
          },
        },
        {}
      );

      const stringForm = (execute.mock.calls[0]?.[0] as { remainder?: unknown }).remainder;
      const structuredForm = (execute.mock.calls[1]?.[0] as { remainder?: unknown }).remainder;
      expect(stringForm).toEqual(structuredForm);
    });

    test('a `-->` command WITHOUT chain_id is left alone — that is a new symbolic chain', async () => {
      const execute = stubPipeline();

      await engine.executePromptCommand({ command: '>>a --> >>b' }, {});

      const request = execute.mock.calls[0]?.[0] as { command?: string; remainder?: unknown };
      expect(request.command).toBe('>>a --> >>b');
      expect(request.remainder).toBeUndefined();
    });

    test('sending both spellings in one call is refused rather than silently preferring one', async () => {
      stubPipeline();

      const result = await engine.executePromptCommand(
        {
          chain_id: 'chain-demo#1',
          command: '--> >>write_summary',
          remainder: { mode: 'append', nodes: [{ id: 'other', promptId: 'review' }] },
        },
        {}
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('two spellings of one append');
    });

    test('an unparseable append is refused before the pipeline is reached', async () => {
      const execute = stubPipeline();

      // `::` rather than `==>`: row A.5 maps the delegation operator onto the node's `delegated`
      // declaration, so it is no longer a parse refusal. A raw gate token still is — its meaning
      // comes from a registry resolution that an appended node has already passed.
      const result = await engine.executePromptCommand(
        { chain_id: 'chain-demo#1', command: '--> >>a :: "cite sources"' },
        {}
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('raw "::" gate token');
      expect(execute).not.toHaveBeenCalled();
    });
  });

  /**
   * Abort is a run-level action, independent of review admission.
   *
   * It belongs on this tool because of which id the caller holds: a `chain_id` is held BECAUSE
   * you are running the chain, so ending that run is part of running it. `system_control session`
   * keeps `list`/`inspect`/`clear`, which are keyed on a `session_id` read from a listing.
   */
  describe('abort', () => {
    async function seedAbortRun(sessionId: string): Promise<void> {
      await engine.getChainSessionStore().createSession(sessionId, 'chain-demo#1', 1);
    }

    test.each([undefined, '', '  '])(
      'requires a named run, including for standalone shell prompts (%p)',
      async (chainId) => {
        const store = engine.getChainSessionStore();
        const cancelChain = jest.spyOn(store, 'cancelChain');
        const pipeline = jest.spyOn(
          engine as unknown as { getPromptExecutionPipeline: () => unknown },
          'getPromptExecutionPipeline'
        );
        const result = await engine.executePromptCommand(
          { gate_action: 'abort', chain_id: chainId, command: '>>demo :: verify:"exit 0"' },
          {}
        );

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('gate_action:"abort"');
        expect(result.content[0].text).toContain('requires `chain_id`');
        expect(cancelChain).not.toHaveBeenCalled();
        expect(pipeline).not.toHaveBeenCalled();
        expect(mockTextReferenceStore.clearChainStepResults).not.toHaveBeenCalled();
      }
    );

    test('resolves chain_id to the internal session id before aborting', async () => {
      // The substance of the relocation. `cancelChain` is keyed on the internal session id
      // (`review-demo-1786998494932`), while the caller holds the resume token
      // (`chain-demo#1`) — the old `system_control` operation took the internal one, so stopping
      // your own run meant listing sessions to look up an id you never chose. A live drive is
      // what caught this: with a mock store, passing the chain id straight through "works".
      const store = engine.getChainSessionStore();
      await seedAbortRun('review-demo-1786998494932');
      jest.spyOn(store, 'getSessionByChainIdentifier');
      const cancelChain = jest.spyOn(store, 'cancelChain');

      const result = await engine.executePromptCommand(
        { gate_action: 'abort', chain_id: ' chain-demo#1 ' },
        {}
      );

      expect(store.getSessionByChainIdentifier).toHaveBeenCalledWith('chain-demo#1', {
        includeDormant: true,
      });
      expect(cancelChain).toHaveBeenCalledWith('review-demo-1786998494932', undefined);
      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('Chain Cancelled');
      // The public action retains the store's cancelled outcome and inspection guidance.
      expect(result.content[0].text).toContain('retained');
    });

    test('reports a run the store could not abort rather than claiming success', async () => {
      const store = engine.getChainSessionStore();
      jest.spyOn(store, 'cancelChain').mockResolvedValue(false as unknown as never);

      const result = await engine.executePromptCommand(
        { gate_action: 'abort', chain_id: 'chain-demo#9' },
        {}
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Abort Not Applied');
      expect(result.content[0].text).not.toContain('Chain Cancelled');
      expect(mockTextReferenceStore.clearChainStepResults).not.toHaveBeenCalled();
    });

    test('short-circuits before companion parsing, handoff, claim and report consumption', async () => {
      const store = engine.getChainSessionStore();
      await seedAbortRun('chain-demo#1');
      const cancelChain = jest.spyOn(store, 'cancelChain');

      const pipeline = jest.spyOn(
        engine as unknown as { getPromptExecutionPipeline: () => unknown },
        'getPromptExecutionPipeline'
      );
      const mint = jest.spyOn(store, 'mintHandoffToken').mockResolvedValue(undefined);
      const claim = jest.spyOn(store, 'claimHandoff');
      // Direct executor boundary only: the public schema still refuses mixed command sources.
      const result = await engine.executePromptCommand(
        {
          gate_action: 'abort',
          chain_id: 'chain-demo#1',
          command: '--> malformed',
          handoff: true,
          claim_token: 'unused-token',
          force_restart: true,
          user_response: 'HANDOFF RESULT: unused report',
          gate_verdict: 'PASS',
        },
        {}
      );

      expect(cancelChain).toHaveBeenCalledWith('chain-demo#1', undefined);
      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('Chain Cancelled');
      expect(pipeline).not.toHaveBeenCalled();
      expect(mint).not.toHaveBeenCalled();
      expect(claim).not.toHaveBeenCalled();
      expect(mockTextReferenceStore.storeChainStepResult).not.toHaveBeenCalled();
    });

    test('passes no scope when the request carries none, so the store skips the scope check', async () => {
      // `undefined`, not a substituted default: `getSessionForMutation` SKIPS the scope check on
      // undefined and ENFORCES it on a value, so substituting the process workspace scope made
      // every abort of a session without a continuityScopeId return "not applied". Found live.
      const store = engine.getChainSessionStore();
      const cancelChain = jest
        .spyOn(store, 'cancelChain')
        .mockResolvedValue(true as unknown as never);

      await engine.executePromptCommand({ gate_action: 'abort', chain_id: 'chain-demo#1' }, {});

      expect(cancelChain.mock.calls[0]?.[1]).toBeUndefined();
    });

    test('returns success again when the durable owner reports an already-cancelled run', async () => {
      const store = engine.getChainSessionStore();
      await seedAbortRun('chain-demo#1');
      jest.spyOn(store, 'cancelChain');
      const args = { gate_action: 'abort' as const, chain_id: 'chain-demo#1' };

      const first = await engine.executePromptCommand(args, {});
      const repeated = await engine.executePromptCommand(args, {});

      expect(first.isError).toBe(false);
      expect(repeated.isError).toBe(false);
      expect(repeated.content[0].text).toContain('Chain Cancelled');
    });
  });

  describe('F20 claim request identity', () => {
    const launch = { workspaceId: 'launch', organizationId: 'org-launch' };
    const launchScope = {
      continuityScopeId: 'launch',
      workspaceId: 'launch',
      organizationId: 'org-launch',
    };
    const foreignSdk = {
      http: { req: { headers: { 'x-workspace-id': 'other', 'x-organization-id': 'org-other' } } },
    };
    test.each([
      {
        name: 'launch with empty SDK',
        sdk: {},
        mode: 'permissive',
        override: true,
        transport: 'streamable-http',
        defaults: launch,
        expected: launchScope,
      },
      {
        name: 'launch with no identity headers',
        sdk: { http: { req: { headers: {} } } },
        mode: 'permissive',
        override: true,
        transport: 'streamable-http',
        defaults: launch,
        expected: launchScope,
      },
      {
        name: 'explicit nondefault request',
        sdk: foreignSdk,
        mode: 'permissive',
        override: true,
        transport: 'streamable-http',
        defaults: launch,
        expected: { continuityScopeId: 'other', workspaceId: 'other', organizationId: 'org-other' },
      },
      {
        name: 'locked ignores foreign request',
        sdk: foreignSdk,
        mode: 'locked',
        override: true,
        transport: 'streamable-http',
        defaults: launch,
        expected: launchScope,
      },
      {
        name: 'disabled override ignores foreign request',
        sdk: foreignSdk,
        mode: 'permissive',
        override: false,
        transport: 'streamable-http',
        defaults: launch,
        expected: launchScope,
      },
      {
        name: 'STDIO launch precedes foreign request',
        sdk: foreignSdk,
        mode: 'permissive',
        override: true,
        transport: 'stdio',
        defaults: launch,
        expected: launchScope,
      },
      {
        name: 'default workspace retains organization fallback',
        sdk: {},
        mode: 'permissive',
        override: true,
        transport: 'streamable-http',
        defaults: { workspaceId: 'default', organizationId: 'org-launch' },
        expected: { organizationId: 'org-launch' },
      },
      {
        name: 'all default normalizes unfiltered',
        sdk: {},
        mode: 'permissive',
        override: true,
        transport: 'streamable-http',
        defaults: {},
        expected: undefined,
      },
    ] as const)(
      'forwards canonical policy: $name',
      async ({ sdk, mode, override, transport, defaults, expected }) => {
        jest.mocked(mockConfigManager.getConfig).mockReturnValue({
          ...mockConfigManager.getConfig(),
          identity: { mode, allowPerRequestOverride: override, launchDefaults: defaults },
        });
        jest.mocked(mockConfigManager.getTransportMode).mockReturnValue(transport);
        const claim = jest
          .spyOn(engine.getChainSessionStore(), 'claimHandoff')
          .mockResolvedValue({ status: 'unknown-token' });
        const pipeline = jest.spyOn(
          engine as unknown as { getPromptExecutionPipeline: () => unknown },
          'getPromptExecutionPipeline'
        );

        const result = await engine.executePromptCommand(
          { claim_token: 'hnd_scope' },
          { _sdkExtra: sdk }
        );

        expect(claim).toHaveBeenCalledWith('hnd_scope', expected);
        expect(result.isError).toBe(true);
        expect(result.content[0]!.text).toContain('Claim Refused');
        expect(pipeline).not.toHaveBeenCalled();
      }
    );

    test.each([undefined, null, 'not-sdk'])(
      'keeps absent/nonobject SDK %s on the legacy request dimension',
      async (sdk) => {
        jest.mocked(mockConfigManager.getConfig).mockReturnValue({
          ...mockConfigManager.getConfig(),
          identity: { mode: 'locked', allowPerRequestOverride: false, launchDefaults: launch },
        });
        const claim = jest
          .spyOn(engine.getChainSessionStore(), 'claimHandoff')
          .mockResolvedValue({ status: 'unknown-token' });
        await engine.executePromptCommand({ claim_token: 'hnd_legacy' }, { _sdkExtra: sdk });
        expect(claim).toHaveBeenCalledWith('hnd_legacy', undefined);
        expect(mockConfigManager.getTransportMode).not.toHaveBeenCalled();
      }
    );

    test('renders request continuity refusal before parsing or pipeline resume', async () => {
      jest.spyOn(engine.getChainSessionStore(), 'claimHandoff').mockResolvedValue({
        status: 'request-continuity-mismatch',
        runContinuityScopeId: undefined,
        requestContinuityScopeId: 'other',
      });
      const pipeline = jest.spyOn(
        engine as unknown as { getPromptExecutionPipeline: () => unknown },
        'getPromptExecutionPipeline'
      );
      const result = await engine.executePromptCommand(
        { claim_token: 'hnd_refused' },
        { _sdkExtra: foreignSdk }
      );
      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('request continuity `other`');
      expect(result.content[0]!.text).toContain('run continuity `absent`');
      expect(result.content[0]!.text).toContain('token and run stay with their owner');
      expect(pipeline).not.toHaveBeenCalled();
    });
  });

  // Framework manager integration behavior (validation + executor) now covered by dedicated
  // FrameworkValidator/FrameworkResolutionStage tests and future pipeline coverage.
});
