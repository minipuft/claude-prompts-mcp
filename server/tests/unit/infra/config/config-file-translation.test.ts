/**
 * 4.x -> 5.0 config file translation.
 *
 * `translateConfigFile` is keyed on the file's `version`: absent means 4.x (the only shape that
 * predates the key), `5` means current, anything else means a shape nobody has described. These
 * pin all three branches against the REAL 4.x file this package shipped — pasted below as a
 * literal from `git show 83196fcd:server/config.json`, so the fixture cannot drift with the
 * working tree the way a `readFile` of `server/config.json` would.
 *
 * The two claims that matter are separable, so they are asserted separately: that the translated
 * record satisfies the 5.0 SCHEMA (a statement about the file shape), and that it resolves to the
 * same runtime `Config` as a hand-built 5.0 twin (a statement about what the server then reads).
 */

import { describe, expect, it, jest } from '@jest/globals';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

import { translateConfigFile } from '../../../../src/infra/config/config-file-translation.js';
import { validateConfigAgainstSchema } from '../../../../src/infra/config/config-schema-validator.js';
import { ConfigLoader } from '../../../../src/infra/config/index.js';

// Same resolution pattern as the ConfigLoader siblings in this directory — the schema ships beside
// the server root, one directory shallower than this test file.
const __filename = fileURLToPath(import.meta.url);
const SERVER_ROOT = path.resolve(path.dirname(__filename), '..', '..', '..', '..');
const SCHEMA_PATH = path.join(SERVER_ROOT, 'config.schema.json');

/**
 * `server/config.json` exactly as it shipped at 83196fcd, the last commit before the 5.0 reshape.
 * A literal rather than a read: this is the file real installations still have on disk, and it has
 * to keep loading whatever the packaged config becomes.
 */
const SHIPPED_4X_CONFIG = {
  $schema: './config.schema.json',
  advanced: {
    sessions: {
      cleanupIntervalMinutes: 5,
      reviewTimeoutMinutes: 30,
      timeoutMinutes: 1440,
    },
  },
  phaseGuards: { mode: 'enforce', maxRetries: 2 },
  execution: { judge: true },
  gates: {
    directory: 'resources/gates',
    enabled: true,
    evaluation: { defaultMode: 'self' },
    frameworkGates: true,
  },
  hooks: { expandedOutput: true },
  logging: { directory: './logs', level: 'info' },
  frameworks: {
    dynamicToolDescriptions: true,
    enabled: true,
    systemPromptFrequency: 3,
    systemPromptTarget: 'steps',
    gateGuidanceFrequency: 0,
    gateGuidanceTarget: 'both',
    styleGuidance: true,
    styleGuidanceFrequency: 0,
    styleGuidanceTarget: 'steps',
  },
  prompts: { directory: 'resources/prompts', registerWithMcp: true },
  resources: {
    gates: { enabled: true },
    logs: { defaultLevel: 'info', enabled: true, maxEntries: 500 },
    frameworks: { enabled: true },
    observability: { enabled: true, metrics: true, sessions: true },
    prompts: { enabled: true },
    registerWithMcp: false,
  },
  server: { name: 'claude-prompts', port: 9090, transport: 'stdio' },
  verification: {
    inContextAttempts: 3,
    isolation: { enabled: true, maxBudget: 1, permissionMode: 'delegate', timeout: 300 },
  },
  versioning: { autoVersion: true, enabled: true, maxVersions: 50 },
};

/**
 * The same installation, written by hand in the 5.0 spellings — nested injection, `chainSessions`
 * at the root, no `advanced`, no `server.transport`.
 *
 * Hand-authored rather than produced by the translation: a twin the translation built would only
 * prove the translation equals itself.
 */
const HAND_BUILT_5X_TWIN = {
  $schema: './config.schema.json',
  version: 5,
  phaseGuards: { mode: 'enforce', maxRetries: 2 },
  execution: { judge: true },
  gates: {
    enabled: true,
    evaluation: { defaultMode: 'self' },
    frameworkGates: true,
  },
  hooks: { expandedOutput: true },
  logging: { directory: './logs', level: 'info' },
  frameworks: {
    dynamicToolDescriptions: true,
    enabled: true,
    injection: {
      systemPrompt: { frequency: 3, target: 'steps' },
      gateGuidance: { frequency: 0, target: 'both' },
      styleGuidance: { enabled: true, frequency: 0, target: 'steps' },
    },
  },
  prompts: { directory: 'resources/prompts', registerWithMcp: true },
  resources: {
    gates: { enabled: true },
    logs: { defaultLevel: 'info', enabled: true, maxEntries: 500 },
    frameworks: { enabled: true },
    observability: { enabled: true, metrics: true, sessions: true },
    prompts: { enabled: true },
    registerWithMcp: false,
  },
  server: { name: 'claude-prompts', port: 9090 },
  verification: {
    inContextAttempts: 3,
    isolation: { enabled: true, maxBudget: 1, permissionMode: 'delegate', timeout: 300 },
  },
  versioning: { autoVersion: true, enabled: true, maxVersions: 50 },
  chainSessions: { cleanupIntervalMinutes: 5, reviewTimeoutMinutes: 30, timeoutMinutes: 1440 },
};

/** Writes `raw` as a config file and returns the resolved `Config` a real loader produces. */
async function resolveThroughLoader(
  raw: Record<string, unknown>,
  options: { readonly schemaPath?: string } = {}
) {
  const dir = await mkdtemp(path.join(tmpdir(), 'cfg-translation-'));
  const configPath = path.join(dir, 'config.json');
  await writeFile(configPath, JSON.stringify(raw), 'utf8');
  const manager = new ConfigLoader(configPath, undefined, options);
  const config = await manager.loadConfig();
  return { config, manager, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

describe('4.x -> 5.0 config file translation', () => {
  describe('the shipped 4.x config.json', () => {
    it('translates to a record the 5.0 schema reports as valid', async () => {
      const { file } = translateConfigFile(SHIPPED_4X_CONFIG as Record<string, unknown>);

      expect(await validateConfigAgainstSchema(file, SCHEMA_PATH)).toMatchObject({
        status: 'valid',
        valid: true,
      });
    });

    // POSITIVE CONTROL for the case above: the same probe against the UNtranslated literal. Without
    // it, "the translated file validates" would pass equally well against a schema that accepts
    // anything, or a validator that never reports.
    it('POSITIVE CONTROL — the untranslated literal does not validate', async () => {
      const result = await validateConfigAgainstSchema(
        SHIPPED_4X_CONFIG as Record<string, unknown>,
        SCHEMA_PATH
      );

      expect(result).toMatchObject({ status: 'invalid', valid: false });
      // Named, not merely counted: these are the shapes the translation exists to move.
      expect(result.errors.some((line) => line.includes('advanced'))).toBe(true);
      expect(result.errors.some((line) => line.includes('systemPromptFrequency'))).toBe(true);
      expect(result.errors.some((line) => line.includes('version'))).toBe(true);
    });

    it('reports exactly the keys it moved and the keys it dropped', () => {
      const { translated, dropped } = translateConfigFile(
        SHIPPED_4X_CONFIG as Record<string, unknown>
      );

      expect(translated).toEqual([
        {
          from: 'frameworks.systemPromptFrequency',
          to: 'frameworks.injection.systemPrompt.frequency',
        },
        { from: 'frameworks.systemPromptTarget', to: 'frameworks.injection.systemPrompt.target' },
        {
          from: 'frameworks.gateGuidanceFrequency',
          to: 'frameworks.injection.gateGuidance.frequency',
        },
        { from: 'frameworks.gateGuidanceTarget', to: 'frameworks.injection.gateGuidance.target' },
        { from: 'frameworks.styleGuidance', to: 'frameworks.injection.styleGuidance.enabled' },
        {
          from: 'frameworks.styleGuidanceFrequency',
          to: 'frameworks.injection.styleGuidance.frequency',
        },
        { from: 'frameworks.styleGuidanceTarget', to: 'frameworks.injection.styleGuidance.target' },
        { from: 'advanced.sessions.timeoutMinutes', to: 'chainSessions.timeoutMinutes' },
        {
          from: 'advanced.sessions.reviewTimeoutMinutes',
          to: 'chainSessions.reviewTimeoutMinutes',
        },
        {
          from: 'advanced.sessions.cleanupIntervalMinutes',
          to: 'chainSessions.cleanupIntervalMinutes',
        },
      ]);
      // `server.version`, `gates.enforcePendingVerdict`, `resources.prompts.defaultRegistration`
      // and `analysis` are also dropped when present; this file carries none of them.
      expect(dropped).toEqual(['server.transport', 'gates.directory']);
    });

    it('does not mutate the record it was given', () => {
      const input = structuredClone(SHIPPED_4X_CONFIG) as Record<string, unknown>;
      const before = structuredClone(input);

      const { file } = translateConfigFile(input);

      expect(input).toEqual(before);
      expect(file).not.toBe(input);
    });

    it('resolves to the same runtime Config as a hand-built 5.0 twin', async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

      const old = await resolveThroughLoader(SHIPPED_4X_CONFIG as Record<string, unknown>);
      const twin = await resolveThroughLoader(HAND_BUILT_5X_TWIN as Record<string, unknown>);

      // Deep equality over the WHOLE resolved config, not a leaf at a time: a translation that
      // moved nine of ten keys would satisfy any per-key assertion the author happened to write.
      expect(old.config).toEqual(twin.config);
      // Anchors the comparison to real values, so it cannot be satisfied by two defaulted configs.
      expect(old.config.chainSessions?.sessionTimeoutMinutes).toBe(1440);
      expect(old.config.frameworks?.injection?.systemPrompt?.frequency).toBe(3);
      expect(old.config.versioning?.max_versions).toBe(50);

      warn.mockRestore();
      await old.cleanup();
      await twin.cleanup();
    });
  });

  describe('a file that declares its version is never translated', () => {
    it('leaves a `version: 5` file with a flat 4.x key exactly as written', async () => {
      const raw = { version: 5, frameworks: { enabled: true, systemPromptFrequency: 7 } };

      const { file, translated, dropped } = translateConfigFile(raw);

      expect(file).toEqual(raw);
      expect(translated).toEqual([]);
      expect(dropped).toEqual([]);
    });

    it('warns about that flat key through the loader, naming it', async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

      const { manager, cleanup } = await resolveThroughLoader(
        { version: 5, frameworks: { enabled: true, systemPromptFrequency: 7 } },
        { schemaPath: SCHEMA_PATH }
      );

      // Untranslated means unrecognized: the schema check is what reports it, by name.
      const validation = manager.getSchemaValidation();
      expect(validation).toMatchObject({ status: 'invalid', valid: false });
      expect(validation?.errors.some((line) => line.includes('systemPromptFrequency'))).toBe(true);

      warn.mockRestore();
      await cleanup();
    });

    it('leaves a `version: 6` file untouched rather than guessing at its shape', () => {
      const raw = {
        version: 6,
        advanced: { sessions: { timeoutMinutes: 90 } },
        frameworks: { systemPromptFrequency: 7 },
      };

      const { file, translated, dropped } = translateConfigFile(raw);

      // A shape this translation has no description of. The schema's `const 5` is what tells the
      // operator so; translating it would produce a file the operator never wrote.
      expect(file).toEqual(raw);
      expect(translated).toEqual([]);
      expect(dropped).toEqual([]);
    });
  });

  describe('a 4.x file stamps itself as 5.0', () => {
    it('sets `version: 5` on a translated file', () => {
      const { file } = translateConfigFile({ gates: { enabled: true } });

      expect(file['version']).toBe(5);
    });

    it('drops an inert `mode` value that is neither "on" nor "off" rather than guessing', () => {
      const { file, translated, dropped } = translateConfigFile({ gates: { mode: 'yes' } });

      // A wrong boolean here silently flips a subsystem, so the key is reported as dropped and
      // `gates.enabled` is left for the default to fill.
      expect((file['gates'] as Record<string, unknown>)['enabled']).toBeUndefined();
      expect(translated).toEqual([]);
      expect(dropped).toEqual(['gates.mode']);
    });
  });
});
