/**
 * P4.11 — the pure renderer framework `inspect` uses to read back the 11 advanced fields.
 *
 * Bounded by design: CLAUDE.md § Instruction surface records that a prompt's declared text is
 * delivered to the client's context before anyone invokes anything, and `judge_prompt` /
 * `template_enhancements` are exactly that shape — resource-authored strings. These tests assert
 * the summary is a COUNT or a truncated first line, never the field's content, and that a field
 * absent from `FrameworkCreationData` produces no line at all (never a printed default).
 */
import { describe, expect, it } from '@jest/globals';

import {
  ADVANCED_FRAMEWORK_FIELD_KEYS,
  renderAdvancedFrameworkFields,
  summarizeAdvancedFieldValue,
} from '../../../../src/mcp/tools/framework-manager/services/framework-advanced-field-summary.js';

import type { FrameworkCreationData } from '../../../../src/mcp/tools/framework-manager/core/types.js';

const baseFramework: FrameworkCreationData = {
  id: 'summary-test',
  name: 'Summary Test',
  type: 'CUSTOM',
  system_prompt_guidance: 'guidance',
};

describe('summarizeAdvancedFieldValue', () => {
  it('reports array length, not the array content', () => {
    const value = [
      { id: 'g1', name: 'Gate 1' },
      { id: 'g2', name: 'Gate 2' },
    ];

    // MUTATION KILLED: changing `value.length` to a hardcoded `0` inside `pluralize(value.length,
    // 'item')` makes this fail ('0 items' instead of '2 items'). Confirmed by applying the
    // mutation, re-running this file (red), and reverting.
    expect(summarizeAdvancedFieldValue(value)).toBe('2 items');
    expect(summarizeAdvancedFieldValue([value[0]])).toBe('1 item');
  });

  it('truncates a string to its first line, bounded — never the full body', () => {
    const longFirstLine = 'x'.repeat(120);
    const multiline = `${longFirstLine}\nSECOND LINE MUST NOT LEAK`;

    const result = summarizeAdvancedFieldValue(multiline);

    // MUTATION KILLED: returning `value` unmodified instead of the truncated first line makes
    // both assertions fail — the full 120-char run survives and the second line leaks through.
    // Confirmed by applying the mutation, re-running this file (red), and reverting.
    expect(result.length).toBeLessThan(longFirstLine.length);
    expect(result).not.toContain('SECOND LINE MUST NOT LEAK');
  });

  it('reports key count for a plain object, not its entries', () => {
    expect(summarizeAdvancedFieldValue({ a: 1, b: 2, c: 3 })).toBe('3 keys');
  });
});

describe('renderAdvancedFrameworkFields', () => {
  it('renders nothing when no advanced field is set', () => {
    expect(renderAdvancedFrameworkFields(baseFramework)).toBe('');
  });

  it('renders only the fields present, each as a bounded summary line', () => {
    const framework: FrameworkCreationData = {
      ...baseFramework,
      framework_gates: [
        {
          id: 'g1',
          name: 'Gate 1',
          description: 'd',
          frameworkArea: 'a',
          priority: 'high',
          validationCriteria: ['c1'],
        },
      ],
      judge_prompt: 'JUDGE_FIRST_LINE\nJUDGE_SECOND_LINE_MUST_NOT_APPEAR',
    };

    const rendered = renderAdvancedFrameworkFields(framework);

    expect(rendered).toContain('framework_gates: 1 item');
    expect(rendered).toContain('judge_prompt: JUDGE_FIRST_LINE');
    expect(rendered).not.toContain('JUDGE_SECOND_LINE_MUST_NOT_APPEAR');

    // MUTATION KILLED: removing the `if (value === undefined) continue;` guard makes every key in
    // ADVANCED_FRAMEWORK_FIELD_KEYS print, including the 9 this framework never set. Confirmed by
    // applying the mutation, re-running this file (red — extra lines for e.g. `execution_steps`
    // appear), and reverting.
    for (const key of ADVANCED_FRAMEWORK_FIELD_KEYS) {
      if (key === 'framework_gates' || key === 'judge_prompt') continue;
      expect(rendered).not.toContain(`${key}:`);
    }
  });
});
