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

/**
 * The `type` field is a CLOSED enum, unlike the passthrough keys above. A pre-rename value fails
 * loudly at parse rather than dropping silently, so this preprocess exists to keep older gate
 * files loading at all — not to prevent a silent loss.
 *
 * NEGATIVE-VERIFY TARGET: remove the `z.preprocess` wrapper around `type` in `gate-schema.ts` and
 * the pre-rename case must fail with a Zod enum error.
 */
describe('pass_criteria type rename: methodology_compliance -> framework_compliance', () => {
  it('accepts the canonical value', () => {
    const parsed = GatePassCriteriaSchema.parse({ type: 'framework_compliance' }) as {
      type: string;
    };

    expect(parsed.type).toBe('framework_compliance');
  });

  it('normalises the pre-rename value instead of rejecting it', () => {
    const parsed = GatePassCriteriaSchema.parse({ type: 'methodology_compliance' }) as {
      type: string;
    };

    expect(parsed.type).toBe('framework_compliance');
  });

  it('still rejects a value that is neither spelling', () => {
    expect(() => GatePassCriteriaSchema.parse({ type: 'not_a_real_type' })).toThrow();
  });

  it('leaves the other criteria types untouched', () => {
    for (const type of ['inline_guidance', 'llm_self_check', 'shell_verify', 'script_tool']) {
      expect((GatePassCriteriaSchema.parse({ type }) as { type: string }).type).toBe(type);
    }
  });
});
