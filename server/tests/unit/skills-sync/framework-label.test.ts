// @lifecycle test - Framework display label composition (F14).
/**
 * F14: `resources/frameworks/cageerf/framework.yaml` ships
 * `name: C.A.G.E.E.R.F Framework` and two surfaces append the word again,
 * rendering "C.A.G.E.E.R.F Framework framework" in the exported SKILL.md and in
 * live `>>` output. Fixed in the formatter, not the resource, because a name is
 * user-editable data.
 */
import { describe, expect, it } from '@jest/globals';

import { frameworkLabel } from '../../../src/shared/utils/framework-label.js';

describe('frameworkLabel (F14)', () => {
  it('does not repeat the word when the name already ends in it', () => {
    expect(frameworkLabel('C.A.G.E.E.R.F Framework')).toBe('C.A.G.E.E.R.F Framework');
  });

  it('appends the word when the name does not carry it', () => {
    expect(frameworkLabel('ReACT')).toBe('ReACT framework');
  });

  it('matches case-insensitively', () => {
    expect(frameworkLabel('Some framework')).toBe('Some framework');
    expect(frameworkLabel('Some FRAMEWORK')).toBe('Some FRAMEWORK');
  });

  it('does not strip a name that merely contains the word mid-string', () => {
    // Guards the inverse: a fix that searched anywhere in the string would
    // wrongly suppress the suffix here.
    expect(frameworkLabel('Framework Of Thought')).toBe('Framework Of Thought framework');
  });

  it('does not match a word that merely ends in those letters', () => {
    expect(frameworkLabel('Metaframework')).toBe('Metaframework framework');
  });
});
