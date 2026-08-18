import { describe, test, expect, beforeEach, jest } from '@jest/globals';

import { PromptExecutor } from '../../../../src/mcp/tools/prompt-engine/core/prompt-executor.js';

import type { ConfigManager } from '../../../../src/infra/config/index.js';
import type { Logger } from '../../../../src/infra/logging/index.js';
import type { PromptAssetManager } from '../../../../src/modules/prompts/index.js';
import type { ContentAnalyzer as SemanticAnalyzer } from '../../../../src/modules/semantic/content-analyzer.js';
import type { TextReferenceStore } from '../../../../src/modules/text-refs/index.js';

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
  }),
  getFrameworksConfig: jest.fn().mockReturnValue({}),
  getChainSessionConfig: jest.fn().mockReturnValue(undefined),
  getServerRoot: jest.fn().mockReturnValue(process.cwd()),
  on: jest.fn(),
  off: jest.fn(),
} as any;

const mockSemanticAnalyzer: SemanticAnalyzer = {
  analyzePrompt: jest.fn().mockResolvedValue({
    executionType: 'prompt',
    requiresExecution: true,
    confidence: 0.8,
  }),
  getConfig: jest.fn().mockReturnValue({
    llmIntegration: { enabled: false },
  }),
} as any;

const mockTextReferenceStore: TextReferenceStore = {
  storeChainStepResult: jest.fn(),
  getChainStepResults: jest.fn().mockReturnValue({}),
  getChainStepResult: jest.fn().mockReturnValue(null),
  getChainStepMetadata: jest.fn().mockReturnValue(null),
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

  beforeEach(() => {
    jest.clearAllMocks();
    engine = new PromptExecutor(
      mockLogger,
      mockPromptAssetManager,
      mockConfigManager,
      mockSemanticAnalyzer,
      mockTextReferenceStore,
      undefined // gateManager
    );
  });

  afterEach(async () => {
    if (engine && typeof engine.cleanup === 'function') {
      await engine.cleanup();
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

  /**
   * `cancel` relocated here from `system_control session cancel` (Tier 7).
   *
   * It belongs on this tool because of which id the caller holds: a `chain_id` is held BECAUSE
   * you are running the chain, so ending that run is part of running it. `system_control session`
   * keeps `list`/`inspect`/`clear`, which are keyed on a `session_id` read from a listing.
   */
  describe('cancel', () => {
    test('requires chain_id, since that is what names the run to stop', async () => {
      const result = await engine.executePromptCommand({ cancel: true }, {});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('chain_id');
    });

    test('resolves chain_id to the internal session id before cancelling', async () => {
      // The substance of the relocation. `cancelChain` is keyed on the internal session id
      // (`review-demo-1786998494932`), while the caller holds the resume token
      // (`chain-demo#1`) — the old `system_control` operation took the internal one, so stopping
      // your own run meant listing sessions to look up an id you never chose. A live drive is
      // what caught this: with a mock store, passing the chain id straight through "works".
      const store = engine.getChainSessionStore();
      jest
        .spyOn(store, 'getSessionByChainIdentifier')
        .mockReturnValue({ sessionId: 'review-demo-1786998494932' } as never);
      const cancelChain = jest
        .spyOn(store, 'cancelChain')
        .mockResolvedValue(true as unknown as never);

      const result = await engine.executePromptCommand(
        { cancel: true, chain_id: 'chain-demo#1' },
        {}
      );

      expect(cancelChain).toHaveBeenCalledWith('review-demo-1786998494932', undefined);
      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('Chain Cancelled');
      // Cancel is not clear: the session's state survives so it can still be inspected.
      expect(result.content[0].text).toContain('retained');
    });

    test('reports a run it could not cancel rather than claiming success', async () => {
      const store = engine.getChainSessionStore();
      jest.spyOn(store, 'cancelChain').mockResolvedValue(false as unknown as never);

      const result = await engine.executePromptCommand(
        { cancel: true, chain_id: 'chain-demo#9' },
        {}
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Cancel Not Applied');
    });

    test('short-circuits before command parsing', async () => {
      const store = engine.getChainSessionStore();
      const cancelChain = jest
        .spyOn(store, 'cancelChain')
        .mockResolvedValue(true as unknown as never);

      // A command alongside cancel is ignored, not executed — cancel names an existing run rather
      // than describing one to start, so nothing about command parsing applies.
      const result = await engine.executePromptCommand(
        { cancel: true, chain_id: 'chain-demo#1', command: '>>analyze_code test' },
        {}
      );

      expect(cancelChain).toHaveBeenCalledWith('chain-demo#1', undefined);
      expect(result.content[0].text).toContain('Chain Cancelled');
    });

    test('passes no scope when the request carries none, so the store skips the scope check', async () => {
      // `undefined`, not a substituted default: `getSessionForMutation` SKIPS the scope check on
      // undefined and ENFORCES it on a value, so substituting the process workspace scope made
      // every cancel of a session without a continuityScopeId return "not applied". Found live.
      const store = engine.getChainSessionStore();
      const cancelChain = jest
        .spyOn(store, 'cancelChain')
        .mockResolvedValue(true as unknown as never);

      await engine.executePromptCommand({ cancel: true, chain_id: 'chain-demo#1' }, {});

      expect(cancelChain.mock.calls[0]?.[1]).toBeUndefined();
    });
  });

  // Framework manager integration behavior (validation + executor) now covered by dedicated
  // FrameworkValidator/FrameworkResolutionStage tests and future pipeline coverage.
});
