#!/usr/bin/env tsx
/**
 * Validates `server/config.json` against `server/config.schema.json`.
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

import type { ConfigSchemaValidationResult } from '../src/infra/config/config-schema-validator.js';
import { validateConfigAgainstSchema } from '../src/infra/config/config-schema-validator.js';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = path.join(SERVER_ROOT, 'config.json');
const SCHEMA_PATH = path.join(SERVER_ROOT, 'config.schema.json');

type JsonObject = Record<string, unknown>;

async function readJson(filePath: string): Promise<JsonObject> {
  return JSON.parse(await readFile(filePath, 'utf8')) as JsonObject;
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

/** Deep-clones the shipped config and applies one mutation, so each case starts from a valid file. */
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
