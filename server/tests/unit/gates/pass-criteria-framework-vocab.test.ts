/**
 * `pass_criteria` speaks one vocabulary: `framework`.
 *
 * This file replaces `pass-criteria-framework-fold.test.ts`, which pinned the two back-compat
 * folds retired in plan row 5.7. The folds accepted a pre-rename `methodology:` key and silently
 * normalised a `methodology_compliance` type value. Both are gone, so the assertions here are the
 * inverse of the ones they replace: the old spellings must now be INERT and REJECTED respectively.
 *
 * Keeping the file rather than deleting it is deliberate. A retirement with no test asserting the
 * old path is gone is indistinguishable from a fold that was never exercised — and this sweep has
 * twice shipped a `.passthrough()` key that parsed cleanly while reaching no consumer.
 *
 * NEGATIVE-VERIFY TARGET: reinstate either fold in `gate-schema.ts` and the two "no longer"
 * assertions below must fail.
 */

import { GatePassCriteriaSchema } from '../../../src/engine/gates/core/gate-schema.js';

describe('pass_criteria framework key', () => {
  it('reads the canonical `framework` key', () => {
    const parsed = GatePassCriteriaSchema.parse({
      type: 'framework_compliance',
      framework: 'CAGEERF',
    }) as { framework?: string };

    expect(parsed.framework).toBe('CAGEERF');
  });

  it('no longer folds the pre-rename `methodology` key forward', () => {
    const parsed = GatePassCriteriaSchema.parse({
      type: 'framework_compliance',
      methodology: 'ReACT',
    }) as { framework?: string };

    expect(parsed.framework).toBeUndefined();
  });
});

describe('pass_criteria type enum', () => {
  it('accepts the canonical value', () => {
    const parsed = GatePassCriteriaSchema.parse({ type: 'framework_compliance' }) as {
      type: string;
    };

    expect(parsed.type).toBe('framework_compliance');
  });

  it('no longer accepts the pre-rename `methodology_compliance` value', () => {
    expect(() => GatePassCriteriaSchema.parse({ type: 'methodology_compliance' })).toThrow();
  });

  it('still rejects a value that is neither spelling', () => {
    expect(() => GatePassCriteriaSchema.parse({ type: 'not_a_real_type' })).toThrow();
  });

  it('leaves the other criteria types untouched', () => {
    // Each entry is the MINIMAL valid criterion for its type, not a bare `{ type }`.
    // `shell_verify` and `script_tool` now require the field that names what to run:
    // a criterion that declares a check it cannot perform is refused at load rather
    // than auto-passing at review time. This test is about the type vocabulary, so it
    // supplies the field rather than asserting the old permissiveness.
    const minimal: Array<Record<string, unknown>> = [
      { type: 'inline_guidance' },
      { type: 'llm_self_check' },
      { type: 'shell_verify', shell_command: ['true'] },
      { type: 'script_tool', script_tool_id: 'some_tool' },
    ];

    for (const criteria of minimal) {
      expect((GatePassCriteriaSchema.parse(criteria) as { type: string }).type).toBe(
        criteria['type']
      );
    }
  });

  it('refuses a criteria type that declares a check it cannot perform', () => {
    expect(() => GatePassCriteriaSchema.parse({ type: 'shell_verify' })).toThrow();
    expect(() => GatePassCriteriaSchema.parse({ type: 'script_tool' })).toThrow();
  });
});
