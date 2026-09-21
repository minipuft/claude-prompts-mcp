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
 * Compared at BOTH levels, which row 6.2 is what made possible. The raw `getConfig()` comparison
 * is the whole claim in one assertion: since every section resolves at load time, the shipped file
 * and an empty one produce deep-equal runtime configs, sections included. It used to be untestable
 * — `gates`, `resources`, `logging`, `phaseGuards`, `verification` and `identity` were carried
 * across raw, so the two sides differed structurally (a populated object against `undefined`)
 * regardless of whether the leaf VALUES agreed, and `prompts.registerWithMcp` had no
 * `ConfigManager`-layer default at all because its effective `true` lived three layers down in
 * `modules/prompts/converter.ts`. The getter-surface comparison is kept beside it: it is what a
 * real consumer reads, and it also covers the two getters that are not a projection of `Config`
 * (`getGatesConfig()`'s rename, `getInjectionConfig()`'s shape translation).
 *
 * Still not compared: `getPort()` / `getLoggingConfig()`'s env-override branches (`PORT`,
 * `LOG_LEVEL`). Both getters are exercised through `getServerConfig().port` and the logging
 * snapshot below instead, with `LOG_LEVEL` cleared for the duration, so an ambient env var in the
 * runner cannot make this flaky. `config-value-source.test.ts` owns the override behaviour itself.
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
    promptsDirectory: manager.getPromptsConfig().directory,
    promptsRegisterWithMcp: manager.getPromptsRegisterWithMcp(),
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
      // Raw `Config`, section for section — the comparison row 6.2 made possible.
      expect(shippedManager.getConfig()).toEqual(emptyManager.getConfig());
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
      expect(overrideManager.getConfig()).not.toEqual(baselineManager.getConfig());

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
