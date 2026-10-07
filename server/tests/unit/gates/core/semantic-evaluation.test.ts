// @lifecycle test - Pinned semantic acceptance, abstention and evidence-integrity controls.
import { createHash } from 'node:crypto';

import { describe, expect, test } from '@jest/globals';

import { evaluateSemanticEvaluation } from '../../../../src/engine/gates/core/semantic-evaluation.js';
import { hashBytes } from '../../../../src/shared/utils/hash.js';

import type {
  PinnedSemanticEvaluationContext,
  SemanticCriterion,
  SemanticEvaluationBinding,
  SemanticEvaluationReport,
  SemanticEvidenceRef,
  SemanticObservation,
} from '../../../../src/shared/types/gate-evaluation.js';

function criterion(overrides: Partial<SemanticCriterion> = {}): SemanticCriterion {
  return {
    type: 'semantic_evaluation',
    id: 'preserves-contract',
    target: { kind: 'step_output' },
    question: 'Does the implementation preserve the declared contract?',
    evidence_requirements: { min_items: 1 },
    result: { kind: 'boolean' },
    acceptance: { kind: 'equals', value: true },
    allow_not_applicable: false,
    ...overrides,
  };
}
function context(
  criteria: readonly SemanticCriterion[] = [criterion()],
  content = 'The contract is preserved.'
): PinnedSemanticEvaluationContext {
  return {
    criteria,
    binding: {
      gate_id: 'contract-gate',
      node_id: 'node-1',
      attempt_id: 'attempt-1',
      definition_digest: hashBytes('frozen definition'),
      target_digest: hashBytes(content),
    },
    target: { kind: 'step_output', content },
  };
}
function evidence(
  pinned: PinnedSemanticEvaluationContext,
  overrides: Partial<SemanticEvidenceRef> = {}
): SemanticEvidenceRef {
  return {
    target_digest: pinned.binding.target_digest,
    start: 0,
    end: pinned.target.content.length,
    quote: pinned.target.content,
    ...overrides,
  };
}
function first<T>(values: readonly T[]): T {
  const value = values[0];
  if (value === undefined) throw new Error('This fixture requires a nonempty array');
  return value;
}
function observation(
  pinned: PinnedSemanticEvaluationContext,
  overrides: Partial<SemanticObservation> = {}
): SemanticObservation {
  return {
    criterion_id: first(pinned.criteria).id,
    state: 'met',
    value: true,
    evidence: [evidence(pinned)],
    rationale: 'The cited target supports this observation.',
    ...overrides,
  };
}
function report(
  pinned: PinnedSemanticEvaluationContext,
  observations: readonly SemanticObservation[] = [observation(pinned)]
): SemanticEvaluationReport {
  return { binding: { ...pinned.binding }, observations };
}
function expectInvalid(
  pinned: PinnedSemanticEvaluationContext,
  submitted: unknown,
  code?: string
): ReturnType<typeof evaluateSemanticEvaluation> {
  const result = evaluateSemanticEvaluation(pinned, submitted);
  expect(result.valid).toBe(false);
  expect(result.passed).toBe(false);
  expect(result.issues.length).toBeGreaterThan(0);
  if (code !== undefined) expect(result.issues.some((entry) => entry.code === code)).toBe(true);
  return result;
}

describe('evaluateSemanticEvaluation', () => {
  test('accepts a complete grounded boolean report without changing its inputs', () => {
    const pinned = context();
    const submitted = report(pinned);
    const before = JSON.stringify({ pinned, submitted });
    const result = evaluateSemanticEvaluation(pinned, submitted);
    expect(result).toEqual({
      valid: true,
      passed: true,
      issues: [],
      criteria: [
        { criterion_id: criterion().id, state: 'met', valid: true, passed: true, issues: [] },
      ],
    });
    expect(JSON.stringify({ pinned, submitted })).toBe(before);
  });

  test('a consistent unmet boolean is valid and fails acceptance', () => {
    const pinned = context();
    const result = evaluateSemanticEvaluation(
      pinned,
      report(pinned, [observation(pinned, { state: 'unmet', value: false })])
    );
    expect(result).toMatchObject({
      valid: true,
      passed: false,
      issues: [],
      criteria: [{ state: 'unmet', valid: true, passed: false }],
    });
  });

  test('supports declarative boolean equals false', () => {
    const pinned = context([criterion({ acceptance: { kind: 'equals', value: false } })]);
    expect(
      evaluateSemanticEvaluation(pinned, report(pinned, [observation(pinned, { value: false })]))
        .passed
    ).toBe(true);
  });

  test.each([
    { kind: 'equals' as const, value: 'good' },
    { kind: 'one_of' as const, values: ['good', 'excellent'] },
  ])('derives category acceptance from %j', (acceptance) => {
    const pinned = context([
      criterion({
        result: { kind: 'category', options: ['poor', 'good', 'excellent'] },
        acceptance,
      }),
    ]);
    expect(
      evaluateSemanticEvaluation(pinned, report(pinned, [observation(pinned, { value: 'good' })]))
        .passed
    ).toBe(true);
    expect(
      evaluateSemanticEvaluation(
        pinned,
        report(pinned, [observation(pinned, { value: 'poor', state: 'unmet' })])
      )
    ).toMatchObject({ valid: true, passed: false });
    expectInvalid(
      pinned,
      report(pinned, [observation(pinned, { value: 'unknown' })]),
      'invalid_value'
    );
    expectInvalid(
      pinned,
      report(pinned, [observation(pinned, { value: 'Good' })]),
      'invalid_value'
    );
    expectInvalid(pinned, report(pinned, [observation(pinned, { value: 1 })]), 'invalid_value');
  });

  test.each(['gte', 'lte'] as const)(
    'score %s uses inclusive domain/threshold boundaries',
    (kind) => {
      const pinned = context([
        criterion({
          result: {
            kind: 'score',
            min: 0,
            max: 10,
            anchors: [
              { value: 0, description: 'No support' },
              { value: 10, description: 'Complete support' },
            ],
          },
          acceptance: { kind, value: 5 },
        }),
      ]);
      for (const value of [0, 4.999, 5, 5.001, 10]) {
        const passed = kind === 'gte' ? value >= 5 : value <= 5;
        const result = evaluateSemanticEvaluation(
          pinned,
          report(pinned, [observation(pinned, { value, state: passed ? 'met' : 'unmet' })])
        );
        expect(result).toMatchObject({ valid: true, passed, issues: [] });
      }
      for (const value of [-0.001, 10.001, NaN, Infinity, -Infinity, '5', true]) {
        expectInvalid(pinned, report(pinned, [observation(pinned, { value })]));
      }
    }
  );

  test.each([
    { value: false, state: 'met' as const },
    { value: true, state: 'unmet' as const },
  ])('refuses state disagreement %j', (overrides) => {
    const pinned = context();
    expectInvalid(pinned, report(pinned, [observation(pinned, overrides)]), 'state_disagreement');
  });

  test.each(['gate_id', 'node_id', 'attempt_id', 'definition_digest', 'target_digest'] as const)(
    'refuses stale/cross-execution %s',
    (key: keyof SemanticEvaluationBinding) => {
      const pinned = context();
      const submitted = report(pinned);
      const result = expectInvalid(
        pinned,
        { ...submitted, binding: { ...submitted.binding, [key]: 'other' } },
        'binding_mismatch'
      );
      expect(result.criteria[0]?.state).toBe('invalid');
      expect(result.issues[0]?.message).toContain(key);
    }
  );

  test('matching report/context digests cannot bless uncaptured target bytes', () => {
    const pinned = context();
    const forged = {
      ...pinned,
      binding: { ...pinned.binding, target_digest: hashBytes('different content') },
    };
    expectInvalid(forged, report(forged), 'target_digest_mismatch');
    expectInvalid(
      { ...pinned, target: { ...pinned.target, content: 'changed after pinning' } },
      report(pinned),
      'target_digest_mismatch'
    );
  });

  test('requires canonical sha256-prefixed digests', () => {
    const pinned = context();
    const bare = {
      ...pinned,
      binding: {
        ...pinned.binding,
        target_digest: pinned.binding.target_digest.replace('sha256:', ''),
      },
    };
    expectInvalid(bare, report(bare), 'target_digest_mismatch');
  });

  test('matches artifact identity and refuses criterion target kind/ID mismatches', () => {
    const artifactCriterion = criterion({ target: { kind: 'artifact', id: 'design.md' } });
    const draft = context([artifactCriterion]);
    const pinned = {
      ...draft,
      target: { ...draft.target, kind: 'artifact' as const, id: 'design.md' },
    };
    expect(evaluateSemanticEvaluation(pinned, report(pinned)).passed).toBe(true);
    expectInvalid(draft, report(draft), 'target_mismatch');
    expectInvalid(
      { ...pinned, target: { ...pinned.target, id: 'other.md' } },
      report(pinned),
      'target_mismatch'
    );
    expectInvalid(
      { ...pinned, target: { kind: 'artifact', content: pinned.target.content } },
      report(pinned),
      'target_mismatch'
    );
    const stepCriterionOnArtifact = { ...pinned, criteria: [criterion()] };
    expectInvalid(stepCriterionOnArtifact, report(stepCriterionOnArtifact), 'target_mismatch');
  });

  test('each criterion is checked against the one captured target', () => {
    const pinned = context([
      criterion(),
      criterion({ id: 'artifact-only', target: { kind: 'artifact', id: 'design.md' } }),
    ]);
    const observations = pinned.criteria.map((entry) =>
      observation(pinned, { criterion_id: entry.id })
    );
    const result = expectInvalid(pinned, report(pinned, observations), 'target_mismatch');
    expect(result.criteria.map((entry) => entry.state)).toEqual(['met', 'invalid']);
  });

  test('empty pinned criteria fail closed instead of vacuous PASS', () => {
    const pinned = context([]);
    expectInvalid(pinned, report(pinned, []), 'invalid_context');
  });

  test('rejects duplicate pinned IDs, missing observations, unknown IDs and duplicate observations', () => {
    const pinned = context();
    expectInvalid(context([criterion(), criterion()]), report(pinned), 'duplicate_criterion');
    expectInvalid(pinned, report(pinned, []), 'missing_observation');
    expectInvalid(
      pinned,
      report(pinned, [observation(pinned), observation(pinned, { criterion_id: 'not-authored' })]),
      'unknown_criterion'
    );
    expectInvalid(
      pinned,
      report(pinned, [observation(pinned), observation(pinned)]),
      'duplicate_observation'
    );
    const substituted = expectInvalid(
      pinned,
      report(pinned, [observation(pinned, { criterion_id: 'not-authored' })]),
      'missing_observation'
    );
    expect(substituted.issues.some((entry) => entry.code === 'unknown_criterion')).toBe(true);
  });

  test('missing evidence negative control: a met value alone never passes', () => {
    const pinned = context();
    const result = expectInvalid(
      pinned,
      report(pinned, [observation(pinned, { evidence: [] })]),
      'evidence_required'
    );
    expect(result.criteria[0]).toMatchObject({ state: 'invalid', valid: false, passed: false });
  });

  test('unmet still requires grounded evidence', () => {
    const pinned = context();
    expectInvalid(
      pinned,
      report(pinned, [observation(pinned, { value: false, state: 'unmet', evidence: [] })]),
      'evidence_required'
    );
  });

  test('deduplicates same-span references within a criterion but allows reuse across criteria', () => {
    const pinned = context([criterion({ evidence_requirements: { min_items: 2 } })]);
    const first = evidence(pinned, { start: 0, end: 3, quote: 'The' });
    const repeatedWithoutQuote = {
      target_digest: first.target_digest,
      start: first.start,
      end: first.end,
    };
    expectInvalid(
      pinned,
      report(pinned, [observation(pinned, { evidence: [first, repeatedWithoutQuote] })]),
      'evidence_required'
    );
    const second = evidence(pinned, { start: 4, end: 12, quote: 'contract' });
    expect(
      evaluateSemanticEvaluation(
        pinned,
        report(pinned, [observation(pinned, { evidence: [first, second] })])
      ).passed
    ).toBe(true);
    const minimumOne = context();
    expect(
      evaluateSemanticEvaluation(
        minimumOne,
        report(minimumOne, [
          observation(minimumOne, { evidence: [evidence(minimumOne), evidence(minimumOne)] }),
        ])
      ).passed
    ).toBe(true);
    const shared = context([criterion(), criterion({ id: 'second' })]);
    expect(
      evaluateSemanticEvaluation(
        shared,
        report(
          shared,
          shared.criteria.map((entry) => observation(shared, { criterion_id: entry.id }))
        )
      ).passed
    ).toBe(true);
  });

  test.each([
    { start: 0, end: 0 },
    { start: 3, end: 1 },
    { start: -1, end: 2 },
    { start: 0.5, end: 2 },
    { start: 0, end: 1000 },
    { start: NaN, end: 2 },
    { start: 0, end: Infinity },
    { quote: 'not the slice' },
    { target_digest: hashBytes('other') },
  ])('refuses invalid evidence %j', (overrides) => {
    const pinned = context();
    expectInvalid(
      pinned,
      report(pinned, [observation(pinned, { evidence: [evidence(pinned, overrides)] })])
    );
  });

  test('UTF-8 digest and UTF-16 half-open offsets have distinct Unicode semantics', () => {
    const content = 'A😀e\u0301 Z';
    const pinned = context(undefined, content);
    expect(pinned.binding.target_digest).toBe(
      `sha256:${createHash('sha256').update(Buffer.from(content, 'utf8')).digest('hex')}`
    );
    expect(content.length).toBe(7);
    const emoji = evidence(pinned, { start: 1, end: 3, quote: '😀' });
    expect(
      evaluateSemanticEvaluation(
        pinned,
        report(pinned, [observation(pinned, { evidence: [emoji] })])
      ).passed
    ).toBe(true);
    expectInvalid(
      pinned,
      report(pinned, [
        observation(pinned, { evidence: [evidence(pinned, { start: 1, end: 2, quote: '😀' })] }),
      ]),
      'invalid_evidence'
    );
    const halfSurrogate = evidence(pinned, { start: 1, end: 2, quote: content.slice(1, 2) });
    expect(
      evaluateSemanticEvaluation(
        pinned,
        report(pinned, [observation(pinned, { evidence: [halfSurrogate] })])
      ).passed
    ).toBe(true);
    const combining = evidence(pinned, { start: 3, end: 5, quote: 'e\u0301' });
    expect(
      evaluateSemanticEvaluation(
        pinned,
        report(pinned, [observation(pinned, { evidence: [combining] })])
      ).passed
    ).toBe(true);
    expectInvalid(
      pinned,
      report(pinned, [
        observation(pinned, { evidence: [evidence(pinned, { start: 3, end: 5, quote: 'é' })] }),
      ]),
      'invalid_evidence'
    );
    const final = { target_digest: pinned.binding.target_digest, start: 6, end: 7 };
    expect(
      evaluateSemanticEvaluation(
        pinned,
        report(pinned, [observation(pinned, { evidence: [final] })])
      ).passed
    ).toBe(true);
  });

  test('insufficient evidence is a valid abstention, never acceptance', () => {
    const pinned = context();
    const result = evaluateSemanticEvaluation(
      pinned,
      report(pinned, [
        observation(pinned, { state: 'insufficient_evidence', value: undefined, evidence: [] }),
      ])
    );
    expect(result).toMatchObject({
      valid: true,
      passed: false,
      issues: [],
      criteria: [{ state: 'insufficient_evidence', valid: true, passed: false }],
    });
    expectInvalid(
      pinned,
      report(pinned, [observation(pinned, { state: 'insufficient_evidence', evidence: [] })]),
      'unexpected_value'
    );
    expectInvalid(
      pinned,
      report(pinned, [
        observation(pinned, {
          state: 'insufficient_evidence',
          value: undefined,
          evidence: [evidence(pinned, { quote: 'wrong' })],
        }),
      ]),
      'invalid_evidence'
    );
  });

  test('N/A needs authored permission, nonempty rationale and required bound evidence', () => {
    const pinned = context([
      criterion({ allow_not_applicable: true, evidence_requirements: { min_items: 2 } }),
    ]);
    const refs = [
      evidence(pinned, { start: 0, end: 3, quote: 'The' }),
      evidence(pinned, { start: 4, end: 12, quote: 'contract' }),
    ] as const;
    const na = observation(pinned, {
      state: 'not_applicable',
      value: undefined,
      evidence: refs,
      rationale: 'This target explicitly excludes the condition.',
    });
    expect(evaluateSemanticEvaluation(pinned, report(pinned, [na]))).toMatchObject({
      valid: true,
      passed: true,
      criteria: [{ state: 'not_applicable', valid: true, passed: true }],
    });
    expectInvalid(context(), report(pinned, [na]), 'not_applicable_denied');
    expectInvalid(pinned, report(pinned, [{ ...na, rationale: ' \n\t' }]), 'not_applicable_denied');
    expectInvalid(pinned, report(pinned, [{ ...na, evidence: [] }]), 'evidence_required');
    expectInvalid(
      pinned,
      report(pinned, [{ ...na, evidence: [refs[0], refs[0]] }]),
      'evidence_required'
    );
    expectInvalid(
      pinned,
      report(pinned, [
        { ...na, evidence: [refs[0], evidence(pinned, { target_digest: hashBytes('stale') })] },
      ]),
      'invalid_evidence'
    );
    expectInvalid(pinned, report(pinned, [{ ...na, value: false }]), 'unexpected_value');
  });

  test('whole acceptance requires every criterion, including abstention/failure', () => {
    const pinned = context([criterion(), criterion({ id: 'second' })]);
    for (const second of [
      { state: 'unmet' as const, value: false },
      { state: 'insufficient_evidence' as const, value: undefined, evidence: [] },
    ]) {
      const result = evaluateSemanticEvaluation(
        pinned,
        report(pinned, [
          observation(pinned),
          observation(pinned, { criterion_id: 'second', ...second }),
        ])
      );
      expect(result).toMatchObject({ valid: true, passed: false, issues: [] });
      expect(result.criteria[0]?.passed).toBe(true);
      expect(result.criteria[1]?.passed).toBe(false);
    }
  });

  test.each([
    null,
    true,
    5,
    'PASS',
    [],
    {},
    { binding: null, observations: [] },
    { binding: {}, observations: [] },
  ])('malformed report %j fails closed without throwing', (submitted) => {
    expectInvalid(context(), submitted, 'invalid_report');
  });

  test.each([
    null,
    {},
    { criterion_id: 'preserves-contract' },
    { state: 'met', value: true },
    { criterion_id: 1 },
    { criterion_id: 'preserves-contract', state: 'PASS' },
  ])('malformed observation %j fails closed', (submitted) => {
    const pinned = context();
    expectInvalid(
      pinned,
      { binding: pinned.binding, observations: [submitted] },
      'invalid_observation'
    );
  });

  test.each([
    { evidence: undefined },
    { evidence: null },
    { evidence: {} },
    { evidence: [null] },
    { rationale: undefined },
    { value: undefined },
    { value: null },
    { value: 'true' },
    { extra: 'smuggled authority' },
    { evidence: [{ target_digest: 'x', start: 0, end: 1, quote: 1 }] },
  ])('malformed met payload %j is invalid rather than abstention', (overrides) => {
    const pinned = context();
    const submitted = { ...observation(pinned), ...overrides };
    const result = expectInvalid(pinned, { binding: pinned.binding, observations: [submitted] });
    expect(result.criteria[0]?.state).toBe('invalid');
  });

  test('canonical definition schema refuses incompatible predicates and malformed drafts', () => {
    for (const bad of [
      criterion({ acceptance: { kind: 'gte', value: 1 } }),
      criterion({ evidence_requirements: { min_items: 0 } }),
      criterion({ question: ' ' }),
      criterion({
        result: { kind: 'category', options: ['yes', 'yes'] },
        acceptance: { kind: 'equals', value: 'yes' },
      }),
    ]) {
      const pinned = context([bad]);
      expectInvalid(pinned, report(pinned), 'invalid_context');
    }
    const pinned = context();
    expectInvalid(
      { ...pinned, criteria: [null] } as unknown as PinnedSemanticEvaluationContext,
      report(pinned),
      'invalid_context'
    );
    expectInvalid(
      null as unknown as PinnedSemanticEvaluationContext,
      report(pinned),
      'invalid_context'
    );
  });

  test('criterion drafts use the canonical denied-N/A default', () => {
    const pinned = context();
    const { allow_not_applicable: _policy, ...draft } = first(pinned.criteria);
    const unparsed = { ...pinned, criteria: [draft] } as unknown as PinnedSemanticEvaluationContext;
    expect(evaluateSemanticEvaluation(unparsed, report(pinned)).passed).toBe(true);
    expectInvalid(
      unparsed,
      report(pinned, [observation(pinned, { state: 'not_applicable', value: undefined })]),
      'not_applicable_denied'
    );
  });
});
