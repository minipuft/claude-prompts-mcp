/**
 * The generated `config.jsonc` template — the file `cpm config init` writes for a user to edit.
 *
 * The template's whole value is an invitation: every setting appears as a commented-out line the
 * user is told to uncomment. So the property worth pinning is not "the text looks right", it is
 * that acting on that invitation WORKS — uncomment one line plus the braces around it and the
 * file still parses and still validates against the schema the loader uses. A template that
 * documents a setting the schema rejects would fail on its first use and would look correct in
 * every review.
 *
 * These cases run over the GENERATED text (`CONFIG_JSONC_TEMPLATE` as committed), never over a
 * re-render: re-rendering here would measure the render function against itself and go green on a
 * template nobody ships. Byte-level drift between the committed file and the generator is a
 * different gate's job (`npm run validate:config-schema`).
 *
 * The last case is the control that keeps the rest honest: one example value mutated to something
 * the schema rejects must FAIL the same check every other case passes, or a validator that
 * accepts everything would satisfy all of them equally.
 *
 * Classification: Unit (pure text + schema validation, no server, no I/O beyond reading the
 * shipped schema file).
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from '@jest/globals';

import { CONFIG_VALID_KEYS } from '../../../src/cli-shared/_generated/config-keys.js';
import {
  CONFIG_JSONC_TEMPLATE,
  CONFIG_SCHEMA_URL,
} from '../../../src/cli-shared/_generated/config-template.js';
import { validateConfigAgainstSchema } from '../../../src/infra/config/config-schema-validator.js';
import { parseConfigText } from '../../../src/shared/utils/config-file-format.js';

// Same resolution pattern as the other tests under `tests/unit/` — the schema ships at the
// server root, three directories above this file.
const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SCHEMA_PATH = path.join(SERVER_ROOT, 'config.schema.json');

// ---------------------------------------------------------------------------
// The template's line grammar, re-derived here rather than imported. The generator owns one
// definition and this file owns another on purpose: a shared regex would make the two agree by
// construction, and the property under test is that the EMITTED text is uncommentable by a reader
// applying an obvious rule — not that it round-trips through its own author's parser.
//
//   `// ` + indent + `"key": {`      opens a section
//   `// ` + indent + `},`            closes one
//   `// ` + indent + `"key": val,`   is one setting's example
//
// Anything else that starts `// ` is documentation and stays a comment.
// ---------------------------------------------------------------------------
const COMMENT_MARKER = '// ';
const SECTION_OPEN = /^\/\/ ( +)"([^"]+)": \{$/;
const SECTION_CLOSE = /^\/\/ ( +)\},$/;
const EXAMPLE = /^\/\/ ( +)"([^"]+)": (.+),$/;

interface SectionSpan {
  readonly openIndex: number;
  readonly closeIndex: number;
}

interface ExampleEntry {
  readonly lineIndex: number;
  /** Dotted paths of the sections this setting sits inside, outermost first. */
  readonly ancestors: readonly string[];
  /** The example value as it appears in the file, before parsing. */
  readonly rawValue: string;
}

const LINES = CONFIG_JSONC_TEMPLATE.split('\n');

const { sections, examples } = parseTemplateStructure(LINES);

function parseTemplateStructure(lines: readonly string[]): {
  sections: Map<string, SectionSpan>;
  examples: Map<string, ExampleEntry>;
} {
  const sections = new Map<string, SectionSpan>();
  const examples = new Map<string, ExampleEntry>();
  const open: { dotted: string; openIndex: number }[] = [];

  lines.forEach((line, index) => {
    const opened = SECTION_OPEN.exec(line);
    if (opened) {
      const key = opened[2] as string;
      const parent = open[open.length - 1];
      open.push({ dotted: parent ? `${parent.dotted}.${key}` : key, openIndex: index });
      return;
    }

    if (SECTION_CLOSE.test(line)) {
      const closed = open.pop();
      if (!closed) throw new Error(`template line ${index + 1} closes a section nothing opened`);
      sections.set(closed.dotted, { openIndex: closed.openIndex, closeIndex: index });
      return;
    }

    const example = EXAMPLE.exec(line);
    if (example) {
      const key = example[2] as string;
      const parent = open[open.length - 1];
      examples.set(parent ? `${parent.dotted}.${key}` : key, {
        lineIndex: index,
        ancestors: open.map((entry) => entry.dotted),
        rawValue: example[3] as string,
      });
    }
  });

  if (open.length > 0) throw new Error(`template leaves ${open.length} section(s) unclosed`);
  return { sections, examples };
}

/** Strips the comment marker from exactly `indices`, leaving every other line untouched. */
function uncomment(indices: ReadonlySet<number>): string {
  return LINES.map((line, index) => {
    if (!indices.has(index)) return line;
    if (!line.startsWith(COMMENT_MARKER)) {
      throw new Error(`template line ${index + 1} is not a commented line: ${line}`);
    }
    return line.slice(COMMENT_MARKER.length);
  }).join('\n');
}

/** The line indices to uncomment so that `dottedKey`'s example becomes live. */
function indicesForKey(dottedKey: string): Set<number> {
  const entry = examples.get(dottedKey);
  if (!entry) throw new Error(`the template carries no example line for "${dottedKey}"`);

  const indices = new Set<number>([entry.lineIndex]);
  for (const ancestor of entry.ancestors) {
    const span = sections.get(ancestor);
    if (!span) throw new Error(`the template carries no section braces for "${ancestor}"`);
    indices.add(span.openIndex);
    indices.add(span.closeIndex);
  }
  return indices;
}

/** Every dotted path in a parsed config document whose value is not a nested section. */
function leafKeysOf(document: unknown, prefix = ''): string[] {
  if (document === null || typeof document !== 'object' || Array.isArray(document)) {
    return prefix === '' ? [] : [prefix];
  }
  return Object.entries(document as Record<string, unknown>).flatMap(([key, value]) =>
    leafKeysOf(value, prefix ? `${prefix}.${key}` : key)
  );
}

function valueAt(document: unknown, dottedKey: string): unknown {
  return dottedKey
    .split('.')
    .reduce<unknown>(
      (node, segment) =>
        node && typeof node === 'object' ? (node as Record<string, unknown>)[segment] : undefined,
      document
    );
}

describe('CONFIG_SCHEMA_URL', () => {
  // Independent of `generate-config-schema.ts`'s own logic: every other assertion touching this
  // constant reads it back from the generated module, which would pass even if the generator
  // wrote back whatever it was given. This regex pins the ADDRESS SHAPE on its own terms — a
  // jsDelivr npm-mirror path, the `claude-prompts` package name, a numeric major, the schema
  // filename — so a generator bug that produces a syntactically different (but still string)
  // value fails here even though every reference-based assertion elsewhere would stay green.
  it('names a jsDelivr npm-mirror address for the claude-prompts package at a numeric major', () => {
    expect(CONFIG_SCHEMA_URL).toMatch(
      /^https:\/\/cdn\.jsdelivr\.net\/npm\/claude-prompts@\d+\/config\.schema\.json$/
    );
  });
});

describe('CONFIG_JSONC_TEMPLATE', () => {
  it('parses to exactly the document members it leaves live', () => {
    const parsed = parseConfigText(CONFIG_JSONC_TEMPLATE, 'jsonc') as Record<string, unknown>;

    expect(Object.keys(parsed).sort()).toEqual(['$schema', 'version']);
    expect(parsed['version']).toBe(5);
    expect(typeof parsed['$schema']).toBe('string');
  });

  it('carries one example line per settable key and nothing else', () => {
    expect([...examples.keys()].sort()).toEqual([...CONFIG_VALID_KEYS].sort());
  });

  describe.each([...CONFIG_VALID_KEYS])('uncommenting only %s', (key) => {
    it('yields a document that parses, validates, and holds that key', async () => {
      const text = uncomment(indicesForKey(key));

      const parsed = parseConfigText(text, 'jsonc') as Record<string, unknown>;
      const result = await validateConfigAgainstSchema(parsed, SCHEMA_PATH);

      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
      expect(valueAt(parsed, key)).toEqual(JSON.parse(examples.get(key)?.rawValue ?? 'null'));
    });
  });

  it('yields every settable key when everything is uncommented', async () => {
    const structural = new Set<number>();
    LINES.forEach((line, index) => {
      if (SECTION_OPEN.test(line) || SECTION_CLOSE.test(line) || EXAMPLE.test(line)) {
        structural.add(index);
      }
    });

    const text = uncomment(structural);
    const parsed = parseConfigText(text, 'jsonc') as Record<string, unknown>;
    const result = await validateConfigAgainstSchema(parsed, SCHEMA_PATH);

    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);

    const settable = leafKeysOf(parsed).filter((key) => key !== '$schema' && key !== 'version');
    expect(settable.sort()).toEqual([...CONFIG_VALID_KEYS].sort());
  });

  it('CONTROL — an example value the schema rejects fails the same check', async () => {
    const key = 'server.port';
    const entry = examples.get(key);
    if (!entry) throw new Error(`the control needs an example line for "${key}"`);

    const text = uncomment(indicesForKey(key)).replace(
      `"port": ${entry.rawValue},`,
      '"port": "nine",'
    );
    expect(text).toContain('"port": "nine"');

    const parsed = parseConfigText(text, 'jsonc') as Record<string, unknown>;
    const result = await validateConfigAgainstSchema(parsed, SCHEMA_PATH);

    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes('/server/port'))).toBe(true);
  });
});
