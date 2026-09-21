// @lifecycle canonical - Unit tests for the canonical hash family (S1.2).
/**
 * Canonical hashing
 *
 * The canonical family is the equality primitive behind every "has this changed?" decision, so
 * these tests assert the two properties that make such a decision trustworthy:
 *
 *   1. **Identity** — equal states hash equal regardless of object key order, and different
 *      states hash differently. The `hashFileSet` cases are the interesting half: they include
 *      the exact input pair `computeContentHash` collides on, and assert BOTH that the legacy
 *      function still collides (so the reason this family exists is documented by a running
 *      check, not by prose) and that the canonical one does not.
 *   2. **Refusal** — a value with no JSON round-trip is rejected at the cause, because encoding
 *      it would make two different states collide silently.
 */

import {
  canonicalJson,
  computeContentHash,
  hashBytes,
  hashCanonical,
  hashFileSet,
} from '../../../../src/shared/utils/hash.js';

describe('canonicalJson', () => {
  it('sorts object keys ASCII-ascending, at every depth', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalJson({ z: { y: 1, x: 2 } })).toBe('{"z":{"x":2,"y":1}}');
    // Positive control: the sort is what produces the equality, not stringify's own order.
    expect(JSON.stringify({ b: 1, a: 2 })).toBe('{"b":1,"a":2}');
  });

  it('preserves array order — order IS content', () => {
    expect(canonicalJson(['a', 'b'])).toBe('["a","b"]');
    expect(canonicalJson(['b', 'a'])).toBe('["b","a"]');
    expect(hashCanonical(['a', 'b'])).not.toBe(hashCanonical(['b', 'a']));
  });

  it('emits no whitespace and keeps null', () => {
    expect(canonicalJson({ a: null, b: [1, null] })).toBe('{"a":null,"b":[1,null]}');
  });

  it('drops undefined object members, matching the JSON boundary every snapshot crosses', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(hashCanonical({ a: 1, b: undefined })).toBe(hashCanonical({ a: 1 }));
    // Positive control: this is the shape a snapshot has after JSON.parse(JSON.stringify(...)).
    expect(hashCanonical(JSON.parse(JSON.stringify({ a: 1, b: undefined })))).toBe(
      hashCanonical({ a: 1 })
    );
  });

  it('normalises -0 to 0, because that is what reads back', () => {
    expect(canonicalJson(-0)).toBe('0');
    expect(hashCanonical({ n: -0 })).toBe(hashCanonical({ n: 0 }));
  });

  it.each([
    ['undefined, alone', undefined],
    ['undefined in an array', [1, undefined]],
    ['NaN', { n: NaN }],
    ['Infinity', { n: Infinity }],
    ['a Date', { at: new Date(0) }],
    ['a Map', { m: new Map() }],
    ['a class instance', { c: new (class Thing {})() }],
    ['a function', { f: (): void => undefined }],
    ['a bigint', { b: 1n }],
    ['a symbol', { s: Symbol('x') }],
    ['an object with toJSON', { o: { toJSON: () => 'x' } }],
  ])('refuses %s rather than guessing an encoding', (_label, value) => {
    expect(() => canonicalJson(value)).toThrow(TypeError);
  });

  it('names the path of the refused value', () => {
    expect(() => canonicalJson({ outer: { inner: [NaN] } })).toThrow(/\$\.outer\.inner\[0\]/);
  });
});

describe('hashCanonical / hashBytes', () => {
  it('carries the sha256: prefix an operator already reads', () => {
    expect(hashCanonical({ a: 1 })).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(hashBytes('abc')).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('is key-order independent', () => {
    expect(hashCanonical({ a: 1, b: 2 })).toBe(hashCanonical({ b: 2, a: 1 }));
    // Positive control: the JSON.stringify comparison this replaces is NOT.
    expect(JSON.stringify({ a: 1, b: 2 })).not.toBe(JSON.stringify({ b: 2, a: 1 }));
  });

  it('separates structure from content', () => {
    expect(hashCanonical({ a: '1' })).not.toBe(hashCanonical({ a: 1 }));
    expect(hashCanonical({ a: { b: 1 } })).not.toBe(hashCanonical({ 'a.b': 1 }));
  });
});

describe('hashFileSet', () => {
  /**
   * WHY THIS FAMILY EXISTS. `computeContentHash` sorts its inputs and concatenates them with no
   * separator, so the boundary between two contents is not encoded — the first assertion is the
   * defect, still live and deliberately untouched in this slice (its digests are persisted in
   * `resource_index` and `skills_sync_manifests`); the second is the fix.
   */
  it('distinguishes inputs computeContentHash collides on', () => {
    expect(computeContentHash(['ab', 'c'])).toBe(computeContentHash(['a', 'bc']));

    expect(
      hashFileSet([
        { path: 'one', content: 'ab' },
        { path: 'two', content: 'c' },
      ])
    ).not.toBe(
      hashFileSet([
        { path: 'one', content: 'a' },
        { path: 'two', content: 'bc' },
      ])
    );
  });

  it('is path-keyed: swapping two files contents changes the hash', () => {
    const before = hashFileSet([
      { path: 'a.yaml', content: 'x' },
      { path: 'b.yaml', content: 'y' },
    ]);
    const swapped = hashFileSet([
      { path: 'a.yaml', content: 'y' },
      { path: 'b.yaml', content: 'x' },
    ]);
    expect(before).not.toBe(swapped);
    // Positive control: the legacy hash cannot see this swap at all.
    expect(computeContentHash(['x', 'y'])).toBe(computeContentHash(['y', 'x']));
  });

  it('ignores enumeration order — a file set has no order', () => {
    expect(
      hashFileSet([
        { path: 'a', content: '1' },
        { path: 'b', content: '2' },
      ])
    ).toBe(
      hashFileSet([
        { path: 'b', content: '2' },
        { path: 'a', content: '1' },
      ])
    );
  });

  it('refuses a duplicate path rather than collapsing or double-counting it', () => {
    expect(() =>
      hashFileSet([
        { path: 'a', content: '1' },
        { path: 'a', content: '2' },
      ])
    ).toThrow(/duplicate path/);
  });
});
