/**
 * Export template compilation: if/elif/else chain selection and complex expressions.
 *
 * Covers row 1.2 of plans/opencode-parity-p1-close-client-gaps-2026-08-21.md — the
 * shared compileIfChain rules both client compilers delegate to. Production callers
 * never supply argument values (export renders the reader's view), so the no-supply
 * cases assert the F18 else-preference; supplied-value cases exercise first-truthy
 * selection that only tests can reach.
 */
import { describe, expect, it } from '@jest/globals';

import {
  compileTemplate,
  compileTemplateToPlaintext,
  emitGateFiles,
  findTemplateFidelityGaps,
  type SkillIR,
} from '../../../src/modules/skills-sync/service.js';

const NO_ARGS: never[] = [];

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
  };
}

describe('compileTemplate if/elif/else chains', () => {
  it('prefers the else branch when nothing is supplied (F18)', () => {
    const out = compileTemplate('{% if phase %}A{% else %}B{% endif %}', NO_ARGS);
    expect(out).toBe('B');
  });

  it('selects the first truthy elif when its argument is supplied', () => {
    const out = compileTemplate('{% if a %}A{% elif b %}B{% else %}C{% endif %}', NO_ARGS, {
      b: 'yes',
    });
    expect(out).toBe('B');
  });

  it('falls through to else when every condition is false', () => {
    const out = compileTemplate('{% if a %}A{% elif b %}B{% else %}C{% endif %}', NO_ARGS);
    expect(out).toBe('C');
  });

  it('renders empty for an elif chain with no else and nothing truthy', () => {
    const out = compileTemplate('{% if a %}A{% elif b %}B{% endif %}', NO_ARGS);
    expect(out).toBe('');
  });

  it('keeps the content of a lone bare-word if with no else (legacy behavior)', () => {
    const out = compileTemplate('before{% if design_mode %}DM{% endif %}after', NO_ARGS);
    expect(out).toBe('beforeDMafter');
  });

  it('resolves nested chains against their own matching endif', () => {
    const tpl =
      '{% if phase %}{% if work_type == "bug_fix" %}INNER{% endif %}OUTER-TAIL{% else %}ELSE{% endif %}';
    // Nothing supplied: outer chain takes its else; inner chain never evaluated.
    expect(compileTemplate(tpl, NO_ARGS)).toBe('ELSE');
    // Outer condition supplied: inner expression chain renders empty (no else), tail survives.
    expect(compileTemplate(tpl, NO_ARGS, { phase: '1' })).toBe('OUTER-TAIL');
    expect(compileTemplate(tpl, NO_ARGS, { phase: '1', work_type: 'bug_fix' })).toBe(
      'INNEROUTER-TAIL'
    );
  });
});

describe('compileTemplate complex expressions', () => {
  it('evaluates == against the supplied value', () => {
    const tpl = '{% if work_type == "bug_fix" %}FIX{% else %}OTHER{% endif %}';
    expect(compileTemplate(tpl, NO_ARGS, { work_type: 'bug_fix' })).toBe('FIX');
    expect(compileTemplate(tpl, NO_ARGS)).toBe('OTHER');
    expect(compileTemplate(tpl, NO_ARGS, { work_type: 'feature' })).toBe('OTHER');
  });

  it('handles unquoted == literals', () => {
    const out = compileTemplate('{% if mode == fast %}FAST{% else %}SLOW{% endif %}', NO_ARGS, {
      mode: 'fast',
    });
    expect(out).toBe('FAST');
  });

  it('evaluates or across disjuncts', () => {
    const out = compileTemplate('{% if a or b %}EITHER{% else %}NEITHER{% endif %}', NO_ARGS, {
      b: 'x',
    });
    expect(out).toBe('EITHER');
  });

  it('negates with not', () => {
    const out = compileTemplate('{% if not verbose %}QUIET{% endif %}', NO_ARGS, {});
    expect(out).toBe('QUIET');
    expect(compileTemplate('{% if not verbose %}QUIET{% endif %}', NO_ARGS, { verbose: '1' })).toBe(
      ''
    );
  });
});

describe('compileTemplateToPlaintext parity', () => {
  it('applies identical chain selection to the Agent Skills compiler', () => {
    const tpl = '{% if a %}A{% elif b %}B{% else %}C{% endif %}';
    expect(compileTemplateToPlaintext(tpl, NO_ARGS)).toBe('C');
    expect(compileTemplateToPlaintext(tpl, NO_ARGS, { a: '1' })).toBe('A');
  });

  it('still renders {{arg}} as a literal {arg} placeholder', () => {
    expect(compileTemplateToPlaintext('Hello {{name}}', NO_ARGS)).toBe('Hello {name}');
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
