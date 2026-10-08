import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import { GateEnforcementAuthority } from '../../../../../src/engine/execution/pipeline/decisions/index.js';
import {
  createSemanticReviewContext,
  bindSemanticReviewTarget,
  readSemanticReviewCriteria,
  resolvePinnedSemanticContext,
} from '../../../../../src/engine/execution/pipeline/decisions/gates/semantic-review-context.js';
import { ExecutionContext } from '../../../../../src/engine/execution/context/execution-context.js';
import { GateLoader } from '../../../../../src/engine/gates/core/gate-loader.js';
import { GatePassCriteriaSchema } from '../../../../../src/engine/gates/core/gate-schema.js';
import { parseGateVerdict } from '../../../../../src/engine/gates/core/gate-verdict-contract.js';
import { hashBytes, hashCanonical } from '../../../../../src/shared/utils/hash.js';

import type {
  EnforcementMode,
  VerdictSource,
} from '../../../../../src/engine/execution/pipeline/decisions/index.js';
import type {
  GateVerdictSubmission,
  SemanticEvaluationReport,
  SemanticCriterionInput,
} from '../../../../../src/shared/types/gate-evaluation.js';
import type { LightweightGateDefinition } from '../../../../../src/engine/gates/types.js';
import type { JudgeEvaluationDefaults } from '../../../../../src/engine/gates/judge/types.js';

function richEvaluation(): SemanticEvaluationReport {
  const targetDigest = hashBytes('A😀e\u0301 Z');
  return {
    binding: {
      gate_id: 'client-claimed-gate',
      node_id: 'n1',
      attempt_id: 'attempt-3',
      definition_digest: hashBytes('frozen definition'),
      target_digest: targetDigest,
    },
    observations: [
      {
        criterion_id: 'preserves-contract',
        state: 'met',
        value: true,
        evidence: [{ target_digest: targetDigest, start: 1, end: 5, quote: '😀e\u0301' }],
        rationale: 'Unicode evidence.\nReport rationale stays multiline.',
      },
    ],
    reviewer: {
      provenance: 'client_reported',
      provider: 'claimed-provider',
      model: 'claimed-model',
      revision: 'claimed-revision',
      context: 'isolated_judge',
    },
  };
}

const createMockLogger = () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
});

const createMockChainSessionStore = () => ({
  getSession: jest.fn(),
  hasActiveSession: jest.fn(),
  getReview: jest.fn(),
  setPendingGateReview: jest.fn(),
  setReview: jest.fn(),
  clearPendingGateReview: jest.fn(),
  recordGateReviewOutcome: jest.fn(),
  cancelChain: jest.fn<(sessionId: string) => Promise<boolean>>().mockResolvedValue(true),
});

describe('GateEnforcementAuthority', () => {
  let authority: GateEnforcementAuthority;
  let mockLogger: ReturnType<typeof createMockLogger>;
  let mockSessionManager: ReturnType<typeof createMockChainSessionStore>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockLogger = createMockLogger();
    mockSessionManager = createMockChainSessionStore();
    authority = new GateEnforcementAuthority(mockSessionManager as any, mockLogger as any);
  });

  describe('parseVerdict', () => {
    test('delegates structured parsing to the canonical contract while retaining report custody', () => {
      const evaluation = richEvaluation();
      const submission: GateVerdictSubmission = {
        overall: 'PASS',
        rationale: 'Reviewed',
        per_gate: [{ index: 1, passed: true, rationale: 'Evidence supplied', evaluation }],
      };
      const result = authority.parseVerdict(submission, 'gate_verdict');

      expect(result).toEqual(parseGateVerdict(submission, 'gate_verdict'));
      expect(result?.submission).toBe(submission);
      expect(result?.submission?.per_gate?.[0]?.evaluation).toBe(evaluation);
      expect(result?.detectedPattern).toBe('structured');
      expect(authority.parseVerdict(submission, 'user_response')).toBeNull();
    });

    describe('pattern 1: GATE_REVIEW: PASS|FAIL - rationale', () => {
      test('parses PASS verdict with hyphen separator', () => {
        const result = authority.parseVerdict('GATE_REVIEW: PASS - Excellent work', 'gate_verdict');
        expect(result).toEqual({
          verdict: 'PASS',
          rationale: 'Excellent work',
          raw: 'GATE_REVIEW: PASS - Excellent work',
          source: 'gate_verdict',
          detectedPattern: 'primary',
        });
      });

      test('parses FAIL verdict with hyphen separator', () => {
        const result = authority.parseVerdict(
          'GATE_REVIEW: FAIL - Needs improvement',
          'gate_verdict'
        );
        expect(result).toEqual({
          verdict: 'FAIL',
          rationale: 'Needs improvement',
          raw: 'GATE_REVIEW: FAIL - Needs improvement',
          source: 'gate_verdict',
          detectedPattern: 'primary',
        });
      });

      test('is case insensitive', () => {
        const result = authority.parseVerdict('gate_review: pass - Good', 'gate_verdict');
        expect(result?.verdict).toBe('PASS');
      });
    });

    describe('pattern 2: GATE_REVIEW: PASS|FAIL : rationale', () => {
      test('parses with colon separator', () => {
        const result = authority.parseVerdict('GATE_REVIEW: PASS : Nice', 'gate_verdict');
        expect(result).toEqual({
          verdict: 'PASS',
          rationale: 'Nice',
          raw: 'GATE_REVIEW: PASS : Nice',
          source: 'gate_verdict',
          detectedPattern: 'high',
        });
      });
    });

    describe('pattern 3: GATE PASS|FAIL - rationale', () => {
      test('parses simplified format with hyphen', () => {
        const result = authority.parseVerdict('GATE PASS - All checks passed', 'gate_verdict');
        expect(result).toEqual({
          verdict: 'PASS',
          rationale: 'All checks passed',
          raw: 'GATE PASS - All checks passed',
          source: 'gate_verdict',
          detectedPattern: 'high',
        });
      });
    });

    describe('pattern 4: GATE PASS|FAIL : rationale', () => {
      test('parses simplified format with colon', () => {
        const result = authority.parseVerdict('GATE FAIL : Missing tests', 'gate_verdict');
        expect(result).toEqual({
          verdict: 'FAIL',
          rationale: 'Missing tests',
          raw: 'GATE FAIL : Missing tests',
          source: 'gate_verdict',
          detectedPattern: 'medium',
        });
      });
    });

    describe('pattern 5: minimal format (PASS|FAIL - rationale)', () => {
      test('parses minimal format from gate_verdict source', () => {
        const result = authority.parseVerdict('PASS - OK', 'gate_verdict');
        expect(result).toEqual({
          verdict: 'PASS',
          rationale: 'OK',
          raw: 'PASS - OK',
          source: 'gate_verdict',
          detectedPattern: 'fallback',
        });
      });

      test('skips minimal pattern for user_response source (security)', () => {
        const result = authority.parseVerdict('PASS - This looks like a verdict', 'user_response');
        expect(result).toBeNull();
      });

      test('allows explicit format from user_response source', () => {
        const result = authority.parseVerdict('GATE_REVIEW: PASS - Approved', 'user_response');
        expect(result?.verdict).toBe('PASS');
        expect(result?.detectedPattern).toBe('primary');
      });
    });

    describe('edge cases', () => {
      test('returns null for undefined input', () => {
        expect(authority.parseVerdict(undefined, 'gate_verdict')).toBeNull();
      });

      test('returns null for empty string', () => {
        expect(authority.parseVerdict('', 'gate_verdict')).toBeNull();
      });

      test('returns null for non-matching input', () => {
        expect(authority.parseVerdict('random text', 'gate_verdict')).toBeNull();
      });

      test('rejects verdict without rationale', () => {
        const result = authority.parseVerdict('GATE_REVIEW: PASS - ', 'gate_verdict');
        expect(result).toBeNull();
        // Note: warn may not fire when trailing space is trimmed before regex match
      });

      test('trims whitespace from rationale', () => {
        const result = authority.parseVerdict('GATE_REVIEW: PASS -   Spaced out  ', 'gate_verdict');
        expect(result?.rationale).toBe('Spaced out');
      });
    });
  });

  describe('parseGateVerdicts', () => {
    /** Strip the wall-clock field so a parse can be compared as a value. */
    const withoutTimestamp = (entries: ReturnType<typeof authority.parseGateVerdicts>) =>
      entries.map(({ timestamp, ...rest }) => {
        expect(typeof timestamp).toBe('number');
        return rest;
      });

    describe('structured entries and reminder custody', () => {
      test('retains the exact Unicode evaluation report under the advertised gate identity', () => {
        const evaluation = richEvaluation();
        const before = structuredClone(evaluation);
        const submission: GateVerdictSubmission = {
          overall: 'FAIL',
          rationale: 'One gate failed',
          per_gate: [
            { index: 2, passed: false, rationale: 'Needs revision', evaluation },
            { index: 1, passed: true, rationale: 'Check passed' },
          ],
        };

        const result = authority.parseGateVerdicts(submission, ['alpha', 'beta'], 3);

        expect(withoutTimestamp(result)).toEqual([
          {
            gateId: 'beta',
            verdict: 'FAIL',
            rationale: 'Needs revision',
            attempt: 3,
            evaluation: before,
          },
          { gateId: 'alpha', verdict: 'PASS', rationale: 'Check passed', attempt: 3 },
        ]);
        expect(result[0]?.evaluation).toBe(evaluation);
        expect(result[0]?.gateId).not.toBe(evaluation.binding.gate_id);
        expect(result[1]).not.toHaveProperty('evaluation');
        expect(evaluation).toEqual(before);
        expect(mockLogger.warn).not.toHaveBeenCalled();
      });

      test('reads typed reminders directly and preserves ordinary attestation semantics', () => {
        const submission: GateVerdictSubmission = {
          overall: 'PASS',
          rationale: 'Reviewed',
          per_gate: [{ index: 1, passed: true, rationale: 'Check passed' }],
          reminders: {
            satisfied: ['style-guide'],
            not_applicable: [{ id: 'security-review', reason: 'no network code' }],
          },
        };
        const result = authority.parseGateVerdicts(
          submission,
          ['test-coverage', 'style-guide', 'security-review'],
          3
        );

        expect(withoutTimestamp(result)).toEqual([
          {
            gateId: 'style-guide',
            verdict: 'PASS',
            rationale: 'attested satisfied',
            tier: 'reminder',
            attempt: 3,
          },
          {
            gateId: 'security-review',
            verdict: 'PASS',
            rationale: 'not applicable: no network code',
            tier: 'reminder',
            attempt: 3,
          },
          { gateId: 'test-coverage', verdict: 'PASS', rationale: 'Check passed', attempt: 3 },
        ]);
        expect(new Set(result.map((entry) => entry.timestamp)).size).toBe(1);
      });

      test('unknown typed reminder IDs keep the legacy diagnostic-and-drop behavior', () => {
        const submission: GateVerdictSubmission = {
          overall: 'PASS',
          rationale: 'Reviewed',
          reminders: { satisfied: ['style-guide', 'not-advertised'], not_applicable: [] },
        };

        expect(withoutTimestamp(authority.parseGateVerdicts(submission, ['style-guide']))).toEqual([
          {
            gateId: 'style-guide',
            verdict: 'PASS',
            rationale: 'attested satisfied',
            tier: 'reminder',
          },
        ]);
        expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('not-advertised'));
      });

      test.each([undefined, { satisfied: [], not_applicable: [] }])(
        'an overall-only review with reminders %j has no summaries',
        (reminders) => {
          const submission: GateVerdictSubmission = {
            overall: 'PASS',
            rationale: 'Reviewed',
            reminders,
          };

          expect(authority.parseGateVerdicts(submission, ['alpha'])).toEqual([]);
        }
      );

      test.each([0, -1, 0.5, 3, 99, NaN, Infinity])(
        'refuses structured index %s atomically before entries or reminders return',
        (index) => {
          const submission: GateVerdictSubmission = {
            overall: 'PASS',
            rationale: 'Reviewed',
            per_gate: [
              {
                index: 1,
                passed: true,
                rationale: 'Valid first entry',
                evaluation: richEvaluation(),
              },
              { index, passed: false, rationale: 'Invalid second entry' },
            ],
            reminders: { satisfied: ['style-guide'], not_applicable: [] },
          };
          const recorded: ReturnType<typeof authority.parseGateVerdicts> = [];

          expect(() =>
            recorded.push(...authority.parseGateVerdicts(submission, ['alpha', 'style-guide']))
          ).toThrow('names no advertised gate');
          expect(recorded).toEqual([]);
          expect(mockLogger.warn).not.toHaveBeenCalled();
        }
      );

      test.each([{ indexes: [1, 1] }, { indexes: [1, 2, 1] }])(
        'refuses duplicate structured indexes %j atomically',
        ({ indexes }) => {
          const submission: GateVerdictSubmission = {
            overall: 'PASS',
            rationale: 'Reviewed',
            per_gate: indexes.map((index) => ({ index, passed: true, rationale: `Gate ${index}` })),
            reminders: { satisfied: ['style-guide'], not_applicable: [] },
          };
          const recorded: ReturnType<typeof authority.parseGateVerdicts> = [];

          expect(() =>
            recorded.push(
              ...authority.parseGateVerdicts(submission, ['alpha', 'beta', 'style-guide'])
            )
          ).toThrow('duplicate index [1]');
          expect(recorded).toEqual([]);
        }
      );

      test('positive control: unique in-range structured indexes return every entry', () => {
        const submission: GateVerdictSubmission = {
          overall: 'FAIL',
          rationale: 'Reviewed',
          per_gate: [
            { index: 1, passed: true, rationale: 'First passed' },
            { index: 2, passed: false, rationale: 'Second failed' },
          ],
        };

        expect(
          withoutTimestamp(authority.parseGateVerdicts(submission, ['alpha', 'beta']))
        ).toEqual([
          { gateId: 'alpha', verdict: 'PASS', rationale: 'First passed' },
          { gateId: 'beta', verdict: 'FAIL', rationale: 'Second failed' },
        ]);
      });

      test('a structured entry refuses when the review advertised no gates', () => {
        const submission: GateVerdictSubmission = {
          overall: 'PASS',
          rationale: 'Reviewed',
          per_gate: [{ index: 1, passed: true, rationale: 'Reviewed' }],
        };

        expect(() => authority.parseGateVerdicts(submission, [])).toThrow('review advertised 0');
      });
    });

    describe('reminder attestations (P4.78)', () => {
      test('a REMINDERS line folds into the same record, marked as an attestation', () => {
        const raw = [
          'GATE_REVIEW: PASS - all good',
          'REMINDERS: satisfied=style-guide; n/a=security-review(no network code)',
          '',
          'GATE_VERDICTS:',
          '[1] PASS - suite green',
        ].join('\n');

        const result = authority.parseGateVerdicts(
          raw,
          ['test-coverage', 'style-guide', 'security-review'],
          1
        );

        expect(withoutTimestamp(result)).toEqual([
          {
            gateId: 'style-guide',
            verdict: 'PASS',
            rationale: 'attested satisfied',
            tier: 'reminder',
            attempt: 1,
          },
          {
            gateId: 'security-review',
            verdict: 'PASS',
            rationale: 'not applicable: no network code',
            tier: 'reminder',
            attempt: 1,
          },
          {
            gateId: 'test-coverage',
            verdict: 'PASS',
            rationale: 'suite green',
            attempt: 1,
          },
        ]);
      });

      test('a reminder naming a gate the review never advertised is dropped, and said so', () => {
        const raw = 'GATE_REVIEW: PASS - fine\nREMINDERS: satisfied=not-under-review; n/a=';

        expect(authority.parseGateVerdicts(raw, ['test-coverage'])).toEqual([]);
        expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('not-under-review'));
      });

      test('positive control: the same line naming an advertised gate is kept, unwarned', () => {
        // Differs from the case above in the gate id alone, so a dropped entry can only be the
        // advertised-list check.
        const raw = 'GATE_REVIEW: PASS - fine\nREMINDERS: satisfied=test-coverage; n/a=';

        expect(authority.parseGateVerdicts(raw, ['test-coverage'])).toHaveLength(1);
        expect(mockLogger.warn).not.toHaveBeenCalled();
      });

      test('a submission with no REMINDERS line records no attestation', () => {
        const raw = 'GATE_REVIEW: PASS - fine\n\nGATE_VERDICTS:\n[1] PASS - ok';

        const result = authority.parseGateVerdicts(raw, ['test-coverage']);

        expect(result).toHaveLength(1);
        expect(result[0]?.tier).toBeUndefined();
      });
    });

    test('resolves each entry to the gate id at that advertised position', () => {
      const raw = `Some preamble text.

CRITERION_VERDICTS:
[1] PASS - All tests pass
[2] FAIL - Missing error handling
[3] PASS - Documentation complete

GATE_REVIEW: PASS - Overall good`;

      const result = authority.parseGateVerdicts(raw, ['alpha', 'beta', 'gamma']);

      expect(withoutTimestamp(result)).toEqual([
        { gateId: 'alpha', verdict: 'PASS', rationale: 'All tests pass' },
        { gateId: 'beta', verdict: 'FAIL', rationale: 'Missing error handling' },
        { gateId: 'gamma', verdict: 'PASS', rationale: 'Documentation complete' },
      ]);
    });

    test('records the review attempt on every entry when one is supplied', () => {
      const raw = `GATE_VERDICTS:
[1] FAIL - not yet`;

      expect(withoutTimestamp(authority.parseGateVerdicts(raw, ['alpha'], 2))).toEqual([
        { gateId: 'alpha', verdict: 'FAIL', rationale: 'not yet', attempt: 2 },
      ]);
    });

    test('drops an entry whose index names no advertised gate, and says so', () => {
      const raw = `GATE_VERDICTS:
[1] PASS - in range
[7] FAIL - out of range`;

      const result = authority.parseGateVerdicts(raw, ['alpha', 'beta']);

      // The in-range entry survives; the out-of-range one is dropped rather than
      // attributed to some other gate.
      expect(withoutTimestamp(result)).toEqual([
        { gateId: 'alpha', verdict: 'PASS', rationale: 'in range' },
      ]);
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('[7]'));
    });

    test('positive control: the same shape with an in-range index is kept and not warned', () => {
      // Differs from the case above in ONE character \u2014 the index \u2014 so a dropped entry
      // can only be the range check, not the parse.
      const raw = `GATE_VERDICTS:
[1] PASS - in range
[2] FAIL - also in range`;

      const result = authority.parseGateVerdicts(raw, ['alpha', 'beta']);

      expect(withoutTimestamp(result)).toEqual([
        { gateId: 'alpha', verdict: 'PASS', rationale: 'in range' },
        { gateId: 'beta', verdict: 'FAIL', rationale: 'also in range' },
      ]);
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    test('returns empty array when no CRITERION_VERDICTS block', () => {
      const result = authority.parseGateVerdicts('GATE_REVIEW: PASS - Good work', ['alpha']);
      expect(result).toEqual([]);
    });

    test('returns empty array for empty input', () => {
      expect(authority.parseGateVerdicts('', ['alpha'])).toEqual([]);
    });

    test('returns empty array when the review advertised no gates', () => {
      const raw = `GATE_VERDICTS:
[1] PASS - orphaned`;
      expect(authority.parseGateVerdicts(raw, [])).toEqual([]);
    });

    test('handles verdicts without brackets', () => {
      const raw = `CRITERION_VERDICTS:
1 PASS - First criterion met
2 FAIL - Second criterion failed`;

      const result = authority.parseGateVerdicts(raw, ['alpha', 'beta']);

      expect(withoutTimestamp(result)).toEqual([
        { gateId: 'alpha', verdict: 'PASS', rationale: 'First criterion met' },
        { gateId: 'beta', verdict: 'FAIL', rationale: 'Second criterion failed' },
      ]);
    });

    test('handles em-dash and en-dash separators', () => {
      const raw = `CRITERION_VERDICTS:
[1] PASS \u2014 em-dash rationale
[2] FAIL \u2013 en-dash rationale`;

      const result = authority.parseGateVerdicts(raw, ['alpha', 'beta']);

      expect(withoutTimestamp(result)).toEqual([
        { gateId: 'alpha', verdict: 'PASS', rationale: 'em-dash rationale' },
        { gateId: 'beta', verdict: 'FAIL', rationale: 'en-dash rationale' },
      ]);
    });

    test('stops capturing at first non-matching line within block', () => {
      const raw = `CRITERION_VERDICTS:
[1] PASS - Good
not a verdict line
[3] FAIL - Bad`;

      const result = authority.parseGateVerdicts(raw, ['alpha', 'beta', 'gamma']);

      // Regex capture group stops at non-matching line
      expect(withoutTimestamp(result)).toEqual([
        { gateId: 'alpha', verdict: 'PASS', rationale: 'Good' },
      ]);
    });

    test('is case insensitive for verdict values', () => {
      const raw = `CRITERION_VERDICTS:
[1] pass - lowercase
[2] Pass - mixed case`;

      const result = authority.parseGateVerdicts(raw, ['alpha', 'beta']);

      expect(result).toHaveLength(2);
      expect(result[0]?.verdict).toBe('PASS');
      expect(result[1]?.verdict).toBe('PASS');
    });

    test('parses GATE_VERDICTS block (new format)', () => {
      const raw = `Some preamble text.

GATE_VERDICTS:
[1] PASS - Code quality met
[2] FAIL - Missing tests

GATE_REVIEW: FAIL - Tests missing`;

      const result = authority.parseGateVerdicts(raw, ['quality', 'tests']);

      expect(withoutTimestamp(result)).toEqual([
        { gateId: 'quality', verdict: 'PASS', rationale: 'Code quality met' },
        { gateId: 'tests', verdict: 'FAIL', rationale: 'Missing tests' },
      ]);
    });
  });

  // getPendingReview() was deleted at P4.52 — the wrapper had zero adopters. Every caller now
  // reads a review by the node it names (`chainSessionStore.getReview`, row 3.12).

  describe('issued public review authority', () => {
    const liveGate = (id: string): LightweightGateDefinition => ({
      id,
      name: id,
      type: 'validation',
      description: 'Public definition',
      guidance: 'Original guidance\nSecond line',
      guidanceFile: 'guidance.md',
      sourceRoot: '/internal',
      severity: 'high',
      enforcementMode: 'advisory',
      subject: 'contracts',
      gate_type: 'custom',
      blockResponseOnFail: true,
      activation: { prompt_categories: ['development'], explicit_request: true },
      retry_config: { max_attempts: 3, improvement_hints: true, preserve_context: true },
      pass_criteria: [
        { type: 'shell_verify', shell_command: ['node', '-v'] },
        { type: 'inline_guidance' },
      ],
    });
    const criterion: SemanticCriterionInput = {
      type: 'semantic_evaluation',
      id: 'semantic',
      target: { kind: 'step_output' },
      question: 'Is the output supported?',
      evidence_requirements: { min_items: 1 },
      result: { kind: 'boolean' },
      acceptance: { kind: 'equals', value: true },
    };
    function withDefinitions(
      definitions: LightweightGateDefinition[],
      defaults: Partial<JudgeEvaluationDefaults> = {}
    ) {
      const loader = new GateLoader(mockLogger as any);
      const load = jest
        .spyOn(loader, 'loadGates')
        .mockImplementation(async (ids) => definitions.filter((gate) => ids.includes(gate.id)));
      return {
        load,
        owner: new GateEnforcementAuthority(
          mockSessionManager as any,
          mockLogger as any,
          loader,
          () => ({ evaluation: defaults })
        ),
      };
    }
    function stagedContext(draft = criterion) {
      const gate = liveGate('mixed');
      return createSemanticReviewContext('reviewed-node', 'server-attempt', [
        { ...gate, pass_criteria: [...(gate.pass_criteria ?? []), draft] },
      ]);
    }

    test('freezes full catalog/defaults and snapshots only newly joined gates', async () => {
      const gate = liveGate('g1');
      const definitions = [gate];
      const defaults: Partial<JudgeEvaluationDefaults> = {
        defaultMode: 'judge',
        defaultModel: 'requested-model',
      };
      const { owner, load } = withDefinitions(definitions, defaults);
      const review = await owner.createReview('s', 'gate', 'node-1', {
        gateIds: ['g1'],
        instructions: 'Review',
      });
      const snapshot = review.semanticContext?.definitions['g1'];
      if (snapshot === undefined) throw new Error('Missing snapshot');
      expect(snapshot?.definition).toEqual({
        ...gate,
        sourceRoot: undefined,
        evaluation: { mode: 'judge', model: 'requested-model', strict: true },
      });
      expect(snapshot?.definition).not.toHaveProperty('sourceRoot');
      expect(snapshot?.definitionDigest).toBe(hashCanonical(snapshot?.definition));
      gate.guidance = 'Changed catalog';
      gate.enforcementMode = 'blocking';
      gate.pass_criteria?.push({ type: 'inline_guidance' });
      defaults.defaultMode = 'self';
      defaults.defaultModel = 'replacement-model';
      expect(snapshot?.definition['guidance']).toBe('Original guidance\nSecond line');
      expect(Reflect.set(snapshot.definition, 'guidance', 'Reinterpreted')).toBe(false);
      expect(await owner.resolveReviewEnforcement(review, [])).toBe('advisory');
      definitions.push(liveGate('g2'));
      const context = new ExecutionContext({ gate_verdict: 'GATE_REVIEW: FAIL - Retry' });
      context.state.gates.temporaryGateIds = ['g2'];
      context.state.gates.reviewGateIds = ['g1', 'g2'];
      const joined = await owner.joinSentGates(context, 's', review);
      expect(joined.semanticContext?.definitions['g1']).toBe(snapshot);
      expect(joined.semanticContext?.definitions['g1']?.definition['evaluation']).toEqual({
        mode: 'judge',
        model: 'requested-model',
        strict: true,
      });
      expect(joined.semanticContext?.definitions['g2']?.definition['evaluation']).toEqual({
        mode: 'self',
        model: 'replacement-model',
        strict: false,
      });
      await owner.joinSentGates(context, 's', joined);
      expect(load.mock.calls).toEqual([[['g1']], [['g2']]]);
    });

    test('server attempts ignore reported pins and renewal invalidates the captured target', async () => {
      const { owner } = withDefinitions([liveGate('g1')]);
      const options = {
        gateIds: ['g1'],
        instructions: 'Review',
        metadata: {
          attempt_id: 'report-attempt',
          node_id: 'report-node',
          definition_digest: 'report-digest',
        },
      };
      const first = await owner.createReview('s', 'gate', 'node-1', options);
      const second = await owner.createReview('s', 'gate', 'node-1', options);
      expect(first.semanticContext?.nodeId).toBe('node-1');
      expect(first.semanticContext?.attemptId).not.toBe('report-attempt');
      expect(first.semanticContext?.attemptId).not.toBe(second.semanticContext?.attemptId);
      expect(first.semanticContext?.target).toBeUndefined();
      const captured = owner.bindReviewOutput(first, '  A😀e\u0301 Z  ');
      const renewed = owner.renewReviewAttempt(captured);
      expect(renewed.semanticContext?.attemptId).not.toBe(captured.semanticContext?.attemptId);
      expect(renewed.semanticContext?.definitions).toBe(first.semanticContext?.definitions);
      expect(renewed.semanticContext?.target).toBeUndefined();
      const detached = await owner.createReview('s', 'detached', 'node-2', {
        ...options,
        reviewedOutput: '  A😀e\u0301 Z  ',
      });
      expect(detached.semanticContext?.target).toEqual(captured.semanticContext?.target);
    });

    test('staged mixed snapshots retain every criterion while canonical parsing narrows semantics', () => {
      const issued = stagedContext();
      const snapshot = issued.definitions['mixed'];
      if (snapshot === undefined) throw new Error('Missing snapshot');
      expect(snapshot.definition['pass_criteria']).toHaveLength(3);
      expect(readSemanticReviewCriteria(snapshot)).toEqual([
        { ...criterion, allow_not_applicable: false },
      ]);
      expect(snapshot.definition).toMatchObject({
        activation: { explicit_request: true },
        retry_config: { max_attempts: 3 },
        blockResponseOnFail: true,
      });
      expect(() => resolvePinnedSemanticContext(issued, 'mixed')).toThrow('prior captured');
      const report = {
        ...richEvaluation(),
        binding: {
          ...richEvaluation().binding,
          target_digest: hashBytes('client-provided output'),
        },
      };
      expect(
        resolvePinnedSemanticContext(
          bindSemanticReviewTarget(issued, 'actual captured output'),
          'mixed'
        ).binding.target_digest
      ).not.toBe(report.binding.target_digest);
      expect(issued.target).toBeUndefined();
    });

    test('canonical capture hashes exact trimmed UTF-8 and spans count half-open UTF-16 units', () => {
      const issued = stagedContext();
      const captured = bindSemanticReviewTarget(issued, '\n\t A😀e\u0301 Z \t');
      const pinned = resolvePinnedSemanticContext(captured, 'mixed');
      expect(pinned.target.content).toBe('A😀e\u0301 Z');
      expect(pinned.binding.target_digest).toBe(hashBytes(Buffer.from('A😀e\u0301 Z', 'utf8')));
      expect(pinned.target.content.slice(1, 5)).toBe('😀e\u0301');
      expect(pinned.binding).toEqual({
        gate_id: 'mixed',
        node_id: 'reviewed-node',
        attempt_id: 'server-attempt',
        definition_digest: issued.definitions['mixed']?.definitionDigest,
        target_digest: captured.target?.digest,
      });
      expect(bindSemanticReviewTarget(issued, 'A😀é Z').target?.digest).not.toBe(
        captured.target?.digest
      );
      expect(bindSemanticReviewTarget(issued, '  A😀e\u0301 Z  ').target).toEqual(captured.target);
    });

    test('artifact drafts cannot acquire step-output authority', () => {
      const issued = stagedContext({
        ...criterion,
        target: { kind: 'artifact', id: 'logical-artifact' },
      });
      expect(() =>
        resolvePinnedSemanticContext(bindSemanticReviewTarget(issued, 'output'), 'mixed')
      ).toThrow('Artifact semantic capture is unavailable');
    });

    test('public script-tool input preserves own special keys without a digest collision', () => {
      const input: unknown = JSON.parse(
        '{"nested":{"__proto__":{"label":"public"},"constructor":"authored"}}'
      );
      const criterion = GatePassCriteriaSchema.parse({
        type: 'script_tool',
        script_tool_id: 'fixture-tool',
        script_tool_input: input,
      });
      const gate = { ...liveGate('tool'), pass_criteria: [criterion] };
      const issued = createSemanticReviewContext('n', 'attempt', [gate]);
      const changed = createSemanticReviewContext('n', 'attempt', [
        {
          ...gate,
          pass_criteria: [
            { ...criterion, script_tool_input: { nested: { constructor: 'authored' } } },
          ],
        },
      ]);
      expect(issued.definitions['tool']?.definition['pass_criteria']).toEqual([criterion]);
      expect(issued.definitions['tool']?.definitionDigest).not.toBe(
        changed.definitions['tool']?.definitionDigest
      );
    });
  });

  describe('createReview prompt construction', () => {
    test('creates review with provided options', async () => {
      const review = await authority.createReview('session-1', 'gate', 'n1', {
        gateIds: ['gate-1', 'gate-2'],
        instructions: 'Please review carefully',
        maxAttempts: 5,
        metadata: { custom: 'data' },
      });

      expect(review.gateIds).toEqual(['gate-1', 'gate-2']);
      expect(review.combinedPrompt).toBe('Please review carefully');
      expect(review.maxAttempts).toBe(5);
      expect(review.metadata).toEqual({ custom: 'data' });
      expect(review.attemptCount).toBe(0);
      expect(review.createdAt).toBeGreaterThan(0);
    });

    test('uses default maxAttempts when not provided', async () => {
      const review = await authority.createReview('session-1', 'gate', 'n1', {
        gateIds: ['gate-1'],
        instructions: 'Review',
      });

      expect(review.maxAttempts).toBe(2); // DEFAULT_RETRY_LIMIT
    });

    test('returns empty prompts when no gateLoader provided', async () => {
      const review = await authority.createReview('session-1', 'gate', 'n1', {
        gateIds: ['gate-1'],
        instructions: 'Review',
      });

      expect(review.prompts).toEqual([]);
    });

    test('returns empty prompts when gateIds is empty', async () => {
      const mockGateLoader = { loadGates: jest.fn() } as any;
      const authorityWithLoader = new GateEnforcementAuthority(
        mockSessionManager as any,
        mockLogger as any,
        mockGateLoader
      );

      const review = await authorityWithLoader.createReview('session-1', 'gate', 'n1', {
        gateIds: [],
        instructions: 'Review',
      });

      expect(review.prompts).toEqual([]);
      expect(mockGateLoader.loadGates).not.toHaveBeenCalled();
    });

    test('populates prompts with gate criteria when gateLoader provided', async () => {
      const mockGateLoader = {
        loadGates: jest.fn().mockResolvedValue([
          {
            id: 'code-quality',
            name: 'Code Quality',
            description: 'Checks code quality',
            guidance: 'Ensure clean code with proper naming.\nSecond line of guidance.',
          },
          {
            id: 'test-coverage',
            name: 'Test Coverage',
            description: 'Validates test coverage',
            guidance: 'All public methods must have tests.',
          },
        ]),
      } as any;

      const authorityWithLoader = new GateEnforcementAuthority(
        mockSessionManager as any,
        mockLogger as any,
        mockGateLoader
      );

      const review = await authorityWithLoader.createReview('session-1', 'gate', 'n1', {
        gateIds: ['code-quality', 'test-coverage'],
        instructions: 'Review output',
      });

      expect(review.prompts).toHaveLength(2);
      expect(review.prompts[0]).toEqual({
        gateId: 'code-quality',
        gateName: 'Code Quality',
        criteriaSummary: 'Ensure clean code with proper naming.',
      });
      expect(review.prompts[1]).toEqual({
        gateId: 'test-coverage',
        gateName: 'Test Coverage',
        criteriaSummary: 'All public methods must have tests.',
      });
    });

    test('falls back to description when guidance is empty', async () => {
      const mockGateLoader = {
        loadGates: jest.fn().mockResolvedValue([
          {
            id: 'minimal-gate',
            name: 'Minimal',
            description: 'A minimal gate',
            guidance: '',
          },
        ]),
      } as any;

      const authorityWithLoader = new GateEnforcementAuthority(
        mockSessionManager as any,
        mockLogger as any,
        mockGateLoader
      );

      const review = await authorityWithLoader.createReview('session-1', 'gate', 'n1', {
        gateIds: ['minimal-gate'],
        instructions: 'Review',
      });

      expect(review.prompts[0]?.criteriaSummary).toBe('A minimal gate');
    });

    test('returns empty prompts when gate loading fails', async () => {
      const mockGateLoader = {
        loadGates: jest.fn().mockRejectedValue(new Error('Load failed')),
      } as any;

      const authorityWithLoader = new GateEnforcementAuthority(
        mockSessionManager as any,
        mockLogger as any,
        mockGateLoader
      );

      const review = await authorityWithLoader.createReview('session-1', 'gate', 'n1', {
        gateIds: ['broken-gate'],
        instructions: 'Review',
      });

      expect(review.prompts).toEqual([]);
      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });

  describe('createReview', () => {
    test('stores the review keyed by the node it grades, awaiting a verdict', async () => {
      const review = await authority.createReview('session-1', 'gate', 'n2', {
        gateIds: ['g1'],
        instructions: 'Review',
        maxAttempts: 4,
      });

      expect(review).toMatchObject({
        nodeId: 'n2',
        kind: 'gate',
        phase: 'awaiting-verdict',
        gateIds: ['g1'],
        attemptCount: 0,
        maxAttempts: 4,
      });
      expect(mockSessionManager.setReview).toHaveBeenCalledWith('session-1', review);
      // The legacy writer, which stamps a node from the run, is not the path.
      expect(mockSessionManager.setPendingGateReview).not.toHaveBeenCalled();
    });

    test('a step review is keyed by the step, and a step with no node is refused (R8)', async () => {
      const gates = { getMaxRetryLimit: () => undefined };
      const context = {
        parsedCommand: { steps: [{ stepNumber: 2, nodeId: 'draft' }] },
        gates,
      } as never;

      const created = await authority.createReviewForStep(
        context,
        { sessionId: 'session-1', currentStep: 2 } as never,
        ['g1']
      );
      expect(created?.nodeId).toBe('draft');

      await expect(
        authority.createReviewForStep(
          { parsedCommand: { steps: [] }, gates } as never,
          { sessionId: 'session-1', currentStep: 2 } as never,
          ['g1']
        )
      ).rejects.toThrow('names no node');
    });
  });

  describe('resolveReviewEnforcement (R10)', () => {
    const withGates = (modes: Record<string, EnforcementMode | undefined>) =>
      new GateEnforcementAuthority(
        mockSessionManager as any,
        mockLogger as any,
        {
          loadGates: async (ids: string[]) => ids.map((id) => ({ id, enforcementMode: modes[id] })),
        } as never
      );

    test("a review's own advisory gates decide, not a constant", async () => {
      const mode = await withGates({ soft: 'advisory' }).resolveReviewEnforcement(
        { gateIds: ['soft'] },
        []
      );
      expect(mode).toBe('advisory');
    });

    test('CONTROL: an undeclared gate counts as blocking, and a named failed gate decides', async () => {
      const authorityWithGates = withGates({ soft: 'advisory' });
      expect(
        await authorityWithGates.resolveReviewEnforcement({ gateIds: ['soft', 'plain'] }, [])
      ).toBe('blocking');
      expect(
        await authorityWithGates.resolveReviewEnforcement({ gateIds: ['soft', 'plain'] }, ['soft'])
      ).toBe('advisory');
    });
  });

  // clearPendingReview() was deleted at P4.52; recordOutcome()/resolveAction() at row 3.3, when
  // every review transition moved onto `advanceReview` in the verdict processor's one path.
});
