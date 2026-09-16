#!/usr/bin/env tsx
/**
 * Generates `server/config.schema.json` from the `ConfigFile` type
 * (`src/shared/types/config-file.ts`).
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
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_PATH = path.join(SERVER_ROOT, 'src', 'shared', 'types', 'config-file.ts');
const TSCONFIG_PATH = path.join(SERVER_ROOT, 'tsconfig.json');
const OUTPUT_PATH = path.join(SERVER_ROOT, 'config.schema.json');

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

/**
 * Generates the `ConfigFile` JSON Schema and writes it to `outputPath` (defaults to the
 * committed `server/config.schema.json`). The single codepath both `main()` (the CLI entry
 * point) and `validate-config-schema.ts`'s drift check call — the drift check proves the real
 * generate output matches disk, not a parallel render function's output.
 */
export function generateConfigSchema(outputPath: string = OUTPUT_PATH): void {
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
}

function main(): void {
  generateConfigSchema();
  console.log(`✓ config.schema.json generated from ConfigFile (${SOURCE_PATH})`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
