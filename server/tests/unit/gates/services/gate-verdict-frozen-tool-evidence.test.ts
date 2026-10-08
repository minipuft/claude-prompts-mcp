// @lifecycle test - Detached caller carries frozen definitions and real refused tool evidence.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, jest, test } from '@jest/globals';
import ts from 'typescript';

import { ExecutionContext } from '../../../../src/engine/execution/context/execution-context.js';
import { GateEnforcementAuthority } from '../../../../src/engine/execution/pipeline/decisions/gates/gate-enforcement-authority.js';
import {
  bindSemanticReviewTarget,
  createSemanticReviewContext,
  resolvePinnedSemanticContext,
} from '../../../../src/engine/execution/pipeline/decisions/gates/semantic-review-context.js';
import {
  composeStructuralReview,
  PHASE_GUARD_GATE_ID,
} from '../../../../src/engine/execution/pipeline/decisions/gates/structural-review-composition.js';
import { evaluateSemanticEvaluation } from '../../../../src/engine/gates/core/semantic-evaluation.js';
import { runGateReviewEvidence } from '../../../../src/engine/gates/services/gate-review-evidence.js';
import { GateVerdictProcessor } from '../../../../src/engine/gates/services/gate-verdict-processor.js';
import { ShellVerifyExecutor } from '../../../../src/engine/gates/shell/shell-verify-executor.js';
import { noopLogger } from '../../../../src/infra/logging/index.js';

import type { SemanticReviewDefinitionInput } from '../../../../src/engine/execution/pipeline/decisions/gates/semantic-review-context.js';
import type { GateDefinitionProvider } from '../../../../src/engine/gates/core/gate-loader.js';
import type { LightweightGateDefinition } from '../../../../src/engine/gates/types.js';
import type { GateReview } from '../../../../src/shared/types/chain-execution.js';
import type {
  ChainSession,
  ChainSessionService,
} from '../../../../src/shared/types/chain-session.js';
import type {
  GateVerdictSubmission,
  SemanticCriterionInput,
  SemanticEvaluationReport,
} from '../../../../src/shared/types/gate-evaluation.js';

const OUTPUT = 'Actual output';
const TOOL: LightweightGateDefinition = {
  id: 'gate-a',
  name: 'Tool',
  type: 'validation',
  description: 'Public fixture',
  enforcementMode: 'blocking',
  pass_criteria: [{ type: 'shell_verify', shell_command: ['true'] }],
};
const FALSE_TOOL: LightweightGateDefinition = {
  ...TOOL,
  pass_criteria: [{ type: 'shell_verify', shell_command: ['false'] }],
};
const SEMANTIC: SemanticCriterionInput = {
  type: 'semantic_evaluation',
  id: 'quality',
  target: { kind: 'step_output' },
  question: 'Is the public contract preserved?',
  evidence_requirements: { min_items: 1 },
  result: { kind: 'boolean' },
  acceptance: { kind: 'equals', value: true },
  allow_not_applicable: false,
};

function issuedReview(
  definitions: SemanticReviewDefinitionInput[],
  legacy = false,
  output = OUTPUT
): GateReview {
  return {
    nodeId: 'n1',
    kind: 'detached',
    phase: 'awaiting-verdict',
    gateIds: definitions.map((gate) => gate.id),
    prompts: [],
    combinedPrompt: '',
    createdAt: 1,
    attemptCount: 0,
    maxAttempts: 3,
    reviewedOutput: output,
    metadata: { source: 'worker-report' },
    ...(legacy
      ? {}
      : {
          semanticContext: bindSemanticReviewTarget(
            createSemanticReviewContext('n1', 'attempt-1', definitions),
            output
          ),
        }),
  };
}

function metSubmission(review: GateReview): GateVerdictSubmission {
  if (review.semanticContext === undefined) throw new Error('Missing server authority');
  const pinned = resolvePinnedSemanticContext(review.semanticContext, 'gate-a');
  const report: SemanticEvaluationReport = {
    binding: pinned.binding,
    observations: [
      {
        criterion_id: 'quality',
        state: 'met',
        value: true,
        evidence: [
          { target_digest: pinned.binding.target_digest, start: 0, end: 6, quote: 'Actual' },
        ],
        rationale: 'Complete evidence',
      },
    ],
  };
  expect(evaluateSemanticEvaluation(pinned, report).passed).toBe(true);
  return {
    overall: 'PASS',
    rationale: 'Valid semantic report',
    per_gate: [{ index: 1, passed: true, rationale: 'Met', evaluation: report }],
  };
}

/** Actual owner/kernel/runners; only catalog and session-store I/O are substituted. */
function fixture(
  review: GateReview,
  live: LightweightGateDefinition[],
  verdict: string | GateVerdictSubmission = 'GATE_REVIEW: PASS - Accepted'
) {
  const provider = {
    loadGate: jest.fn(async (id: string) => live.find((gate) => gate.id === id) ?? null),
    loadGates: jest.fn(async (ids: string[]) => live.filter((gate) => ids.includes(gate.id))),
  } as unknown as GateDefinitionProvider;
  const store = {
    setReview: jest.fn<ChainSessionService['setReview']>(async () => undefined),
    clearReview: jest.fn(async () => undefined),
    recordGateReviewOutcome: jest.fn(async () => undefined),
  };
  const service = store as unknown as ChainSessionService;
  const context = new ExecutionContext(
    { chain_id: 'chain-1', gate_verdict: verdict, user_response: 'Unrelated current-node carrier' },
    noopLogger
  );
  context.gateEnforcement = new GateEnforcementAuthority(service, noopLogger);
  context.state.gates.enforcementMode = 'blocking';
  context.sessionContext = {
    sessionId: 'session-1',
    currentStep: 2,
    currentNodeId: 'n2',
    isChainExecution: true,
  };
  const session = {
    sessionId: 'session-1',
    chainId: 'chain-1',
    reviews: { n1: review },
    state: { currentNodeId: 'n2', nodes: [{ id: 'n1' }, { id: 'n2' }] },
  } as unknown as ChainSession;
  const executor = new ShellVerifyExecutor({ allowlist: ['false', 'true'] });
  const executed = jest.spyOn(executor, 'execute');
  type Callback = NonNullable<ConstructorParameters<typeof GateVerdictProcessor>[4]>;
  const checks = jest.fn<Callback>(
    async (ids, output, scope, definitions) =>
      (
        await runGateReviewEvidence(
          ids,
          provider,
          output,
          { shellVerifyExecutor: executor },
          scope,
          definitions
        )
      ).checkResults
  );
  const processor = new GateVerdictProcessor(service, noopLogger, undefined, undefined, checks);
  return {
    context,
    session,
    store,
    checks,
    executed,
    submit: () => processor.processDetachedReviewVerdict(context, session, 'n1'),
  };
}

describe('detached frozen tool evidence caller', () => {
  test('frozen false/live true refuses even a valid met report and earlier passing ID', async () => {
    const review = issuedReview([
      { ...FALSE_TOOL, pass_criteria: [...(FALSE_TOOL.pass_criteria ?? []), SEMANTIC] },
    ]);
    review.checkResults = [
      { gateId: 'gate-a', passed: true, summary: 'Earlier gate-id-only pass' },
    ];
    const f = fixture(review, [TOOL], metSubmission(review));
    const result = await f.submit();
    expect(f.checks.mock.calls[0][0]).toEqual(['gate-a']);
    expect(f.checks.mock.calls[0][1]).toBe(OUTPUT);
    const physical = f.checks.mock.calls[0][3];
    const original = review.semanticContext?.definitions['gate-a'];
    if (original === undefined) throw new Error('Missing original issued fixture');
    expect(Object.keys(physical ?? {})).toEqual(['gate-a']);
    expect(physical?.['gate-a']).toBe(original);
    expect(physical?.['gate-a']?.definition).toBe(original.definition);
    expect(f.executed).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      kind: 'refused',
      message: expect.stringContaining('did not run'),
    });
    expect(f.store.clearReview).not.toHaveBeenCalled();
    expect(f.store.recordGateReviewOutcome).not.toHaveBeenCalled();
  });

  test.each([false, true])('unchanged command actually runs pass=%j', async (passed) => {
    const gate = passed ? TOOL : FALSE_TOOL;
    const f = fixture(issuedReview([gate]), [gate]);
    const result = await f.submit();
    expect(f.executed).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject(
      passed
        ? { kind: 'recorded', result: 'passed' }
        : { kind: 'refused', message: expect.stringContaining('exit 1') }
    );
    expect(f.store.clearReview).toHaveBeenCalledTimes(passed ? 1 : 0);
  });

  test('unchanged mixed true tool and valid model evidence can pass', async () => {
    const review = issuedReview([
      { ...TOOL, pass_criteria: [...(TOOL.pass_criteria ?? []), SEMANTIC] },
    ]);
    const f = fixture(review, [TOOL], metSubmission(review));
    expect(await f.submit()).toMatchObject({ kind: 'recorded', result: 'passed' });
    expect(f.executed).toHaveBeenCalledTimes(1);
    expect(f.store.clearReview).toHaveBeenCalledTimes(1);
  });

  test.each(['missing-issued', 'missing-live'] as const)(
    '%s ordinary gate does not run or accept a prior pass',
    async (kind) => {
      const review = issuedReview(kind === 'missing-issued' ? [] : [TOOL]);
      review.gateIds = ['gate-a'];
      review.checkResults = [{ gateId: 'gate-a', passed: true, summary: 'Prior pass' }];
      const f = fixture(review, kind === 'missing-live' ? [] : [TOOL]);
      expect(await f.submit()).toMatchObject({
        kind: 'refused',
        message: expect.stringContaining('did not run'),
      });
      expect(f.executed).not.toHaveBeenCalled();
      expect(f.store.clearReview).not.toHaveBeenCalled();
    }
  );

  test.each(['plain', 'mixed', 'authored-collision'] as const)(
    '%s structural route selects tools without rewriting full requirements',
    async (kind) => {
      const collision = { ...TOOL, id: PHASE_GUARD_GATE_ID };
      const base = issuedReview(
        kind === 'authored-collision' ? [collision] : kind === 'mixed' ? [TOOL] : []
      );
      const review: GateReview = {
        ...base,
        ...composeStructuralReview(base.gateIds.length ? base : undefined, {
          gateId: PHASE_GUARD_GATE_ID,
          feedback: 'Missing context',
          retryHints: [],
          failedPhases: ['context'],
          mode: 'enforce',
          previousResponse: OUTPUT,
          reviewedStep: { nodeId: 'n1', stepNumber: 1 },
          maxAttempts: 3,
          createdAt: 42,
        }),
        nodeId: 'n1',
        kind: 'detached',
        phase: 'awaiting-verdict',
      };
      const required = [...review.gateIds];
      const f = fixture(
        review,
        kind === 'authored-collision' ? [collision] : [TOOL],
        'GATE_REVIEW: FAIL - Missing structure'
      );
      await f.submit();
      expect(f.checks.mock.calls[0][0]).toEqual(
        kind === 'plain' ? [] : kind === 'mixed' ? ['gate-a'] : [PHASE_GUARD_GATE_ID]
      );
      expect(f.executed).toHaveBeenCalledTimes(kind === 'plain' ? 0 : 1);
      expect(review.gateIds).toEqual(required);
      expect(f.store.clearReview).not.toHaveBeenCalled();
      expect(f.store.setReview.mock.calls.at(-1)?.[1]?.gateIds).toEqual(required);
    }
  );

  test.each(['', OUTPUT])(
    'legacy detached recorded output %j is forwarded unchanged',
    async (output) => {
      const f = fixture(issuedReview([TOOL], true, output), [TOOL]);
      expect(await f.submit()).toMatchObject({ kind: 'recorded', result: 'passed' });
      expect(f.checks.mock.calls[0][1]).toBe(output);
      expect(f.checks.mock.calls[0][3]).toBeUndefined();
      expect(f.executed).toHaveBeenCalledTimes(1);
    }
  );
});

test('STATIC composition-root callback forwards its fourth frozen-definition argument to the shared owner', () => {
  const filename = fileURLToPath(
    new URL('../../../../src/mcp/tools/prompt-engine/core/pipeline-builder.ts', import.meta.url)
  );
  const source = ts.createSourceFile(
    filename,
    readFileSync(filename, 'utf8'),
    ts.ScriptTarget.Latest,
    true
  );
  const constructors: ts.NewExpression[] = [];
  const collect = (node: ts.Node) => {
    if (ts.isNewExpression(node) && node.expression.getText(source) === 'GateVerdictProcessor')
      constructors.push(node);
    ts.forEachChild(node, collect);
  };
  collect(source);
  expect(constructors).toHaveLength(1);
  const callback = constructors[0].arguments?.[4];
  if (callback === undefined || !ts.isArrowFunction(callback))
    throw new Error('Missing actual detached callback');
  const parameters = callback.parameters.map((parameter) => parameter.name.getText(source));
  expect(parameters).toEqual(['gateIds', 'agentResponse', 'scope', 'issuedDefinitions']);
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'runGateReviewEvidence')
      calls.push(node);
    ts.forEachChild(node, visit);
  };
  visit(callback.body);
  expect(calls).toHaveLength(1);
  expect([
    calls[0].arguments[0].getText(source),
    calls[0].arguments[2].getText(source),
    calls[0].arguments[4].getText(source),
    calls[0].arguments[5]?.getText(source),
  ]).toEqual(parameters);
});
