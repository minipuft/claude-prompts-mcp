/**
 * `formatJsonDocument` prints what the repository's Prettier contract prints, so a JSON file the
 * server writes already passes `validate:format`.
 *
 * Two references, both read rather than restated: the bundled `resources/**` JSON files (which
 * the format gate already accepts) must come back byte for byte, and for synthetic shapes Prettier
 * itself, run with the config it resolves for a file under `server/resources/`, is the oracle.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from '@jest/globals';

import { formatJsonDocument } from '../../../../src/shared/utils/json-document-format.js';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const RESOURCES_ROOT = path.join(SERVER_ROOT, 'resources');

type PrettierModule = typeof import('prettier');
let prettier: PrettierModule;
let prettierOptions: Record<string, unknown>;

beforeAll(async () => {
  prettier = await import('prettier');
  const resolved = await prettier.resolveConfig(
    path.join(RESOURCES_ROOT, 'prompts', 'any', 'tools', 'any', 'schema.json')
  );
  if (resolved === null) throw new Error('prettier resolved no config under server/resources');
  prettierOptions = { ...resolved, parser: 'json' };
});

/** What `validate:format` would accept for a file the server wrote from `value`. */
async function prettierText(value: unknown): Promise<string> {
  return prettier.format(JSON.stringify(value, null, 2), prettierOptions);
}

/** The one-line `  "key": [item]` member line, with or without its trailing comma. */
function memberLine(key: string, item: string, comma: string): string {
  return `  ${JSON.stringify(key)}: [${JSON.stringify(item)}]${comma}`;
}

/** An `{ k: [item], ... }` whose one-line array member is exactly `width` columns wide. */
function boundaryObject(width: number, withComma: boolean, unit = 'x', unitWidth = 1): unknown {
  const comma = withComma ? ',' : '';
  const base = memberLine('k', '', comma).length;
  const repeat = Math.floor((width - base) / unitWidth);
  const pad = (width - base) % unitWidth;
  const item = unit.repeat(repeat) + 'x'.repeat(pad);
  return withComma ? { k: [item], z: 1 } : { k: [item] };
}

describe('formatJsonDocument over the bundled resources', () => {
  /**
   * Every `resources/**` JSON file the format gate checks. A file `.prettierignore` exempts
   * belongs to a generator that owns its own layout, so it is not evidence of Prettier's.
   */
  async function formatCheckedCorpus(): Promise<string[]> {
    const ignorePath = path.join(SERVER_ROOT, '.prettierignore');
    const candidates = (readdirSync(RESOURCES_ROOT, { recursive: true }) as string[])
      .filter((relative) => relative.endsWith('.json'))
      .sort();
    const checked: string[] = [];
    for (const relative of candidates) {
      const info = await prettier.getFileInfo(path.join(RESOURCES_ROOT, relative), { ignorePath });
      if (!info.ignored) checked.push(relative);
    }
    return checked;
  }

  it('reproduces every format-checked resource JSON file byte for byte', async () => {
    const corpus = await formatCheckedCorpus();
    expect(corpus.filter((relative) => relative.endsWith('/schema.json')).length).toBeGreaterThan(
      0
    );
    for (const relative of corpus) {
      const bytes = readFileSync(path.join(RESOURCES_ROOT, relative), 'utf8');
      expect({ file: relative, text: formatJsonDocument(JSON.parse(bytes)) }).toEqual({
        file: relative,
        text: bytes,
      });
    }
  });
});

describe('formatJsonDocument agrees with Prettier', () => {
  const shapes: Array<[string, unknown]> = [
    ['short scalar arrays', { required: ['id', 'name'], flags: [true, false, null], n: [1, -2] }],
    ['empty containers', { a: [], b: {}, c: [{}, {}], d: [[], []], e: [{}, []], f: [[]], g: [{}] }],
    ['nested objects', { a: { b: { c: { d: { e: 'deep' } } } } }],
    ['an array of objects', { items: [{ a: 1 }, { b: [1, 2] }], one: [{ x: 'y' }] }],
    [
      'arrays of multi-element arrays',
      {
        m: [
          [1, 2],
          [3, 4],
        ],
        one: [[1], [2]],
        mixed: [1, [2, 3]],
      },
    ],
    [
      'deep arrays',
      {
        a: [
          [
            [1, 2],
            [3, 4],
          ],
          [
            [5, 6],
            [7, 8],
          ],
        ],
        b: [[[[[]]]]],
      },
    ],
    ['a long string array', { a: Array.from({ length: 12 }, (_, i) => `item${i}`) }],
    ['a single overlong string', { a: ['x'.repeat(90)] }],
    ['a long number array (filled)', { a: Array.from({ length: 40 }, (_, i) => i * 37 - 7) }],
    [
      'wide numbers',
      { a: [1111111111, 2222222222, 3333333333, 4444444444, 5555555555, 6666666666, 7777777777] },
    ],
    ['number spellings', { a: [1e21, 1.5e-7, 0.1, -0, 5e-324, 123456789012345680000] }],
    ['a top-level array', ['a', 'b']],
    ['a top-level array of objects', [{ a: 1 }]],
    ['a top-level scalar', 'x'],
    ['escapes', { 'k"\\': ['a\n', '\t', '\u0001', ' ', '/'] }],
    ['unicode', { a: ['é', '中文字符', '😀', 'á', '한국어', 'ｆｕｌｌ'], 键: ['值'] }],
    ['a long key', { ['k'.repeat(70)]: ['aaaa', 'bbbb', 'cccc'], ['j'.repeat(78)]: [] }],
    [
      'a JSON Schema',
      {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['create', 'update', 'delete', 'list', 'inspect'] },
          tags: { type: 'array', items: { type: 'string' }, minItems: 1, default: [] },
          ranges: {
            type: 'array',
            items: { type: ['integer', 'null'] },
            examples: [
              [1, 2],
              [3, 4],
            ],
          },
        },
        required: ['mode'],
        additionalProperties: false,
      },
    ],
  ];

  it.each(shapes)('%s', async (_name, value) => {
    expect(formatJsonDocument(value)).toBe(await prettierText(value));
  });

  // printWidth for *.json is 80 (server/.prettierrc.json override): 80 fits, 81 breaks.
  describe.each([79, 80, 81])('a one-line array member %i columns wide', (width) => {
    it.each([false, true])('with a trailing comma: %s', async (withComma) => {
      const value = boundaryObject(width, withComma);
      expect(formatJsonDocument(value)).toBe(await prettierText(value));
    });

    it('measured in display columns for CJK and emoji', async () => {
      for (const [unit, unitWidth] of [
        ['中', 2],
        ['😀', 2],
        ['é', 1],
      ] as const) {
        const value = boundaryObject(width, false, unit, unitWidth);
        expect(formatJsonDocument(value)).toBe(await prettierText(value));
      }
    });
  });

  it('fills a number array right up to column 80', async () => {
    for (let length = 1; length <= 40; length += 1) {
      const value = { a: Array.from({ length }, (_, i) => 1000 + i) };
      expect(formatJsonDocument(value)).toBe(await prettierText(value));
    }
  });

  it('is already Prettier-formatted (the format gate leaves it unchanged)', async () => {
    for (const [, value] of shapes) {
      const text = formatJsonDocument(value);
      expect(await prettier.format(text, prettierOptions)).toBe(text);
    }
  });
});

describe('formatJsonDocument keeps JSON.stringify value semantics', () => {
  it('ends with exactly one newline', () => {
    expect(formatJsonDocument({ a: 1 })).toBe('{\n  "a": 1\n}\n');
    expect(formatJsonDocument([])).toBe('[]\n');
  });

  it('drops undefined members, calls toJSON and prints non-finite numbers as null', () => {
    const value = { a: undefined, b: { toJSON: () => 'b' }, c: [Number.NaN, undefined] };
    expect(JSON.parse(formatJsonDocument(value))).toEqual(JSON.parse(JSON.stringify(value)));
  });

  it('refuses a value with no JSON text', () => {
    expect(() => formatJsonDocument(undefined)).toThrow(/no JSON representation/);
  });
});
