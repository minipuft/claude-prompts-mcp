// @lifecycle test - Standalone semantic acceptance and the live-loader activation boundary.
import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { dump, load } from 'js-yaml';

import { GateDefinitionLoader } from '../../../src/engine/gates/core/gate-definition-loader.js';
import { SemanticCriterionSchema } from '../../../src/engine/gates/core/gate-schema.js';
import { evaluateSemanticEvaluation } from '../../../src/engine/gates/core/semantic-evaluation.js';
import { hashBytes } from '../../../src/shared/utils/hash.js';

import type {
  PinnedSemanticEvaluationContext,
  SemanticCriterionInput,
  SemanticEvaluationReport,
  SemanticObservation,
} from '../../../src/shared/types/gate-evaluation.js';

const draft = {
  type: 'semantic_evaluation',
  id: 'supports-claim',
  target: { kind: 'step_output' },
  question: 'Does the captured output support the claim?',
  evidence_requirements: { min_items: 1 },
  result: { kind: 'boolean' },
  acceptance: { kind: 'equals', value: true },
} satisfies SemanticCriterionInput;

function pinnedReport(): {
  context: PinnedSemanticEvaluationContext;
  report: SemanticEvaluationReport;
} {
  const drafts: SemanticCriterionInput[] = [
    draft,
    {
      ...draft,
      id: 'support-category',
      result: { kind: 'category', options: ['supported', 'unsupported'] },
      acceptance: { kind: 'one_of', values: ['supported'] },
    },
    {
      ...draft,
      id: 'support-score',
      result: {
        kind: 'score',
        min: 0,
        max: 2,
        anchors: [
          { value: 0, description: 'No support' },
          { value: 1, description: 'Partial support' },
          { value: 2, description: 'Complete support' },
        ],
      },
      acceptance: { kind: 'gte', value: 1 },
    },
  ];
  const content = '🔎 Evidence: the captured output cites the measured result.';
  const context: PinnedSemanticEvaluationContext = {
    criteria: drafts.map((entry) => SemanticCriterionSchema.parse(entry)),
    binding: {
      gate_id: 'semantic-contract',
      node_id: 'node-1',
      attempt_id: 'attempt-1',
      definition_digest: hashBytes(dump(drafts)),
      target_digest: hashBytes(content),
    },
    target: { kind: 'step_output', content },
  };
  const values = new Map<string, boolean | string | number>([
    ['supports-claim', true],
    ['support-category', 'supported'],
    ['support-score', 2],
  ]);
  return {
    context,
    report: {
      binding: { ...context.binding },
      observations: context.criteria.map((criterion) => ({
        criterion_id: criterion.id,
        state: 'met',
        value: values.get(criterion.id),
        evidence: [
          {
            target_digest: context.binding.target_digest,
            start: content.indexOf('Evidence'),
            end: content.length,
            quote: 'Evidence: the captured output cites the measured result.',
          },
        ],
        rationale: 'The captured citation supports this result.',
      })),
    },
  };
}

describe('standalone schema-to-kernel semantic contract', () => {
  test('accepts a complete report for parsed domains and a pinned captured target', () => {
    const { context, report } = pinnedReport();
    expect(context.criteria.every((entry) => entry.allow_not_applicable === false)).toBe(true);
    expect(evaluateSemanticEvaluation(context, report)).toEqual({
      valid: true,
      passed: true,
      issues: [],
      criteria: context.criteria.map((criterion) => ({
        criterion_id: criterion.id,
        state: 'met',
        valid: true,
        passed: true,
        issues: [],
      })),
    });
  });

  test.each<[string, string, Partial<SemanticObservation>]>([
    ['missing evidence', 'evidence_required', { evidence: [] }],
    ['score beyond the declared maximum', 'invalid_value', { value: 3 }],
    ['met state with a rejected bounded score', 'state_disagreement', { value: 0 }],
  ])('refuses %s after the complete report passes', (_name, issueCode, mutation) => {
    const { context, report } = pinnedReport();
    expect(evaluateSemanticEvaluation(context, report).passed).toBe(true);
    const seeded: SemanticEvaluationReport = {
      ...report,
      observations: report.observations.map((observation) =>
        observation.criterion_id === 'support-score' ? { ...observation, ...mutation } : observation
      ),
    };
    const result = evaluateSemanticEvaluation(context, seeded);
    expect(result.valid).toBe(false);
    expect(result.passed).toBe(false);
    expect(result.issues).toEqual([
      expect.objectContaining({ code: issueCode, criterion_id: 'support-score' }),
    ]);
    expect(result.criteria.filter((entry) => entry.passed)).toHaveLength(2);
  });
});

describe('real gate loader accepts canonical semantic definitions', () => {
  let gatesDir: string;

  beforeEach(() => {
    gatesDir = mkdtempSync(join(tmpdir(), 'cpm-semantic-contract-'));
  });

  afterEach(() => {
    rmSync(gatesDir, { recursive: true, force: true });
  });

  function writeGate(id: string, passCriteria: readonly unknown[]): string {
    const directory = join(gatesDir, id);
    mkdirSync(directory, { recursive: true });
    const path = join(directory, 'gate.yaml');
    writeFileSync(
      path,
      dump({
        id,
        name: 'Contract fixture',
        type: 'validation',
        description: 'Temporary loader control',
        guidance: 'Review the captured evidence.',
        pass_criteria: passCriteria,
      })
    );
    return path;
  }

  test('loads legacy guidance and a defaulted semantic criterion', () => {
    const legacyCriterion = { type: 'inline_guidance', description: 'Review the evidence.' };
    writeGate('legacy-control', [legacyCriterion]);
    const draftPath = writeGate('semantic-draft', [draft]);
    const authored = load(readFileSync(draftPath, 'utf8')) as { pass_criteria: unknown[] };
    expect(SemanticCriterionSchema.parse(authored.pass_criteria[0])).toEqual({
      ...draft,
      allow_not_applicable: false,
    });

    const loader = new GateDefinitionLoader({ gatesDir, enableCache: false });
    const legacy = loader.loadGate('legacy-control');
    expect(legacy?.pass_criteria).toEqual([expect.objectContaining(legacyCriterion)]);
    expect(loader.getQuarantine().byId('legacy-control')).toHaveLength(0);

    expect(loader.loadGate('semantic-draft')?.pass_criteria).toEqual([
      { ...draft, allow_not_applicable: false },
    ]);
    expect(loader.getQuarantine().byId('semantic-draft')).toHaveLength(0);
    expect(loader.getQuarantine().size).toBe(0);
    expect(loader.loadGate('legacy-control')?.id).toBe('legacy-control');
  });
});
