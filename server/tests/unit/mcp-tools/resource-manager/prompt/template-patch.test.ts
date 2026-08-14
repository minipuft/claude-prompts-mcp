/**
 * P7 row 3.1 — `applyTemplatePatches` edges.
 *
 * The applier is pure, so every branch is reachable directly and none of these needs a processor,
 * a file or a version row. The rejection cases carry the weight: an anchor that silently matched
 * the wrong region is the defect class patch mode exists to prevent, so "rejects" is the assertion,
 * never "does something reasonable".
 */

import { describe, expect, it } from '@jest/globals';

import {
  applyTemplatePatches,
  findPatchParameterConflict,
  type TemplatePatchOperation,
} from '../../../../../src/mcp/tools/resource-manager/prompt/operations/template-patch.js';

const BODY = ['## Context', '{{input}}', '', '## Output', 'Answer in prose.'].join('\n');

function op(overrides: Partial<TemplatePatchOperation>): TemplatePatchOperation {
  return {
    field: 'user_message_template',
    old_string: 'Answer in prose.',
    new_string: 'Answer in bullet points.',
    ...overrides,
  };
}

describe('applyTemplatePatches', () => {
  it('replaces a unique anchor and returns only the touched field', () => {
    const result = applyTemplatePatches(
      { user_message_template: BODY, system_message: 'sys', description: 'desc' },
      [op({})]
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.applied).toBe(1);
    expect(result.values).toEqual({
      user_message_template: BODY.replace('Answer in prose.', 'Answer in bullet points.'),
    });
    // The untouched bodies must not appear at all: the caller writes back exactly what it is
    // handed, so echoing an unchanged field would make an unrelated update look like an edit.
    expect(Object.keys(result.values)).toEqual(['user_message_template']);
  });

  it('applies operations in order, each against the previous result', () => {
    const result = applyTemplatePatches({ user_message_template: 'alpha' }, [
      op({ old_string: 'alpha', new_string: 'beta' }),
      op({ old_string: 'beta', new_string: 'gamma' }),
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.values.user_message_template).toBe('gamma');
    expect(result.applied).toBe(2);
  });

  it('patches different fields in one call', () => {
    const result = applyTemplatePatches(
      { user_message_template: BODY, system_message: 'Be terse.', description: 'Old summary' },
      [
        op({}),
        op({ field: 'system_message', old_string: 'terse', new_string: 'exhaustive' }),
        op({ field: 'description', old_string: 'Old', new_string: 'New' }),
      ]
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.values.system_message).toBe('Be exhaustive.');
    expect(result.values.description).toBe('New summary');
  });

  it('rejects an anchor that does not occur, naming the field and an excerpt', () => {
    const result = applyTemplatePatches({ user_message_template: BODY }, [
      op({ old_string: 'Answer in verse.' }),
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.reason).toBe('anchor_not_found');
    expect(result.rejection.field).toBe('user_message_template');
    expect(result.rejection.operation).toBe(1);
    expect(result.rejection.message).toContain('Answer in verse.');
  });

  it('rejects an ambiguous anchor and reports the occurrence count', () => {
    const result = applyTemplatePatches({ user_message_template: 'step\nstep\nstep' }, [
      op({ old_string: 'step', new_string: 'phase' }),
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.reason).toBe('anchor_ambiguous');
    expect(result.rejection.occurrences).toBe(3);
    expect(result.rejection.message).toContain('3 times');
  });

  it('replaces every occurrence when replace_all is set', () => {
    const result = applyTemplatePatches({ user_message_template: 'step\nstep\nstep' }, [
      op({ old_string: 'step', new_string: 'phase', replace_all: true }),
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.values.user_message_template).toBe('phase\nphase\nphase');
  });

  it('rejects an empty anchor rather than matching everywhere', () => {
    const result = applyTemplatePatches({ user_message_template: BODY }, [
      op({ old_string: '', new_string: 'x' }),
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.reason).toBe('empty_old_string');
  });

  it('rejects a patch against a field the prompt does not carry', () => {
    const result = applyTemplatePatches({ user_message_template: BODY }, [
      op({ field: 'system_message', old_string: 'anything' }),
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.reason).toBe('target_absent');
    expect(result.rejection.field).toBe('system_message');
  });

  it('stops at the first failure instead of reporting guesses about later anchors', () => {
    const result = applyTemplatePatches({ user_message_template: 'alpha' }, [
      op({ old_string: 'missing', new_string: 'x' }),
      op({ old_string: 'alpha', new_string: 'beta' }),
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.operation).toBe(1);
  });

  /**
   * `String.prototype.replace` interprets `$&`, `$1` and friends in the replacement. A prompt body
   * is arbitrary text, so a replacement containing them must land verbatim — otherwise the written
   * template silently differs from what the operator sent.
   */
  it('inserts replacement text literally, including $-sequences', () => {
    const result = applyTemplatePatches({ user_message_template: 'cost: X' }, [
      op({ old_string: 'X', new_string: '$& and $1 and $$' }),
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.values.user_message_template).toBe('cost: $& and $1 and $$');
  });

  it('treats an empty new_string as a deletion', () => {
    const result = applyTemplatePatches({ description: 'keep drop' }, [
      op({ field: 'description', old_string: ' drop', new_string: '' }),
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.values.description).toBe('keep');
  });

  it('counts occurrences without overlap, matching what replace_all would do', () => {
    // 'aa' occurs twice non-overlapping in 'aaaa' — replace_all produces two replacements, so an
    // overlap-counting implementation would report an ambiguity of 3 that cannot exist.
    const result = applyTemplatePatches({ description: 'aaaa' }, [
      op({ field: 'description', old_string: 'aa', new_string: 'b', replace_all: true }),
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.values.description).toBe('bb');
  });
});

describe('findPatchParameterConflict', () => {
  const patchTemplate = [op({})];

  it('rejects patch combined with a full user_message_template', () => {
    expect(findPatchParameterConflict(['user_message_template'], patchTemplate)).toContain(
      '`user_message_template`'
    );
  });

  it('rejects patch combined with a full system_message', () => {
    expect(findPatchParameterConflict(['system_message'], patchTemplate)).toContain(
      '`system_message`'
    );
  });

  it('rejects a description supplied both as a value and as a patch target', () => {
    expect(findPatchParameterConflict(['description'], [op({ field: 'description' })])).toContain(
      'description'
    );
  });

  it('allows setting a description while patching the template', () => {
    expect(findPatchParameterConflict(['description'], patchTemplate)).toBeUndefined();
  });

  it('allows a patch with no full-body parameter', () => {
    expect(findPatchParameterConflict([], patchTemplate)).toBeUndefined();
  });
});
