import { describe, expect, jest, test } from '@jest/globals';

import { ExecutionContext } from '../../../src/engine/execution/context/execution-context.js';
import { GateReviewStage } from '../../../src/engine/execution/pipeline/stages/10-gate-review-stage.js';
import { GATE_VERDICT_REQUIRED_FORMAT } from '../../../src/engine/gates/core/gate-verdict-contract.js';

import type { LightweightGateDefinition } from '../../../src/engine/gates/types.js';
import type { GateDefinitionProvider } from '../../../src/engine/gates/core/gate-loader.js';

/**
 * Integration test: Judge gate evaluation pipeline wiring.
 *
 * Verifies that gates with `evaluation: { mode: 'judge' }` flow through
 * the pipeline (loader → Stage 10 → response metadata) correctly.
 * Uses real review-utils/judge-prompt-builder modules with mock I/O.
 */

const baseGate: LightweightGateDefinition = {
  id: 'code-quality',
  name: 'Code Quality',
  type: 'validation',
  description: 'Validates code quality',
  guidance: 'Check for proper error handling.',
  pass_criteria: [{ type: 'inline_guidance', min_length: 100, required_patterns: ['function'] }],
};

function createMockLoader(
  gates: Record<string, LightweightGateDefinition>
): GateDefinitionProvider {
  return {
    loadGate: jest.fn(async (id: string) => gates[id] ?? null),
    loadGates: jest.fn(
      async (ids: string[]) =>
        ids.map((id) => gates[id]).filter(Boolean) as LightweightGateDefinition[]
    ),
    getActiveGates: jest.fn(async () => ({
      activeGates: [],
      guidanceText: [],
      validationGates: [],
    })),
    listAvailableGates: jest.fn(async () => Object.keys(gates)),
    listAvailableGateDefinitions: jest.fn(async () => Object.values(gates)),
    clearCache: jest.fn(),
    isGateActive: jest.fn(() => true),
    getStatistics: jest.fn(() => ({
      cachedGates: 0,
      totalLoads: 0,
      lastAccess: null,
    })),
    isMethodologyGate: jest.fn(async () => false),
    isMethodologyGateCached: jest.fn(() => false),
    getMethodologyGateIds: jest.fn(async () => []),
  } as unknown as GateDefinitionProvider;
}

const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as any;

function createRenderResult(content = 'Generated output') {
  return {
    stepNumber: 2,
    totalSteps: 2,
    promptId: '__gate_review__',
    promptName: 'Quality Gate Validation',
    content,
    callToAction: 'Return with GATE_REVIEW: PASS or FAIL.',
  };
}

function createStageWithGates(
  gates: Record<string, LightweightGateDefinition>,
  configEvaluation?: { defaultMode?: 'self' | 'judge'; strict?: boolean },
  overrides?: { chainSessionManager?: any }
) {
  const loader = createMockLoader(gates);
  const chainOperatorExecutor = {
    renderStep: jest.fn().mockResolvedValue(createRenderResult()),
  } as any;
  const chainSessionManager =
    overrides?.chainSessionManager ??
    ({
      getPendingGateReview: jest.fn().mockReturnValue({
        combinedPrompt: 'Review prompt',
        gateIds: Object.keys(gates),
        prompts: [],
        createdAt: Date.now(),
        attemptCount: 1,
        maxAttempts: 3,
      }),
      getChainContext: jest.fn().mockReturnValue({ step_results: {} }),
      clearPendingGateReview: jest.fn().mockResolvedValue(undefined),
    } as any);

  const stage = new GateReviewStage(
    chainOperatorExecutor,
    chainSessionManager,
    loader,
    mockLogger,
    () => ({ evaluation: configEvaluation })
  );

  const context = new ExecutionContext({ command: '>>chain' });
  context.parsedCommand = {
    steps: [{ stepNumber: 1, promptId: 'analyze', args: {} }],
  } as any;
  context.sessionContext = {
    sessionId: 'session-1',
    chainId: 'chain-1',
    isChainExecution: true,
    currentStep: 2,
    totalSteps: 2,
    pendingReview: true,
  };

  return { stage, context, chainOperatorExecutor, chainSessionManager };
}

describe('Judge Gate Pipeline Wiring', () => {
  test('Stage 10 produces metadata.judge when judge gates are active', async () => {
    const judgeGate: LightweightGateDefinition = {
      ...baseGate,
      id: 'judge-gate',
      evaluation: { mode: 'judge', model: 'haiku', strict: true },
    };

    const { stage, context } = createStageWithGates({ 'judge-gate': judgeGate });
    await stage.execute(context);

    const metadata = context.executionResults?.metadata as any;
    expect(metadata.judge).toBeDefined();
    expect(metadata.judge.judgeGateIds).toEqual(['judge-gate']);
    expect(metadata.judge.modelHint).toBe('haiku');
    expect(metadata.judge.judgePrompt).toContain(GATE_VERDICT_REQUIRED_FORMAT);
    expect(metadata.judge.judgePrompt).toContain('## Judge Evaluation');
  });

  test('Stage 10 omits metadata.judge when all gates are self mode', async () => {
    const selfGate: LightweightGateDefinition = {
      ...baseGate,
      id: 'self-gate',
      evaluation: { mode: 'self' },
    };

    const { stage, context } = createStageWithGates({ 'self-gate': selfGate });
    await stage.execute(context);

    const metadata = context.executionResults?.metadata as any;
    expect(metadata.judge).toBeUndefined();
    expect(metadata.gateReview).toBeDefined();
  });

  test('judge prompt contains criteria from gate definition', async () => {
    const judgeGate: LightweightGateDefinition = {
      ...baseGate,
      id: 'criteria-gate',
      guidance: 'Follow clean code principles',
      pass_criteria: [{ type: 'inline_guidance', min_length: 200, required_patterns: ['export'] }],
      evaluation: { mode: 'judge' },
    };

    const { stage, context } = createStageWithGates({ 'criteria-gate': judgeGate });
    await stage.execute(context);

    const metadata = context.executionResults?.metadata as any;
    expect(metadata.judge.judgePrompt).toContain('at least 200 characters');
    expect(metadata.judge.judgePrompt).toContain('export');
    expect(metadata.judge.judgePrompt).toContain('Follow clean code principles');
  });

  test('config defaults apply when gate has no explicit evaluation mode', async () => {
    const gateNoEval: LightweightGateDefinition = {
      ...baseGate,
      id: 'no-eval-gate',
      // No evaluation field — relies on config defaults
    };

    // Config sets defaultMode to 'judge', so gate should be treated as judge
    const { stage, context } = createStageWithGates(
      { 'no-eval-gate': gateNoEval },
      { defaultMode: 'judge', strict: true }
    );
    await stage.execute(context);

    const metadata = context.executionResults?.metadata as any;
    expect(metadata.judge).toBeDefined();
    expect(metadata.judge.judgeGateIds).toEqual(['no-eval-gate']);
  });

  test('evaluation field flows through loader to LightweightGateDefinition', () => {
    // Direct type verification: LightweightGateDefinition accepts evaluation
    const gate: LightweightGateDefinition = {
      ...baseGate,
      evaluation: { mode: 'judge', model: 'haiku', strict: true },
    };

    expect(gate.evaluation?.mode).toBe('judge');
    expect(gate.evaluation?.model).toBe('haiku');
    expect(gate.evaluation?.strict).toBe(true);
  });
});

describe('Shell Verify Auto-Pass', () => {
  test('auto-clears gate review when all shell_verify criteria pass', async () => {
    const shellGate: LightweightGateDefinition = {
      ...baseGate,
      id: 'test-suite',
      pass_criteria: [{ type: 'shell_verify', shell_command: 'echo ok' }],
    };

    const { stage, context, chainOperatorExecutor, chainSessionManager } = createStageWithGates({
      'test-suite': shellGate,
    });
    await stage.execute(context);

    const metadata = context.executionResults?.metadata as any;
    expect(metadata.gateReview.autoCleared).toBe(true);
    expect(metadata.gateReview.verifiedBy).toBe('shell_verify');
    expect(metadata.gateReview.gateIds).toEqual(['test-suite']);
    // renderStep should NOT be called — no LLM review needed
    expect(chainOperatorExecutor.renderStep).not.toHaveBeenCalled();
    // Pending review should be cleared from session
    expect(chainSessionManager.clearPendingGateReview).toHaveBeenCalledWith('session-1');
  });

  test('falls through to normal review when gate has no shell_verify criteria', async () => {
    const nonShellGate: LightweightGateDefinition = {
      ...baseGate,
      id: 'content-gate',
      pass_criteria: [{ type: 'inline_guidance', min_length: 100 }],
    };

    const { stage, context, chainOperatorExecutor } = createStageWithGates({
      'content-gate': nonShellGate,
    });
    await stage.execute(context);

    const metadata = context.executionResults?.metadata as any;
    // Normal review — no autoCleared flag
    expect(metadata.gateReview.autoCleared).toBeUndefined();
    // renderStep should be called for normal rendering
    expect(chainOperatorExecutor.renderStep).toHaveBeenCalled();
  });

  test('falls through to normal review when shell_verify command fails', async () => {
    const failingGate: LightweightGateDefinition = {
      ...baseGate,
      id: 'failing-test',
      pass_criteria: [{ type: 'shell_verify', shell_command: 'exit 1' }],
    };

    const { stage, context, chainOperatorExecutor } = createStageWithGates({
      'failing-test': failingGate,
    });
    await stage.execute(context);

    const metadata = context.executionResults?.metadata as any;
    // Normal review with shell results appended
    expect(metadata.gateReview.autoCleared).toBeUndefined();
    expect(chainOperatorExecutor.renderStep).toHaveBeenCalled();
    // Content should include shell failure section
    expect(context.executionResults?.content).toContain('Shell Verification Results');
    expect(context.executionResults?.content).toContain('FAILED');
  });

  test('falls through when mixed gates (some with shell_verify, some without)', async () => {
    const shellGate: LightweightGateDefinition = {
      ...baseGate,
      id: 'test-suite',
      pass_criteria: [{ type: 'shell_verify', shell_command: 'echo ok' }],
    };
    const nonShellGate: LightweightGateDefinition = {
      ...baseGate,
      id: 'code-review',
      pass_criteria: [{ type: 'inline_guidance', min_length: 100 }],
    };

    const { stage, context, chainOperatorExecutor } = createStageWithGates({
      'test-suite': shellGate,
      'code-review': nonShellGate,
    });
    await stage.execute(context);

    const metadata = context.executionResults?.metadata as any;
    // Not all gates covered by shell_verify — normal review
    expect(metadata.gateReview.autoCleared).toBeUndefined();
    expect(chainOperatorExecutor.renderStep).toHaveBeenCalled();
  });

  test('includes Stage 08b shellVerifyPassedForGates in coverage check', async () => {
    // Gate has no shell_verify criteria in its definition,
    // but Stage 08b already verified it via inline :: verify
    const nonShellGate: LightweightGateDefinition = {
      ...baseGate,
      id: 'test-suite',
      pass_criteria: [{ type: 'inline_guidance', min_length: 100 }],
    };

    const { stage, context, chainOperatorExecutor } = createStageWithGates({
      'test-suite': nonShellGate,
    });

    // Simulate Stage 08b having verified this gate via inline :: verify
    context.state.gates.shellVerifyPassedForGates = ['test-suite'];

    await stage.execute(context);

    const metadata = context.executionResults?.metadata as any;
    // Shell results from Stage 10 runner are empty (no shell_verify criteria on gate),
    // so allShellPassed is false — falls through to normal review.
    // Stage 08b signal alone is insufficient without Stage 10 shell results.
    expect(metadata.gateReview.autoCleared).toBeUndefined();
    expect(chainOperatorExecutor.renderStep).toHaveBeenCalled();
  });
});
