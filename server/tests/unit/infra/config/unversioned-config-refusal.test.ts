/**
 * A config file with no `version` key is refused at the config-load boundary.
 *
 * It is the pre-5.0 shape, and no reader accepts it: the server refuses to start, naming each
 * pre-5.0 key the file carries with what replaces it, then the line to add. Nothing is translated
 * in memory and nothing on disk is rewritten. The real file is the one the package shipped before
 * 5.0, kept byte for byte as `fixtures/pre-5.0-shipped-config.json`
 * (`git show 83196fcd:server/config.json`), so the fixture cannot drift with the working tree.
 */

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

import { ConfigLoader } from '../../../../src/infra/config/index.js';
import { PathSettingError } from '../../../../src/shared/utils/path-setting.js';
import { unversionedConfigFileRefusal } from '../../../../src/shared/utils/unversioned-config-file.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(HERE, '..', '..', '..', '..');
const SCHEMA_PATH = path.join(SERVER_ROOT, 'config.schema.json');
const PRE_5_SHIPPED_CONFIG = path.join(HERE, 'fixtures', 'pre-5.0-shipped-config.json');

/**
 * The shipped pre-5.0 file, rewritten by hand the way its refusal says: each listed key moved or
 * removed, and `"version": 5` added. Hand-authored, so it is evidence that the message is enough.
 */
const HAND_FIXED_5_TWIN = {
  $schema: './config.schema.json',
  version: 5,
  phaseGuards: { mode: 'enforce', maxRetries: 2 },
  execution: { judge: true },
  gates: { enabled: true, evaluation: { defaultMode: 'self' }, frameworkGates: true },
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

/** The refusal the shipped pre-5.0 file receives, in full, for a file at `configPath`. */
function expectedShippedRefusal(configPath: string): string {
  return [
    `Refusing to start: ${configPath} is a config file with no "version" key (the pre-5.0 ` +
      'shape), which is refused since 6.0.0. Change each pre-5.0 key it carries:',
    '  - "frameworks.systemPromptFrequency": move its value to ' +
      '"frameworks.injection.systemPrompt.frequency"',
    '  - "frameworks.systemPromptTarget": move its value to ' +
      '"frameworks.injection.systemPrompt.target"',
    '  - "frameworks.gateGuidanceFrequency": move its value to ' +
      '"frameworks.injection.gateGuidance.frequency"',
    '  - "frameworks.gateGuidanceTarget": move its value to ' +
      '"frameworks.injection.gateGuidance.target"',
    '  - "frameworks.styleGuidance": move its value to ' +
      '"frameworks.injection.styleGuidance.enabled"',
    '  - "frameworks.styleGuidanceFrequency": move its value to ' +
      '"frameworks.injection.styleGuidance.frequency"',
    '  - "frameworks.styleGuidanceTarget": move its value to ' +
      '"frameworks.injection.styleGuidance.target"',
    '  - "advanced.sessions.timeoutMinutes": move its value to "chainSessions.timeoutMinutes"',
    '  - "advanced.sessions.reviewTimeoutMinutes": move its value to ' +
      '"chainSessions.reviewTimeoutMinutes"',
    '  - "advanced.sessions.cleanupIntervalMinutes": move its value to ' +
      '"chainSessions.cleanupIntervalMinutes"',
    '  - "server.transport": remove it; stdio is the default, and another transport is chosen ' +
      'at launch with the launch flag --transport=streamable-http (or --transport=both)',
    '  - "gates.directory": remove it; gates are read from the gates/ folder of each location ' +
      'in "paths.resources"',
    '  - "advanced": remove the section; 5.0 has no "advanced" section, and chain session ' +
      'lifetimes live under "chainSessions"',
    'Then add "version": 5 at the top level of the file.',
  ].join('\n');
}

describe('a config file with no "version" is refused at load', () => {
  let tempDir: string;
  let configPath: string;
  let warnSpy: jest.SpiedFunction<typeof console.warn>;

  beforeEach(async () => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    tempDir = await mkdtemp(path.join(tmpdir(), 'cfg-unversioned-'));
    configPath = path.join(tempDir, 'config.json');
  });

  afterEach(async () => {
    warnSpy.mockRestore();
    await rm(tempDir, { recursive: true, force: true });
  });

  async function refusalFor(raw: Record<string, unknown>): Promise<string> {
    await writeFile(configPath, JSON.stringify(raw), 'utf8');
    try {
      await new ConfigLoader(configPath).loadConfig();
    } catch (error) {
      expect(error).toBeInstanceOf(PathSettingError);
      return (error as Error).message;
    }
    throw new Error('the loader accepted a config file with no "version"');
  }

  describe('the config.json shipped before 5.0', () => {
    it('refuses it, naming every pre-5.0 key it carries and the line to add', async () => {
      await copyFile(PRE_5_SHIPPED_CONFIG, configPath);
      const before = await readFile(configPath);

      const refusal = new ConfigLoader(configPath, undefined, {
        schemaPath: SCHEMA_PATH,
      }).loadConfig();

      await expect(refusal).rejects.toBeInstanceOf(PathSettingError);
      await expect(refusal).rejects.toThrow(expectedShippedRefusal(configPath));
      // Refused, not rewritten: the bytes on disk are the bytes the operator wrote.
      expect(await readFile(configPath)).toEqual(before);
    });

    // POSITIVE CONTROL: the same installation, edited exactly as the refusal instructs, loads and
    // matches the schema — so the message alone is enough to fix the file.
    it('POSITIVE CONTROL — the file edited as the refusal says loads and matches the schema', async () => {
      await writeFile(configPath, JSON.stringify(HAND_FIXED_5_TWIN), 'utf8');
      const loader = new ConfigLoader(configPath, undefined, { schemaPath: SCHEMA_PATH });

      const config = await loader.loadConfig();

      expect(loader.getSchemaValidation()).toMatchObject({ status: 'valid', valid: true });
      expect(config.chainSessions?.timeoutMinutes).toBe(1440);
      expect(config.frameworks?.injection?.systemPrompt?.frequency).toBe(3);
    });
  });

  it('refuses a file that carries no pre-5.0 key with only the line to add', async () => {
    expect(await refusalFor({})).toBe(
      `Refusing to start: ${configPath} is a config file with no "version" key (the pre-5.0 ` +
        'shape), which is refused since 6.0.0. It carries no pre-5.0 key.\n' +
        'Add "version": 5 at the top level of the file.'
    );
    expect(await refusalFor({ gates: { enabled: false } })).toContain('It carries no pre-5.0 key.');
  });

  it('names the boolean an "on"/"off" key becomes, and asks for one when the value is neither', async () => {
    const refusal = await refusalFor({
      gates: { mode: 'off' },
      resources: { mode: 'on', logs: { mode: 'yes' } },
    });

    expect(refusal).toContain('  - "gates.mode": "off" becomes "gates.enabled": false');
    expect(refusal).toContain(
      '  - "resources.mode": "on" becomes "resources.registerWithMcp": true'
    );
    expect(refusal).toContain(
      '  - "resources.logs.mode": replace it with "resources.logs.enabled" set to true or false'
    );
  });

  it('tells the operator to remove a pre-5.0 key whose 5.0 key is already set', async () => {
    const refusal = await refusalFor({
      versioning: { max_versions: 7, maxVersions: 42, auto_version: false },
    });

    expect(refusal).toContain(
      '  - "versioning.max_versions": remove it; "versioning.maxVersions" is already set'
    );
    expect(refusal).toContain(
      '  - "versioning.auto_version": move its value to "versioning.autoVersion"'
    );
  });

  it('names each removed key with what replaces it, the analysis section from the ledger', async () => {
    const refusal = await refusalFor({
      server: { version: '1.0.0' },
      gates: { enforcePendingVerdict: true },
      resources: { prompts: { defaultRegistration: 'both' } },
      analysis: { semanticAnalysis: { llmIntegration: { enabled: true } } },
    });

    expect(refusal).toContain(
      '  - "server.version": remove it; the server reports its own version'
    );
    expect(refusal).toContain(
      '  - "gates.enforcePendingVerdict": remove it; nothing reads it and nothing replaces it'
    );
    expect(refusal).toContain(
      '  - "resources.prompts.defaultRegistration": remove it; nothing reads it and nothing replaces it'
    );
    expect(refusal).toContain(
      '  - "analysis": remove the section; use the `%judge` modifier or ' +
        '`gates.evaluation.defaultMode` for model-graded gate evaluation'
    );
  });

  it('leaves the three live modes out of the list', async () => {
    const refusal = await refusalFor({
      telemetry: { mode: 'off' },
      phaseGuards: { mode: 'warn' },
      identity: { mode: 'permissive' },
    });

    expect(refusal).toContain('It carries no pre-5.0 key.');
  });

  it('refuses a version-less config.jsonc the same way, after parsing its comments', async () => {
    const jsoncPath = path.join(tempDir, 'config.jsonc');
    await writeFile(
      jsoncPath,
      ['{', '  // a pre-5.0 file', '  "gates": { "mode": "off" },', '}'].join('\n'),
      'utf8'
    );

    const refusal = new ConfigLoader(jsoncPath).loadConfig();

    await expect(refusal).rejects.toBeInstanceOf(PathSettingError);
    await expect(refusal).rejects.toThrow(`${jsoncPath} is a config file with no "version" key`);
    await expect(refusal).rejects.toThrow('"gates.mode": "off" becomes "gates.enabled": false');
  });
});

describe('unversionedConfigFileRefusal', () => {
  it('answers nothing for a file that declares a version, whatever the value', () => {
    expect(unversionedConfigFileRefusal('/w/config.json', { version: 5 })).toBeUndefined();
    // A version other than 5 is the schema's `const 5` to report, not this refusal's.
    expect(unversionedConfigFileRefusal('/w/config.json', { version: 6 })).toBeUndefined();
  });

  it('answers nothing for a document that is not an object', () => {
    expect(unversionedConfigFileRefusal('/w/config.json', [])).toBeUndefined();
    expect(unversionedConfigFileRefusal('/w/config.json', 'text')).toBeUndefined();
  });

  it('lists "prompts.directory" only when it names something other than the default', () => {
    const custom = unversionedConfigFileRefusal('/w/config.json', {
      prompts: { directory: 'lib/prompts' },
    });
    const shipped = unversionedConfigFileRefusal('/w/config.json', {
      prompts: { directory: './resources/prompts/' },
    });

    expect(custom).toContain('  - "prompts.directory": remove it; use ');
    expect(shipped).toContain('It carries no pre-5.0 key.');
  });
});

describe('a config file that declares its version loads by its file format', () => {
  it('loads a config.jsonc with comments and a trailing comma, and its values are effective', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'cfg-jsonc-values-'));
    const configPath = path.join(dir, 'config.jsonc');
    await writeFile(
      configPath,
      [
        '{',
        '  // line comment',
        '  "version": 5,',
        '  /* block comment */',
        '  "server": { "name": "jsonc-effective", "port": 4321 },',
        '}',
      ].join('\n'),
      'utf8'
    );

    const config = await new ConfigLoader(configPath).loadConfig();

    expect(config.server.name).toBe('jsonc-effective');
    expect(config.server.port).toBe(4321);

    await rm(dir, { recursive: true, force: true });
  });

  // POSITIVE CONTROL for the case above: the identical commented, trailing-comma text named
  // `config.json` fails strict parsing, and `loadConfig`'s catch serves the built-in defaults.
  it('POSITIVE CONTROL — the same commented text named config.json falls back to defaults', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'cfg-json-control-'));
    const configPath = path.join(dir, 'config.json');
    await writeFile(
      configPath,
      [
        '{',
        '  // line comment',
        '  "version": 5,',
        '  "server": { "name": "jsonc-effective", "port": 4321 },',
        '}',
      ].join('\n'),
      'utf8'
    );
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const config = await new ConfigLoader(configPath).loadConfig();

    expect(config.server.name).not.toBe('jsonc-effective');
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
    await rm(dir, { recursive: true, force: true });
  });
});
