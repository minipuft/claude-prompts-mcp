// Test-only issuing-realm boundary; production clone and strict hash guards stay unchanged.
import { expect, jest } from '@jest/globals';

import { canonicalJson, hashBytes } from '../../../src/shared/utils/hash.js';

export interface IssuedReviewCloneFixture {
  readonly nativeClone: typeof structuredClone;
  readonly restore: () => void;
}

/**
 * Native-clone every value. Only an already-valid issued context's definition JSON is restored
 * to this Jest realm. All pins and other fields retain native clone behavior. Invalid originals
 * remain raw: no class/cycle/undefined/digest laundering. Restore the scoped spy after each test.
 */
export function installIssuedReviewCloneFixture(): IssuedReviewCloneFixture {
  const nativeClone = globalThis.structuredClone;
  const nativeJSON = new WeakMap<object, object | null>();
  const record = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);
  const contextOf = (value: unknown) => {
    if (!record(value)) return undefined;
    const context = record(value['definitions']) ? value : value['semanticContext'];
    return record(context) &&
      typeof context['nodeId'] === 'string' &&
      typeof context['attemptId'] === 'string'
      ? context
      : undefined;
  };
  // A validation view may cross ONLY prototypes recorded from prior valid native JSON clones.
  // New classes and changed prototypes remain nonplain for the canonical validator to reject.
  function validationView(value: unknown, active = new Set<object>()): unknown {
    if (typeof value !== 'object' || value === null) return value;
    const prototype: object | null = Object.getPrototypeOf(value);
    if (
      !Array.isArray(value) &&
      prototype !== Object.prototype &&
      prototype !== null &&
      (!nativeJSON.has(value) || nativeJSON.get(value) !== prototype)
    )
      return value;
    if (active.has(value)) throw new Error('Cyclic issuer JSON');
    active.add(value);
    const copy = Array.isArray(value)
      ? value.map((item) => validationView(item, active))
      : Object.fromEntries(
          Object.entries(value).map(([key, item]) => [key, validationView(item, active)])
        );
    active.delete(value);
    return copy;
  }
  function remember(value: unknown): void {
    if (typeof value !== 'object' || value === null || nativeJSON.has(value)) return;
    nativeJSON.set(value, Object.getPrototypeOf(value));
    for (const child of Object.values(value)) remember(child);
  }
  const spy = jest
    .spyOn(globalThis, 'structuredClone')
    .mockImplementation(<T>(value: T, options?: Parameters<typeof structuredClone>[1]): T => {
      const copy = nativeClone(value, options);
      const original = contextOf(value),
        cloned = contextOf(copy);
      if (original === undefined || cloned === undefined) return copy;
      const definitions = original['definitions'],
        copies = cloned['definitions'];
      if (!record(definitions) || !record(copies)) return copy;
      const replacements: Array<{ snapshot: Record<string, unknown>; bytes: string }> = [];
      let originalBytes: string;
      try {
        originalBytes = canonicalJson(validationView(original));
        for (const [id, snapshot] of Object.entries(definitions)) {
          const destination = copies[id];
          if (!record(snapshot) || !record(destination) || !record(snapshot['definition']))
            return copy;
          const bytes = canonicalJson(snapshot['definition']);
          if (
            snapshot['definition']['id'] !== id ||
            hashBytes(bytes) !== snapshot['definitionDigest'] ||
            destination['definitionDigest'] !== snapshot['definitionDigest']
          )
            return copy;
          replacements.push({ snapshot: destination, bytes });
        }
      } catch {
        return copy;
      }
      remember(cloned);
      for (const { snapshot, bytes } of replacements) {
        const definition: unknown = JSON.parse(bytes);
        snapshot['definition'] = definition;
        expect(canonicalJson(definition)).toBe(bytes);
        expect(hashBytes(bytes)).toBe(snapshot['definitionDigest']);
      }
      expect(canonicalJson(validationView(cloned))).toBe(originalBytes);
      return copy;
    });
  return { nativeClone, restore: () => spy.mockRestore() };
}
