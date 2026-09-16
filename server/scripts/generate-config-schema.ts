#!/usr/bin/env tsx
/**
 * Generates `server/config.schema.json` AND `src/cli-shared/_generated/config-keys.ts` from the
 * `ConfigFile` type (`src/shared/types/config-file.ts`).
 *
 * WHY BOTH ARTIFACTS COME OUT OF ONE RUN
 * The schema says what a config DOCUMENT may contain; the key table says what an operator may
 * SET and what each value is checked against. Those were two hand-maintained lists — in fact
 * three, counting the duplicate in `mcp/tools/config-utils.ts` — so a key could exist in the
 * schema and be unsettable, or be settable and rejected by the loader, with nothing forcing the
 * two into agreement. Deriving the table from the schema this generator just built makes the
 * disagreement unrepresentable: the settable set IS the schema's leaf set minus the two
 * document-level members named in `DOCUMENT_META_LEAVES` below.
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

/**
 * The schema `$id` kept stable across the hand-written and generated files. A later row changes
 * this; this row only changes how the file is produced, not its identity.
 */
const SCHEMA_ID = 'https://github.com/minipuft/claude-prompts-mcp/server/config.schema.json';

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

const GENERATED_HEADER = `// Auto-generated by scripts/generate-config-schema.ts from src/shared/types/config-file.ts.
// Do not edit manually — run \`npm run generate:config-schema\`. \`npm run validate:config-schema\`
// fails when this file and the generator disagree.
//
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

/**
 * Generates the `ConfigFile` JSON Schema and the leaf key table derived from it, writing them to
 * `outputPath` / `keysOutputPath` (defaulting to the committed files). The single codepath both
 * `main()` (the CLI entry point) and `validate-config-schema.ts`'s drift check call — the drift
 * check proves the real generate output matches disk, not a parallel render function's output.
 */
export function generateConfigSchema(
  outputPath: string = OUTPUT_PATH,
  keysOutputPath: string = KEYS_OUTPUT_PATH
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

  const content = JSON.stringify(schema, null, 2) + '\n';
  writeFileSync(outputPath, content);

  mkdirSync(path.dirname(keysOutputPath), { recursive: true });
  writeFileSync(keysOutputPath, renderConfigKeysModule(collectLeaves(schema as SchemaNode)));
}

function main(): void {
  generateConfigSchema();
  console.log(`✓ config.schema.json generated from ConfigFile (${SOURCE_PATH})`);
  console.log(`✓ ${path.relative(SERVER_ROOT, KEYS_OUTPUT_PATH)} generated from the same schema`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
