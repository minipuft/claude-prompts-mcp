/**
 * `paths.resources` and the retired `prompts.directory`, through a real `ConfigLoader.loadConfig`.
 *
 * Every refusal is a `PathSettingError` thrown out of `loadConfig` (the startup entry point prints
 * it and exits); a load that silently fell back to the defaults would resolve instead, so each
 * refusal case also proves the loader did not swallow it.
 */

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

import { ConfigLoader } from '../../../../src/infra/config/index.js';
import { PathSettingError } from '../../../../src/shared/utils/path-setting.js';

const __filename = fileURLToPath(import.meta.url);
const SERVER_ROOT = path.resolve(path.dirname(__filename), '..', '..', '..', '..');
const SCHEMA_PATH = path.join(SERVER_ROOT, 'config.schema.json');

describe('paths.resources in the config file', () => {
  let tempDir: string;
  let configPath: string;
  let errorSpy: jest.SpiedFunction<typeof console.error>;
  let warnSpy: jest.SpiedFunction<typeof console.warn>;

  beforeEach(async () => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    tempDir = await mkdtemp(path.join(tmpdir(), 'cfg-resource-locations-'));
    configPath = path.join(tempDir, 'config.json');
  });

  afterEach(async () => {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
    await rm(tempDir, { recursive: true, force: true });
  });

  async function load(file: Record<string, unknown>): Promise<ConfigLoader> {
    await writeFile(configPath, JSON.stringify(file), 'utf8');
    const loader = new ConfigLoader(configPath, undefined, { schemaPath: SCHEMA_PATH });
    await loader.loadConfig();
    return loader;
  }

  it('accepts an ordered list of paths and "bundled", keeps its order, and passes the schema', async () => {
    const absolute = path.join(tempDir, 'abs-lib');
    await mkdir(absolute);
    await mkdir(path.join(tempDir, 'lib'));
    const loader = await load({ version: 5, paths: { resources: ['bundled', './lib', absolute] } });

    expect(loader.getSchemaValidation()?.status).toBe('valid');
    // The effective value: each path absolute against the config's directory, "bundled" kept.
    expect(loader.getConfigValueWithSource('paths.resources')).toMatchObject({
      value: ['bundled', path.join(tempDir, 'lib'), absolute],
      source: 'file',
    });
    expect(loader.getConfig().paths.resources).toEqual([
      'bundled',
      path.join(tempDir, 'lib'),
      absolute,
    ]);
    // The first entry that is a path feeds the readers `prompts.directory` fed.
    expect(loader.getConfig().prompts.directory).toBe(path.join('lib', 'prompts'));
    expect(loader.getPromptsDirectory()).toBe(path.join(tempDir, 'lib', 'prompts'));
  });

  it('resolves an absolute first entry as itself, not under the config directory', async () => {
    const absolute = path.join(tempDir, 'abs-lib');
    await mkdir(absolute);
    const loader = await load({ version: 5, paths: { resources: [absolute, 'bundled'] } });

    expect(loader.getPromptsDirectory()).toBe(path.join(absolute, 'prompts'));
  });

  it('loads a file with neither key on the default prompts directory', async () => {
    const loader = await load({ version: 5 });

    expect(loader.getConfig().prompts.directory).toBe('resources/prompts');
    expect(loader.getPromptsDirectory()).toBe(path.join(tempDir, 'resources', 'prompts'));
  });

  it('keeps the default when "bundled" is the only entry', async () => {
    const loader = await load({ version: 5, paths: { resources: ['bundled'] } });

    expect(loader.getConfig().prompts.directory).toBe('resources/prompts');
  });

  it.each([
    ['a string', './lib', /a string \("\.\/lib"\)/],
    ['an object', { first: './lib' }, /an object/],
    ['a number', 5, /a number \(5\)/],
  ])('refuses %s as "paths.resources", naming the key and a list', async (_kind, value, shown) => {
    const refusal = load({ version: 5, paths: { resources: value } });

    await expect(refusal).rejects.toBeInstanceOf(PathSettingError);
    await expect(refusal).rejects.toThrow(/sets "paths\.resources" to /);
    await expect(refusal).rejects.toThrow(shown);
    await expect(refusal).rejects.toThrow(/Expected a list of strings/);
    await expect(refusal).rejects.toThrow(configPath);
  });

  it('refuses a "paths" that is not an object', async () => {
    await expect(load({ version: 5, paths: ['./lib'] })).rejects.toThrow(
      /sets "paths" to a list[\s\S]*Expected an object/
    );
  });

  it.each([
    ['a number', ['./lib', 7], /"paths\.resources\[1\]" to a number \(7\)/],
    ['an empty string', ['', 'bundled'], /"paths\.resources\[0\]" to a string \(""\)/],
  ])('refuses %s as an entry, naming its position', async (_kind, value, shown) => {
    const refusal = load({ version: 5, paths: { resources: value } });

    await expect(refusal).rejects.toBeInstanceOf(PathSettingError);
    await expect(refusal).rejects.toThrow(shown);
  });

  it.each([
    [
      'spelled the same',
      ['./lib', 'bundled', './lib'],
      /"\.\/lib" in "paths\.resources" more than once\./,
    ],
    [
      'spelled differently',
      ['lib', './lib/'],
      /"\.\/lib\/" in "paths\.resources" more than once \(also spelled "lib"\)/,
    ],
    ['"bundled" twice', ['bundled', 'bundled'], /"bundled" in "paths\.resources" more than once/],
  ])(
    'refuses a duplicate location %s, naming the key and the entry',
    async (_kind, value, shown) => {
      const refusal = load({ version: 5, paths: { resources: value } });

      await expect(refusal).rejects.toBeInstanceOf(PathSettingError);
      await expect(refusal).rejects.toThrow(shown);
    }
  );

  it('refuses a listed entry naming a missing directory, naming the file, the key, the entry and its resolved path', async () => {
    await mkdir(path.join(tempDir, 'present'));
    const refusal = load({ version: 5, paths: { resources: ['./present', 'bundled', '../gone'] } });

    await expect(refusal).rejects.toBeInstanceOf(PathSettingError);
    await expect(refusal).rejects.toThrow(configPath);
    await expect(refusal).rejects.toThrow(
      `lists "../gone" in "paths.resources[2]", which resolves to ${path.resolve(tempDir, '..', 'gone')}, and that path does not exist`
    );
    await expect(refusal).rejects.toThrow(/Expected an existing directory there/);
  });

  it('refuses a listed entry naming a file (CONTROL: the same list with the directory present loads)', async () => {
    await writeFile(path.join(tempDir, 'a-file'), 'x', 'utf8');
    await expect(load({ version: 5, paths: { resources: ['./a-file'] } })).rejects.toThrow(
      /"paths\.resources\[0\]", which resolves to .*a-file, and that path is not a directory/
    );

    await mkdir(path.join(tempDir, 'a-dir'));
    const loader = await load({ version: 5, paths: { resources: ['./a-dir'] } });
    expect(loader.getConfig().paths.resources).toEqual([path.join(tempDir, 'a-dir')]);
  });

  it('refuses an empty "paths.resources", naming the key and what to write instead', async () => {
    const refusal = load({ version: 5, paths: { resources: [] } });

    await expect(refusal).rejects.toBeInstanceOf(PathSettingError);
    await expect(refusal).rejects.toThrow(/sets "paths\.resources" to an empty list/);
    await expect(refusal).rejects.toThrow(/the key omitted, or a list naming at least "bundled"/);
  });

  it('drops a default-equal "prompts.directory" in a 4.x file and starts on the default', async () => {
    const loader = await load({
      prompts: { directory: 'resources/prompts', registerWithMcp: false },
    });

    expect(loader.getConfig().prompts.directory).toBe('resources/prompts');
    expect(loader.getConfig().prompts.registerWithMcp).toBe(false);
    // Dropped, not carried: the translated file the schema checked no longer holds the key.
    expect(loader.getSchemaValidation()?.status).toBe('valid');
    expect(loader.getConfigValueWithSource('prompts.directory').source).not.toBe('file');
  });

  it.each([
    ['spelled differently', './resources/prompts/'],
    ['as an absolute path', 'ABSOLUTE_DEFAULT'],
  ])('drops a default-equal "prompts.directory" in a 5.0 file %s', async (_kind, directory) => {
    const value =
      directory === 'ABSOLUTE_DEFAULT' ? path.join(tempDir, 'resources', 'prompts') : directory;
    const loader = await load({ version: 5, prompts: { directory: value } });

    expect(loader.getSchemaValidation()?.status).toBe('valid');
    expect(loader.getConfig().prompts.directory).toBe('resources/prompts');
  });

  it.each([
    ['a 5.0 file', { version: 5, prompts: { directory: 'custom/prompts' } }],
    ['a 4.x file (no version)', { prompts: { directory: './lib/prompts', registerWithMcp: true } }],
  ])(
    'refuses a non-default "prompts.directory" in %s, naming the file, the key and paths.resources',
    async (_kind, file) => {
      const refusal = load(file);

      await expect(refusal).rejects.toBeInstanceOf(PathSettingError);
      await expect(refusal).rejects.toThrow(
        new RegExp(
          `^Refusing to start: ${configPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} sets "prompts\\.directory"`
        )
      );
      await expect(refusal).rejects.toThrow(/under "paths\.resources"/);
    }
  );

  it('accepts a "prompts" section without "directory" (positive control for the refusal above)', async () => {
    const loader = await load({ version: 5, prompts: { registerWithMcp: false } });

    expect(loader.getConfig().prompts.registerWithMcp).toBe(false);
  });
});
