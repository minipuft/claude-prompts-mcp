/**
 * A gate authored before the framework rename must keep its compliance target.
 *
 * `GatePassCriteriaSchema` is `.passthrough()`, so a pre-rename `methodology:` key survives on the
 * parsed object but never reaches a typed consumer — `criteria.framework` reads as undefined and
 * the criterion silently evaluates as though no framework were named. That is the same failure
 * mode that made all 8 frameworks contribute zero gates (regression #3 of this sweep), so the
 * fold-forward gets a test rather than a comment.
 */

import { GatePassCriteriaSchema } from '../../../src/engine/gates/core/gate-schema.js';

describe('pass_criteria framework fold-forward', () => {
  it('reads the canonical `framework` key', () => {
    const parsed = GatePassCriteriaSchema.parse({
      type: 'methodology_compliance',
      framework: 'CAGEERF',
    }) as { framework?: string };

    expect(parsed.framework).toBe('CAGEERF');
  });

  it('folds the pre-rename `methodology` key forward', () => {
    const parsed = GatePassCriteriaSchema.parse({
      type: 'methodology_compliance',
      methodology: 'ReACT',
    }) as { framework?: string };

    expect(parsed.framework).toBe('ReACT');
  });

  it('prefers the canonical key when a file carries both', () => {
    const parsed = GatePassCriteriaSchema.parse({
      type: 'methodology_compliance',
      framework: 'CAGEERF',
      methodology: 'ReACT',
    }) as { framework?: string };

    expect(parsed.framework).toBe('CAGEERF');
  });
});
