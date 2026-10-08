import {
  resolveJudgeConfig,
  buildJudgeEnvelope,
  renderJudgePrompt,
  isJudgeMode,
  renderSemanticReviewPrompt,
} from '../../../../src/engine/gates/judge/judge-prompt-builder.js';
import {
  composeJudgeReviewPrompt,
  composeReviewPrompt,
} from '../../../../src/engine/gates/core/review-utils.js';
import { GATE_VERDICT_REQUIRED_FORMAT } from '../../../../src/engine/gates/core/gate-verdict-contract.js';

import type {
  JudgeEvaluationConfig,
  JudgeEvaluationDefaults,
  JudgeEnvelope,
  SemanticReviewPromptInput,
} from '../../../../src/engine/gates/judge/types.js';
import type { LightweightGateDefinition } from '../../../../src/engine/gates/types.js';

describe('resolveJudgeConfig', () => {
  it('returns self mode with defaults when no config provided', () => {
    const result = resolveJudgeConfig();
    expect(result.mode).toBe('self');
    expect(result.model).toBeUndefined();
    expect(result.strict).toBe(false); // strict defaults to (mode === 'judge')
  });

  it('uses gate-level config over global defaults', () => {
    const gateConfig: Partial<JudgeEvaluationConfig> = {
      mode: 'judge',
      model: 'haiku',
      strict: false,
    };
    const globalDefaults: Partial<JudgeEvaluationDefaults> = {
      defaultMode: 'self',
      defaultModel: 'sonnet',
      strict: true,
    };

    const result = resolveJudgeConfig(gateConfig, globalDefaults);
    expect(result.mode).toBe('judge');
    expect(result.model).toBe('haiku');
    expect(result.strict).toBe(false);
  });

  it('falls back to global defaults when gate config is partial', () => {
    const gateConfig: Partial<JudgeEvaluationConfig> = { mode: 'judge' };
    const globalDefaults: Partial<JudgeEvaluationDefaults> = {
      defaultModel: 'haiku',
      strict: false,
    };

    const result = resolveJudgeConfig(gateConfig, globalDefaults);
    expect(result.mode).toBe('judge');
    expect(result.model).toBe('haiku');
    expect(result.strict).toBe(false);
  });

  it('defaults strict to true when mode is judge and no explicit setting', () => {
    const result = resolveJudgeConfig({ mode: 'judge' });
    expect(result.strict).toBe(true);
  });

  it('defaults strict to false when mode is self and no explicit setting', () => {
    const result = resolveJudgeConfig({ mode: 'self' });
    expect(result.strict).toBe(false);
  });

  it('uses global defaultMode when gate config has no mode', () => {
    const result = resolveJudgeConfig({}, { defaultMode: 'judge' });
    expect(result.mode).toBe('judge');
  });
});

describe('buildJudgeEnvelope', () => {
  it('builds envelope with all fields', () => {
    const envelope = buildJudgeEnvelope(
      'The quick brown fox',
      'Code Quality',
      'code-quality',
      ['Check for proper error handling', 'Validate input types'],
      true
    );

    expect(envelope.output).toBe('The quick brown fox');
    expect(envelope.gateName).toBe('Code Quality');
    expect(envelope.gateId).toBe('code-quality');
    expect(envelope.criteria).toEqual(['Check for proper error handling', 'Validate input types']);
    expect(envelope.strict).toBe(true);
    expect(envelope.verdictFormat).toBe(GATE_VERDICT_REQUIRED_FORMAT);
  });

  it('defaults strict to true', () => {
    const envelope = buildJudgeEnvelope('output', 'Gate', 'gate-id', ['criteria']);
    expect(envelope.strict).toBe(true);
  });

  it('respects explicit strict=false', () => {
    const envelope = buildJudgeEnvelope('output', 'Gate', 'gate-id', ['criteria'], false);
    expect(envelope.strict).toBe(false);
  });
});

describe('renderJudgePrompt', () => {
  const baseEnvelope: JudgeEnvelope = {
    output: 'function add(a, b) { return a + b; }',
    criteria: ['Includes error handling', 'Has type annotations'],
    gateName: 'Code Quality',
    gateId: 'code-quality',
    strict: true,
    verdictFormat: GATE_VERDICT_REQUIRED_FORMAT,
  };

  it('renders header with independent reviewer framing', () => {
    const prompt = renderJudgePrompt(baseEnvelope);
    expect(prompt).toContain('## Judge Evaluation — Independent Quality Audit');
    expect(prompt).toContain('independent quality reviewer');
    expect(prompt).toContain('You did NOT produce this output');
  });

  it('includes the output in a code block', () => {
    const prompt = renderJudgePrompt(baseEnvelope);
    expect(prompt).toContain('### Output Under Review');
    expect(prompt).toContain('```');
    expect(prompt).toContain('function add(a, b) { return a + b; }');
  });

  it('lists all criteria', () => {
    const prompt = renderJudgePrompt(baseEnvelope);
    expect(prompt).toContain('### Evaluation Criteria (Code Quality)');
    expect(prompt).toContain('- Includes error handling');
    expect(prompt).toContain('- Has type annotations');
  });

  it('uses strict protocol when strict=true', () => {
    const prompt = renderJudgePrompt(baseEnvelope);
    expect(prompt).toContain('### Evaluation Protocol');
    expect(prompt).toContain('**FAILS**');
    expect(prompt).toContain('Only PASS if you cannot find genuine failures');
  });

  it('uses balanced protocol when strict=false', () => {
    const envelope: JudgeEnvelope = { ...baseEnvelope, strict: false };
    const prompt = renderJudgePrompt(envelope);
    expect(prompt).toContain('### Evaluation Protocol');
    expect(prompt).not.toContain('**FAILS**');
    expect(prompt).toContain('substantially meets all criteria');
  });

  it('includes verdict format', () => {
    const prompt = renderJudgePrompt(baseEnvelope);
    expect(prompt).toContain(GATE_VERDICT_REQUIRED_FORMAT);
  });

  it('does not include chain history, framework context, or reasoning', () => {
    const prompt = renderJudgePrompt(baseEnvelope);
    // Judge prompt should be clean — no execution context leaks
    expect(prompt).not.toContain('Chain History');
    expect(prompt).not.toContain('Framework');
    expect(prompt).not.toContain('CAGEERF');
    expect(prompt).not.toContain('EXECUTION CONTEXT');
  });
});

describe('isJudgeMode', () => {
  it('returns true for judge mode', () => {
    expect(isJudgeMode({ mode: 'judge', model: undefined, strict: true })).toBe(true);
  });

  it('returns false for self mode', () => {
    expect(isJudgeMode({ mode: 'self', model: undefined, strict: false })).toBe(false);
  });
});

describe('public semantic review projection', () => {
  const publicReview: SemanticReviewPromptInput = {
    gateId: 'gate-α',
    criteria: [
      {
        type: 'semantic_evaluation',
        id: 'boolean-α',
        question: 'Contains "evidence"?\nExplain.',
        target: { kind: 'step_output' },
        result: { kind: 'boolean' },
        acceptance: { kind: 'equals', value: true },
        evidence_requirements: { min_items: 1 },
        allow_not_applicable: false,
      },
      {
        type: 'semantic_evaluation',
        id: 'category',
        question: 'Select public category.',
        target: { kind: 'artifact', id: 'public-artifact-reference' },
        result: { kind: 'category', options: ['supported', 'unsupported', 'unknown'] },
        acceptance: { kind: 'one_of', values: ['supported', 'unknown'] },
        evidence_requirements: { min_items: 2 },
        allow_not_applicable: true,
      },
      {
        type: 'semantic_evaluation',
        id: 'score',
        question: 'Rate evidence completeness.',
        target: { kind: 'step_output' },
        result: {
          kind: 'score',
          min: 0,
          max: 4,
          anchors: [
            { value: 0, description: 'No evidence' },
            { value: 4, description: 'Complete evidence' },
          ],
        },
        acceptance: { kind: 'gte', value: 3 },
        evidence_requirements: { min_items: 1 },
        allow_not_applicable: false,
      },
    ],
    binding: {
      gate_id: 'gate-α',
      node_id: 'node "α"',
      attempt_id: 'server-attempt',
      definition_digest: 'frozen-definition',
      target_digest: 'captured-target',
    },
  };
  const gate: LightweightGateDefinition = {
    id: publicReview.gateId,
    name: 'Public gate',
    type: 'validation',
    description: 'Public description',
    guidance: 'Legacy guidance remains.',
    evaluation: { mode: 'judge', model: 'requested-model' },
  };
  const selfPrompts = [{ gateId: publicReview.gateId, criteriaSummary: gate.guidance! }];
  const renderBoth = (reviews: readonly SemanticReviewPromptInput[]) => [
    composeReviewPrompt(selfPrompts, undefined, [], { createdAt: 42 }, reviews).combinedPrompt,
    composeJudgeReviewPrompt([gate], 'ACTUAL OUTPUT', reviews).judgePrompt,
  ];

  it('preserves the complete public criterion rubric through both actual composers', () => {
    for (const prompt of renderBoth([publicReview])) {
      expect(prompt).toContain(JSON.stringify(publicReview.criteria, null, 2));
      expect(prompt).toContain('Legacy guidance remains.');
    }
  });

  it('preserves every server binding pin verbatim through both actual composers', () => {
    for (const prompt of renderBoth([publicReview])) {
      expect(prompt).toContain(JSON.stringify(publicReview.binding, null, 2));
      expect(prompt).toContain('copy exactly');
      expect(prompt).not.toContain('No binding is available yet');
    }
  });

  it('uses the identical semantic block for self, composed judge and direct judge envelope', () => {
    const common = renderSemanticReviewPrompt([publicReview]);
    const envelope = buildJudgeEnvelope('ACTUAL OUTPUT', gate.name, gate.id, ['legacy'], true, [
      publicReview,
    ]);
    for (const prompt of [...renderBoth([publicReview]), renderJudgePrompt(envelope)]) {
      expect(prompt).toContain(common);
    }
    expect(envelope.semanticReviews).toEqual([publicReview]);
  });

  it('describes capture first when no server binding exists without manufacturing pins', () => {
    const unbound: SemanticReviewPromptInput = {
      gateId: publicReview.gateId,
      criteria: publicReview.criteria,
    };
    for (const prompt of renderBoth([unbound])) {
      expect(prompt).toContain('Capture the node output first');
      expect(prompt).toContain('No binding is available yet');
      expect(prompt).not.toContain('server-attempt');
      expect(prompt).not.toContain('definition_digest');
      expect(prompt).not.toContain('Server-issued binding (copy exactly)');
    }
  });

  it('describes report states, per-gate placement and captured UTF-16 evidence consistently', () => {
    for (const prompt of renderBoth([publicReview])) {
      expect(prompt).toContain('gate_verdict.per_gate');
      expect(prompt).toContain('met, unmet, insufficient_evidence or not_applicable');
      expect(prompt).toContain('half-open UTF-16 start/end');
      expect(prompt).toContain('quote is optional');
      expect(prompt).toContain('not_applicable is permitted only by allow_not_applicable');
      expect(prompt).toContain('Do not invent missing pins');
    }
  });

  it('names the actual report observation and evidence keys in self and judge composers', () => {
    for (const prompt of renderBoth([publicReview])) {
      expect(prompt).toContain('Each report contains binding and observations.');
      expect(prompt).toContain('criterion_id, state, value, evidence and rationale');
      expect(prompt).toContain(
        'Each evidence reference uses target_digest, start, end and optional quote.'
      );
      expect(prompt).toContain('evidence.target_digest equals binding.target_digest');
      expect(prompt).not.toContain('evidence.digest');
    }
  });

  it('requires structured reports as the final semantic judge instruction', () => {
    const prompt = composeJudgeReviewPrompt([gate], 'OUTPUT', [publicReview]).judgePrompt;
    const finalInstruction = prompt.split('\n').at(-1);
    expect(finalInstruction).toContain('Respond with structured gate_verdict.per_gate entries');
    expect(finalInstruction).toContain('unchanged server-issued binding and observations');
    expect(finalInstruction).toContain('companion only and is insufficient');
    expect(finalInstruction).not.toContain('Respond with:');
  });

  it('retains the exact legacy judge final instruction when semantic reviews are absent or empty', () => {
    const legacy = composeJudgeReviewPrompt([gate], 'OUTPUT').judgePrompt;
    expect(legacy.split('\n').at(-1)).toBe(`Respond with: \`${GATE_VERDICT_REQUIRED_FORMAT}\``);
    expect(composeJudgeReviewPrompt([gate], 'OUTPUT', []).judgePrompt).toBe(legacy);
    expect(legacy).not.toContain('structured gate_verdict.per_gate');
  });

  it('keeps multiple gate rubrics and binding attribution separate', () => {
    const firstCriterion = publicReview.criteria[0];
    if (firstCriterion === undefined) throw new Error('Fixture has no first criterion');
    const second: SemanticReviewPromptInput = {
      gateId: 'gate-b',
      criteria: [{ ...firstCriterion, id: 'criterion-b', question: 'Second public question.' }],
      binding: { ...publicReview.binding!, gate_id: 'gate-b', attempt_id: 'second-attempt' },
    };
    const secondGate = { ...gate, id: 'gate-b' };
    const judge = composeJudgeReviewPrompt([gate, secondGate], 'OUTPUT', [
      publicReview,
      second,
    ]).judgePrompt;
    const self = composeReviewPrompt(
      [...selfPrompts, { gateId: 'gate-b', criteriaSummary: 'Second' }],
      undefined,
      [],
      undefined,
      [publicReview, second]
    ).combinedPrompt;
    for (const prompt of [judge, self]) {
      expect(prompt).toContain(renderSemanticReviewPrompt([publicReview]).split('\n\nSubmit')[0]);
      expect(prompt).toContain('### Semantic Evaluation: gate-b');
      expect(prompt).toContain(JSON.stringify(second.criteria, null, 2));
      expect(prompt).toContain(JSON.stringify(second.binding, null, 2));
    }
  });

  it('excludes projections for gates outside each advertised composer', () => {
    const extra = { ...publicReview, gateId: 'unadvertised-gate' };
    for (const prompt of renderBoth([extra])) {
      expect(prompt).not.toContain('unadvertised-gate');
      expect(prompt).not.toContain('captured-target');
      expect(prompt).not.toContain('### Semantic Evaluation');
    }
  });

  it('projects declared public fields without private metadata or claimed host identity', () => {
    const injected = {
      ...publicReview,
      privateCases: ['PRIVATE CASE'],
      generationHistory: 'PRIVATE HISTORY',
      archivePath: '/PRIVATE ARCHIVE',
      reviewer: { provenance: 'host_verified' },
      criteria: publicReview.criteria.map((criterion) => ({
        ...criterion,
        expectedLabel: 'PRIVATE LABEL',
      })),
      binding: { ...publicReview.binding!, sourceModelInstance: 'PRIVATE INSTANCE' },
    };
    for (const prompt of renderBoth([injected])) {
      for (const privateText of [
        'PRIVATE CASE',
        'PRIVATE HISTORY',
        'PRIVATE ARCHIVE',
        'PRIVATE LABEL',
        'PRIVATE INSTANCE',
        'host_verified',
        'requested-model',
      ]) {
        expect(prompt).not.toContain(privateText);
      }
    }
  });

  it('does not mutate a caller-frozen public projection', () => {
    const frozen = Object.freeze({
      ...publicReview,
      criteria: Object.freeze(publicReview.criteria),
      binding: Object.freeze(publicReview.binding!),
    });
    const before = JSON.stringify(frozen);
    expect(() => renderBoth([frozen])).not.toThrow();
    expect(JSON.stringify(frozen)).toBe(before);
  });

  it('retains legacy prompt bytes and omitted envelope shape when no projection is supplied', () => {
    expect(composeReviewPrompt(selfPrompts, undefined, [], { createdAt: 42 }).combinedPrompt).toBe(
      composeReviewPrompt(selfPrompts, undefined, [], { createdAt: 42 }, []).combinedPrompt
    );
    expect(composeJudgeReviewPrompt([gate], 'OUTPUT').judgePrompt).toBe(
      composeJudgeReviewPrompt([gate], 'OUTPUT', []).judgePrompt
    );
    expect(buildJudgeEnvelope('OUTPUT', 'Gate', 'gate', [])).not.toHaveProperty('semanticReviews');
    expect(renderSemanticReviewPrompt([])).toBe('');
    expect(composeJudgeReviewPrompt([], 'OUTPUT', [publicReview]).judgePrompt).toBe('');
  });
});
