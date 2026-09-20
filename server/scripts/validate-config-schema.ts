#!/usr/bin/env tsx
/**
 * Validates `server/config.json` against `server/config.schema.json`, and validates the SCHEMA
 * itself against its own generator.
 *
 * WHY THIS EXISTS
 * `config.json` carries `"$schema": "./config.schema.json"`, which buys editor validation.
 * `ConfigLoader.loadConfig` also calls `validateConfigAgainstSchema` at startup, with the
 * package schema injected from `runtime/context.ts` — but that path reports drift as a
 * `console.warn`, not a rejection, so a hand-edited `config.json` still loads and still starts
 * the server. This script is the CI check that makes a schema violation in the SHIPPED
 * `config.json` fail the build outright, rather than surface only as a runtime warning. Until it
 * was wired into `validate:all` it was itself unreferenced, which is the same shape it exists to
 * prevent: a declaration with no check standing behind it.
 *
 * WHY THE DRIFT CHECK EXISTS
 * `config.schema.json` is generated from `ConfigFile` by `scripts/generate-config-schema.ts`
 * (row 4.9), but nothing before this row stopped a hand-edit to the committed schema, or a
 * forgotten `npm run generate:config-schema` after editing `ConfigFile`, from shipping silently —
 * the config-validity check below only reads whatever schema happens to be on disk, generated or
 * not. `checkSchemaDrift` closes that: it calls `generateConfigSchema` (the exact function
 * `npm run generate:config-schema` calls) into a temp file and compares bytes against the
 * committed file, so the gate proves the shipped schema IS the generator's output rather than
 * merely internally self-consistent. All three artifacts of that one generator run are compared —
 * the schema, `src/cli-shared/_generated/config-keys.ts` (the leaf key table every config setter
 * validates against) and `src/cli-shared/_generated/config-template.ts` (the `config.jsonc` a
 * fresh workspace is initialized with) — because a check covering only the schema would go green
 * while the settable key list, or the example file a user edits, sat one `ConfigFile` edit behind.
 * The template is the one a reader would least suspect: it is prose as much as data, so a stale
 * copy still parses, still validates, and still documents a default the server stopped using.
 * This mirrors the shape `generate-contracts.ts --check` and
 * `generate-framework-schemas.ts --check` already use for their own generated artifacts — the
 * project's established drift-gate pattern — adapted to live inside this script (per this row)
 * rather than as a second flag on the generator.
 *
 * WHY THE SELF-TEST EXISTS
 * Running clean proved almost nothing until 2026-09-11. `additionalProperties: false` sat at the
 * ROOT only, and every one of the 27 subsections left it unset — so `gates.enabld`,
 * `server.prot`, `resources.logs.maxEntrys` and `verification.isolation.tmeout` all validated,
 * and the loader then silently defaulted each one. Every setting this file governs lives in a
 * subsection, so the strict gate guarded the only level with nothing in it.
 *
 * `unevaluatedProperties: false` is NOT the fix and must not be substituted for it: AJV 8.20
 * compiles this schema under draft-07 with `strict: false`, where that keyword is accepted and
 * ignored. Measured — `{a:{typo:1}}` still validates. Case 8 below pins that, so a future
 * "modernize the dialect" edit cannot silently disarm the gate.
 *
 * Case 2 is the one that keeps this honest over time: it asserts the property STRUCTURALLY, so a
 * subsection added later without `additionalProperties: false` fails here rather than quietly
 * reopening the hole. Case 1 is the positive control — without it, every rejection below would
 * pass equally well against a schema that rejects everything.
 *
 * Paths resolve from this file, not `process.cwd()`, so the result does not depend on where it
 * was invoked from.
 *
 * Usage:
 *   tsx scripts/validate-config-schema.ts
 *   npm run validate:config-schema
 *   npm run validate:config-schema:self-test
 */
import { copyFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateConfigSchema } from './generate-config-schema.js';
import { generateDefaultConfig } from '../src/cli-shared/config-operations.js';
import { validateConfigAgainstSchema } from '../src/infra/config/config-schema-validator.js';

import type { ConfigSchemaValidationResult } from '../src/shared/types/config-manager.js';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = path.join(SERVER_ROOT, 'config.json');
const SCHEMA_PATH = path.join(SERVER_ROOT, 'config.schema.json');
const KEYS_PATH = path.join(SERVER_ROOT, 'src', 'cli-shared', '_generated', 'config-keys.ts');
const TEMPLATE_PATH = path.join(
  SERVER_ROOT,
  'src',
  'cli-shared',
  '_generated',
  'config-template.ts'
);

type JsonObject = Record<string, unknown>;

async function readJson(filePath: string): Promise<JsonObject> {
  return JSON.parse(await readFile(filePath, 'utf8')) as JsonObject;
}

interface SchemaDriftResult {
  readonly drifted: boolean;
  readonly message?: string;
}

/**
 * Regenerates ALL THREE generated artifacts via `generateConfigSchema` — the same function
 * `main()` in `generate-config-schema.ts` calls — into a fresh temp directory, and compares their
 * bytes to `committedSchemaPath` / `committedKeysPath` / `committedTemplatePath` (defaulting to
 * the real files). Parameterized so the self-test can point any one of them at a fixture copy
 * instead of the real file.
 *
 * The key table and the `config.jsonc` template are checked here rather than in gates of their
 * own because they come out of the same run: a check that covered only the schema would pass
 * while `CONFIG_VALID_KEYS` — the list every config setter validates against — or the example
 * file `cpm init` writes sat one `ConfigFile` edit behind.
 */
async function checkSchemaDrift(
  committedSchemaPath: string = SCHEMA_PATH,
  committedKeysPath: string = KEYS_PATH,
  committedTemplatePath: string = TEMPLATE_PATH
): Promise<SchemaDriftResult> {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'config-schema-drift-'));
  const regeneratedSchemaPath = path.join(tempDir, 'config.schema.json');
  const regeneratedKeysPath = path.join(tempDir, 'config-keys.ts');
  const regeneratedTemplatePath = path.join(tempDir, 'config-template.ts');
  generateConfigSchema(regeneratedSchemaPath, regeneratedKeysPath, regeneratedTemplatePath);

  const comparisons = [
    { committedPath: committedSchemaPath, regeneratedPath: regeneratedSchemaPath },
    { committedPath: committedKeysPath, regeneratedPath: regeneratedKeysPath },
    { committedPath: committedTemplatePath, regeneratedPath: regeneratedTemplatePath },
  ];

  const stale: string[] = [];
  for (const { committedPath, regeneratedPath } of comparisons) {
    const [committed, regenerated] = await Promise.all([
      readFile(committedPath, 'utf8'),
      readFile(regeneratedPath, 'utf8'),
    ]);
    if (committed !== regenerated) stale.push(path.relative(SERVER_ROOT, committedPath));
  }

  if (stale.length === 0) {
    return { drifted: false };
  }
  return {
    drifted: true,
    message:
      `${stale.join(' and ')} ${stale.length === 1 ? 'does' : 'do'} not match what ` +
      `\`npm run generate:config-schema\` produces from ConfigFile. Run: npm run generate:config-schema`,
  };
}

// ---------------------------------------------------------------------------
// Self-test fixtures. The fixture config is validated against a COPY of the real schema, so the
// cases measure the shipped schema rather than a hand-written stand-in that could drift from it.
// ---------------------------------------------------------------------------

interface SelfTestCase {
  readonly name: string;
  readonly run: (_fixtureDir: string, _shippedConfig: JsonObject) => Promise<void>;
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

/** Writes `config` into the fixture dir and validates it against the copied real schema. */
async function validateFixture(
  fixtureDir: string,
  config: JsonObject
): Promise<ConfigSchemaValidationResult> {
  const fixturePath = path.join(fixtureDir, 'config.json');
  writeFileSync(fixturePath, JSON.stringify(config, null, 2), 'utf8');
  const fixtureSchemaPath = path.join(fixtureDir, 'config.schema.json');
  return validateConfigAgainstSchema(config, fixtureSchemaPath);
}

/**
 * Deep-clones the shipped config and applies one mutation, so each case starts from a valid file.
 *
 * The shipped `server/config.json` carries no sections — row 4.5 (ruling R46) made it exactly
 * `{$schema, version}`, because code owns every default now and a config.json holds only
 * OVERRIDES. `shipped` here is therefore that two-key object, not a full example: a case that
 * needs to mutate a nested key (`c.gates.enabld`, `c.resources.logs.maxEntrys`, …) must build the
 * section it needs itself (`c.gates ??= {}`) rather than assume `shipped` already populated it —
 * assigning through an absent parent throws `Cannot set properties of undefined`, it does not
 * silently no-op.
 */
function mutate(shipped: JsonObject, apply: (_config: any) => void): JsonObject {
  const clone = JSON.parse(JSON.stringify(shipped)) as JsonObject;
  apply(clone);
  return clone;
}

/** Every node carrying a `properties` block, keyed by dotted path. Root is `''`. */
function nodesWithProperties(schema: JsonObject): Map<string, JsonObject> {
  const found = new Map<string, JsonObject>();
  const walk = (node: JsonObject, prefix: string): void => {
    const properties = node['properties'] as JsonObject | undefined;
    if (!properties) return;
    found.set(prefix, node);
    for (const [key, value] of Object.entries(properties)) {
      if (value && typeof value === 'object') {
        walk(value as JsonObject, prefix ? `${prefix}.${key}` : key);
      }
    }
  };
  walk(schema, '');
  return found;
}

const SELF_TEST_CASES: readonly SelfTestCase[] = [
  {
    name: 'POSITIVE CONTROL — the shipped config validates clean',
    run: async (fixtureDir, shipped) => {
      const result = await validateFixture(fixtureDir, shipped);
      assert(
        result.valid,
        `the shipped config must validate, or every rejection case below is vacuous: ${result.errors.join('; ')}`
      );
    },
  },
  {
    name: 'STRUCTURAL — every subsection carries additionalProperties: false',
    run: async () => {
      const schema = await readJson(SCHEMA_PATH);
      const nodes = nodesWithProperties(schema);
      const lax = [...nodes.entries()]
        .filter(([, node]) => node['additionalProperties'] !== false)
        .map(([dotted]) => dotted || '(root)');
      assert(
        lax.length === 0,
        `these schema sections accept unknown keys, so a typo in them defaults silently: ${lax.join(', ')}`
      );
      assert(nodes.size > 1, 'expected the root plus subsections; found only the root');
    },
  },
  {
    name: 'depth 1 — gates.enabld is rejected',
    run: async (fixtureDir, shipped) => {
      const result = await validateFixture(
        fixtureDir,
        mutate(shipped, (c) => {
          c.gates ??= {};
          c.gates.enabld = true;
        })
      );
      assert(!result.valid, 'a misspelled key one level down must be rejected');
      assert(
        result.errors.some((error) => error.startsWith('/gates')),
        `the error must name the section it is in, got: ${result.errors.join('; ')}`
      );
    },
  },
  {
    name: 'depth 2 — resources.logs.maxEntrys is rejected',
    run: async (fixtureDir, shipped) => {
      const result = await validateFixture(
        fixtureDir,
        mutate(shipped, (c) => {
          c.resources ??= {};
          c.resources.logs ??= {};
          c.resources.logs.maxEntrys = 5;
        })
      );
      assert(!result.valid, 'a misspelled key two levels down must be rejected');
      assert(
        result.errors.some((error) => error.startsWith('/resources/logs')),
        `the error must name the nested section, got: ${result.errors.join('; ')}`
      );
    },
  },
  {
    name: 'depth 2 — verification.isolation.tmeout is rejected',
    run: async (fixtureDir, shipped) => {
      const result = await validateFixture(
        fixtureDir,
        mutate(shipped, (c) => {
          c.verification ??= {};
          c.verification.isolation ??= {};
          c.verification.isolation.tmeout = 9;
        })
      );
      assert(!result.valid, 'a misspelled key in a second nested section must be rejected');
    },
  },
  {
    name: 'CONTROL — a root-level unknown key is still rejected',
    run: async (fixtureDir, shipped) => {
      const result = await validateFixture(
        fixtureDir,
        mutate(shipped, (c) => {
          c.gatez = {};
        })
      );
      assert(!result.valid, 'root strictness must survive the per-section change');
    },
  },
  {
    name: 'CONTROL — ordinary type validation still fires',
    run: async (fixtureDir, shipped) => {
      const result = await validateFixture(
        fixtureDir,
        mutate(shipped, (c) => {
          c.server ??= {};
          c.server.port = 'nine';
        })
      );
      assert(!result.valid, 'a wrongly-typed value must still be rejected');
      assert(
        result.errors.some((error) => error.includes('/server/port')),
        `the type error must name the key, got: ${result.errors.join('; ')}`
      );
    },
  },
  {
    name: 'REGRESSION — the schema does not rely on unevaluatedProperties',
    run: async () => {
      const raw = await readFile(SCHEMA_PATH, 'utf8');
      assert(
        !raw.includes('unevaluatedProperties'),
        'unevaluatedProperties is accepted and IGNORED by AJV under draft-07 with strict:false — ' +
          'substituting it for additionalProperties disarms this gate silently'
      );
    },
  },
  {
    name: 'UNAVAILABLE — a missing schema path is reported as unavailable, not invalid',
    run: async (fixtureDir, shipped) => {
      const missingSchemaPath = path.join(fixtureDir, 'does-not-exist.schema.json');
      const result = await validateConfigAgainstSchema(shipped, missingSchemaPath);
      assert(
        result.status === 'unavailable',
        `a schema that cannot be read must report 'unavailable', not be conflated with 'invalid'; got status=${result.status}`
      );
      assert(!result.valid, 'valid must be false when the schema is unavailable');
      assert(
        result.errors.length > 0,
        'the unreadable-schema error must be reported, not swallowed'
      );
    },
  },
  {
    name: 'DRIFT — the committed schema matches what the generator produces',
    run: async () => {
      const result = await checkSchemaDrift();
      assert(
        !result.drifted,
        `the committed config.schema.json must match \`npm run generate:config-schema\`'s ` +
          `output, or the fix-it command the drift check prints is pointing at a fix that would ` +
          `not actually converge: ${result.message ?? '(no message)'}`
      );
    },
  },
  {
    name: 'DRIFT POSITIVE CONTROL — a hand-edited schema copy is detected as stale',
    run: async (fixtureDir) => {
      const schema = JSON.parse(await readFile(SCHEMA_PATH, 'utf8')) as JsonObject;
      const server = (schema['properties'] as JsonObject)['server'] as JsonObject;
      const port = (server['properties'] as JsonObject)['port'] as JsonObject;
      port['description'] = 'DRIFT SELF-TEST MUTATION — this text must never match the generator';

      const mutatedPath = path.join(fixtureDir, 'mutated-config.schema.json');
      writeFileSync(mutatedPath, JSON.stringify(schema, null, 2) + '\n', 'utf8');

      const result = await checkSchemaDrift(mutatedPath);
      assert(
        result.drifted,
        'a hand-edited schema copy (one description changed) must be reported as drifted, or ' +
          'the drift check is not actually comparing bytes'
      );
      assert(
        result.message?.includes('mutated-config.schema.json') === true,
        `the drift message must name the stale artifact, got: ${result.message ?? '(none)'}`
      );
    },
  },
  {
    // The key table is a SECOND artifact of the same generator run, so the schema half of the
    // check going green says nothing about it. Without this case, a hand-edit to
    // `CONFIG_VALID_KEYS` — adding a key no schema leaf backs, or deleting one an operator
    // relies on — would ship under a passing gate.
    name: 'DRIFT POSITIVE CONTROL — a hand-edited key table copy is detected as stale',
    run: async (fixtureDir) => {
      const committed = await readFile(KEYS_PATH, 'utf8');
      const mutated = committed.replace(
        "  'logging.level',",
        "  'logging.level',\n  'logging.notARealKey',"
      );
      assert(
        mutated !== committed,
        'the mutation anchor is gone from the key table — this case would measure nothing'
      );

      const mutatedPath = path.join(fixtureDir, 'mutated-config-keys.ts');
      writeFileSync(mutatedPath, mutated, 'utf8');

      const result = await checkSchemaDrift(SCHEMA_PATH, mutatedPath);
      assert(
        result.drifted,
        'a hand-edited key table copy (one key added) must be reported as drifted, or the drift ' +
          'check is comparing only the schema'
      );
      assert(
        result.message?.includes('mutated-config-keys.ts') === true,
        `the drift message must name the stale artifact, got: ${result.message ?? '(none)'}`
      );
    },
  },
  {
    // The THIRD artifact of the same run, and the one whose staleness hides best: a template one
    // `ConfigFile` edit behind still parses, still validates, and still reads as authoritative
    // while documenting a default the server no longer uses.
    name: 'DRIFT POSITIVE CONTROL — a hand-edited config.jsonc template copy is detected as stale',
    run: async (fixtureDir) => {
      const committed = await readFile(TEMPLATE_PATH, 'utf8');
      const mutated = committed.replace('"port": 9090,', '"port": 9091,');
      assert(
        mutated !== committed,
        'the mutation anchor is gone from the config.jsonc template — this case would measure nothing'
      );

      const mutatedPath = path.join(fixtureDir, 'mutated-config-template.ts');
      writeFileSync(mutatedPath, mutated, 'utf8');

      const result = await checkSchemaDrift(SCHEMA_PATH, KEYS_PATH, mutatedPath);
      assert(
        result.drifted,
        'a hand-edited template copy (one example value changed) must be reported as drifted, ' +
          'or the drift check is not comparing the template at all'
      );
      assert(
        result.message?.includes('mutated-config-template.ts') === true,
        `the drift message must name the stale artifact, got: ${result.message ?? '(none)'}`
      );
    },
  },
  {
    // The template restates `generateDefaultConfig()`'s document members rather than importing
    // them — importing would make regenerating `_generated/config-keys.ts` depend on that same
    // file already being on disk, since `config-operations.ts` reaches it through
    // `config-input-validator.ts`. A restated constant with nothing pinning it is the drift shape
    // this whole script exists to prevent, so it is pinned here instead of in the generator.
    name: 'PARITY — the template writes exactly what `cpm init` writes today',
    run: async () => {
      const template = await readFile(TEMPLATE_PATH, 'utf8');
      const defaults = generateDefaultConfig();
      assert(
        Object.keys(defaults).length > 0,
        'generateDefaultConfig() returned no members — this case would assert nothing'
      );

      for (const [key, value] of Object.entries(defaults)) {
        const liveLine = `\n  ${JSON.stringify(key)}: ${JSON.stringify(value)},\n`;
        assert(
          template.includes(liveLine),
          `the config.jsonc template must carry ${JSON.stringify(key)} live with the value ` +
            `\`cpm init\` writes (${JSON.stringify(value)}); it does not. Update ` +
            'TEMPLATE_DOCUMENT_MEMBERS in generate-config-schema.ts and generateDefaultConfig() ' +
            'together, then regenerate.'
        );
      }
    },
  },
];

async function selfTest(): Promise<void> {
  const fixtureDir = mkdtempSync(path.join(os.tmpdir(), 'config-schema-selftest-'));
  copyFileSync(SCHEMA_PATH, path.join(fixtureDir, 'config.schema.json'));
  const shipped = await readJson(CONFIG_PATH);

  for (const testCase of SELF_TEST_CASES) {
    try {
      await testCase.run(fixtureDir, shipped);
    } catch (error) {
      throw new Error(
        `self-test case failed — ${testCase.name}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
  }

  console.log(
    `validate:config-schema self-test — ${SELF_TEST_CASES.length}/${SELF_TEST_CASES.length} cases passed`
  );
}

async function validateShippedConfig(): Promise<void> {
  const drift = await checkSchemaDrift();
  if (drift.drifted) {
    console.error('Config schema is out of date:');
    console.error(`- ${drift.message}`);
    process.exit(1);
  }

  const config = await readJson(CONFIG_PATH);
  const result = await validateConfigAgainstSchema(config, SCHEMA_PATH);

  if (result.status === 'unavailable') {
    console.error('Config schema is unavailable — the config was not checked:');
    for (const error of result.errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  if (result.status === 'invalid') {
    console.error('Config schema validation failed:');
    for (const error of result.errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log('✓ Config schema validation passed');
}

async function main(): Promise<void> {
  if (process.argv.slice(2).includes('--self-test')) {
    await selfTest();
    return;
  }
  await validateShippedConfig();
}

main().catch((error) => {
  console.error('Config schema validation error:', error instanceof Error ? error.message : error);
  process.exit(1);
});
