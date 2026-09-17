/**
 * ConfigFile -> Config normalization.
 *
 * `loadConfig` used to do `JSON.parse(content) as Config` — an unchecked cast of the FILE shape
 * onto the RESOLVED runtime shape, which is how the two drifted: a key the file spelled one way
 * and the runtime read another produced no error anywhere, only a setting that silently did
 * nothing. The cast is now one typed mapping (`normalizeConfigFile`), and these pin what that
 * mapping does — the compiler pins the rest.
 *
 * Fixtures are authored here rather than read from the shipped `server/config.json`: this asserts
 * the mapping, not the values one installation happens to ship, and the shipped file is being
 * reshaped by a sibling row of the same initiative.
 *
 * No `schemaPath` is injected, for the same reason — the schema check reports and serves, it does
 * not gate, so it changes nothing these cases measure. `config-schema-warning.test.ts` owns it.
 */

import { describe, expect, it, jest } from '@jest/globals';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

import { ConfigLoader } from '../../../../src/infra/config/index.js';

/** Writes `raw` as the config file and returns the resolved `Config` it loads to. */
async function resolve(raw: Record<string, unknown>) {
  const dir = await mkdtemp(path.join(tmpdir(), 'cfg-normalize-'));
  const configPath = path.join(dir, 'config.json');
  await writeFile(configPath, JSON.stringify(raw), 'utf8');
  const manager = new ConfigLoader(configPath);
  const config = await manager.loadConfig();
  return { config, manager, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

/** The injection block a 5.0 file carries, nested — one non-default value per leaf. */
const NESTED_INJECTION = {
  systemPrompt: { enabled: false, frequency: 5, target: 'both' },
  gateGuidance: { frequency: 4, target: 'steps' },
  styleGuidance: { enabled: false, frequency: 6, target: 'gates' },
};

describe('config file -> runtime config mapping', () => {
  describe('frameworks.injection is read nested', () => {
    it('carries a nested injection block through to Config.frameworks.injection', async () => {
      const { config, cleanup } = await resolve({
        version: 5,
        frameworks: { enabled: true, injection: NESTED_INJECTION },
      });

      expect(config.frameworks?.injection).toEqual(NESTED_INJECTION);

      await cleanup();
    });

    // POSITIVE CONTROL for the case above: it is only evidence that the file is READ if a
    // different value in the same leaf produces that different value. A pass-through that
    // returned the defaults would satisfy the first case whenever the fixture matched them.
    it('resolves a nested frequency of 9 to 9', async () => {
      const { config, manager, cleanup } = await resolve({
        version: 5,
        frameworks: { injection: { systemPrompt: { frequency: 9 } } },
      });

      expect(config.frameworks?.injection?.systemPrompt?.frequency).toBe(9);
      // The getter reads the same block, so the value reaches every injection consumer.
      expect(manager.getFrameworksConfig().injection?.systemPrompt?.frequency).toBe(9);

      await cleanup();
    });

    it('defaults every injection leaf the file does not set', async () => {
      const { config, cleanup } = await resolve({ version: 5, frameworks: { enabled: true } });

      expect(config.frameworks?.injection).toEqual({
        systemPrompt: { enabled: true, frequency: 3, target: 'steps' },
        gateGuidance: { frequency: 0, target: 'both' },
        styleGuidance: { enabled: true, frequency: 0, target: 'steps' },
      });

      await cleanup();
    });

    // The flip this case's previous stamp named: a version-less file IS a 4.x file, so the flat
    // spelling resolves to 7 again — through `translateConfigFile`, not through this mapping,
    // which never sees the flat key.
    it('resolves the flat `systemPromptFrequency` of a version-less 4.x file to 7', async () => {
      const { config, manager, cleanup } = await resolve({
        frameworks: { enabled: true, systemPromptFrequency: 7 },
      });

      expect(config.frameworks?.injection?.systemPrompt?.frequency).toBe(7);
      expect(manager.getFrameworksConfig().injection?.systemPrompt?.frequency).toBe(7);

      await cleanup();
    });

    // The twin that makes the case above evidence about the VERSION key rather than about the
    // flat spelling: the identical `frameworks` block under `version: 5` is not translated, so
    // the flat key reaches no reader and the default stands.
    it('ignores the same flat key in a `version: 5` file, resolving to the default', async () => {
      const { config, manager, cleanup } = await resolve({
        version: 5,
        frameworks: { enabled: true, systemPromptFrequency: 7 },
      });

      expect(config.frameworks?.injection?.systemPrompt?.frequency).toBe(3);
      expect(manager.getFrameworksConfig().injection?.systemPrompt?.frequency).toBe(3);

      await cleanup();
    });
  });

  describe('chainSessions is read from the file root', () => {
    it('maps the file spelling onto the runtime one', async () => {
      const { config, manager, cleanup } = await resolve({
        version: 5,
        chainSessions: { timeoutMinutes: 90, reviewTimeoutMinutes: 11, cleanupIntervalMinutes: 2 },
      });

      // `timeoutMinutes` on the file, `sessionTimeoutMinutes` at runtime: the rename the mapping
      // makes visible and the cast could not.
      expect(config.chainSessions).toEqual({
        sessionTimeoutMinutes: 90,
        reviewTimeoutMinutes: 11,
        cleanupIntervalMinutes: 2,
      });
      expect(manager.getChainSessionConfig()).toEqual(config.chainSessions);

      await cleanup();
    });

    // True of a `version: 5` file specifically, which is why the fixture declares the version: the
    // wrapper named nothing and is gone from the 5.0 file shape, so a file that says it is written
    // in that shape and still carries `advanced` resolves to the default rather than to 90. A
    // version-less file carrying the same key is a 4.x file and IS translated — the sibling case
    // in `config-file-translation.test.ts` pins that half.
    it('no longer reads `advanced.sessions` from a `version: 5` file', async () => {
      const { manager, cleanup } = await resolve({
        version: 5,
        advanced: { sessions: { timeoutMinutes: 90 } },
      });

      expect(manager.getChainSessionConfig().sessionTimeoutMinutes).toBe(1440);

      await cleanup();
    });
  });

  describe('a file that declares nothing', () => {
    // Every default value this loader applies, in one place. Written out rather than compared
    // against the module's own constants: a test that reads the same constant the code reads
    // passes however that constant changes. These values were aligned with the shipped
    // `config.json` by plan row 4.6 (`server.name`, `server.port`,
    // `frameworks.injection.systemPrompt.frequency`) — a future drift between the two goes red
    // here first.
    const DEFAULTS = {
      server: { name: 'claude-prompts', version: '1.0.0', port: 9090 },
      prompts: { directory: 'resources/prompts' },
      // No `analysis`: the section is not a config key any more, so the loader defaults nothing
      // for it and `Config.analysis` stays unset.
      execution: { judge: true },
      frameworks: {
        enabled: true,
        dynamicToolDescriptions: true,
        defaultFramework: 'CAGEERF',
        injection: {
          systemPrompt: { enabled: true, frequency: 3, target: 'steps' },
          gateGuidance: { frequency: 0, target: 'both' },
          styleGuidance: { enabled: true, frequency: 0, target: 'steps' },
        },
      },
      chainSessions: {
        sessionTimeoutMinutes: 1440,
        reviewTimeoutMinutes: 30,
        cleanupIntervalMinutes: 5,
      },
      versioning: { enabled: true, max_versions: 50, auto_version: true },
      telemetry: {
        enabled: false,
        mode: 'off',
        exporterEndpoint: 'http://localhost:4318',
        samplingRate: 1.0,
        attributePolicy: { businessContext: true, rawCommands: false, rawResponses: false },
      },
    };

    it('resolves to the loader defaults, and to nothing else', async () => {
      const { config, cleanup } = await resolve({});

      expect(config).toEqual(DEFAULTS);
      // The sections this loader has never defaulted at load time stay absent, which is what
      // lets `getConfigValueWithSource` report them as 'deferred' rather than inventing a value.
      for (const section of ['gates', 'resources', 'logging', 'identity', 'verification']) {
        expect(config[section as 'gates']).toBeUndefined();
      }

      await cleanup();
    });

    it('resolves a missing config file to the same object', async () => {
      const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const dir = await mkdtemp(path.join(tmpdir(), 'cfg-normalize-missing-'));

      // The fallback path runs the same mapping on an empty file, so "what a missing config
      // resolves to" and "what an empty config resolves to" cannot drift apart.
      const manager = new ConfigLoader(path.join(dir, 'absent.json'));
      const config = await manager.loadConfig();

      expect(config).toEqual(DEFAULTS);
      expect(consoleError).toHaveBeenCalled();

      consoleError.mockRestore();
      await rm(dir, { recursive: true, force: true });
    });
  });

  describe('sections the file owns are carried across, not defaulted', () => {
    it('passes gates, resources and logging through as written', async () => {
      const { config, cleanup } = await resolve({
        version: 5,
        gates: { enabled: false, directory: 'my-gates', harnessCovers: ['security'] },
        resources: { registerWithMcp: true, logs: { maxEntries: 50 } },
        logging: { directory: '/var/log/cpm', level: 'debug' },
      });

      expect(config.gates).toMatchObject({
        enabled: false,
        directory: 'my-gates',
        harnessCovers: ['security'],
      });
      expect(config.resources).toMatchObject({
        registerWithMcp: true,
        logs: { maxEntries: 50 },
      });
      expect(config.logging).toEqual({ directory: '/var/log/cpm', level: 'debug' });

      await cleanup();
    });

    it('drops the retired `analysis` section rather than keeping its values', async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      const { config, manager, cleanup } = await resolve({
        analysis: { semanticAnalysis: { llmIntegration: { enabled: true, model: 'gpt-4o' } } },
      });

      // The deprecation cycle is over: the section is removed by the 4.x translation, announced
      // once, and resolves to nothing at all — not to the section's own defaults, which would be
      // indistinguishable from a config that set them. `Config` no longer declares the field, so
      // this checks for the key's absence at runtime rather than reading a typed member.
      expect('analysis' in config).toBe(false);
      expect('analysis' in manager.getConfig()).toBe(false);

      warn.mockRestore();
      await cleanup();
    });

    it('serves the defaults when the file is not a JSON object', async () => {
      const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const dir = await mkdtemp(path.join(tmpdir(), 'cfg-normalize-array-'));
      const configPath = path.join(dir, 'config.json');
      await writeFile(configPath, '[]', 'utf8');

      const manager = new ConfigLoader(configPath);
      const config = await manager.loadConfig();

      // Rejected at the parse boundary and reported, rather than carried into the mapping as an
      // object with no keys.
      expect(config.server.port).toBe(9090);
      expect(consoleError).toHaveBeenCalled();

      consoleError.mockRestore();
      await rm(dir, { recursive: true, force: true });
    });
  });
});
