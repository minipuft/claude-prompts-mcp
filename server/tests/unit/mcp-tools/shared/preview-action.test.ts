/**
 * The preview vocabulary, tested against its own table rather than a copy of it.
 *
 * The cases below enumerate `PREVIEWABLE_ACTIONS_BY_TYPE` and `PREVIEWABLE_ACTIONS`, so adding a
 * resource type or a previewable operation extends the suite without anyone remembering to. A
 * hand-written list would pass unchanged on the day someone adds `style` — which is P3.1, already
 * on the plan — and the first thing anyone would learn about the gap is a preview that wrote.
 */

import {
  PREVIEWABLE_ACTIONS,
  PREVIEWABLE_ACTIONS_BY_TYPE,
  describePreviewRefusal,
  isPreviewRequest,
  resolveDispatchAction,
} from '../../../../src/mcp/tools/shared/preview-action.js';

const TYPES = Object.keys(PREVIEWABLE_ACTIONS_BY_TYPE);

describe('resolveDispatchAction', () => {
  test.each(TYPES.flatMap((type) => PREVIEWABLE_ACTIONS_BY_TYPE[type]!.map((a) => [type, a])))(
    'a %s preview of %s dispatches to that operation',
    (_type, action) => {
      expect(resolveDispatchAction({ action: 'preview', preview_action: action })).toBe(action);
    }
  );

  test.each(['create', 'update', 'delete', 'list', 'rollback'])(
    'a plain %s dispatches to itself',
    (action) => {
      expect(resolveDispatchAction({ action })).toBe(action);
    }
  );

  /**
   * The router refuses this ahead of dispatch, so the value only matters to a handler called
   * directly. It must not resolve to a mutating action — falling through to `'preview'` reaches
   * each handler's own refusal arm, where falling through to, say, `'delete'` would not.
   */
  test('a preview with no target resolves to preview, never to a mutation', () => {
    expect(resolveDispatchAction({ action: 'preview' })).toBe('preview');
  });
});

describe('isPreviewRequest', () => {
  test('reads the action the caller stated, not a separate flag', () => {
    expect(isPreviewRequest({ action: 'preview', preview_action: 'delete' })).toBe(true);
    expect(isPreviewRequest({ action: 'delete' })).toBe(false);
    // The point of the change: there is no second field that can disagree with `action`.
    expect(isPreviewRequest({ action: 'delete', preview_action: 'delete' })).toBe(false);
  });
});

describe('describePreviewRefusal', () => {
  // Positive control. Every assertion below is that a refusal EXISTS, and "a refusal exists" is
  // evidence about nothing until the same function is shown to return null for a valid call.
  test.each(TYPES.flatMap((type) => PREVIEWABLE_ACTIONS_BY_TYPE[type]!.map((a) => [type, a])))(
    'accepts %s preview_action:%s',
    (type, action) => {
      expect(
        describePreviewRefusal(type, { action: 'preview', preview_action: action })
      ).toBeNull();
    }
  );

  test.each(TYPES)('accepts an ordinary %s call carrying no preview_action', (type) => {
    expect(describePreviewRefusal(type, { action: 'update' })).toBeNull();
  });

  test.each(TYPES)(
    'refuses a %s preview with no preview_action, naming the valid values',
    (type) => {
      const refusal = describePreviewRefusal(type, { action: 'preview' });
      expect(refusal).toContain("requires 'preview_action'");
      for (const action of PREVIEWABLE_ACTIONS_BY_TYPE[type]!) {
        expect(refusal).toContain(`"${action}"`);
      }
    }
  );

  /**
   * The case carrying the actual defect this parameter replaced.
   *
   * `dry_run` was forwarded to every manager for every action, but only seven of the nine
   * (type × action) pairs read it. Gate and framework `update` accepted it and wrote anyway, so a
   * preview of those two performed the mutation and returned a success receipt. Enumerating the
   * complement of the table is what keeps that closed for a type nobody has added yet.
   */
  test.each(
    TYPES.flatMap((type) =>
      PREVIEWABLE_ACTIONS.filter((a) => !PREVIEWABLE_ACTIONS_BY_TYPE[type]!.includes(a)).map(
        (a) => [type, a] as const
      )
    )
  )('refuses %s preview_action:%s, which has no preview path', (type, action) => {
    const refusal = describePreviewRefusal(type, { action: 'preview', preview_action: action });
    expect(refusal).toContain('not supported for resource_type');
    expect(refusal).toContain(`"${type}"`);
  });

  test('refuses preview_action sent without action:"preview"', () => {
    const refusal = describePreviewRefusal('prompt', {
      action: 'update',
      preview_action: 'update',
    });
    // Refused rather than ignored: a parameter that silently does nothing reads as a preview that
    // ran, and the caller would believe nothing had been written.
    expect(refusal).toContain('only meaningful with action:"preview"');
  });

  test('refuses an unknown resource type rather than accepting every operation for it', () => {
    const refusal = describePreviewRefusal('style', {
      action: 'preview',
      preview_action: 'delete',
    });
    // P3.1 adds `style` as a resource type. Until its entry exists in the table, a preview of it
    // must refuse — defaulting to "allowed" is how a new type would inherit a preview that writes.
    expect(refusal).toContain('not supported for resource_type');
  });
});
