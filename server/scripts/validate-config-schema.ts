#!/usr/bin/env tsx
/**
 * Validates `server/config.json` against `server/config.schema.json`.
 *
 * WHY THIS EXISTS
 * `config.json` carries `"$schema": "./config.schema.json"`, which buys editor validation and
 * nothing else — no runtime path calls `validateConfigAgainstSchema`, so a hand-edited config
 * that violates the schema is caught by whichever editor the author happened to be using, or by
 * nobody. This script is the programmatic reader that makes the declared `$schema` mean
 * something in CI. Until it was wired into `validate:all` it was itself unreferenced, which is
 * the same shape it exists to prevent: a declaration with no check standing behind it.
 *
 * Paths resolve from this file, not `process.cwd()`, so the result does not depend on where it
 * was invoked from.
 *
 * Usage:
 *   tsx scripts/validate-config-schema.ts
 *   npm run validate:config-schema
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateConfigAgainstSchema } from '../src/infra/config/config-schema-validator.js';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function main(): Promise<void> {
  const configPath = path.join(SERVER_ROOT, 'config.json');
  const raw = await readFile(configPath, 'utf8');
  const config = JSON.parse(raw) as Record<string, unknown>;

  const result = await validateConfigAgainstSchema(config, configPath);
  if (!result.valid) {
    console.error('Config schema validation failed:');
    for (const error of result.errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log('✓ Config schema validation passed');
}

main().catch((error) => {
  console.error('Config schema validation error:', error instanceof Error ? error.message : error);
  process.exit(1);
});
