/**
 * Substituted values are DATA, never template source.
 *
 * Security review 2026-08-25, Tier 2.2 / 2.5. Two separate paths feed
 * caller-influenced strings into a Nunjucks render as context values:
 *
 *   - prompt arguments        -> `processTemplate(template, args)`
 *   - captured chain output   -> `templateContext['previous_step_output']`,
 *                                assigned in `chain-operator-executor.ts` and
 *                                rendered by `renderTemplateString`
 *
 * Neither concatenates the value into the template STRING, so neither should
 * ever evaluate it. That is a property of how the render is called, not of the
 * values themselves — a single future change to double-render, or to build the
 * template by concatenation, converts both paths into server-side template
 * injection at once. These tests exist to fail loudly if that happens, because
 * the failure would otherwise be silent and reachable from ordinary input.
 *
 * Reproduced live before writing them: `{{ 7*7 }}` supplied as an argument
 * rendered as the literal `{{ 7*7 }}`, not `49`.
 */

import { describe, expect, it } from '@jest/globals';

import { processTemplate } from '../../../src/shared/utils/jsonUtils.js';

describe('substituted values are data, not template source', () => {
  it('does not evaluate arithmetic supplied in an argument value', () => {
    const out = processTemplate('START {{payload}} END', { payload: '{{ 7*7 }}' });

    expect(out).toContain('{{ 7*7 }}');
    expect(out).not.toContain('49');
  });

  it('does not evaluate a tag supplied in an argument value', () => {
    const out = processTemplate('START {{payload}} END', {
      payload: '{% set leaked = 1 %}{{ leaked }}',
    });

    expect(out).toContain('{% set leaked = 1 %}');
  });

  it('does not resolve a constructor-reaching payload supplied as a value', () => {
    // The canonical Nunjucks SSTI shape. If a value were ever re-parsed, this is
    // the expression that turns template injection into code execution.
    const payload = '{{ range.constructor("return 1")() }}';
    const out = processTemplate('START {{payload}} END', { payload });

    expect(out).toContain('range.constructor');
  });

  it('does not evaluate a payload arriving as captured chain step output', () => {
    // Same call shape `chain-operator-executor` uses: the previous step's text is a
    // context key, and the step template references it by name.
    const out = processTemplate('Prior step said: {{previous_step_output}}', {
      previous_step_output: 'STEP_OUT {{ 7*7 }} END',
    });

    expect(out).toContain('{{ 7*7 }}');
    expect(out).not.toContain('49');
  });

  it('still evaluates expressions written in the TEMPLATE itself', () => {
    // The negative assertions above must not be passing because rendering is
    // broken outright. An author writing `{{ 7*7 }}` in their own template is
    // exercising a feature, not an injection.
    expect(processTemplate('{{ 7*7 }}', {})).toContain('49');
  });
});
