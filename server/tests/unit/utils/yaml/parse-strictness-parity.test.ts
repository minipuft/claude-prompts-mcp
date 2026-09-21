/**
 * The loader must not accept MORE than it did before the parser was swapped.
 *
 * A prompt pack is untrusted input — this repository's handbook prices installing one as letting
 * its author write into your model's context — so the parser swap from js-yaml to `yaml` is only
 * safe if the set of documents the server accepts did not grow. It did grow, measurably: `yaml`
 * resolves `!!binary`, `!!set` and `!!omap` with no error and no warning at all, reduces an
 * unknown tag such as `!!python/object/apply:os.system` to that tag's argument, and stringifies a
 * collection used as a mapping key into an invented name like `"[ 1, 2 ]"`. js-yaml refused all
 * five. `parseYaml` closes the gap; this file is the proof, case by case.
 *
 * THE OLD BEHAVIOUR IS ASSERTED, NOT REMEMBERED. js-yaml 5.3.0 is still a direct dependency of
 * this package (server-only code and several validation scripts still import it), so each case
 * runs through the real `jsyaml.load` here rather than against a number written down by hand. If
 * js-yaml is ever removed, these `expectOldBehaviour` assertions are what has to be converted to
 * recorded constants, and the conversion should say so.
 *
 * Classification: unit. One pure function, no I/O.
 */

import { describe, expect, test } from '@jest/globals';
import * as jsyaml from 'js-yaml';

import { parseYaml } from '../../../../src/shared/utils/yaml/yaml-parser.js';

/** What the previous parser did with this input, measured by running it. */
function oldParserAccepts(source: string): boolean {
  try {
    jsyaml.load(source);
    return true;
  } catch {
    return false;
  }
}

/** What the current loader does with this input. */
const newParserAccepts = (source: string): boolean => parseYaml(source).success;

interface Case {
  name: string;
  source: string;
  /** Whether js-yaml 5.3.0 accepted it — asserted below, never assumed. */
  oldAccepted: boolean;
}

/**
 * Constructs `yaml` accepts and js-yaml refused. Every one of these must now be refused, and the
 * `oldAccepted: false` column is checked against the real js-yaml so the expectation cannot rot.
 */
const MUST_BE_REFUSED: Case[] = [
  { name: 'an unknown tag', source: 'a: !custom foo', oldAccepted: false },
  {
    name: 'a tag naming a host command',
    source: "a: !!python/object/apply:os.system ['id']",
    oldAccepted: false,
  },
  { name: '!!binary', source: 'a: !!binary R0lG', oldAccepted: false },
  { name: '!!set', source: 'a: !!set\n  ? x\n  ? y', oldAccepted: false },
  { name: '!!omap', source: 'a: !!omap\n  - x: 1', oldAccepted: false },
  { name: 'a collection used as a mapping key', source: '? [1,2]\n: v', oldAccepted: false },
  { name: 'duplicate keys', source: 'a: 1\na: 2', oldAccepted: false },
  { name: 'several documents in one stream', source: 'a: 1\n---\nb: 2', oldAccepted: false },
  { name: 'a tab used as indentation', source: 'a:\n\t- 1', oldAccepted: false },
];

describe('the loader refuses everything the previous parser refused', () => {
  test.each(MUST_BE_REFUSED)('$name', ({ source, oldAccepted }) => {
    expect(oldParserAccepts(source)).toBe(oldAccepted);
    expect(newParserAccepts(source)).toBe(false);
  });

  /**
   * POSITIVE CONTROL. Without it every assertion above is satisfied by a parser that refuses
   * everything, which would be "strict" and useless.
   */
  test('POSITIVE CONTROL: a valid, commented, hand-authored file still parses', () => {
    const source = [
      '# Authored by hand.',
      'id: probe',
      'name: Probe',
      'category: "analysis"',
      '',
      'description: >-',
      '  A folded paragraph that wraps across',
      '  more than one line.',
      '',
      'tags: [alpha, beta]',
      'nested:',
      '  count: 3',
      '  enabled: true',
      '  ratio: 1.5',
      '  missing: null',
      '',
    ].join('\n');

    expect(oldParserAccepts(source)).toBe(true);

    const result = parseYaml<Record<string, unknown>>(source);
    expect(result.success).toBe(true);
    expect(result.data).toEqual(jsyaml.load(source));
  });
});

describe('alias expansion is bounded', () => {
  /**
   * A billion-laughs document: six levels of nine-fold alias reuse, which realises to 9^5 nodes.
   * js-yaml had no alias budget and expanded it; `yaml` refuses past `maxAliasCount`. This is the
   * one case where the new parser is STRICTER than the old, so the assertion is deliberately
   * asymmetric — and it is pinned because the limit is applied when the node tree is realised,
   * which is a different call from the one that composes it and is easy to drop.
   */
  const BILLION_LAUGHS = [
    'a: &a ["x","x","x","x","x","x","x","x","x"]',
    'b: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a]',
    'c: &c [*b,*b,*b,*b,*b,*b,*b,*b,*b]',
    'd: &d [*c,*c,*c,*c,*c,*c,*c,*c,*c]',
    'e: &e [*d,*d,*d,*d,*d,*d,*d,*d,*d]',
    'f: [*e,*e,*e,*e,*e,*e,*e,*e,*e]',
  ].join('\n');

  test('a billion-laughs document is refused', () => {
    expect(oldParserAccepts(BILLION_LAUGHS)).toBe(true); // js-yaml expanded it
    expect(newParserAccepts(BILLION_LAUGHS)).toBe(false);
  });

  test('ordinary anchors and aliases still work', () => {
    const source = 'base: &b\n  x: 1\nchild: *b\n';
    const result = parseYaml<Record<string, unknown>>(source);
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ base: { x: 1 }, child: { x: 1 } });
  });
});

describe('prototype keys stay own properties', () => {
  /**
   * Neither parser expands a merge key, and neither assigns through `__proto__`. Both are pinned
   * rather than assumed: a merge key that started being expanded would silently change what a
   * prompt declares, and a `__proto__` that started being assigned through would be a pollution
   * bug that no test anywhere else in this repository would notice.
   */
  test('a merge key is a literal key, not an instruction', () => {
    const source = 'base: &b {x: 1}\nchild:\n  <<: *b\n  y: 2\n';
    const result = parseYaml<Record<string, Record<string, unknown>>>(source);
    expect(result.success).toBe(true);
    expect(result.data!['child']).toEqual({ '<<': { x: 1 }, y: 2 });
    expect(jsyaml.load(source)).toEqual(result.data);
  });

  test('a __proto__ key does not reach Object.prototype', () => {
    const result = parseYaml<Record<string, unknown>>('__proto__:\n  polluted: true\n');
    expect(result.success).toBe(true);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty('polluted');
  });

  test('a constructor key does not reach Object.prototype', () => {
    const result = parseYaml<Record<string, unknown>>(
      'constructor:\n  prototype:\n    polluted: true\n'
    );
    expect(result.success).toBe(true);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty('polluted');
  });
});

describe('a refusal says where to look', () => {
  test('the failure names the file it was given', () => {
    const result = parseYaml('a: !!binary R0lG', { filename: 'gates/probe/gate.yaml' });
    expect(result.success).toBe(false);
    expect(result.error?.filename).toBe('gates/probe/gate.yaml');
    expect(result.error?.message).toContain('tag');
  });

  test('a syntax failure carries a line number', () => {
    const result = parseYaml('id: ok\na:\n\t- 1\n', { filename: 'probe.yaml' });
    expect(result.success).toBe(false);
    expect(result.error?.line).toBeGreaterThanOrEqual(0);
  });
});
