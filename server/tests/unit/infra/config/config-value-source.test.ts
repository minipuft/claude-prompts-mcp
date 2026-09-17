/**
 * Config value source labeling — three states, and one pinned list of absences.
 *
 * `getConfigValueWithSource(key)` reports where an effective config value came from: `'file'`,
 * `'default'`, or `'environment'`. There is no fourth label: since row 6.2 / Ruling R57
 * `normalizeConfigFile` resolves EVERY section at load time, so a key the file omits answers with
 * the value the server actually uses. The `'deferred'` label this file used to enumerate named the
 * state where a section stayed absent from `Config` until its owning getter defaulted it at read
 * time — that state no longer exists.
 *
 * What replaces it is stricter. A `'default'` answer may still carry `value: undefined`, but only
 * for a key with no default in ANY layer, and the whole set is pinned as a literal below: a NEW
 * undefined answer is a red test naming the key, not a label that quietly absorbs it.
 *
 * This enumerates every key `listConfigKeys()` reports (schema-driven, not a hand-written list —
 * the point is to close the CLASS, not one instance of it) against a loader fed a config file that
 * sets almost nothing.
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

/**
 * Every schema-declared key whose effective value is `undefined` under the fixture below, MEASURED
 * against the loader rather than predicted from the schema. Sorted, compared as a set, exact.
 *
 * Three kinds of entry live here, and the difference is the point:
 *
 * 1. **No default in any layer.** `config.schema.json` carries no `@default` for them either, so
 *    absent IS the effective value: the six `identity.launchDefaults.*` leaves,
 *    `gates.evaluation.defaultModel`, `telemetry.attributePolicy.allowlist`.
 * 2. **`gates.evaluation.strict`** — the one key row 6.2 deliberately declined to resolve. Its
 *    only code default (`judge-prompt-builder.ts`) is `mode === 'judge'`, a function of the
 *    resolved mode rather than a constant, and folding the schema's `true` in would change what a
 *    `mode: 'self'` gate does. Named on `GatesConfig.evaluation`.
 * 3. **`hooks.expandedOutput`** — a file key `Config` has no member for at all (the Python hooks
 *    read it straight off the file). It is the one entry left of the row 6.2 findings: the other
 *    three were RENAMES (the file said `versioning.maxVersions` / `versioning.autoVersion` /
 *    `chainSessions.timeoutMinutes`, the runtime held `max_versions` / `auto_version` /
 *    `sessionTimeoutMinutes`, and the dot-walk over `Config` missed a value the server very much
 *    used — 50, true, 1440). Ruling R40 declined a file-name → runtime-name map for those; row 6.6
 *    renamed the runtime type to match the file instead, so all three now resolve and are gone
 *    from this list — see `answers versioning and chainSessions with their resolved values` below.
 *
 * Shrinking this list is progress; it still has to be done deliberately, which is why the
 * comparison is equality and not containment.
 */
const KEYS_WITH_NO_EFFECTIVE_VALUE = [
  'gates.evaluation.defaultModel',
  'gates.evaluation.strict',
  'hooks.expandedOutput',
  'identity.launchDefaults.clientFamily',
  'identity.launchDefaults.clientId',
  'identity.launchDefaults.clientVersion',
  'identity.launchDefaults.delegationProfile',
  'identity.launchDefaults.organizationId',
  'identity.launchDefaults.workspaceId',
  'telemetry.attributePolicy.allowlist',
];

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
    await writeFile(configPath, JSON.stringify({ version: 5, gates: { enabled: true } }), 'utf8');
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

  // THE gate for the class: every schema-declared key answers with one of the three real labels,
  // and the keys that answer with no value at all are EXACTLY the pinned set. Iterates the
  // schema's own enumeration rather than a hand-picked key list, so a section that stops resolving
  // a leaf at load time trips this automatically, naming the leaf.
  it('answers every schema-declared key with a real source, and leaves exactly the pinned keys unset', async () => {
    const keys = await manager.listConfigKeys();
    // Sanity: the schema declares dozens of leaf keys — a near-empty result would mean
    // `listConfigKeys()` itself broke, not that the config has few keys.
    expect(keys.length).toBeGreaterThan(50);

    const bySource: Record<string, number> = { file: 0, default: 0, environment: 0 };
    const unset: string[] = [];

    for (const key of keys) {
      const result = manager.getConfigValueWithSource(key);
      expect(['file', 'default', 'environment']).toContain(result.source);
      bySource[result.source] = (bySource[result.source] ?? 0) + 1;
      if (result.value === undefined) unset.push(key);
    }

    // The claim the row exists to make: an absent value is now a property of the KEY, enumerated
    // above, not a state a whole section can drift into.
    expect(unset.sort()).toEqual([...KEYS_WITH_NO_EFFECTIVE_VALUE].sort());

    // Every bucket should be non-empty for this fixture — a zero here would mean the fixture
    // stopped exercising one of the three paths, silently narrowing what this test covers.
    expect(bySource['file']).toBeGreaterThan(0);
    expect(bySource['default']).toBeGreaterThan(0);
    expect(bySource['environment']).toBe(2); // server.port, logging.level — the only two overrides
    expect(bySource['file'] + bySource['default'] + bySource['environment']).toBe(keys.length);
  });

  it('reports the one key the file explicitly set as "file"', () => {
    expect(manager.getConfigValueWithSource('gates.enabled')).toMatchObject({
      value: true,
      source: 'file',
    });
  });

  // The three cases that used to answer 'deferred'. Each now answers with the value the server
  // actually uses — asserted on the VALUE, not just the label, because a label nobody can check
  // against a value is what the row retired.
  it('reports a key in a section the file never mentions as "default", carrying the resolved value', () => {
    expect(manager.getConfigValueWithSource('resources.registerWithMcp')).toMatchObject({
      value: false,
      source: 'default',
    });
    expect(manager.getConfigValueWithSource('gates.frameworkGates')).toMatchObject({
      value: true,
      source: 'default',
    });
    expect(manager.getConfigValueWithSource('logging.directory')).toMatchObject({
      value: './logs',
      source: 'default',
    });
    expect(manager.getConfigValueWithSource('phaseGuards.maxRetries')).toMatchObject({
      value: 2,
      source: 'default',
    });
    expect(manager.getConfigValueWithSource('verification.isolation.permissionMode')).toMatchObject(
      { value: 'delegate', source: 'default' }
    );
    expect(manager.getConfigValueWithSource('identity.mode')).toMatchObject({
      value: 'permissive',
      source: 'default',
    });
    // F-T4-15: the effective default used to live in `modules/prompts/converter.ts`, three layers
    // below anything the config surface could see.
    expect(manager.getConfigValueWithSource('prompts.registerWithMcp')).toMatchObject({
      value: true,
      source: 'default',
    });
  });

  // Row 6.6: the runtime `Config` used to spell these three fields differently from the schema
  // path the dot-walk reads (`max_versions`/`auto_version`/`sessionTimeoutMinutes` at runtime vs
  // `maxVersions`/`autoVersion`/`timeoutMinutes` on the schema path), so `readDotPath` found
  // nothing and each answered `undefined` — the three entries `KEYS_WITH_NO_EFFECTIVE_VALUE` no
  // longer carries. Renaming the runtime type to match closes the gap: each now answers the
  // resolved default value the server actually uses.
  it('answers versioning and chainSessions with their resolved values, not as no-value keys', () => {
    expect(manager.getConfigValueWithSource('versioning.maxVersions')).toMatchObject({
      value: 50,
      source: 'default',
    });
    expect(manager.getConfigValueWithSource('versioning.autoVersion')).toMatchObject({
      value: true,
      source: 'default',
    });
    expect(manager.getConfigValueWithSource('chainSessions.timeoutMinutes')).toMatchObject({
      value: 1440,
      source: 'default',
    });
  });

  it('still reports a key whose section IS written back at load time as "default"', () => {
    // `server` is fully merged with `DEFAULT_SERVER_CONFIG` inside `normalizeConfigFile`, so
    // this resolves to a real value even though the file never set it.
    expect(manager.getConfigValueWithSource('server.name')).toMatchObject({
      value: 'claude-prompts',
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

  // The snapshot `getConfigValueWithSource` labels from is taken AFTER the 4.x translation, so a
  // key the operator wrote in a 4.x spelling is reported under its 5.0 name. Before that order was
  // fixed, the raw snapshot held the 4.x spelling and the merged config held the 5.0 one, and
  // neither name answered with both a value and a 'file' label.
  describe('a 4.x file is labelled under its 5.0 key names', () => {
    it('reports a translated flat key as "file" under the nested 5.0 name', async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      const fourXPath = path.join(tempDir, 'four-x.json');
      await writeFile(
        fourXPath,
        JSON.stringify({ frameworks: { enabled: true, systemPromptFrequency: 7 } }),
        'utf8'
      );

      const fourXManager = new ConfigLoader(fourXPath, undefined, { schemaPath: SCHEMA_PATH });
      await fourXManager.loadConfig();

      expect(
        fourXManager.getConfigValueWithSource('frameworks.injection.systemPrompt.frequency')
      ).toMatchObject({ value: 7, source: 'file' });
      // The 4.x spelling is not a config key at all any more — it is not in the schema, so it is
      // not enumerable, and asking for it answers with no value rather than inventing one. (The
      // handler refuses an undeclared key before it ever gets here; this is the loader's own
      // answer for a path nothing declares.)
      expect(
        fourXManager.getConfigValueWithSource('frameworks.systemPromptFrequency')
      ).toMatchObject({ value: undefined, source: 'default' });

      warn.mockRestore();
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
