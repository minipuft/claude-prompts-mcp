// @lifecycle canonical - Pins the auto-clear rule moved out of GateReviewStage in Tier 13.
import { describe, expect, jest, test } from '@jest/globals';

import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { resolveGroundTruthCoverage } from '../../../../../src/engine/execution/pipeline/decisions/gates/ground-truth-coverage.js';
import {
  composeStructuralReview,
  hasStructuralFinding,
  PHASE_GUARD_GATE_ID,
  selectToolReviewGateIds,
} from '../../../../../src/engine/execution/pipeline/decisions/gates/structural-review-composition.js';

import { ExecutionContext } from '../../../../../src/engine/execution/context/execution-context.js';
import { GateEnforcementAuthority } from '../../../../../src/engine/execution/pipeline/decisions/gates/gate-enforcement-authority.js';
import {
  bindSemanticReviewTarget,
  resolvePinnedSemanticContext,
  createSemanticReviewContext,
} from '../../../../../src/engine/execution/pipeline/decisions/gates/semantic-review-context.js';
import { GateReviewStage } from '../../../../../src/engine/execution/pipeline/stages/20-gate-review-stage.js';
import { evaluateSemanticEvaluation } from '../../../../../src/engine/gates/core/semantic-evaluation.js';
import { GateVerdictProcessor } from '../../../../../src/engine/gates/services/gate-verdict-processor.js';
import { runGateReviewEvidence } from '../../../../../src/engine/gates/services/gate-review-evidence.js';
import { ShellVerifyExecutor } from '../../../../../src/engine/gates/shell/shell-verify-executor.js';

import type { SemanticReviewDefinitionInput } from '../../../../../src/engine/execution/pipeline/decisions/gates/semantic-review-context.js';
import type { ChainOperatorExecutor } from '../../../../../src/engine/execution/operators/chain-operator-executor.js';
import type { GateDefinitionProvider } from '../../../../../src/engine/gates/core/gate-loader.js';
import type { LightweightGateDefinition } from '../../../../../src/engine/gates/types.js';
import type { Logger } from '../../../../../src/infra/logging/index.js';
import type { GateReview } from '../../../../../src/shared/types/chain-execution.js';
import type { SemanticCriterionInput } from '../../../../../src/shared/types/gate-evaluation.js';
import type {
  GateVerdictSubmission,
  SemanticEvaluationReport,
} from '../../../../../src/shared/types/gate-evaluation.js';
import type {
  ChainSession,
  ChainSessionService,
} from '../../../../../src/shared/types/chain-session.js';

import type { ScriptToolRuntime } from '../../../../../src/engine/gates/services/script-tool-criterion-runner.js';
import type { LoadedScriptTool } from '../../../../../src/shared/types/automation.js';
import type { ScriptExecutorPort } from '../../../../../src/shared/types/index.js';
import type { ScriptLoader } from '../../../../../src/engine/execution/reference/script-reference-resolver.js';

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

interface StageFixtureOptions {
  review?: GateReview;
  live?: LightweightGateDefinition[];
  shell?: ShellVerifyExecutor;
  body?: string;
}

function stageFixture(
  kind: ReviewKind,
  disabled = false,
  legacy = false,
  options: StageFixtureOptions = {}
) {
  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
  const review: GateReview = options.review ?? {
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
    getReview: jest.fn(() => run.reviews?.['n1'] ?? review),
    getSession: jest.fn(() => run),
    clearReview: jest.fn(async () => undefined),
    setPendingGateReview: jest.fn(async (_sessionId: string, stored: GateReview) => {
      run.reviews = { ...run.reviews, [stored.nodeId]: stored };
    }),
    setReview: jest.fn(async (_sessionId: string, stored: GateReview) => {
      run.reviews = { ...run.reviews, [stored.nodeId]: stored };
    }),
    recordGateReviewOutcome: jest.fn(async () => undefined),
    advanceStep: jest.fn(async () => false),
    isStepComplete: jest.fn(() => true),
    getChainContext: jest.fn(() => ({ step_results: {} })),
  };
  // Deliberately changed live catalog: semantic/mixed review snapshots retain their obligation.
  const live =
    kind === 'reminder'
      ? { ...TOOL_GATE, pass_criteria: [{ type: 'inline_guidance' as const }] }
      : TOOL_GATE;
  const liveGates = options.live ?? [live];
  const provider = {
    loadGate: jest.fn(async (id: string) => liveGates.find((gate) => gate.id === id) ?? null),
    loadGates: jest.fn(async (ids: string[]) => liveGates.filter((gate) => ids.includes(gate.id))),
  } as unknown as GateDefinitionProvider;
  const renderStep = jest.fn(async () => ({
    stepNumber: 1,
    totalSteps: 1,
    promptId: 'draft',
    promptName: 'Draft',
    content: 'Review the output',
    callToAction: 'Submit verdict',
  }));
  const shell =
    options.shell ??
    (disabled
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
        } as unknown as ShellVerifyExecutor));
  const stage = new GateReviewStage(
    { renderStep } as unknown as ChainOperatorExecutor,
    store as unknown as ChainSessionService,
    provider,
    logger,
    undefined,
    { shellVerifyExecutor: shell }
  );
  const context = new ExecutionContext(
    { command: '>>draft', ...(options.body !== undefined ? { user_response: options.body } : {}) },
    logger
  );
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
  return { stage, context, store, renderStep, review, run, provider, logger };
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
  test.each([undefined, false])(
    'omitted/false structural pending fact %j preserves ordinary tool success',
    (structuralPending) => {
      const input = { requiredGateIds: ['tests'], results: [pass('tests')] };
      const withFact = structuralPending === undefined ? input : { ...input, structuralPending };
      expect(resolveGroundTruthCoverage(withFact)).toEqual({
        satisfied: true,
        verifiedGateIds: ['tests'],
        reason: 'Every required gate passed ground-truth verification',
      });
    }
  );

  test('actual authored canonical collision plus passing tool remains structurally held without falsifying tool facts', async () => {
    const gate: LightweightGateDefinition = { ...TOOL_GATE, id: PHASE_GUARD_GATE_ID };
    const review: GateReview = {
      nodeId: 'n1',
      kind: 'detached',
      phase: 'awaiting-verdict',
      gateIds: [PHASE_GUARD_GATE_ID],
      prompts: [],
      combinedPrompt: 'Authored criterion',
      createdAt: 1,
      attemptCount: 2,
      maxAttempts: 5,
      metadata: { source: 'worker-report' },
      semanticContext: createSemanticReviewContext('n1', 'attempt-1', [gate]),
    };
    const pending = composeStructuralReview(review, {
      gateId: PHASE_GUARD_GATE_ID,
      feedback: 'Missing required section',
      retryHints: ['Add context'],
      failedPhases: ['context'],
      mode: 'enforce',
      previousResponse: 'one line',
      reviewedStep: { nodeId: 'n1', stepNumber: 1 },
      maxAttempts: 3,
      createdAt: 42,
    });
    const before = structuredClone(pending);
    const provider = evidenceProvider([gate]);
    const executor = new ShellVerifyExecutor({ allowlist: ['true'] });
    const executed = jest.spyOn(executor, 'execute');
    const evidence = await runGateReviewEvidence(
      selectToolReviewGateIds(pending),
      provider.provider,
      'one line',
      { shellVerifyExecutor: executor },
      undefined,
      pending.semanticContext?.definitions
    );
    expect(executed).toHaveBeenCalledTimes(1);
    expect(evidence.checkResults).toMatchObject([{ gateId: PHASE_GUARD_GATE_ID, passed: true }]);
    const facts = structuredClone(evidence.checkResults);
    const input = {
      requiredGateIds: pending.gateIds,
      reviewDefinitions: pending.semanticContext?.definitions,
      results: evidence.checkResults,
    };
    const held = resolveGroundTruthCoverage({
      ...input,
      structuralPending: hasStructuralFinding(pending),
    });
    expect(held.satisfied).toBe(false);
    expect(held.reason).toContain('Structural verification is still pending');
    expect(held.reason).not.toContain('failed');
    expect(held.verifiedGateIds).toEqual([PHASE_GUARD_GATE_ID]);
    expect(pending.gateIds).toEqual([PHASE_GUARD_GATE_ID]);
    expect(evidence.checkResults).toEqual(facts);
    expect(pending).toEqual(before);
    // Same actual tool evidence without a structural marker still satisfies the authored gate.
    expect(
      resolveGroundTruthCoverage({ ...input, structuralPending: hasStructuralFinding(review) })
        .satisfied
    ).toBe(true);
  });

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

/** Only provider/registered-script I/O is substituted; shell false/true controls use the real executor. */
function evidenceProvider(gates: LightweightGateDefinition[]) {
  const loadGates = jest.fn<GateDefinitionProvider['loadGates']>(async () => gates);
  const provider = {
    loadGate: async (id: string) => gates.find((gate) => gate.id === id) ?? null,
    loadGates,
  } as unknown as GateDefinitionProvider;
  return { provider, loadGates };
}

function scriptRuntime() {
  const loadScript = jest.fn<ScriptLoader['loadScript']>(
    (id) =>
      ({
        id,
        name: id,
        description: 'Registered fixture',
        scriptPath: 'script.py',
        inputSchema: { type: 'object' },
        execution: { trigger: 'schema_match', confirm: false },
        toolDir: '/fixture',
        absoluteScriptPath: '/fixture/script.py',
        promptId: 'draft',
        descriptionContent: 'Fixture',
      }) satisfies LoadedScriptTool
  );
  const execute = jest.fn<ScriptExecutorPort['execute']>(async () => ({
    success: true,
    output: { passed: true, reason: 'Fixture result' },
    stdout: '',
    stderr: '',
    exitCode: 0,
    durationMs: 1,
  }));
  const runtime: ScriptToolRuntime = {
    loader: { loadScript } as unknown as ScriptLoader,
    executor: { execute },
  };
  return { runtime, loadScript, execute };
}

const FALSE_GATE: LightweightGateDefinition = {
  ...TOOL_GATE,
  pass_criteria: [{ type: 'shell_verify', shell_command: ['false'] }],
};

function issuedToolReview(gates: SemanticReviewDefinitionInput[]): GateReview {
  return {
    nodeId: 'n1',
    kind: 'gate',
    phase: 'awaiting-verdict',
    gateIds: gates.map((gate) => gate.id),
    combinedPrompt: 'Review frozen output',
    prompts: [],
    createdAt: 1,
    attemptCount: 0,
    maxAttempts: 3,
    semanticContext: bindSemanticReviewTarget(
      createSemanticReviewContext('n1', 'attempt-1', gates),
      'Actual output'
    ),
  };
}

describe('ordinary frozen tool evidence caller and legacy response I/O', () => {
  test.each([false, true])(
    'changed false→true holds with prior/sibling passes (semantic=%j)',
    async (semantic) => {
      const sibling = { ...TOOL_GATE, id: 'sibling' };
      const review = issuedToolReview([
        {
          ...FALSE_GATE,
          pass_criteria: [...(FALSE_GATE.pass_criteria ?? []), ...(semantic ? [SEMANTIC] : [])],
        },
        sibling,
      ]);
      const executor = new ShellVerifyExecutor({ allowlist: ['false', 'true'] });
      const executed = jest.spyOn(executor, 'execute');
      const f = stageFixture('tool', false, false, {
        review,
        live: [TOOL_GATE, sibling],
        shell: executor,
      });
      f.context.state.gates.shellVerifyPassedForGates = ['gate-a'];
      await f.stage.execute(f.context);
      expect(executed.mock.calls.map(([gate]) => gate.command)).toEqual([['true']]);
      expect(f.store.clearReview).not.toHaveBeenCalled();
      const held = f.run.reviews?.['n1'];
      expect(held?.checkResults?.filter((result) => result.gateId === 'gate-a')).toMatchObject([
        { gateId: 'gate-a', passed: false, summary: expect.stringContaining('did not run') },
      ]);
      if (semantic && held?.semanticContext !== undefined) {
        const expected = resolvePinnedSemanticContext(held.semanticContext, 'gate-a');
        const report: SemanticEvaluationReport = {
          binding: expected.binding,
          observations: [
            {
              criterion_id: 'quality',
              state: 'met',
              value: true,
              evidence: [
                {
                  target_digest: expected.binding.target_digest,
                  start: 0,
                  end: 6,
                  quote: 'Actual',
                },
              ],
              rationale: 'Complete evidence',
            },
          ],
        };
        expect(evaluateSemanticEvaluation(expected, report).passed).toBe(true);
        const verdict: GateVerdictSubmission = {
          overall: 'PASS',
          rationale: 'Valid semantic report',
          per_gate: [{ index: 1, passed: true, rationale: 'Met', evaluation: report }],
        };
        const context = new ExecutionContext(
          { chain_id: 'chain-1', gate_verdict: verdict },
          f.logger
        );
        context.gateEnforcement = new GateEnforcementAuthority(
          f.store as unknown as ChainSessionService,
          f.logger
        );
        context.sessionContext = f.context.sessionContext;
        context.state.gates.enforcementMode = 'blocking';
        const result = await new GateVerdictProcessor(
          f.store as unknown as ChainSessionService,
          f.logger
        ).processReviewVerdict(context, f.run, context.sessionContext!, 'Actual output');
        expect(result.passClearedThisCall).toBe(false);
        expect(context.response?.content[0]).toMatchObject({
          text: expect.stringContaining('did not run'),
        });
        expect(f.store.clearReview).not.toHaveBeenCalled();
        expect(f.store.recordGateReviewOutcome).not.toHaveBeenCalled();
      }
    }
  );

  test.each([false, true])(
    'unchanged real tool command pass=%j records the actual exit',
    async (passed) => {
      const gate = passed ? TOOL_GATE : FALSE_GATE;
      const executor = new ShellVerifyExecutor({ allowlist: ['false', 'true'] });
      const executed = jest.spyOn(executor, 'execute');
      const f = stageFixture('tool', false, false, {
        review: issuedToolReview([gate]),
        live: [gate],
        shell: executor,
      });
      await f.stage.execute(f.context);
      expect(executed).toHaveBeenCalledTimes(1);
      if (passed) expect(f.store.clearReview).toHaveBeenCalledTimes(1);
      else {
        expect(f.store.clearReview).not.toHaveBeenCalled();
        expect(f.run.reviews?.['n1']?.checkResults).toMatchObject([{ passed: false }]);
      }
    }
  );

  test('missing issued definition cannot run a real required gate or be cleared by a prior ID', async () => {
    const review = issuedToolReview([]);
    review.gateIds = ['gate-a'];
    const executor = new ShellVerifyExecutor({ allowlist: ['true'] });
    const executed = jest.spyOn(executor, 'execute');
    const f = stageFixture('tool', false, false, { review, live: [TOOL_GATE], shell: executor });
    f.context.state.gates.shellVerifyPassedForGates = ['gate-a'];
    await f.stage.execute(f.context);
    expect(executed).not.toHaveBeenCalled();
    expect(f.store.clearReview).not.toHaveBeenCalled();
    expect(f.run.reviews?.['n1']?.checkResults).toMatchObject([
      { gateId: 'gate-a', passed: false },
    ]);
  });

  test.each(['plain', 'mixed', 'authored-collision'] as const)(
    '%s structural route keeps its full hold',
    async (kind) => {
      const gate = { ...TOOL_GATE, id: PHASE_GUARD_GATE_ID };
      const base =
        kind === 'authored-collision'
          ? issuedToolReview([gate])
          : issuedToolReview(kind === 'mixed' ? [TOOL_GATE] : []);
      const composed = composeStructuralReview(base.gateIds.length ? base : undefined, {
        gateId: PHASE_GUARD_GATE_ID,
        feedback: 'Missing context',
        retryHints: [],
        failedPhases: ['context'],
        mode: 'enforce',
        previousResponse: 'Actual output',
        reviewedStep: { nodeId: 'n1', stepNumber: 1 },
        maxAttempts: 3,
        createdAt: 42,
      });
      const review = {
        ...base,
        ...composed,
        nodeId: 'n1',
        kind: 'gate' as const,
        phase: 'awaiting-verdict' as const,
      };
      const executor = new ShellVerifyExecutor({ allowlist: ['true'] });
      const executed = jest.spyOn(executor, 'execute');
      const f = stageFixture('tool', false, false, {
        review,
        live: kind === 'authored-collision' ? [gate] : [TOOL_GATE],
        shell: executor,
      });
      await f.stage.execute(f.context);
      expect(f.provider.loadGates).toHaveBeenNthCalledWith(1, selectToolReviewGateIds(review));
      expect(executed.mock.calls.map(([entry]) => entry.command)).toEqual(
        kind === 'plain' ? [] : [['true']]
      );
      expect(f.store.clearReview).not.toHaveBeenCalled();
      expect(f.run.reviews?.['n1']?.gateIds).toEqual(review.gateIds);
      expect(f.run.reviews?.['n1']?.structuralGateIds).toEqual([PHASE_GUARD_GATE_ID]);
    }
  );

  test.each(['', 'Payload 😀'])(
    'legacy ordinary response %j maps only tool I/O and preserves carrier',
    async (body) => {
      const root = await mkdtemp(path.join(tmpdir(), 'stage-response-'));
      try {
        const script = path.join(root, 'observe.cjs');
        const key = `REVIEW_BODY_${path.basename(root).replace(/-/g, '_')}`;
        await writeFile(
          script,
          `let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>console.log(JSON.stringify({stdin:input,hasEnv:Object.hasOwn(process.env,${JSON.stringify(key)}),body:process.env[${JSON.stringify(key)}]})));`
        );
        const gate: LightweightGateDefinition = {
          ...TOOL_GATE,
          pass_criteria: [
            {
              type: 'shell_verify',
              shell_command: ['node', script],
              shell_stdin_source: 'agent_response',
              shell_response_env_var: key,
            },
          ],
        };
        const executor = new ShellVerifyExecutor({ allowlist: [`node ${script}`] });
        const executed = jest.spyOn(executor, 'execute');
        const f = stageFixture('tool', false, true, { live: [gate], shell: executor, body });
        await f.stage.execute(f.context);
        expect(executed).toHaveBeenCalledTimes(1);
        expect(executed.mock.calls[0][0].stdin).toBe(body === '' ? undefined : body);
        expect(executed.mock.calls[0][0].env?.[key]).toBe(body === '' ? undefined : body);
        const result = (await executed.mock.results[0].value) as Awaited<
          ReturnType<ShellVerifyExecutor['execute']>
        >;
        expect(JSON.parse(result.stdout)).toEqual(
          body === '' ? { stdin: '', hasEnv: false } : { stdin: body, hasEnv: true, body }
        );
        expect(f.context.mcpRequest.user_response).toBe(body);
        expect(f.store.clearReview).toHaveBeenCalledTimes(1);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  );
});

describe('checked declared tool identity in the existing evidence owner', () => {
  test('live true cannot verify frozen false even with a valid met semantic report', async () => {
    const issued = bindSemanticReviewTarget(
      createSemanticReviewContext('n1', 'attempt-1', [
        { ...FALSE_GATE, pass_criteria: [...(FALSE_GATE.pass_criteria ?? []), SEMANTIC] },
      ]),
      'Actual output'
    );
    const expected = resolvePinnedSemanticContext(issued, 'gate-a');
    const report = {
      binding: expected.binding,
      observations: [
        {
          criterion_id: 'quality',
          state: 'met',
          value: true,
          evidence: [
            { target_digest: expected.binding.target_digest, start: 0, end: 6, quote: 'Actual' },
          ],
          rationale: 'Complete attributable report',
        },
      ],
    };
    expect(evaluateSemanticEvaluation(expected, report).passed).toBe(true);
    const fixture = evidenceProvider([TOOL_GATE]);
    const executor = new ShellVerifyExecutor({ allowlist: ['false', 'true'] });
    const execution = jest.spyOn(executor, 'execute');
    const evidence = await runGateReviewEvidence(
      ['gate-a'],
      fixture.provider,
      'Actual output',
      { shellVerifyExecutor: executor },
      undefined,
      issued.definitions
    );
    expect(execution).not.toHaveBeenCalled();
    expect(fixture.loadGates).toHaveBeenCalledTimes(1);
    expect(evidence.shellResults).toEqual([]);
    expect(evidence.scriptResults).toEqual([]);
    expect(evidence.checkResults).toMatchObject([
      { gateId: 'gate-a', passed: false, summary: expect.stringContaining('did not run') },
    ]);
    expect(evidence.section).toContain('verification refused');
  });

  test('unchanged frozen false actually executes and records its failing exit', async () => {
    const fixture = evidenceProvider([FALSE_GATE]);
    const issued = createSemanticReviewContext('n1', 'attempt-1', [FALSE_GATE]);
    const evidence = await runGateReviewEvidence(
      ['gate-a'],
      fixture.provider,
      undefined,
      { shellVerifyExecutor: new ShellVerifyExecutor({ allowlist: ['false', 'true'] }) },
      undefined,
      issued.definitions
    );
    expect(fixture.loadGates).toHaveBeenCalledTimes(1);
    expect(evidence.shellResults).toMatchObject([{ command: 'false', passed: false, exitCode: 1 }]);
    expect(evidence.checkResults[0]?.summary).toBe('false exit 1');
  });

  test('omitted frozen authority retains live legacy execution', async () => {
    const fixture = evidenceProvider([TOOL_GATE]);
    const evidence = await runGateReviewEvidence(['gate-a'], fixture.provider, undefined, {
      shellVerifyExecutor: new ShellVerifyExecutor({ allowlist: ['true'] }),
    });
    expect(evidence.shellResults).toMatchObject([{ command: 'true', passed: true, exitCode: 0 }]);
    expect(fixture.loadGates).toHaveBeenCalledTimes(1);
  });

  test('a hypothetical second provider load cannot swap the command', async () => {
    const fixture = evidenceProvider([FALSE_GATE]);
    fixture.loadGates.mockResolvedValueOnce([FALSE_GATE]).mockResolvedValue([TOOL_GATE]);
    const issued = createSemanticReviewContext('n1', 'attempt-1', [FALSE_GATE]);
    const evidence = await runGateReviewEvidence(
      ['gate-a'],
      fixture.provider,
      undefined,
      { shellVerifyExecutor: new ShellVerifyExecutor({ allowlist: ['false', 'true'] }) },
      undefined,
      issued.definitions
    );
    expect(evidence.shellResults[0]?.command).toBe('false');
    expect(evidence.shellResults[0]?.passed).toBe(false);
    expect(fixture.loadGates).toHaveBeenCalledTimes(1);
  });

  test.each(['shell_env', 'shell_working_dir', 'shell_preset', 'shell_stdin_source'] as const)(
    'full declared %s changes refuse before any command runs',
    async (field) => {
      const values = {
        shell_env: { REPORT_MODE: 'changed' },
        shell_working_dir: '/changed',
        shell_preset: 'full',
        shell_stdin_source: 'agent_response',
      };
      const live: LightweightGateDefinition = {
        ...FALSE_GATE,
        pass_criteria: [
          { ...FALSE_GATE.pass_criteria?.[0], type: 'shell_verify', [field]: values[field] },
        ],
      };
      const fixture = evidenceProvider([live]);
      const executor = new ShellVerifyExecutor({ allowlist: ['false', 'true'] });
      const execution = jest.spyOn(executor, 'execute');
      const evidence = await runGateReviewEvidence(
        ['gate-a'],
        fixture.provider,
        'Reply',
        { shellVerifyExecutor: executor },
        undefined,
        createSemanticReviewContext('n1', 'attempt-1', [FALSE_GATE]).definitions
      );
      expect(execution).not.toHaveBeenCalled();
      expect(evidence.shellResults).toEqual([]);
      expect(evidence.checkResults[0]?.passed).toBe(false);
      expect(evidence.section).toContain('did not run');
    }
  );

  test.each(['missing-declaration', 'missing-provider', 'unavailable-provider'] as const)(
    '%s produces did-not-run evidence instead of a synthetic exit',
    async (issue) => {
      const fixture = evidenceProvider(issue === 'missing-provider' ? [] : [FALSE_GATE]);
      if (issue === 'unavailable-provider')
        fixture.loadGates.mockRejectedValue(new Error('Provider unavailable'));
      const issued = createSemanticReviewContext('n1', 'attempt-1', [FALSE_GATE]);
      const evidence = await runGateReviewEvidence(
        ['gate-a'],
        fixture.provider,
        undefined,
        {},
        undefined,
        issue === 'missing-declaration' ? {} : issued.definitions
      );
      expect(evidence.shellResults).toEqual([]);
      expect(evidence.scriptResults).toEqual([]);
      expect(evidence.checkResults).toMatchObject([{ gateId: 'gate-a', passed: false }]);
      expect(evidence.section).toContain('did not run');
    }
  );

  test('script runner uses the cloned checked DTO after shell execution mutates provider-owned data', async () => {
    const gate: LightweightGateDefinition = {
      ...FALSE_GATE,
      pass_criteria: [
        ...(FALSE_GATE.pass_criteria ?? []),
        {
          type: 'script_tool',
          script_tool_id: 'frozen-tool',
          script_tool_input: { approved: true },
        },
      ],
    };
    const issued = createSemanticReviewContext('n1', 'attempt-1', [gate]);
    const fixture = evidenceProvider([gate]);
    const scripts = scriptRuntime();
    const executor = new ShellVerifyExecutor({ allowlist: ['false'] });
    const actualExecute = executor.execute.bind(executor);
    jest.spyOn(executor, 'execute').mockImplementation(async (command, scope) => {
      const criterion = gate.pass_criteria?.find((entry) => entry.type === 'script_tool');
      if (criterion === undefined || criterion.type !== 'script_tool')
        throw new Error('Missing script fixture');
      criterion.script_tool_id = 'live-tool';
      criterion.script_tool_input = { approved: false };
      return actualExecute(command, scope);
    });
    const evidence = await runGateReviewEvidence(
      ['gate-a'],
      fixture.provider,
      undefined,
      { shellVerifyExecutor: executor, scriptToolRuntime: () => scripts.runtime },
      undefined,
      issued.definitions
    );
    expect(scripts.loadScript.mock.calls[0]?.[0]).toBe('frozen-tool');
    expect(scripts.execute.mock.calls[0]?.[0]).toMatchObject({
      toolId: 'frozen-tool',
      inputs: { approved: true },
    });
    expect(evidence.scriptResults[0]?.toolId).toBe('frozen-tool');
    expect(fixture.loadGates).toHaveBeenCalledTimes(1);
  });

  test('changed declared script ID refuses without loading or executing the registry tool', async () => {
    const old: LightweightGateDefinition = {
      ...TOOL_GATE,
      pass_criteria: [
        { type: 'script_tool', script_tool_id: 'old-tool', script_tool_input: { approved: true } },
      ],
    };
    const live: LightweightGateDefinition = {
      ...old,
      pass_criteria: [
        { type: 'script_tool', script_tool_id: 'new-tool', script_tool_input: { approved: true } },
      ],
    };
    const fixture = evidenceProvider([live]);
    const scripts = scriptRuntime();
    const evidence = await runGateReviewEvidence(
      ['gate-a'],
      fixture.provider,
      undefined,
      { scriptToolRuntime: () => scripts.runtime },
      undefined,
      createSemanticReviewContext('n1', 'attempt-1', [old]).definitions
    );
    expect(scripts.loadScript).not.toHaveBeenCalled();
    expect(scripts.execute).not.toHaveBeenCalled();
    expect(evidence.scriptResults).toEqual([]);
    expect(evidence.checkResults[0]?.summary).toContain('did not run');
  });

  test('the checked observed sourceRoot is retained for gate-shipped script resolution', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'checked-tool-root-'));
    try {
      const directory = path.join(root, 'gate-a', 'scripts');
      await mkdir(directory, { recursive: true });
      const scriptPath = path.join(directory, 'probe.sh');
      await writeFile(scriptPath, 'exit 1\n');
      const gate: LightweightGateDefinition = {
        ...TOOL_GATE,
        sourceRoot: root,
        pass_criteria: [{ type: 'shell_verify', shell_command: ['sh', 'scripts/probe.sh'] }],
      };
      const issued = createSemanticReviewContext('n1', 'attempt-1', [gate]);
      expect(issued.definitions['gate-a']?.definition).not.toHaveProperty('sourceRoot');
      const fixture = evidenceProvider([gate]);
      const executor = new ShellVerifyExecutor({ allowlist: [] });
      const execution = jest.spyOn(executor, 'execute').mockResolvedValue({
        passed: false,
        exitCode: -1,
        stdout: '',
        stderr: 'I/O observer',
        durationMs: 0,
        command: 'observer',
      });
      await runGateReviewEvidence(
        ['gate-a'],
        fixture.provider,
        undefined,
        { shellVerifyExecutor: executor },
        undefined,
        issued.definitions
      );
      expect(execution.mock.calls[0]?.[0]?.command).toEqual(['sh', scriptPath]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
