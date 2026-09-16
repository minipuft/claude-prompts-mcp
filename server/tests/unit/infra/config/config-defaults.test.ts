/**
 * One default set in code, aligned to the shipped config values (plan row 4.6).
 *
 * The shipped `server/config.json` states nearly every section explicitly. This proves that every
 * value it states equals what the code already defaults to when the file says nothing — i.e. the
 * shipped file is a restatement of the defaults, not an override. Row 4.6 aligned three literals
 * that had drifted from the shipped file (`server.name`, `server.port`,
 * `frameworks.injection.systemPrompt.frequency`, plus the dead `gates.definitionsDirectory`
 * default that only the schema and this loader's own default ever compared against each other);
 * this pins the result so a future drift goes red here first.
 *
 * Compared through the `ConfigManager` READER surface, not through raw `getConfig()`: several
 * sections (`gates`, `resources`, `logging`) are deliberately carried across RAW at load time and
 * defaulted only by their OWNING getter (`getGatesConfig()`, etc — see the `'deferred'` vs
 * `'default'` distinction documented on `ConfigValueSource` in `config-manager.ts`). A raw
 * `getConfig()` comparison would show a populated object (shipped file sets the section) against
 * `undefined` (an empty file never sets it) for those sections regardless of whether the leaf
 * VALUES agree — that is a structural fact of the loader, not a claim about defaults. The getter
 * surface is what a real consumer reads, so it is the level at which "the shipped file holds no
 * override" is actually testable.
 *
 * Deliberately excluded, and why:
 * - `prompts.registerWithMcp` (`getPromptsRegisterWithMcp()`): has no default at the
 *   `ConfigManager` layer at all — it returns `undefined` absent a file value. The effective
 *   default (`true`) is a hard-coded fallback three layers down, in
 *   `modules/prompts/converter.ts` (`resolveRegisterWithMcp`, step 4), invisible to this loader.
 *   Shipped `true` therefore does not equal empty-file `undefined` at THIS layer even though
 *   runtime behaviour is identical; folding it into a `ConfigManager`-level default would flip its
 *   `getConfigValueWithSource` label from `'deferred'` to `'default'`, a bigger change than this
 *   row makes.
 * - `phaseGuards`, `verification`, `identity`: no `ConfigManager` getter exists for any of the
 *   three — consumers read `Config` directly and carry their own literal default (e.g.
 *   `pipeline-builder.ts`'s own `?? 'enforce'`), so there is no getter-level claim to make here.
 * - `getPort()` / `getLoggingConfig()`'s env-override branches (`PORT`, `LOG_LEVEL`): both getters
 *   are exercised through `getServerConfig().port` and the logging snapshot below instead, with
 *   `LOG_LEVEL` cleared for the duration, so an ambient env var in the runner cannot make this
 *   flaky. `config-value-source.test.ts` owns the override behaviour itself.
 */

import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

import { ConfigLoader } from '../../../../src/infra/config/index.js';

// Same resolution pattern as legacy-key-migration.test.ts / config-schema-warning.test.ts — the
// shipped config ships beside the server root, one directory shallower than this test file.
const __filename = fileURLToPath(import.meta.url);
const SERVER_ROOT = path.resolve(path.dirname(__filename), '..', '..', '..', '..');
const SHIPPED_CONFIG_PATH = path.join(SERVER_ROOT, 'config.json');

/** Writes `raw` as a temp config file and returns a loaded manager for it. */
async function loadFrom(raw: Record<string, unknown>) {
  const dir = await mkdtemp(path.join(tmpdir(), 'cfg-defaults-'));
  const configPath = path.join(dir, 'config.json');
  await writeFile(configPath, JSON.stringify(raw), 'utf8');
  const manager = new ConfigLoader(configPath);
  await manager.loadConfig();
  return { manager, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

/** A loaded manager for the shipped `server/config.json`, read directly — never written. */
async function loadShipped() {
  const manager = new ConfigLoader(SHIPPED_CONFIG_PATH);
  await manager.loadConfig();
  return manager;
}

/**
 * The resolved shape every real consumer reads, assembled from `ConfigManager`'s domain getters.
 * See the file header for what is excluded and why.
 */
function snapshot(manager: ConfigLoader) {
  return {
    server: manager.getServerConfig(),
    promptsDirectory: manager.getPromptsConfig()?.directory,
    transport: manager.getTransportMode(),
    logging: manager.getLoggingConfig(),
    frameworks: manager.getFrameworksConfig(),
    gates: manager.getGatesConfig(),
    chainSessions: manager.getChainSessionConfig(),
    execution: manager.getExecutionConfig(),
    judgeEnabled: manager.isJudgeEnabled(),
    versioning: manager.getVersioningConfig(),
    resources: manager.getResourcesConfig(),
    telemetry: manager.getTelemetryConfig(),
    injection: manager.getInjectionConfig(),
  };
}

describe('config defaults, aligned to the shipped config.json (row 4.6)', () => {
  const originalLogLevel = process.env['LOG_LEVEL'];

  beforeEach(() => {
    delete process.env['LOG_LEVEL'];
  });

  afterEach(() => {
    if (originalLogLevel === undefined) delete process.env['LOG_LEVEL'];
    else process.env['LOG_LEVEL'] = originalLogLevel;
  });

  it('resolves the shipped config.json to the same effective config as a file declaring only {"version": 5} — the shipped file holds no override', async () => {
    const shippedManager = await loadShipped();
    const { manager: emptyManager, cleanup } = await loadFrom({ version: 5 });

    try {
      expect(snapshot(shippedManager)).toEqual(snapshot(emptyManager));
    } finally {
      await cleanup();
    }
  });

  it('positive control: a file that DOES override a value is not deep-equal, differing exactly at that key', async () => {
    const { manager: baselineManager, cleanup: cleanupBaseline } = await loadFrom({ version: 5 });
    const { manager: overrideManager, cleanup: cleanupOverride } = await loadFrom({
      version: 5,
      server: { port: 9091 },
    });

    try {
      const baseline = snapshot(baselineManager);
      const override = snapshot(overrideManager);

      expect(override).not.toEqual(baseline);

      // The only field summed into `server` — the exact-key claim, not just "different somewhere".
      expect(override.server).toEqual({ ...baseline.server, port: 9091 });
      const { server: _baselineServer, ...baselineRest } = baseline;
      const { server: _overrideServer, ...overrideRest } = override;
      expect(overrideRest).toEqual(baselineRest);
    } finally {
      await cleanupBaseline();
      await cleanupOverride();
    }
  });
});
