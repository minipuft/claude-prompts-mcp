/**
 * Pins the `{METHODOLOGY}` -> `{FRAMEWORK_TYPE}` placeholder rename (plan row 5.1) and, since
 * 5.7, the RETIREMENT of the back-compat fold that accepted the old spelling.
 *
 * NEGATIVE-VERIFY TARGET: restore the `DEPRECATED_FRAMEWORK_TYPE_PLACEHOLDER` replace in
 * `template-variables.ts` and the "no longer substitutes" case must fail.
 */

import {
  TEMPLATE_VARIABLE_NAMES,
  substituteTemplateVariables,
  type TemplateVariableValues,
} from '../../../src/engine/frameworks/prompt-guidance/template-variables.js';

const VALUES: TemplateVariableValues = {
  promptName: 'Build First Prompt',
  promptCategory: 'tutorials',
  frameworkName: 'CAGEERF Framework',
  frameworkType: 'CAGEERF',
  promptType: 'chain',
};

describe('substituteTemplateVariables', () => {
  it('substitutes every advertised placeholder', () => {
    const template = TEMPLATE_VARIABLE_NAMES.map((name) => `${name}={${name}}`).join('|');

    expect(substituteTemplateVariables(template, VALUES)).toBe(
      [
        'PROMPT_NAME=Build First Prompt',
        'PROMPT_CATEGORY=tutorials',
        'FRAMEWORK_NAME=CAGEERF Framework',
        'FRAMEWORK_TYPE=CAGEERF',
        'PROMPT_TYPE=chain',
      ].join('|')
    );
  });

  it('leaves no advertised placeholder unsubstituted', () => {
    const template = TEMPLATE_VARIABLE_NAMES.map((name) => `{${name}}`).join(' ');

    expect(substituteTemplateVariables(template, VALUES)).not.toMatch(/\{[A-Z_]+\}/);
  });

  it('no longer substitutes the pre-rename {METHODOLOGY} spelling', () => {
    expect(substituteTemplateVariables('type={METHODOLOGY}', VALUES)).toBe('type={METHODOLOGY}');
  });

  it('leaves the retired spelling literal while the canonical one still resolves', () => {
    expect(substituteTemplateVariables('{METHODOLOGY} vs {FRAMEWORK_TYPE}', VALUES)).toBe(
      '{METHODOLOGY} vs CAGEERF'
    );
  });

  it('keeps FRAMEWORK_NAME and FRAMEWORK_TYPE distinct', () => {
    // The rename exists because the old name read as a sibling of {FRAMEWORK_NAME} while
    // resolving to `framework.type`. These must not collapse.
    expect(substituteTemplateVariables('{FRAMEWORK_NAME}/{FRAMEWORK_TYPE}', VALUES)).toBe(
      'CAGEERF Framework/CAGEERF'
    );
  });

  it('advertises the new spelling and not the deprecated one', () => {
    expect(TEMPLATE_VARIABLE_NAMES).toContain('FRAMEWORK_TYPE');
    expect(TEMPLATE_VARIABLE_NAMES).not.toContain('METHODOLOGY');
  });

  it('replaces every occurrence, not just the first', () => {
    expect(substituteTemplateVariables('{FRAMEWORK_TYPE} {FRAMEWORK_TYPE}', VALUES)).toBe(
      'CAGEERF CAGEERF'
    );
  });
});
