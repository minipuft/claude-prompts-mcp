#!/usr/bin/env tsx
/**
 * Generates `server/config.schema.json`, `src/cli-shared/_generated/config-keys.ts` AND
 * `src/cli-shared/_generated/config-template.ts` from the `ConfigFile` type
 * (`src/shared/types/config-file.ts`).
 *
 * WHY ALL THREE ARTIFACTS COME OUT OF ONE RUN
 * The schema says what a config DOCUMENT may contain; the key table says what an operator may
 * SET and what each value is checked against. Those were two hand-maintained lists — in fact
 * three, counting the duplicate in `mcp/tools/config-utils.ts` — so a key could exist in the
 * schema and be unsettable, or be settable and rejected by the loader, with nothing forcing the
 * two into agreement. Deriving the table from the schema this generator just built makes the
 * disagreement unrepresentable: the settable set IS the schema's leaf set minus the two
 * document-level members named in `DOCUMENT_META_LEAVES` below.
 *
 * The third artifact is the `config.jsonc` TEMPLATE a fresh workspace is initialized with: the
 * same leaf set again, this time as commented-out example lines carrying each setting's
 * description, default and permitted values. It comes out of the same run for the same reason —
 * a hand-written example file would describe settings the server does not have the moment
 * `ConfigFile` moves, and an example that lies is worse than no example.
 *
 * WHY THIS EXISTS
 * `config.schema.json` was hand-maintained, so a member added to `ConfigFile` had no mechanical
 * path into the shipped schema — the two could drift with nothing forcing them back into sync.
 * `ConfigFile`'s own header names this file as the generation source and states the JSDoc-tag
 * contract (`@default`, `@minimum`, `@maximum`, `@pattern`, `@asType`) this generator reads.
 *
 * WHY `@asType integer` WORKS: A NATIVE TAG, NOT A CARRIER
 * An earlier version of this file claimed `ts-json-schema-generator` 2.9.0 "has no mechanism to
 * mark a TypeScript `number` member as JSON Schema `integer`" and that "no JSDoc tag (`@asType`,
 * or otherwise) changes that." That claim was wrong, and wrong about the exact tag this file now
 * uses. Verified against the installed package's
 * `dist/src/AnnotationsReader/ExtendedAnnotationsReader.js` (`getTypeAnnotation`): when
 * `jsDoc: 'extended'` is set — which this generator already sets, for `@default`/`@minimum`
 * support — the reader looks for a JSDoc tag literally named `asType` on every member
 * independently of `Config.extraTags`, and if present returns `{ type: <tag text> }`, which
 * `AnnotatedTypeFormatter.getDefinition` (`{ ...childDef, ...annotations }`) merges over the
 * child type unconditionally. `@asType integer` on a `number` member therefore produces
 * `{ type: "integer" }` directly — no `extraTags` registration, no post-generation rewrite, no
 * carrier key ever reaches the emitted schema. The hand-written schema this file replaced used
 * `"type": "integer"` on the same members (`server.port`, `gates.reminderTokenBudget`, and
 * others); `@asType` recovers that shape mechanically instead of by hand.
 *
 * `getTypeAnnotation` has no idea what the member's declared TypeScript type is — it overwrites
 * `type` unconditionally for ANY member carrying the tag, number or not. `assertIntegerTagsOnNumberMembers`
 * below is the check the library doesn't do: it walks the ORIGINAL TypeScript AST (not the
 * generated schema, whose `type` field the tag has already overwritten by the time this file
 * could inspect it) and throws if `@asType` sits on a property signature whose declared type is
 * not the `number` keyword — a misplaced or misspelled tag fails generation loudly instead of
 * silently retyping the wrong field.
 *
 * WHY `topRef: false` AND `expose: "none"`
 * The shipped schema has always been fully inlined — every section (`server`, `gates`, …) sits
 * directly under `properties` as its own `{ "type": "object", "properties": {…} }`, with no
 * `definitions` section and no `$ref` anywhere. `scripts/validate-config-schema.ts`'s self-test
 * (`nodesWithProperties`) walks the schema by descending into each node's own `properties` key; it
 * does not resolve `$ref`, so a `$ref`-and-`definitions` shape (the default with `expose: "export"`
 * — every exported `ConfigFile*` interface becomes a named definition referenced from where it is
 * used) makes the walker see only the root and fail the "every subsection carries
 * `additionalProperties: false`" case with "found only the root". That validator is out of scope
 * for this row, so the generator matches the shape it already assumes: `expose: "none"` inlines
 * every referenced type at its use site instead of naming it, and `topRef: false` inlines the root
 * `ConfigFile` type itself rather than wrapping it in `{ $ref: "#/definitions/ConfigFile" }`.
 *
 * WHY NO `sortProps`
 * `Config.sortProps` looks like the knob for deterministic property order, but it is not wired
 * into the programmatic API used here — verified against the installed package
 * (`node_modules/ts-json-schema-generator/dist/ts-json-schema-generator.js`): it is read only by
 * the CLI entry point, to choose `safe-stable-stringify` over `JSON.stringify` when serializing,
 * and `SchemaGenerator.createSchema()` never reads it. `ObjectTypeFormatter` always emits
 * properties in TypeScript's own member-declaration order, which is already deterministic for a
 * given source file — the "second run changes nothing" check below is what proves that, not a
 * config flag that would silently do nothing through this path.
 *
 * Usage:
 *   tsx scripts/generate-config-schema.ts
 *   npm run generate:config-schema
 *
 * `generateConfigSchema` is also exported so `scripts/validate-config-schema.ts` can run the
 * real generate codepath against a temp path and compare bytes to the committed file — a drift
 * check that exercises the same function `main()` calls, not a parallel reimplementation that
 * could quietly diverge from it.
 */
import { createGenerator } from 'ts-json-schema-generator';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_PATH = path.join(SERVER_ROOT, 'src', 'shared', 'types', 'config-file.ts');
const TSCONFIG_PATH = path.join(SERVER_ROOT, 'tsconfig.json');
const OUTPUT_PATH = path.join(SERVER_ROOT, 'config.schema.json');
const KEYS_OUTPUT_PATH = path.join(
  SERVER_ROOT,
  'src',
  'cli-shared',
  '_generated',
  'config-keys.ts'
);
const TEMPLATE_OUTPUT_PATH = path.join(
  SERVER_ROOT,
  'src',
  'cli-shared',
  '_generated',
  'config-template.ts'
);

/**
 * The npm package major this schema's published address points at. `claude-prompts` is published
 * to npm, and jsDelivr mirrors every published npm package at a versioned URL for free — so
 * `@<major>` in the address below always resolves to whatever that major's latest release
 * actually shipped, with no hosting of our own to keep alive. Bumped by hand alongside a breaking
 * `ConfigFile` change; `validate-config-schema.ts`'s window check is what catches this constant
 * drifting out of step with `server/package.json`'s released major (its comment owns the window
 * rule, not this one).
 */
const CONFIG_SCHEMA_MAJOR = 5;

/**
 * The schema's canonical, resolvable address — what `$id` in the generated schema carries, and
 * what every config document's `$schema` hint points at. A GitHub path (this constant's previous
 * value) 404s: nothing publishes `config.schema.json` at that URL. jsDelivr's npm mirror does,
 * once the package containing it ships.
 */
const SCHEMA_ID = `https://cdn.jsdelivr.net/npm/claude-prompts@${CONFIG_SCHEMA_MAJOR}/config.schema.json`;

/** The JSDoc tag name `ExtendedAnnotationsReader.getTypeAnnotation` recognizes natively. */
const INTEGER_TAG = 'asType';

/**
 * Walks `config-file.ts`'s own AST (not the generated schema — see the file header for why) and
 * throws if `@asType` sits on a property signature whose declared type is not the `number`
 * keyword. `ts-json-schema-generator`'s native handling of this tag has no such check: it
 * overwrites the emitted `type` unconditionally for whatever member carries the tag.
 */
function assertIntegerTagsOnNumberMembers(): void {
  const sourceText = readFileSync(SOURCE_PATH, 'utf8');
  const sourceFile = ts.createSourceFile(SOURCE_PATH, sourceText, ts.ScriptTarget.Latest, true);

  const misapplied: string[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isPropertySignature(node)) {
      const hasIntegerTag = ts.getJSDocTags(node).some((tag) => tag.tagName.text === INTEGER_TAG);
      if (hasIntegerTag && node.type?.kind !== ts.SyntaxKind.NumberKeyword) {
        misapplied.push(node.name.getText(sourceFile));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  if (misapplied.length > 0) {
    throw new Error(
      `generate-config-schema: @${INTEGER_TAG} is applied to non-number member(s) in ` +
        `${SOURCE_PATH}: ${misapplied.join(', ')}. @${INTEGER_TAG} only widens a number member ` +
        `to JSON Schema "integer"; move or remove the tag.`
    );
  }
}

// ---------------------------------------------------------------------------
// Leaf key table emission
// ---------------------------------------------------------------------------

/** The subset of JSON Schema a settable leaf may carry, in the order it is emitted. */
interface LeafRule {
  readonly type: 'string' | 'integer' | 'number' | 'boolean' | 'array';
  readonly enum?: readonly string[];
  readonly minimum?: number;
  readonly maximum?: number;
  readonly items?: { readonly type: string; readonly pattern?: string };
}

/**
 * Document-level members of `ConfigFile` that are NOT settings. `$schema` is the editor hint and
 * `version` is the file-format discriminator the loader migrates — offering a setter for either
 * would let an operator write a value that changes how the file is READ. They stay in
 * `config.schema.json` (they are legal members of the document) and stay out of the key table.
 */
const DOCUMENT_META_LEAVES: ReadonlySet<string> = new Set(['$schema', 'version']);

/** Prettier's `printWidth` for `server/**` (`.prettierrc.json`). */
const PRINT_WIDTH = 100;

type SchemaNode = Record<string, unknown>;

/**
 * Every leaf path in the generated schema, keyed by dotted path. A node carrying `properties` is
 * a SECTION and is descended into; anything else is a leaf. Sorted, so the emitted file's order
 * depends on the key names rather than on member-declaration order in `config-file.ts` — moving a
 * member then produces no diff here.
 */
function collectLeaves(schema: SchemaNode): Map<string, LeafRule> {
  const leaves = new Map<string, LeafRule>();

  const walk = (node: SchemaNode, prefix: string): void => {
    const properties = node['properties'] as Record<string, SchemaNode> | undefined;
    if (properties) {
      for (const [key, child] of Object.entries(properties)) {
        walk(child, prefix ? `${prefix}.${key}` : key);
      }
      return;
    }
    if (prefix === '' || DOCUMENT_META_LEAVES.has(prefix)) return;
    leaves.set(prefix, toLeafRule(prefix, node));
  };

  walk(schema, '');
  return new Map([...leaves.entries()].sort(([a], [b]) => (a < b ? -1 : 1)));
}

/** Narrows one schema leaf to the fields the validator reads, failing loudly on an unknown type. */
function toLeafRule(dottedKey: string, node: SchemaNode): LeafRule {
  const type = node['type'];
  if (
    type !== 'string' &&
    type !== 'integer' &&
    type !== 'number' &&
    type !== 'boolean' &&
    type !== 'array'
  ) {
    throw new Error(
      `generate-config-schema: leaf "${dottedKey}" has type ${JSON.stringify(type)}, which the ` +
        `config key table cannot express. Give it one of string/integer/number/boolean/array in ` +
        `${SOURCE_PATH}, or exclude it as a document-level member.`
    );
  }

  const rule: {
    type: LeafRule['type'];
    enum?: readonly string[];
    minimum?: number;
    maximum?: number;
    items?: { type: string; pattern?: string };
  } = { type };

  const enumValues = node['enum'];
  if (Array.isArray(enumValues)) rule.enum = enumValues.map((value) => String(value));

  const minimum = node['minimum'];
  if (typeof minimum === 'number') rule.minimum = minimum;

  const maximum = node['maximum'];
  if (typeof maximum === 'number') rule.maximum = maximum;

  const items = node['items'] as SchemaNode | undefined;
  if (items) {
    const itemType = typeof items['type'] === 'string' ? items['type'] : 'string';
    const pattern = items['pattern'];
    rule.items = typeof pattern === 'string' ? { type: itemType, pattern } : { type: itemType };
  }

  return rule;
}

function quote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/**
 * A string-array literal on one line when it fits `PRINT_WIDTH` at `indent`, one element per line
 * otherwise — the same choice prettier makes, so the emitted file is already formatted and
 * `lint-staged`'s `prettier --check` on a staged `.ts` has nothing to reflow.
 */
function renderStringArray(values: readonly string[], indent: string, prefix: string): string {
  const inline = `${indent}${prefix}[${values.map(quote).join(', ')}],`;
  if (inline.length <= PRINT_WIDTH) return inline;
  const lines = values.map((value) => `${indent}  ${quote(value)},`);
  return [`${indent}${prefix}[`, ...lines, `${indent}],`].join('\n');
}

function renderLeafRule(rule: LeafRule): string {
  const lines = [`    type: ${quote(rule.type)},`];
  if (rule.enum) lines.push(renderStringArray(rule.enum, '    ', 'enum: '));
  if (rule.minimum !== undefined) lines.push(`    minimum: ${rule.minimum},`);
  if (rule.maximum !== undefined) lines.push(`    maximum: ${rule.maximum},`);
  if (rule.items) {
    const pattern = rule.items.pattern;
    const body =
      pattern === undefined
        ? `{ type: ${quote(rule.items.type)} }`
        : `{ type: ${quote(rule.items.type)}, pattern: ${quote(pattern)} }`;
    lines.push(`    items: ${body},`);
  }
  return lines.join('\n');
}

const GENERATED_PREAMBLE = `// Auto-generated by scripts/generate-config-schema.ts from src/shared/types/config-file.ts.
// Do not edit manually — run \`npm run generate:config-schema\`. \`npm run validate:config-schema\`
// fails when this file and the generator disagree.
`;

const GENERATED_HEADER = `${GENERATED_PREAMBLE}//
// This is the ONE table \`config-input-validator.ts\` validates against, so a key an operator may
// set, the constraint it is checked by, and the schema the loader validates the whole document
// against all come from one declaration: \`ConfigFile\` (src/shared/types/config-file.ts).
`;

/** The whole text of `src/cli-shared/_generated/config-keys.ts`. */
function renderConfigKeysModule(leaves: ReadonlyMap<string, LeafRule>): string {
  const keys = [...leaves.keys()];

  return `${GENERATED_HEADER}
/** The subset of JSON Schema a settable config leaf may carry. */
export interface ConfigLeafRule {
  readonly type: 'string' | 'integer' | 'number' | 'boolean' | 'array';
  /** Permitted values for a \`string\` leaf, in schema order. */
  readonly enum?: readonly string[];
  readonly minimum?: number;
  readonly maximum?: number;
  /** Element contract for an \`array\` leaf. */
  readonly items?: { readonly type: string; readonly pattern?: string };
}

/**
 * Every dotted key an operator may set, sorted. Derived from the leaves of
 * \`config.schema.json\` minus the document-level members (\`$schema\`, \`version\`), which decide
 * how the file is READ rather than what it configures.
 */
export const CONFIG_VALID_KEYS = [
${keys.map((key) => `  ${quote(key)},`).join('\n')}
] as const;

export type ConfigKey = (typeof CONFIG_VALID_KEYS)[number];

/**
 * The constraint each key carries. Typed as a total \`Record<ConfigKey, …>\`, so the compiler —
 * not a convention — is what keeps this table and \`CONFIG_VALID_KEYS\` naming the same set.
 */
export const CONFIG_KEY_TABLE: Readonly<Record<ConfigKey, ConfigLeafRule>> = {
${keys.map((key) => `  ${quote(key)}: {\n${renderLeafRule(leaves.get(key)!)}\n  },`).join('\n')}
};
`;
}

// ---------------------------------------------------------------------------
// `config.jsonc` template emission
// ---------------------------------------------------------------------------

/**
 * The document members the template leaves LIVE (uncommented), and the values it writes for them.
 * These are exactly what `generateDefaultConfig()` (`src/cli-shared/config-operations.ts`) writes
 * today, restated here rather than imported: that module reaches `_generated/config-keys.ts`
 * through `config-input-validator.ts`, so importing it would make regenerating an artifact depend
 * on that artifact already being on disk and well-formed. `validate-config-schema.ts`'s self-test
 * pins the two against each other instead, which costs nothing and cannot deadlock.
 */
const TEMPLATE_DOCUMENT_MEMBERS: Readonly<Record<string, unknown>> = {
  $schema: SCHEMA_ID,
  version: 5,
};

/** Column the template's comment prose wraps at. Prose only — no emitted JSON line is wrapped. */
const TEMPLATE_COMMENT_WIDTH = 96;

/**
 * The template's LINE GRAMMAR, which is what makes "uncomment one setting" mechanical rather than
 * a judgement call:
 *
 *   `// ` + indent + payload   — every commented structural line, marker at column 0
 *   payload `"key": {`          — a section opening
 *   payload `},`                — a section closing
 *   payload `"key": <value>,`   — one setting's example
 *   payload `— text`            — documentation, and the only comment kind that stays a comment
 *   (blank)                     — separates members
 *
 * Uncommenting is therefore `line.slice(3)` on the structural lines and nothing else, and the
 * indentation a line carries is already the indentation it needs once uncommented. Every example
 * line ends with a comma so that uncommenting ONE line inside an otherwise-commented section
 * still parses — `.jsonc` accepts trailing commas, which is the whole reason the file is `.jsonc`.
 */
const TEMPLATE_EXAMPLE_LINE = /^\/\/ {2,}"[^"]+": .+,$/;

/** Text the template opens with, as a comment block. Addressed to whoever opens the file. */
const TEMPLATE_FILE_HEADER: readonly string[] = [
  'Configuration for the claude-prompts MCP server.',
  '',
  'Every setting is listed below, commented out, showing the value it already uses. To change',
  'one, uncomment its line and the braces of the section around it. Anything left commented',
  'keeps its default, so a file with nothing uncommented behaves exactly like no file at all.',
  '',
  'Comments and trailing commas are both fine here — that is what the .jsonc extension buys.',
  'Uncomment a single line and the file still parses; there are no commas to fix afterwards.',
  '',
  'A plain config.json is still read if you prefer one. It simply cannot carry comments.',
];

function commentedLine(depth: number, payload: string): string {
  return `// ${'  '.repeat(depth)}${payload}`;
}

function docLine(depth: number, text: string): string {
  return `// ${'  '.repeat(depth)}— ${text}`;
}

function docContinuationLine(depth: number, text: string): string {
  return `// ${'  '.repeat(depth)}  ${text}`;
}

/** Greedy word wrap. `width` is the room left for TEXT after the marker, indent and `— `. */
function wrapText(text: string, width: number): string[] {
  const usable = Math.max(width, 20);
  const lines: string[] = [];
  let current = '';
  for (const word of text.split(' ')) {
    if (current === '') {
      current = word;
    } else if (current.length + 1 + word.length <= usable) {
      current += ` ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current !== '') lines.push(current);
  return lines;
}

/** `— …` doc lines for one run of prose, first line marked and the rest aligned under it. */
function renderDocParagraph(text: string, depth: number): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized === '') return [];
  const chunks = wrapText(normalized, TEMPLATE_COMMENT_WIDTH - 5 - depth * 2);
  return chunks.map((chunk, index) =>
    index === 0 ? docLine(depth, chunk) : docContinuationLine(depth, chunk)
  );
}

/**
 * The doc lines that follow one setting's description: what it defaults to and what bounds it
 * accepts, then its permitted values when it has an enum. A leaf with no `default` says so
 * outright rather than presenting the derived example value as one — nine leaves are deliberately
 * unset, and an invented default would read as the server's answer instead of the operator's.
 */
function renderLeafFactLines(node: SchemaNode, depth: number): string[] {
  const lines: string[] = [];

  const facts: string[] = [
    'default' in node ? `default: ${JSON.stringify(node['default'])}` : 'no default',
  ];
  if (typeof node['minimum'] === 'number') facts.push(`minimum: ${node['minimum']}`);
  if (typeof node['maximum'] === 'number') facts.push(`maximum: ${node['maximum']}`);
  lines.push(...renderDocParagraph(facts.join(', '), depth));

  const enumValues = node['enum'];
  if (Array.isArray(enumValues) && enumValues.length > 0) {
    const rendered = enumValues.map((value) => JSON.stringify(value)).join(', ');
    lines.push(...renderDocParagraph(`one of: ${rendered}`, depth));
  }

  return lines;
}

/**
 * The example value one setting's commented line carries: its schema `default` where it has one,
 * and otherwise a value derived from what the schema DOES say — first enum member, `minimum`,
 * empty array, or a visibly-placeholder string. Throws rather than emit an example the schema
 * would reject, because every example here is a line a user is invited to uncomment verbatim.
 */
function renderExampleValue(dottedKey: string, node: SchemaNode): string {
  if ('default' in node) return JSON.stringify(node['default']);

  const enumValues = node['enum'];
  if (Array.isArray(enumValues) && enumValues.length > 0) return JSON.stringify(enumValues[0]);

  switch (node['type']) {
    case 'boolean':
      return 'false';
    case 'array':
      return '[]';
    case 'integer':
    case 'number':
      return JSON.stringify(typeof node['minimum'] === 'number' ? node['minimum'] : 0);
    case 'string': {
      const placeholder = `<${dottedKey.split('.').pop()}>`;
      const pattern = node['pattern'];
      if (typeof pattern === 'string' && !new RegExp(pattern).test(placeholder)) {
        throw new Error(
          `generate-config-schema: leaf "${dottedKey}" has a pattern (${pattern}) and no default, ` +
            `so no example string can be derived mechanically. Give it an @default in ${SOURCE_PATH}.`
        );
      }
      return JSON.stringify(placeholder);
    }
    default:
      throw new Error(
        `generate-config-schema: leaf "${dottedKey}" has type ${JSON.stringify(node['type'])}, ` +
          `for which no config.jsonc example value can be derived.`
      );
  }
}

/**
 * One block of lines per member of `node`, in SCHEMA order (which is `ConfigFile`'s own member
 * order) rather than the sorted order the key table uses — a reader scans this file by section,
 * and sections read best in the order the type declares them.
 */
function renderTemplateMemberBlocks(node: SchemaNode, prefix: string, depth: number): string[][] {
  const properties = (node['properties'] ?? {}) as Record<string, SchemaNode>;
  const blocks: string[][] = [];

  for (const [key, child] of Object.entries(properties)) {
    const dotted = prefix ? `${prefix}.${key}` : key;
    if (DOCUMENT_META_LEAVES.has(dotted)) continue;

    const block: string[] = [];
    const description = child['description'];
    if (typeof description === 'string') block.push(...renderDocParagraph(description, depth));

    if (child['properties']) {
      block.push(commentedLine(depth, `${JSON.stringify(key)}: {`));
      renderTemplateMemberBlocks(child, dotted, depth + 1).forEach((inner, index) => {
        if (index > 0) block.push('');
        block.push(...inner);
      });
      block.push(commentedLine(depth, '},'));
    } else {
      block.push(...renderLeafFactLines(child, depth));
      block.push(
        commentedLine(depth, `${JSON.stringify(key)}: ${renderExampleValue(dotted, child)},`)
      );
    }

    blocks.push(block);
  }

  return blocks;
}

/** The whole text of the `config.jsonc` a fresh workspace is initialized with. */
function renderConfigTemplateText(schema: SchemaNode, leafCount: number): string {
  const rootProperties = (schema['properties'] ?? {}) as Record<string, SchemaNode>;

  const versionSchema = rootProperties['version'];
  if (versionSchema?.['const'] !== TEMPLATE_DOCUMENT_MEMBERS['version']) {
    throw new Error(
      `generate-config-schema: the config.jsonc template writes "version": ` +
        `${JSON.stringify(TEMPLATE_DOCUMENT_MEMBERS['version'])} while the schema pins ` +
        `${JSON.stringify(versionSchema?.['const'])}. Update TEMPLATE_DOCUMENT_MEMBERS and ` +
        `generateDefaultConfig() together — a template the loader rejects is worse than none.`
    );
  }

  const blocks: string[][] = [];
  for (const [key, value] of Object.entries(TEMPLATE_DOCUMENT_MEMBERS)) {
    const memberSchema = rootProperties[key];
    if (!memberSchema) {
      throw new Error(
        `generate-config-schema: the config.jsonc template writes a live "${key}" member that ` +
          `the schema does not declare.`
      );
    }
    const block: string[] = [];
    const description = memberSchema['description'];
    if (typeof description === 'string') block.push(...renderDocParagraph(description, 1));
    block.push(`  ${JSON.stringify(key)}: ${JSON.stringify(value)},`);
    blocks.push(block);
  }
  blocks.push(...renderTemplateMemberBlocks(schema, '', 1));

  const lines: string[] = TEMPLATE_FILE_HEADER.map((line) => (line === '' ? '//' : `// ${line}`));
  lines.push('', '{');
  blocks.forEach((block, index) => {
    if (index > 0) lines.push('');
    lines.push(...block);
  });
  lines.push('}');

  // A doc line that happened to look like an example line would silently add a settable key to
  // the file a user copies from. Counting the example lines is what proves the grammar held.
  const exampleLines = lines.filter((line) => TEMPLATE_EXAMPLE_LINE.test(line)).length;
  if (exampleLines !== leafCount) {
    throw new Error(
      `generate-config-schema: the config.jsonc template renders ${exampleLines} example lines ` +
        `for ${leafCount} settable keys. A description or enum list is being mistaken for an ` +
        `example line, or a leaf failed to render.`
    );
  }

  return lines.join('\n') + '\n';
}

/** Escapes text for embedding in a TypeScript template literal. */
function escapeTemplateLiteral(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

const TEMPLATE_GENERATED_HEADER = `${GENERATED_PREAMBLE}//
// The text \`cpm init\` writes as a workspace \`config.jsonc\`. Every setting it shows, and
// every description, default and permitted-value list beside it, is read out of the same schema
// the loader validates against — so the example file a user edits cannot describe a setting the
// server does not have.
`;

/** The whole text of `src/cli-shared/_generated/config-template.ts`. */
function renderConfigTemplateModule(templateText: string, schemaUrl: string): string {
  return `${TEMPLATE_GENERATED_HEADER}
/**
 * The schema's one published address — the same value the generated schema's own \`$id\` carries
 * and this template's live \`$schema\` line shows. \`generateDefaultConfig()\`
 * (\`src/cli-shared/config-operations.ts\`) reads this constant rather than restating the address,
 * so a config document written anywhere in the codebase points at one address by construction.
 */
export const CONFIG_SCHEMA_URL = ${quote(schemaUrl)};

/**
 * A ready-to-edit \`config.jsonc\`: \`$schema\` and \`version\` live, every setting beneath them
 * commented out with its description, its default and its permitted values.
 *
 * Uncommenting one setting's line together with the braces of the sections it sits in yields a
 * document that still parses and still validates — every example line ends with a comma so that
 * holds for a single line as much as for all of them.
 */
export const CONFIG_JSONC_TEMPLATE: string = \`${escapeTemplateLiteral(templateText)}\`;
`;
}

/**
 * Generates the `ConfigFile` JSON Schema, the leaf key table derived from it, and the
 * `config.jsonc` template that documents the same leaves, writing them to `outputPath` /
 * `keysOutputPath` / `templateOutputPath` (defaulting to the committed files). The single codepath
 * both `main()` (the CLI entry point) and `validate-config-schema.ts`'s drift check call — the
 * drift check proves the real generate output matches disk, not a parallel render function's
 * output.
 */
export function generateConfigSchema(
  outputPath: string = OUTPUT_PATH,
  keysOutputPath: string = KEYS_OUTPUT_PATH,
  templateOutputPath: string = TEMPLATE_OUTPUT_PATH
): void {
  assertIntegerTagsOnNumberMembers();

  const schema = createGenerator({
    path: SOURCE_PATH,
    tsconfig: TSCONFIG_PATH,
    type: 'ConfigFile',
    expose: 'none',
    topRef: false,
    jsDoc: 'extended',
    additionalProperties: false,
    schemaId: SCHEMA_ID,
  }).createSchema('ConfigFile');

  // `allowTrailingCommas` is a vscode-json-languageservice schema extension, not a JSON Schema
  // keyword — Ajv under this repo's `strict: false` accepts and ignores unknown keywords, so it
  // changes nothing for the server's own `validateConfigAgainstSchema` path. It is here because
  // every example line in `CONFIG_JSONC_TEMPLATE` (below) ends with a comma so that uncommenting
  // ONE line leaves valid JSON, and that line is often the last live property before a closing
  // brace — which VS Code's JSON language service flags as a trailing-comma warning even under
  // its own default `.jsonc` settings. The cost: the same keyword also silences that warning for
  // a strict `config.json`, where `ConfigLoader` (`src/infra/config/index.ts`) parses with plain
  // `JSON.parse` and a trailing comma is a real, unrecovered parse error — accepted because the
  // documented "uncomment one line" flow trips the warning on a file the server accepts by
  // design, which cost more than the editor staying quiet on a `.json` mistake it already refuses
  // to load.
  (schema as SchemaNode)['allowTrailingCommas'] = true;

  const content = JSON.stringify(schema, null, 2) + '\n';
  writeFileSync(outputPath, content);

  const leaves = collectLeaves(schema as SchemaNode);

  mkdirSync(path.dirname(keysOutputPath), { recursive: true });
  writeFileSync(keysOutputPath, renderConfigKeysModule(leaves));

  mkdirSync(path.dirname(templateOutputPath), { recursive: true });
  writeFileSync(
    templateOutputPath,
    renderConfigTemplateModule(
      renderConfigTemplateText(schema as SchemaNode, leaves.size),
      SCHEMA_ID
    )
  );
}

function main(): void {
  generateConfigSchema();
  console.log(`✓ config.schema.json generated from ConfigFile (${SOURCE_PATH})`);
  console.log(`✓ ${path.relative(SERVER_ROOT, KEYS_OUTPUT_PATH)} generated from the same schema`);
  console.log(
    `✓ ${path.relative(SERVER_ROOT, TEMPLATE_OUTPUT_PATH)} generated from the same schema`
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
