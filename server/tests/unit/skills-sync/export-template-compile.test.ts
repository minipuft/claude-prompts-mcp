/**
 * Export template compilation: if/elif/else chain selection and complex expressions.
 *
 * Covers row 1.2 of plans/opencode-parity-p1-close-client-gaps-2026-08-21.md — the
 * compileIfChain rules that the one export compiler, shared by every client adapter,
 * delegates to. Production callers
 * never supply argument values (export renders the reader's view), so the no-supply
 * cases assert the F18 else-preference; supplied-value cases exercise first-truthy
 * selection that only tests can reach.
 *
 * Also pins the chain-step arm of the fidelity detector and the generated gate-review hook's
 * source header and gate list.
 */
import { describe, expect, it } from '@jest/globals';

import {
  buildGateReviewHookScript,
  compileTemplate,
  emitGateFiles,
  findTemplateFidelityGaps,
  type SkillIR,
} from '../../../src/modules/skills-sync/service.js';

function minimalIR(userMessage: string): SkillIR {
  return {
    id: 'test-prompt',
    name: 'Test Prompt',
    description: 'test',
    resourceType: 'prompt',
    category: null,
    enabled: true,
    systemMessage: null,
    userMessage,
    guidanceContent: null,
    arguments: [],
    chainSteps: [],
    scriptTools: [],
    gateRefs: [],
    chainStepContents: [],
    docFiles: [],
    gateData: null,
    frameworkData: null,
    styleData: null,
    extensions: {},
    sourcePaths: ['/fixture/prompt.yaml'],
    sourceHash: '',
  };
}

describe('compileTemplate if/elif/else chains', () => {
  it('prefers the else branch when nothing is supplied (F18)', () => {
    const out = compileTemplate('{% if phase %}A{% else %}B{% endif %}');
    expect(out).toBe('B');
  });

  it('selects the first truthy elif when its argument is supplied', () => {
    const out = compileTemplate('{% if a %}A{% elif b %}B{% else %}C{% endif %}', {
      b: 'yes',
    });
    expect(out).toBe('B');
  });

  it('falls through to else when every condition is false', () => {
    const out = compileTemplate('{% if a %}A{% elif b %}B{% else %}C{% endif %}');
    expect(out).toBe('C');
  });

  it('renders empty for an elif chain with no else and nothing truthy', () => {
    const out = compileTemplate('{% if a %}A{% elif b %}B{% endif %}');
    expect(out).toBe('');
  });

  it('keeps the content of a lone bare-word if with no else (legacy behavior)', () => {
    const out = compileTemplate('before{% if design_mode %}DM{% endif %}after');
    expect(out).toBe('beforeDMafter');
  });

  it('resolves nested chains against their own matching endif', () => {
    const tpl =
      '{% if phase %}{% if work_type == "bug_fix" %}INNER{% endif %}OUTER-TAIL{% else %}ELSE{% endif %}';
    // Nothing supplied: outer chain takes its else; inner chain never evaluated.
    expect(compileTemplate(tpl)).toBe('ELSE');
    // Outer condition supplied: inner expression chain renders empty (no else), tail survives.
    expect(compileTemplate(tpl, { phase: '1' })).toBe('OUTER-TAIL');
    expect(compileTemplate(tpl, { phase: '1', work_type: 'bug_fix' })).toBe('INNEROUTER-TAIL');
  });
});

describe('compileTemplate chain edge cases', () => {
  it('treats an unknown condition form as falsy, so only the else branch can win', () => {
    const tpl = '{% if a > 1 %}BIG{% else %}SMALL{% endif %}';
    expect(compileTemplate(tpl)).toBe('SMALL');
    // Supplying the left operand does not make `>` evaluable: the whole form is unknown.
    expect(compileTemplate(tpl, { a: '5' })).toBe('SMALL');
    // Without an else the non-bare condition has no fallback and renders empty.
    expect(compileTemplate('x{% if a > 1 %}BIG{% endif %}y', { a: '5' })).toBe('xy');
  });

  it('lets a truthy disjunct rescue an unknown-form disjunct', () => {
    const out = compileTemplate('{% if a > 1 or b %}YES{% else %}NO{% endif %}', {
      b: 'on',
    });
    expect(out).toBe('YES');
  });

  it('renders empty for a single non-bare condition with no else, but keeps a bare one', () => {
    // `a b` is neither a bare word nor a known form: no legacy keep-content fallback applies.
    expect(compileTemplate('[{% if a b %}BODY{% endif %}]')).toBe('[]');
    expect(compileTemplate('[{% if a %}BODY{% endif %}]')).toBe('[BODY]');
  });

  it('keeps an else inside a nested chain with that chain, not the outer one', () => {
    const tpl =
      '{% if a %}{% if b %}B{% else %}NOT-B{% endif %}TAIL{% else %}OUTER-ELSE{% endif %}';
    // The inner else sits at depth 2, so the outer chain still has exactly one else branch.
    expect(compileTemplate(tpl)).toBe('OUTER-ELSE');
    expect(compileTemplate(tpl, { a: '1' })).toBe('NOT-BTAIL');
    expect(compileTemplate(tpl, { a: '1', b: '1' })).toBe('BTAIL');
  });

  it('passes an unbalanced if through verbatim and compiles what follows it', () => {
    expect(compileTemplate('before{% if a %}rest')).toBe('before{% if a %}rest');
    // The inner chain closes, the outer never does: the outer opener survives as text while the
    // inner chain is still compiled (its else wins, nothing supplied).
    expect(compileTemplate('{% if a %}X{% if b %}Y{% else %}Z{% endif %}')).toBe('{% if a %}XZ');
  });

  it('honors whitespace-trimming tags and single-quoted literals', () => {
    const tpl = "{%- if mode == 'fast' -%}FAST{%- else -%}SLOW{%- endif -%}";
    expect(compileTemplate(tpl, { mode: 'fast' })).toBe('FAST');
    expect(compileTemplate(tpl, { mode: 'slow' })).toBe('SLOW');
  });

  it('negates one disjunct without negating the whole or-expression', () => {
    const tpl = '{% if not a or b %}HIT{% else %}MISS{% endif %}';
    expect(compileTemplate(tpl)).toBe('HIT');
    expect(compileTemplate(tpl, { a: '1' })).toBe('MISS');
    expect(compileTemplate(tpl, { a: '1', b: '1' })).toBe('HIT');
  });
});

describe('compileTemplate complex expressions', () => {
  it('evaluates == against the supplied value', () => {
    const tpl = '{% if work_type == "bug_fix" %}FIX{% else %}OTHER{% endif %}';
    expect(compileTemplate(tpl, { work_type: 'bug_fix' })).toBe('FIX');
    expect(compileTemplate(tpl)).toBe('OTHER');
    expect(compileTemplate(tpl, { work_type: 'feature' })).toBe('OTHER');
  });

  it('handles unquoted == literals', () => {
    const out = compileTemplate('{% if mode == fast %}FAST{% else %}SLOW{% endif %}', {
      mode: 'fast',
    });
    expect(out).toBe('FAST');
  });

  it('evaluates or across disjuncts', () => {
    const out = compileTemplate('{% if a or b %}EITHER{% else %}NEITHER{% endif %}', {
      b: 'x',
    });
    expect(out).toBe('EITHER');
  });

  it('negates with not', () => {
    const out = compileTemplate('{% if not verbose %}QUIET{% endif %}', {});
    expect(out).toBe('QUIET');
    expect(compileTemplate('{% if not verbose %}QUIET{% endif %}', { verbose: '1' })).toBe('');
  });
});

describe('compileTemplate placeholders', () => {
  it('renders {{arg}} as a literal {arg} placeholder', () => {
    expect(compileTemplate('Hello {{name}}')).toBe('Hello {name}');
  });
});

describe('findTemplateFidelityGaps elif and expression detection', () => {
  it('names an elif branch as compiled-to-fallback', () => {
    const gaps = findTemplateFidelityGaps(minimalIR('{% if a %}A{% elif b %}B{% endif %}'));
    const elifGap = gaps.find((g) => g.detail.includes('elif'));
    expect(elifGap).toBeDefined();
    expect(elifGap?.kind).toBe('control-flow');
  });

  it('names a complex if-expression as evaluated against unsupplied args', () => {
    for (const expr of ['x == "y"', 'a or b', 'not quiet']) {
      const gaps = findTemplateFidelityGaps(minimalIR(`{% if ${expr} %}BODY{% endif %}`));
      const gap = gaps.find((g) => g.kind === 'expression' && g.detail.includes('{% if'));
      expect(gap).toBeDefined();
    }
  });

  it('reads chain-step contents and labels each gap with its step', () => {
    const ir = minimalIR('plain');
    ir.chainStepContents = [
      {
        stepId: 'analyze',
        promptYaml: '',
        systemMessage: '{% for x in xs %}{{ x }}{% endfor %}',
        userMessage: '{% if a %}A{% elif b %}B{% endif %}',
      },
      { stepId: 'empty', promptYaml: '', systemMessage: null, userMessage: null },
    ];
    const details = findTemplateFidelityGaps(ir).map((g) => g.detail);
    expect(details).toEqual(
      expect.arrayContaining([
        'step analyze system message: {% for %} survives verbatim',
        expect.stringContaining('step analyze user message: {% elif %} compiles to the fallback'),
      ])
    );
    // A step whose messages are null contributes nothing.
    expect(details.some((d) => d.startsWith('step empty'))).toBe(false);
    // Top-level content is clean, so every gap came from a chain step.
    expect(details.every((d) => d.startsWith('step analyze'))).toBe(true);
  });

  it('does not flag plain bare-word if blocks', () => {
    const gaps = findTemplateFidelityGaps(minimalIR('{% if design_mode %}DM{% endif %}'));
    expect(gaps.find((g) => g.kind === 'expression' && g.detail.includes('{% if'))).toBeUndefined();
  });
});

describe('emitGateFiles index.json manifest', () => {
  const gateYaml = [
    'id: code-quality',
    'name: Code Quality Standards',
    'type: validation',
    'description: Ensures generated code follows best practices',
    'pass_criteria:',
    '  - type: inline_guidance',
    '    min_length: 100',
  ].join('\n');

  it('emits a manifest with ids and criteria matching the gate artifacts', () => {
    const files = emitGateFiles(
      [
        {
          id: 'code-quality',
          source: 'registered',
          gateYamlContent: gateYaml,
          guidanceContent: '# guidance',
        },
      ],
      'my-skill',
      'my-skill'
    );

    const manifest = files.find((f) => f.relativePath === 'my-skill/gates/index.json');
    expect(manifest).toBeDefined();
    const parsed = JSON.parse(manifest!.content);
    expect(parsed.skill).toBe('my-skill');
    expect(parsed.gates).toHaveLength(1);
    expect(parsed.gates[0].id).toBe('code-quality');
    expect(parsed.gates[0].name).toBe('Code Quality Standards');
    expect(parsed.gates[0].pass_criteria).toHaveLength(1);
    // Manifest sits beside the per-gate artifacts it indexes
    expect(
      files.find((f) => f.relativePath === 'my-skill/gates/code-quality/gate.yaml')
    ).toBeDefined();
  });

  it('omits the manifest when no skill id is given (legacy callers)', () => {
    const files = emitGateFiles(
      [{ id: 'g', source: 'registered', gateYamlContent: gateYaml, guidanceContent: null }],
      'skill'
    );
    expect(files.find((f) => f.relativePath.endsWith('index.json'))).toBeUndefined();
  });

  it('omits the manifest when there are no registered gates', () => {
    const files = emitGateFiles([], 'skill', 'skill');
    expect(files.find((f) => f.relativePath.endsWith('index.json'))).toBeUndefined();
  });
});

describe('buildGateReviewHookScript', () => {
  const withGates = (category: string | null, ids: string[]): SkillIR => ({
    ...minimalIR('body'),
    category,
    gateRefs: ids.map((id) => ({
      id,
      source: 'registered' as const,
      gateYamlContent: null,
      guidanceContent: null,
    })),
  });

  it('names a prompt without a category by id alone', () => {
    const script = buildGateReviewHookScript(withGates(null, ['code-quality']));
    expect(script).toContain('Source resource: prompt:test-prompt\n');
    expect(script).toContain('GATES = ["code-quality"]');
  });

  it('prefixes the category when the prompt has one', () => {
    const script = buildGateReviewHookScript(withGates('development', ['a', 'b']));
    expect(script).toContain('Source resource: prompt:development/test-prompt\n');
    expect(script).toContain('GATES = ["a","b"]');
  });

  it('emits an empty gate list when the prompt references no gates', () => {
    const script = buildGateReviewHookScript(withGates(null, []));
    expect(script).toContain('GATES = []');
    expect(script).toContain('GATE_REVIEW:');
  });
});
