/**
 * Schema validation warnings on load.
 *
 * `ConfigLoader.loadConfig` checks the raw parsed config against the package's
 * `config.schema.json` when a schema path is injected, and reports drift through the module
 * logger's `warn` (`src/infra/config/index.ts`), which reaches stderr under STDIO on every
 * process, CI or not. Warnings are suppressed per SET: a reload warns again only when status +
 * the sorted error list differ from the last one warned, and a valid load clears that memory.
 *
 * `tsc` cannot see any of this — the shape is only bound at load time — so these tests pin the
 * exact warning text and `getSchemaValidation()` across a sequence of loads on ONE loader
 * instance, plus a positive control: without it, every "warns" assertion below could pass
 * equally well against a loader that warns on everything.
 */

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

import { ConfigLoader } from '../../../../src/infra/config/index.js';

// Resolve the actual server root for test context (Jest's import.meta.url differs from dist/) —
// same pattern as tests/unit/runtime/application-startup.test.ts, one directory deeper.
const __filename = fileURLToPath(import.meta.url);
const SERVER_ROOT = path.resolve(path.dirname(__filename), '..', '..', '..', '..');
const SCHEMA_PATH = path.join(SERVER_ROOT, 'config.schema.json');
const SHIPPED_CONFIG_PATH = path.join(SERVER_ROOT, 'config.json');

type JsonObject = Record<string, unknown>;

async function readShippedConfig(): Promise<JsonObject> {
  return JSON.parse(await readFile(SHIPPED_CONFIG_PATH, 'utf8')) as JsonObject;
}

/** Deep-clones `config` and applies one mutation, so each step starts from a known-clean base. */
function mutate(config: JsonObject, apply: (_clone: any) => void): JsonObject {
  const clone = JSON.parse(JSON.stringify(config)) as JsonObject;
  apply(clone);
  return clone;
}

describe('config schema validation warnings', () => {
  let warnSpy: jest.SpiedFunction<typeof console.warn>;
  let errorSpy: jest.SpiedFunction<typeof console.error>;
  let tempDir: string;
  let configPath: string;

  beforeEach(async () => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    tempDir = await mkdtemp(path.join(tmpdir(), 'cfg-schema-warning-'));
    configPath = path.join(tempDir, 'config.json');
  });

  afterEach(async () => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    await rm(tempDir, { recursive: true, force: true });
  });

  /**
   * Only the `[CONFIG] ... schema ...` lines — isolates the schema warning from any other. Also
   * requires the module logger's `[WARN] ` prefix on the first argument: a route that fell back
   * to a bare `console.warn(message)` produces a line with no prefix, so this filter would drop
   * it and every length assertion below would see zero instead of the expected count.
   */
  const schemaWarnings = (): string[] =>
    warnSpy.mock.calls
      .map((call) => String(call[0]))
      .filter(
        (line) =>
          line.startsWith('[WARN] ') &&
          line.includes('[CONFIG]') &&
          (line.includes('does not match its schema') ||
            line.includes('Could not read the config schema'))
      );

  // POSITIVE CONTROL — without this, every "warns" assertion below could pass equally well
  // against a loader that warns on everything: it proves a clean load produces zero warnings.
  it('POSITIVE CONTROL — the shipped config.json validates clean with zero warnings', async () => {
    const manager = new ConfigLoader(SHIPPED_CONFIG_PATH, undefined, { schemaPath: SCHEMA_PATH });

    await manager.loadConfig();

    expect(schemaWarnings()).toHaveLength(0);
    expect(manager.getSchemaValidation()).toMatchObject({ status: 'valid', valid: true });
  });

  // One ConfigLoader instance, driven through the full measured sequence: typo, unchanged
  // reload, a second typo, a fix, the typo reintroduced, broken JSON, then two schemaPath-less
  // manager variants. Each step rewrites the same temp config.json before reloading.
  it('pins the measured warning sequence across successive loads of one instance', async () => {
    const shipped = await readShippedConfig();
    const manager = new ConfigLoader(configPath, undefined, { schemaPath: SCHEMA_PATH });

    // Step 1: typo (gates.enabld) — 1 warning naming /gates and enabld; status 'invalid'.
    const withTypo = mutate(shipped, (c) => {
      c.gates.enabld = true;
    });
    await writeFile(configPath, JSON.stringify(withTypo), 'utf8');
    await manager.loadConfig();

    let warnings = schemaWarnings();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('/gates');
    expect(warnings[0]).toContain('enabld');
    expect(manager.getSchemaValidation()).toMatchObject({ status: 'invalid', valid: false });

    // Step 2: same file reloaded — 0 warnings (signature unchanged); still 'invalid'.
    warnSpy.mockClear();
    await manager.loadConfig();

    expect(schemaWarnings()).toHaveLength(0);
    expect(manager.getSchemaValidation()).toMatchObject({ status: 'invalid', valid: false });

    // Step 3: a second typo added, reloaded — 2 warnings (the whole new set); still 'invalid'.
    warnSpy.mockClear();
    const withTwoTypos = mutate(withTypo, (c) => {
      c.resources.logs.maxEntrys = 5;
    });
    await writeFile(configPath, JSON.stringify(withTwoTypos), 'utf8');
    await manager.loadConfig();

    warnings = schemaWarnings();
    expect(warnings).toHaveLength(2);
    expect(warnings.some((line) => line.includes('/gates') && line.includes('enabld'))).toBe(true);
    expect(
      warnings.some((line) => line.includes('/resources/logs') && line.includes('maxEntrys'))
    ).toBe(true);
    expect(manager.getSchemaValidation()).toMatchObject({ status: 'invalid', valid: false });

    // Step 4: fixed (clean) — back to the shipped config verbatim; 0 warnings, status 'valid'.
    warnSpy.mockClear();
    await writeFile(configPath, JSON.stringify(shipped), 'utf8');
    await manager.loadConfig();

    expect(schemaWarnings()).toHaveLength(0);
    expect(manager.getSchemaValidation()).toMatchObject({ status: 'valid', valid: true });

    // Step 5: typo reintroduced — the valid load cleared the suppression memory, so this warns
    // again: 1 warning, status 'invalid'.
    warnSpy.mockClear();
    await writeFile(configPath, JSON.stringify(withTypo), 'utf8');
    await manager.loadConfig();

    warnings = schemaWarnings();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('/gates');
    expect(manager.getSchemaValidation()).toMatchObject({ status: 'invalid', valid: false });

    // Step 6: broken JSON — the load fails before the schema is ever consulted: 0 schema
    // warnings, and getSchemaValidation() reports undefined (whatever the last check said
    // describes a file this load did not serve). The fallback pins its own line on
    // console.error (not console.info — stdout is the STDIO protocol channel).
    warnSpy.mockClear();
    await writeFile(configPath, '{ not valid json', 'utf8');
    await manager.loadConfig();

    expect(schemaWarnings()).toHaveLength(0);
    expect(manager.getSchemaValidation()).toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
    expect(errorSpy.mock.calls.some((call) => call[0] === 'Using default configuration')).toBe(
      true
    );

    // Step 7: no schemaPath injected — a fresh manager over the same (now-broken) file path
    // reset to a clean config, with no schema option: 0 warnings, undefined validation.
    warnSpy.mockClear();
    await writeFile(configPath, JSON.stringify(shipped), 'utf8');
    const unwiredManager = new ConfigLoader(configPath);
    await unwiredManager.loadConfig();

    expect(schemaWarnings()).toHaveLength(0);
    expect(unwiredManager.getSchemaValidation()).toBeUndefined();

    // Step 8: schemaPath pointing at a missing file — 1 unavailable warning (not a "does not
    // match" line); status 'unavailable'.
    warnSpy.mockClear();
    const missingSchemaPath = path.join(tempDir, 'does-not-exist.schema.json');
    const unavailableManager = new ConfigLoader(configPath, undefined, {
      schemaPath: missingSchemaPath,
    });
    await unavailableManager.loadConfig();

    warnings = schemaWarnings();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Could not read the config schema');
    expect(warnings[0]).not.toContain('does not match its schema');
    expect(unavailableManager.getSchemaValidation()).toMatchObject({
      status: 'unavailable',
      valid: false,
    });

    // Step 9: missing schema, reloaded — same manager, unchanged file: 0 warnings (signature
    // unchanged); still 'unavailable'.
    warnSpy.mockClear();
    await unavailableManager.loadConfig();

    expect(schemaWarnings()).toHaveLength(0);
    expect(unavailableManager.getSchemaValidation()).toMatchObject({
      status: 'unavailable',
      valid: false,
    });
  });
});
