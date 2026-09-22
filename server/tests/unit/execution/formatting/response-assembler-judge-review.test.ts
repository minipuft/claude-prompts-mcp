/**
 * P4.133 — the judge prompt the review stage builds reaches the client.
 *
 * `GateReviewStage` composes a context-isolated judge prompt for `mode: judge` gates and stamps it
 * on `metadata.judge`; `docs/guides/judge-mode.md` promises the client that prompt. Nothing
 * rendered it, so a judge gate and its `mode: self` twin replied byte-identically. The twin here
 * is the same context without `metadata.judge` — exactly what the stage produces for a gate that
 * differs only in `mode` — and its reply must stay what it was.
 *
 * Classification: Unit. Real `ResponseAssembler` and a real composed judge prompt.
 */
import { describe, expect, test } from '@jest/globals';

import { ExecutionContext } from '../../../../src/engine/execution/context/execution-context.js';
import { ResponseAssembler } from '../../../../src/engine/execution/formatting/response-assembler.js';
import {
  JUDGE_OUTPUT_PLACEHOLDER,
  composeJudgeReviewPrompt,
} from '../../../../src/engine/gates/core/review-utils.js';

import type { LightweightGateDefinition } from '../../../../src/engine/gates/types.js';
import type { PendingGateReview } from '../../../../src/shared/types/chain-execution.js';

const assembler = new ResponseAssembler();

const judgeGate: LightweightGateDefinition = {
  id: 'judged-gate',
  name: 'Judged Gate',
  type: 'validation',
  description: 'judge-routed',
  guidance: 'JUDGE-CRITERION',
  pass_criteria: [{ type: 'inline_guidance' }],
  evaluation: { mode: 'judge', model: 'haiku-hint' },
};

const composed = composeJudgeReviewPrompt([judgeGate], JUDGE_OUTPUT_PLACEHOLDER);
const judgeMetadata = {
  judgePrompt: composed.judgePrompt,
  judgeGateIds: composed.judgeGateIds,
  modelHint: composed.modelHint,
};

function reviewContext(judge?: unknown, blocked = false): ExecutionContext {
  const pendingReview: PendingGateReview = {
    combinedPrompt: 'Review the output',
    gateIds: ['judged-gate'],
    prompts: [{ gateId: 'judged-gate', gateName: 'Judged Gate', criteriaSummary: 'c' }],
    createdAt: 0,
    attemptCount: 0,
    maxAttempts: 3,
  };
  const context = new ExecutionContext({ command: '>>demo' });
  context.executionResults = {
    content: 'REVIEW-RENDER',
    metadata: {
      gateReview: { gateIds: ['judged-gate'], attemptCount: 0, maxAttempts: 3 },
      ...(judge !== undefined ? { judge } : {}),
    },
    generatedAt: 0,
  };
  context.sessionContext = {
    sessionId: 'session-judge',
    chainId: 'chain-judge#1',
    isChainExecution: true,
    currentStep: 1,
    totalSteps: 2,
    pendingReview,
  };
  if (blocked) {
    context.state.gates.responseBlocked = true;
    context.state.gates.blockedGateIds = ['judged-gate'];
  }
  return context;
}

const chainReply = (context: ExecutionContext): string =>
  assembler.formatChainResponse(context, { isChainFormatting: true } as never);

const occurrences = (text: string, needle: string): number => text.split(needle).length - 1;

describe('ResponseAssembler renders the judge prompt (P4.133)', () => {
  test('a judge-routed review carries the prompt once, with the gate and model hint', () => {
    const reply = chainReply(reviewContext(judgeMetadata));

    expect(occurrences(reply, '## Judge Evaluation — Independent Quality Audit')).toBe(1);
    expect(reply).toContain('JUDGE-CRITERION');
    expect(reply).toContain('**Independent judge required** for `judged-gate`');
    expect(reply).toContain('(suggested model: haiku-hint)');
    // The output slot is the client's to fill, never the review render itself.
    expect(reply).toContain(JUDGE_OUTPUT_PLACEHOLDER);
    // Before the verdict template the client submits, not after it.
    expect(reply.indexOf('## Judge Evaluation')).toBeLessThan(reply.indexOf('gate_verdict='));
  });

  test('CONTROL: the self-mode twin renders no judge section, and nothing else changes', () => {
    const twin = chainReply(reviewContext());
    const judged = chainReply(reviewContext(judgeMetadata));

    // Positive control for the absence: the twin IS a review reply.
    expect(twin).toContain('Gate Review Required');
    expect(twin).not.toContain('Judge Evaluation');
    expect(twin).not.toContain('Independent judge required');
    // The judge reply is the twin plus exactly the judge block.
    const start = judged.indexOf('\n\n**Independent judge required**');
    const end = judged.indexOf('````', judged.lastIndexOf('Respond with:')) + '````'.length;
    expect(judged.slice(0, start) + judged.slice(end)).toBe(twin);
  });

  test('a blocked judge-routed review still carries the prompt, once', () => {
    const reply = assembler.formatBlockedResponse(reviewContext(judgeMetadata, true));

    expect(reply).toContain('Response Blocked');
    expect(occurrences(reply, '## Judge Evaluation — Independent Quality Audit')).toBe(1);
  });

  test('a malformed metadata.judge fails loudly instead of reading as self-review', () => {
    expect(() => chainReply(reviewContext({ judgeGateIds: ['judged-gate'] }))).toThrow(
      /metadata\.judge/
    );
  });
});
