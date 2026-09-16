/**
 * Config value source labeling — the fourth state.
 *
 * `getConfigValueWithSource(key)` reports where an effective config value came from: `'file'`,
 * `'default'`, `'environment'`, or `'deferred'`. `normalizeConfigFile` resolves a real value for
 * only a handful of sections (`server`, `prompts`, `analysis`, `frameworks`, `chainSessions`,
 * `execution`, `versioning`, `telemetry`) — every OTHER schema-declared
 * key (`gates`, `resources`, `logging`, `identity`, `verification`, `phaseGuards`, `hooks`, plus a
 * few genuinely default-less leaves inside the sections that ARE written back, e.g.
 * `prompts.registerWithMcp` and `telemetry.attributePolicy.allowlist`) stays `undefined` in the
 * loaded config until its OWNING getter defaults it at read time (`gates.enabled` inside
 * `getGatesConfig()`, for instance). Before this row, that state answered
 * `{ value: undefined, source: 'default' }` — indistinguishable from a default that legitimately
 * IS `undefined`.
 *
 * This enumerates every key `listConfigKeys()` reports (schema-driven, not a hand-written list —
 * the point is to close the CLASS, not one instance of it) against a loader fed a config file that
 * sets almost nothing, and asserts none of them lands on that ambiguous
 * `{ value: undefined, source: 'default' }` shape.
 *
 * Same temp-file + injected-schema-path construction as the `ConfigLoader` siblings in this
 * directory (`config-schema-warning.test.ts`, `legacy-key-migration.test.ts`).
 */

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { copyFile, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

import { ConfigLoader } from '../../../../src/infra/config/index.js';

// Same resolution pattern as the other tests in this directory — the schema ships beside the
// server root, one directory shallower than this file.
const __filename = fileURLToPath(import.meta.url);
const SERVER_ROOT = path.resolve(path.dirname(__filename), '..', '..', '..', '..');
const SCHEMA_PATH = path.join(SERVER_ROOT, 'config.schema.json');

describe('config value source labeling (getConfigValueWithSource / listConfigKeys)', () => {
  let tempDir: string;
  let configPath: string;
  let manager: ConfigLoader;
  const originalPort = process.env['PORT'];
  const originalLogLevel = process.env['LOG_LEVEL'];

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'cfg-value-source-'));
    configPath = path.join(tempDir, 'config.json');
    // "Almost nothing": one explicit key (exercises 'file'), everything else left to the loader
    // — this is the shape the row's background names as the worked example (gates.enabled).
    await writeFile(configPath, JSON.stringify({ gates: { enabled: true } }), 'utf8');
    process.env['PORT'] = '4321'; // exercises 'environment' for server.port
    process.env['LOG_LEVEL'] = 'DEBUG'; // exercises 'environment' for logging.level
    manager = new ConfigLoader(configPath, undefined, { schemaPath: SCHEMA_PATH });
    await manager.loadConfig();
  });

  afterEach(async () => {
    if (originalPort === undefined) delete process.env['PORT'];
    else process.env['PORT'] = originalPort;
    if (originalLogLevel === undefined) delete process.env['LOG_LEVEL'];
    else process.env['LOG_LEVEL'] = originalLogLevel;
    await rm(tempDir, { recursive: true, force: true });
  });

  // THE gate for the class: every schema-declared key answers with either a defined value, or the
  // 'deferred' label — never a bare `undefined` under 'default'. Iterates the schema's own
  // enumeration rather than a hand-picked key list, so a future section that starts defaulting
  // only inside its getter (instead of inside `validateAndSetDefaults`) trips this automatically.
  it('never reports an undefined value under source "default", for any schema-declared key', async () => {
    const keys = await manager.listConfigKeys();
    // Sanity: the schema declares dozens of leaf keys — a near-empty result would mean
    // `listConfigKeys()` itself broke, not that the config has few keys.
    expect(keys.length).toBeGreaterThan(50);

    const bySource: Record<string, number> = { file: 0, default: 0, environment: 0, deferred: 0 };

    for (const key of keys) {
      const result = manager.getConfigValueWithSource(key);
      bySource[result.source] = (bySource[result.source] ?? 0) + 1;

      if (result.source === 'default') {
        // The one assertion this whole test exists to make: a defaulted value must be a REAL
        // value, never the ambiguous "defaulted to undefined".
        expect(result.value).not.toBeUndefined();
      }
      if (result.source === 'deferred') {
        // 'deferred' never invents a value — it is a label for the absence of one.
        expect(result.value).toBeUndefined();
      }
    }

    // Every bucket should be non-empty for this fixture — a zero here would mean the fixture
    // stopped exercising one of the four paths, silently narrowing what this test covers.
    expect(bySource['file']).toBeGreaterThan(0);
    expect(bySource['default']).toBeGreaterThan(0);
    expect(bySource['environment']).toBe(2); // server.port, logging.level — the only two overrides
    expect(bySource['deferred']).toBeGreaterThan(0);
    expect(
      bySource['file'] + bySource['default'] + bySource['environment'] + bySource['deferred']
    ).toBe(keys.length);
  });

  it('reports the one key the file explicitly set as "file"', () => {
    expect(manager.getConfigValueWithSource('gates.enabled')).toMatchObject({
      value: true,
      source: 'file',
    });
  });

  it('reports a key whose section this loader never writes back as "deferred", not "default"', () => {
    // `resources` is never touched by `validateAndSetDefaults` — only `getResourcesConfig()`
    // defaults it, at read time. This is the shape a bare `undefined`/'default' used to hide.
    expect(manager.getConfigValueWithSource('resources.registerWithMcp')).toMatchObject({
      value: undefined,
      source: 'deferred',
    });
  });

  it('still reports a key whose section IS written back at load time as "default"', () => {
    // `server` is fully merged with `DEFAULT_CONFIG.server` inside `validateAndSetDefaults`, so
    // this resolves to a real value even though the file never set it.
    expect(manager.getConfigValueWithSource('server.name')).toMatchObject({
      value: 'Claude Custom Prompts',
      source: 'default',
    });
  });

  it('reports the env-overridden keys as "environment", ahead of the deferred/default split', () => {
    expect(manager.getConfigValueWithSource('server.port')).toMatchObject({
      value: 4321,
      source: 'environment',
    });
    expect(manager.getConfigValueWithSource('logging.level')).toMatchObject({
      value: 'debug',
      source: 'environment',
    });
  });

  // The cache-sharing gate (row 2.12): `listConfigKeys()` used to re-read and re-parse
  // config.schema.json on every call. It now goes through `getParsedConfigSchema`
  // (config-schema-validator.ts), the same mtime-keyed cache entry the compiled AJV validator is
  // drawn from — this proves that by counting actual `readFile` calls, not by trusting that "it
  // calls the new function" implies "it shares the cache".
  //
  // A plain `jest.spyOn`/`jest.mock('node:fs/promises', ...)` cannot observe this: under Jest's
  // native-ESM mode (`--experimental-vm-modules`), a statically-imported module's bindings are
  // real ES module bindings, already linked before any in-file `jest.mock()` call runs — measured
  // here (spyOn threw "Cannot assign to read only property 'readFile'"; a hoisted `jest.mock`
  // left the real function in place, uninstrumented). `jest.unstable_mockModule` plus a dynamic
  // `import()` performed AFTER registering it is the mechanism that actually intercepts a
  // built-in: the dynamic import re-links `index.ts` (and, transitively,
  // `config-schema-validator.ts`) against the mocked module instead of the real one.
  describe('schema cache sharing (config-schema-validator.ts owns one read/parse per schemaPath)', () => {
    afterEach(() => {
      // Isolated per test: a fresh module graph next time, so this never leaks into the
      // statically-imported `ConfigLoader` the rest of this file uses.
      jest.resetModules();
    });

    it('reads and parses config.schema.json once across two listConfigKeys() calls on the same schema path', async () => {
      const actualFsPromises = jest.requireActual(
        'node:fs/promises'
      ) as typeof import('node:fs/promises');
      // A spy that still calls through to the real implementation — reads stay real, only the
      // call count is being observed.
      const readFileMock = jest.fn(actualFsPromises.readFile);

      jest.resetModules();
      jest.unstable_mockModule('node:fs/promises', () => ({
        ...actualFsPromises,
        readFile: readFileMock,
      }));

      // A fresh, mock-linked copy of the module under test — NOT the `ConfigLoader` statically
      // imported at the top of this file, which is already bound to the real `node:fs/promises`
      // and would not see this mock.
      const { ConfigLoader: IsolatedConfigLoader } =
        await import('../../../../src/infra/config/index.js');

      const isolatedSchemaPath = path.join(tempDir, 'isolated.config.schema.json');
      await copyFile(SCHEMA_PATH, isolatedSchemaPath);
      const isolatedManager = new IsolatedConfigLoader(configPath, undefined, {
        schemaPath: isolatedSchemaPath,
      });

      await isolatedManager.listConfigKeys();
      await isolatedManager.listConfigKeys();

      const schemaReadCallCount = readFileMock.mock.calls.filter(
        (call) => call[0] === isolatedSchemaPath
      ).length;

      // THE assertion this test exists to make: two calls, ONE underlying file read. A
      // `listConfigKeys()` that bypasses the shared cache (re-reading + re-parsing on every
      // call — the pre-row behavior) reads twice and fails this at 2.
      expect(schemaReadCallCount).toBe(1);
    });
  });
});
