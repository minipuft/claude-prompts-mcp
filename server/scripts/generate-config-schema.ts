#!/usr/bin/env tsx
/**
 * Generates `server/config.schema.json` from the `ConfigFile` type
 * (`src/shared/types/config-file.ts`).
 *
 * WHY THIS EXISTS
 * `config.schema.json` was hand-maintained, so a member added to `ConfigFile` had no mechanical
 * path into the shipped schema — the two could drift with nothing forcing them back into sync.
 * `ConfigFile`'s own header names this file as the generation source and states the JSDoc-tag
 * contract (`@default`, `@minimum`, `@maximum`, `@pattern`) this generator reads.
 *
 * `ts-json-schema-generator` 2.9.0 has no mechanism to mark a TypeScript `number` member as JSON
 * Schema `"integer"` — verified against the installed version's `Config.ts` and
 * `NumberTypeNodeParser.ts`: every `number` keyword produces `{ type: "number" }` unconditionally,
 * and no JSDoc tag (`@asType`, or otherwise) changes that. The hand-written schema this file
 * replaces used `"type": "integer"` on several members (`server.port`,
 * `gates.reminderTokenBudget`, and others); this generator narrows those to `"number"` until the
 * upstream library gains a mechanism, or a custom `SubTypeFormatter` is written to add one. Do not
 * invent a tag that the installed library silently ignores — an ignored tag is worse than an
 * absent one, because it reads as effective.
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
 */
import { createGenerator } from 'ts-json-schema-generator';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_PATH = path.join(SERVER_ROOT, 'src', 'shared', 'types', 'config-file.ts');
const TSCONFIG_PATH = path.join(SERVER_ROOT, 'tsconfig.json');
const OUTPUT_PATH = path.join(SERVER_ROOT, 'config.schema.json');

/**
 * The schema `$id` kept stable across the hand-written and generated files. A later row changes
 * this; this row only changes how the file is produced, not its identity.
 */
const SCHEMA_ID = 'https://github.com/minipuft/claude-prompts-mcp/server/config.schema.json';

function main(): void {
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
  writeFileSync(OUTPUT_PATH, content);
  console.log(`✓ config.schema.json generated from ConfigFile (${SOURCE_PATH})`);
}

main();
