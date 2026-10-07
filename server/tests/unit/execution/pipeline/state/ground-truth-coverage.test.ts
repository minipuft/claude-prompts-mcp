// @lifecycle canonical - Pins the auto-clear rule moved out of GateReviewStage in Tier 13.
import { describe, expect, jest, test } from '@jest/globals';

import { resolveGroundTruthCoverage } from '../../../../../src/engine/execution/pipeline/decisions/gates/ground-truth-coverage.js';

import { ExecutionContext } from '../../../../../src/engine/execution/context/execution-context.js';
import { createSemanticReviewContext } from '../../../../../src/engine/execution/pipeline/decisions/gates/semantic-review-context.js';
import { GateReviewStage } from '../../../../../src/engine/execution/pipeline/stages/20-gate-review-stage.js';
import { ShellVerifyExecutor } from '../../../../../src/engine/gates/shell/shell-verify-executor.js';

import type { SemanticReviewDefinitionInput } from '../../../../../src/engine/execution/pipeline/decisions/gates/semantic-review-context.js';
import type { ChainOperatorExecutor } from '../../../../../src/engine/execution/operators/chain-operator-executor.js';
import type { GateDefinitionProvider } from '../../../../../src/engine/gates/core/gate-loader.js';
import type { LightweightGateDefinition } from '../../../../../src/engine/gates/types.js';
import type { Logger } from '../../../../../src/infra/logging/index.js';
import type { GateReview } from '../../../../../src/shared/types/chain-execution.js';
import type { SemanticCriterionInput } from '../../../../../src/shared/types/gate-evaluation.js';
import type {
  ChainSession,
  ChainSessionService,
} from '../../../../../src/shared/types/chain-session.js';

const TOOL_GATE: LightweightGateDefinition = {
  id: 'gate-a',
  name: 'Tool gate',
  type: 'validation',
  description: 'Tool criterion',
  pass_criteria: [{ type: 'shell_verify', shell_command: ['true'] }],
};
const SEMANTIC: SemanticCriterionInput = {
  type: 'semantic_evaluation',
  id: 'quality',
  target: { kind: 'step_output' },
  question: 'Does the output preserve the contract?',
  evidence_requirements: { min_items: 1 },
  result: { kind: 'boolean' },
  acceptance: { kind: 'equals', value: true },
};
type ReviewKind = 'tool' | 'semantic' | 'mixed' | 'reminder';

/** Honest staged draft facts; the live provider below keeps its existing tool-only union. */
function frozenReview(kind: ReviewKind) {
  const definition: SemanticReviewDefinitionInput =
    kind === 'tool'
      ? TOOL_GATE
      : {
          ...TOOL_GATE,
          pass_criteria:
            kind === 'reminder'
              ? [{ type: 'inline_guidance' }]
              : kind === 'mixed'
                ? [...(TOOL_GATE.pass_criteria ?? []), SEMANTIC]
                : [SEMANTIC],
        };
  return createSemanticReviewContext('n1', 'attempt-1', [definition]);
}

function stageFixture(kind: ReviewKind, disabled = false, legacy = false) {
  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
  const review: GateReview = {
    nodeId: 'n1',
    kind: 'gate',
    phase: 'awaiting-verdict',
    gateIds: ['gate-a'],
    combinedPrompt: 'Review',
    prompts: [],
    createdAt: 1,
    attemptCount: 0,
    maxAttempts: 3,
    ...(legacy ? {} : { semanticContext: frozenReview(kind) }),
  };
  const run = {
    sessionId: 'session-1',
    chainId: 'chain-1',
    reviews: { n1: review },
    state: { currentNodeId: 'n1', nodes: [{ id: 'n1', promptId: 'draft' }] },
  } as unknown as ChainSession;
  const store = {
    getReview: jest.fn(() => review),
    getSession: jest.fn(() => run),
    clearReview: jest.fn(async () => undefined),
    setPendingGateReview: jest.fn(async (_sessionId: string, _review: GateReview) => undefined),
    getChainContext: jest.fn(() => ({ step_results: {} })),
  };
  // Deliberately changed live catalog: semantic/mixed review snapshots retain their obligation.
  const live =
    kind === 'reminder'
      ? { ...TOOL_GATE, pass_criteria: [{ type: 'inline_guidance' as const }] }
      : TOOL_GATE;
  const provider = {
    loadGate: jest.fn(async () => live),
    loadGates: jest.fn(async () => [live]),
  } as unknown as GateDefinitionProvider;
  const renderStep = jest.fn(async () => ({
    stepNumber: 1,
    totalSteps: 1,
    promptId: 'draft',
    promptName: 'Draft',
    content: 'Review the output',
    callToAction: 'Submit verdict',
  }));
  const shell = disabled
    ? new ShellVerifyExecutor({ gateSystemEnabled: () => false })
    : ({
        execute: jest.fn(async () => ({
          passed: true,
          exitCode: 0,
          stdout: 'ok',
          stderr: '',
          durationMs: 1,
          command: 'true',
        })),
      } as unknown as ShellVerifyExecutor);
  const stage = new GateReviewStage(
    { renderStep } as unknown as ChainOperatorExecutor,
    store as unknown as ChainSessionService,
    provider,
    logger,
    undefined,
    { shellVerifyExecutor: shell }
  );
  const context = new ExecutionContext({ command: '>>draft' }, logger);
  context.parsedCommand = {
    commandType: 'chain',
    promptId: 'draft',
    rawArgs: '',
    format: 'symbolic',
    confidence: 1,
    metadata: {
      originalCommand: '>>draft',
      parseStrategy: 'fixture',
      detectedFormat: 'symbolic',
      warnings: [],
    },
    steps: [{ stepNumber: 1, nodeId: 'n1', promptId: 'draft', args: {} }],
    promptArgs: {},
  };
  context.sessionContext = {
    sessionId: 'session-1',
    chainId: 'chain-1',
    currentStep: 1,
    currentNodeId: 'n1',
    isChainExecution: true,
    pendingReview: review,
  };
  return { stage, context, store, renderStep, review };
}

const pass = (gateId: string) => ({ gateId, passed: true });
const fail = (gateId: string) => ({ gateId, passed: false });

/**
 * This decides whether a pending gate review is cleared without any LLM evaluation, so the
 * cases that matter most are the ones where it must refuse. A false `satisfied` costs one
 * redundant review; a false `true` marks unverified gates as passed and lets the chain
 * advance past them.
 */
describe('resolveGroundTruthCoverage', () => {
  test('clears the review when every required gate passed', () => {
    const coverage = resolveGroundTruthCoverage({
      requiredGateIds: ['tests', 'lint'],
      results: [pass('tests'), pass('lint')],
    });

    expect(coverage.satisfied).toBe(true);
    expect(coverage.verifiedGateIds).toEqual(['tests', 'lint']);
  });

  test('refuses when a required gate ran nothing — a passing sibling does not speak for it', () => {
    const coverage = resolveGroundTruthCoverage({
      requiredGateIds: ['tests', 'code-quality'],
      results: [pass('tests')],
    });

    expect(coverage.satisfied).toBe(false);
    expect(coverage.reason).toContain('code-quality');
  });

  test('refuses when any verification failed, even if coverage is complete', () => {
    const coverage = resolveGroundTruthCoverage({
      requiredGateIds: ['tests', 'lint'],
      results: [pass('tests'), fail('lint')],
    });

    expect(coverage.satisfied).toBe(false);
    expect(coverage.reason).toContain('lint');
  });

  test('refuses when no shell_verify criteria ran at all', () => {
    const coverage = resolveGroundTruthCoverage({
      requiredGateIds: ['tests'],
      results: [],
    });

    expect(coverage.satisfied).toBe(false);
    expect(coverage.verifiedGateIds).toEqual([]);
  });

  test('counts a gate an earlier stage already verified in this request', () => {
    // ShellVerificationStage (17) writes state.gates.shellVerifyPassedForGates; the review
    // stage passes it through so a gate verified there is not re-run here to be honoured.
    const coverage = resolveGroundTruthCoverage({
      requiredGateIds: ['tests', 'test-suite'],
      results: [pass('tests')],
      priorVerifiedGateIds: ['test-suite'],
    });

    expect(coverage.satisfied).toBe(true);
    expect(coverage.verifiedGateIds).toEqual(['tests', 'test-suite']);
  });

  test('prior verification alone does not clear a review with no results this run', () => {
    const coverage = resolveGroundTruthCoverage({
      requiredGateIds: ['test-suite'],
      results: [],
      priorVerifiedGateIds: ['test-suite'],
    });

    expect(coverage.satisfied).toBe(false);
    expect(coverage.verifiedGateIds).toEqual(['test-suite']);
  });

  test('deduplicates gates that produced several results', () => {
    const coverage = resolveGroundTruthCoverage({
      requiredGateIds: ['tests'],
      results: [pass('tests'), pass('tests')],
      priorVerifiedGateIds: ['tests'],
    });

    expect(coverage.satisfied).toBe(true);
    expect(coverage.verifiedGateIds).toEqual(['tests']);
  });

  test('reports every failing gate once, not once per result', () => {
    const coverage = resolveGroundTruthCoverage({
      requiredGateIds: ['tests'],
      results: [fail('tests'), fail('tests')],
    });

    expect(coverage.reason).toBe('Ground-truth verification failed for tests');
  });

  test.each(['semantic', 'mixed'] as const)(
    'a passed tool result cannot satisfy frozen %s criteria on the same gate',
    (kind) => {
      const issued = frozenReview(kind);
      const before = structuredClone(issued);
      const coverage = resolveGroundTruthCoverage({
        requiredGateIds: ['gate-a'],
        reviewDefinitions: issued.definitions,
        results: [pass('gate-a')],
      });
      expect(coverage.satisfied).toBe(false);
      expect(coverage.reason).toContain('semantic reports');
      expect(issued).toEqual(before);
    }
  );

  test('a passed sibling and prior tool coverage cannot satisfy a frozen semantic gate', () => {
    const issued = frozenReview('semantic');
    const coverage = resolveGroundTruthCoverage({
      requiredGateIds: ['gate-a', 'tool-sibling'],
      reviewDefinitions: issued.definitions,
      results: [pass('tool-sibling')],
      priorVerifiedGateIds: ['gate-a'],
    });
    expect(coverage.satisfied).toBe(false);
    expect(coverage.reason).toContain('gate-a');
  });

  test('complete frozen tool-only coverage still clears', () => {
    expect(
      resolveGroundTruthCoverage({
        requiredGateIds: ['gate-a'],
        reviewDefinitions: frozenReview('tool').definitions,
        results: [pass('gate-a')],
      }).satisfied
    ).toBe(true);
  });

  test('a frozen reminder remains uncovered by its passing tool sibling', () => {
    const coverage = resolveGroundTruthCoverage({
      requiredGateIds: ['gate-a', 'tool-sibling'],
      reviewDefinitions: frozenReview('reminder').definitions,
      results: [pass('tool-sibling')],
    });
    expect(coverage.satisfied).toBe(false);
    expect(coverage.reason).toContain('does not cover gate-a');
  });

  test('an empty requirement list is vacuously covered once something passed', () => {
    // Unreachable from GateReviewStage, which only runs verifications when the pending
    // review has gate ids. Pinned so the vacuous-truth edge is a decision, not an accident.
    const coverage = resolveGroundTruthCoverage({
      requiredGateIds: [],
      results: [pass('tests')],
    });

    expect(coverage.satisfied).toBe(true);
  });
});

describe('GateReviewStage frozen coverage caller', () => {
  test.each(['tool', 'semantic', 'mixed', 'reminder'] as const)(
    'actual stage consumes frozen %s facts rather than the changed live catalog',
    async (kind) => {
      const fixture = stageFixture(kind);
      const issued = fixture.review.semanticContext;
      await fixture.stage.execute(fixture.context);
      if (kind === 'tool') {
        expect(fixture.store.clearReview).toHaveBeenCalledTimes(1);
        expect(fixture.context.executionResults?.metadata?.gateReview).toMatchObject({
          autoCleared: true,
        });
        expect(fixture.renderStep).not.toHaveBeenCalled();
      } else {
        expect(fixture.store.clearReview).not.toHaveBeenCalled();
        expect(fixture.renderStep).toHaveBeenCalledTimes(1);
        expect(fixture.store.setPendingGateReview.mock.calls[0]?.[1]?.semanticContext).toBe(issued);
        expect(fixture.context.executionResults?.metadata?.gateReview).not.toHaveProperty(
          'autoCleared'
        );
      }
    }
  );

  test('disabled gate execution cannot auto-clear a tool-only review', async () => {
    const fixture = stageFixture('tool', true);
    await fixture.stage.execute(fixture.context);
    expect(fixture.store.clearReview).not.toHaveBeenCalled();
    expect(fixture.renderStep).toHaveBeenCalledTimes(1);
    expect(fixture.context.sessionContext?.pendingReview?.checkResults?.[0]?.passed).toBe(false);
  });

  test('legacy tool-only review without issued context preserves auto-clear', async () => {
    const fixture = stageFixture('tool', false, true);
    await fixture.stage.execute(fixture.context);
    expect(fixture.store.clearReview).toHaveBeenCalledTimes(1);
  });
});
