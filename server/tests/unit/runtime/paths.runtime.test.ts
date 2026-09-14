import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { PathResolver } from '../../../src/runtime/paths.js';
import {
  assertUsableDirectorySetting,
  PathSettingError,
} from '../../../src/shared/utils/path-setting.js';

/**
 * Every path override `PathResolver` honors, neutralized for the duration of this file.
 *
 * All four, not the two the assertions set. `MCP_RESOURCES_PATH` is exported into the shell by
 * the Claude Code plugin that runs this very server, so on a maintainer's machine
 * `getResourcesPath()` returned `~/.claude/resources` and the third assertion failed — while CI,
 * where nothing exports it, stayed green. A test that passes only where the product is NOT
 * installed is measuring the environment, not the resolver.
 *
 * Saved and restored rather than merely deleted: this process is shared with every other test
 * file in the run.
 */
const PATH_ENV_KEYS = [
  'MCP_RUNTIME_ROOT',
  'MCP_WORKSPACE',
  'MCP_RESOURCES_PATH',
  'MCP_CONFIG_PATH',
] as const;

const originalPathEnv = new Map<string, string | undefined>(
  PATH_ENV_KEYS.map((key) => [key, process.env[key]])
);

beforeEach(() => {
  for (const key of PATH_ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  for (const [key, value] of originalPathEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('PathResolver writable runtime paths', () => {
  it('keeps state and relative logs under MCP_RUNTIME_ROOT', () => {
    process.env['MCP_RUNTIME_ROOT'] = '/tmp/codex-prompts/server';
    process.env['MCP_WORKSPACE'] = '/read-only/plugin';
    const resolver = new PathResolver({ cli: {}, packageRoot: '/read-only/package' });

    expect(resolver.getRuntimeStatePath()).toBe('/tmp/codex-prompts/server/runtime-state');
    expect(resolver.getLogsPath('./logs')).toBe('/tmp/codex-prompts/server/logs');
    expect(resolver.getResourcesPath()).toBe('/read-only/package/resources');
  });

  it('retains an absolute configured log directory', () => {
    const resolver = new PathResolver({ cli: {}, packageRoot: '/package' });
    expect(resolver.getLogsPath('/var/tmp/claude-prompts-logs')).toBe(
      '/var/tmp/claude-prompts-logs'
    );
  });

  it('falls back to the effective workspace when no runtime root is explicit', () => {
    delete process.env['MCP_RUNTIME_ROOT'];
    process.env['MCP_WORKSPACE'] = path.join('/tmp', 'workspace');
    const resolver = new PathResolver({ cli: {}, packageRoot: '/package' });

    expect(resolver.getRuntimeRoot()).toBe(path.join('/tmp', 'workspace'));
  });
});

/**
 * An explicit config path is a statement about which settings to run with. Before this refusal,
 * `ConfigLoader.loadConfig` answered a missing, unreadable or malformed file with its built-in
 * defaults, so the server booted and served while ignoring the path it was given.
 */
describe('PathResolver refuses an explicit config path it cannot use', () => {
  let dir: string;
  const packageRoot = '/claude-prompts/package';
  const packagedDefault = path.join(packageRoot, 'config.json');

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'config-path-refusal-'));
  });

  afterEach(() => {
    chmodSync(dir, 0o700);
    rmSync(dir, { recursive: true, force: true });
  });

  function refusalFor(resolver: PathResolver): string {
    try {
      resolver.getConfigPath();
    } catch (error) {
      expect(error).toBeInstanceOf(PathSettingError);
      return (error as Error).message;
    }
    throw new Error('getConfigPath() returned instead of refusing');
  }

  it('names the variable, the value, the resolved path, the problem and the packaged default', () => {
    const missing = path.join(dir, 'nope.json');
    process.env['MCP_CONFIG_PATH'] = missing;

    const message = refusalFor(new PathResolver({ cli: {}, packageRoot }));

    expect(message).toContain('MCP_CONFIG_PATH');
    expect(message).toContain(`"${missing}"`);
    expect(message).toContain(`resolves to ${missing}`);
    expect(message).toContain('does not exist');
    expect(message).toContain('Expected a readable JSON config file');
    expect(message).toContain(
      `unset MCP_CONFIG_PATH to use the packaged default at ${packagedDefault}`
    );
  });

  it('names the --config flag and resolves a relative value against the working directory', () => {
    const message = refusalFor(
      new PathResolver({ cli: { config: 'relative/nope.json' }, packageRoot })
    );

    expect(message).toContain('--config is set to "relative/nope.json"');
    expect(message).toContain(`resolves to ${path.resolve(process.cwd(), 'relative/nope.json')}`);
    expect(message).toContain(`remove --config to use the packaged default at ${packagedDefault}`);
    expect(message).not.toContain('MCP_CONFIG_PATH');
  });

  it('refuses a directory', () => {
    process.env['MCP_CONFIG_PATH'] = dir;
    expect(refusalFor(new PathResolver({ cli: {}, packageRoot }))).toContain(
      'is a directory, not a file'
    );
  });

  it('refuses a file that is not valid JSON, and JSON that is not an object', () => {
    const malformed = path.join(dir, 'malformed.json');
    writeFileSync(malformed, '{ not json');
    process.env['MCP_CONFIG_PATH'] = malformed;
    expect(refusalFor(new PathResolver({ cli: {}, packageRoot }))).toContain('is not valid JSON (');

    const scalar = path.join(dir, 'scalar.json');
    writeFileSync(scalar, '42');
    process.env['MCP_CONFIG_PATH'] = scalar;
    expect(refusalFor(new PathResolver({ cli: {}, packageRoot }))).toContain(
      'is valid JSON but not a JSON object'
    );
  });

  // Root reads through mode 000, so the case is unreachable there rather than failing.
  const unreadableIt = process.getuid?.() === 0 ? it.skip : it;
  unreadableIt('refuses a file it cannot read', () => {
    const locked = path.join(dir, 'locked.json');
    writeFileSync(locked, '{}');
    chmodSync(locked, 0o000);
    process.env['MCP_CONFIG_PATH'] = locked;

    expect(refusalFor(new PathResolver({ cli: {}, packageRoot }))).toContain(
      'cannot be read (EACCES)'
    );
  });

  it('names the workspace config as the fallback when unsetting would resolve to it', () => {
    const workspace = path.join(dir, 'workspace');
    mkdirSync(workspace);
    writeFileSync(path.join(workspace, 'config.json'), '{}');
    process.env['MCP_WORKSPACE'] = workspace;
    process.env['MCP_CONFIG_PATH'] = path.join(dir, 'nope.json');

    expect(refusalFor(new PathResolver({ cli: {}, packageRoot }))).toContain(
      `to use the workspace config at ${path.join(workspace, 'config.json')}`
    );
  });

  it('returns a usable explicit path unchanged', () => {
    const valid = path.join(dir, 'config.json');
    writeFileSync(valid, '{"logging": {"level": "warn"}}');
    process.env['MCP_CONFIG_PATH'] = valid;

    expect(new PathResolver({ cli: {}, packageRoot }).getConfigPath()).toBe(valid);
  });

  it('names the unusable workspace config it would fall back to, rather than sending the operator into a second refusal', () => {
    const workspace = path.join(dir, 'workspace');
    mkdirSync(workspace);
    writeFileSync(path.join(workspace, 'config.json'), '{ not json');
    process.env['MCP_WORKSPACE'] = workspace;
    process.env['MCP_CONFIG_PATH'] = path.join(dir, 'nope.json');

    expect(refusalFor(new PathResolver({ cli: {}, packageRoot }))).toContain(
      `to use the workspace config at ${path.join(workspace, 'config.json')} (which is not valid JSON (`
    );
  });

  it('leaves the packaged default to ConfigLoader, which still answers an unusable one with built-in defaults', () => {
    // The package root here does not exist, so a check applied to the packaged default would throw.
    expect(new PathResolver({ cli: {}, packageRoot }).getConfigPath()).toBe(packagedDefault);
  });
});

/**
 * A workspace, a resources path or a workspace config.json that cannot be used stops startup.
 * Before this refusal a missing workspace was CREATED by the logs mkdir, a missing resources path
 * fell through to the bundled catalog one subfolder at a time, and a malformed workspace
 * config.json booted on built-in defaults — each a server running on settings nobody asked for.
 */
describe('PathResolver.assertUsablePathSettings refuses an unusable path setting', () => {
  let dir: string;
  const packageRoot = '/claude-prompts/package';

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'path-setting-refusal-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function refusalFor(resolver: PathResolver): string {
    try {
      resolver.assertUsablePathSettings();
    } catch (error) {
      expect(error).toBeInstanceOf(PathSettingError);
      return (error as Error).message;
    }
    throw new Error('assertUsablePathSettings() returned instead of refusing');
  }

  it('refuses a missing MCP_WORKSPACE, naming the value, the resolved path and the package root', () => {
    const missing = path.join(dir, 'no-workspace');
    process.env['MCP_WORKSPACE'] = missing;

    const message = refusalFor(new PathResolver({ cli: {}, packageRoot }));

    expect(message).toBe(
      [
        `Refusing to start: the MCP_WORKSPACE environment variable is set to "${missing}", which resolves to ${missing}, and that path does not exist.`,
        `Expected an existing directory at that path, or unset MCP_WORKSPACE to use the package root at ${packageRoot}.`,
      ].join('\n')
    );
  });

  it('refuses a --workspace that names a file, and names the MCP_WORKSPACE behind it as the fallback', () => {
    const file = path.join(dir, 'a-file');
    writeFileSync(file, '');
    const behind = path.join(dir, 'behind');
    process.env['MCP_WORKSPACE'] = behind;

    const message = refusalFor(new PathResolver({ cli: { workspace: file }, packageRoot }));

    expect(message).toContain(`--workspace is set to "${file}"`);
    expect(message).toContain('and that path is not a directory.');
    expect(message).toContain(`remove --workspace to use the MCP_WORKSPACE workspace at ${behind}`);
  });

  it('refuses a missing MCP_RESOURCES_PATH, naming the resources it would fall back to', () => {
    const missing = path.join(dir, 'no-resources');
    process.env['MCP_RESOURCES_PATH'] = missing;

    const message = refusalFor(new PathResolver({ cli: {}, packageRoot }));

    expect(message).toContain(
      `the MCP_RESOURCES_PATH environment variable is set to "${missing}", which resolves to ${missing}, and that path does not exist.`
    );
    expect(message).toContain(
      `or unset MCP_RESOURCES_PATH to use the packaged resources at ${path.join(packageRoot, 'resources')}.`
    );
  });

  it('refuses a workspace config.json that is malformed, not an object, or a directory', () => {
    const workspace = path.join(dir, 'workspace');
    mkdirSync(workspace);
    const config = path.join(workspace, 'config.json');
    process.env['MCP_WORKSPACE'] = workspace;

    writeFileSync(config, '{ not json');
    const malformed = refusalFor(new PathResolver({ cli: {}, packageRoot }));
    expect(malformed).toContain(
      `the MCP_WORKSPACE environment variable is set to "${workspace}", which resolves to ${workspace}, and its config file ${config} is not valid JSON (`
    );
    expect(malformed).toContain(
      `Expected a readable JSON config file at that path, or move it out of the workspace to use the packaged default at ${path.join(packageRoot, 'config.json')}.`
    );

    writeFileSync(config, '[]');
    expect(refusalFor(new PathResolver({ cli: {}, packageRoot }))).toContain(
      'is valid JSON but not a JSON object'
    );

    rmSync(config);
    mkdirSync(config);
    expect(refusalFor(new PathResolver({ cli: {}, packageRoot }))).toContain(
      `its config file ${config} is a directory, not a file`
    );
  });

  // Root reads through mode 000, so the case is unreachable there rather than failing.
  const unreadableIt = process.getuid?.() === 0 ? it.skip : it;
  unreadableIt('refuses a workspace config.json it cannot read', () => {
    const workspace = path.join(dir, 'workspace');
    mkdirSync(workspace);
    const config = path.join(workspace, 'config.json');
    writeFileSync(config, '{}');
    chmodSync(config, 0o000);
    process.env['MCP_WORKSPACE'] = workspace;

    try {
      expect(refusalFor(new PathResolver({ cli: {}, packageRoot }))).toContain(
        'cannot be read (EACCES)'
      );
    } finally {
      chmodSync(config, 0o600);
    }
  });

  it('does not refuse a workspace with no config.json, an empty value, or a usable explicit config beside a broken workspace one', () => {
    const workspace = path.join(dir, 'workspace');
    mkdirSync(workspace);
    process.env['MCP_WORKSPACE'] = workspace;
    const resolver = new PathResolver({ cli: {}, packageRoot });
    expect(() => resolver.assertUsablePathSettings()).not.toThrow();
    expect(resolver.getConfigPath()).toBe(path.join(packageRoot, 'config.json'));

    process.env['MCP_WORKSPACE'] = '';
    process.env['MCP_RESOURCES_PATH'] = '';
    expect(() =>
      new PathResolver({ cli: { workspace: '' }, packageRoot }).assertUsablePathSettings()
    ).not.toThrow();

    // The workspace config is not the one in use once an explicit config is named.
    process.env['MCP_WORKSPACE'] = workspace;
    writeFileSync(path.join(workspace, 'config.json'), '{ not json');
    const explicit = path.join(dir, 'explicit.json');
    writeFileSync(explicit, '{}');
    process.env['MCP_CONFIG_PATH'] = explicit;
    expect(() =>
      new PathResolver({ cli: {}, packageRoot }).assertUsablePathSettings()
    ).not.toThrow();
  });

  it('assertUsableDirectorySetting returns the resolved path and words a non-server refusal as "run"', () => {
    expect(assertUsableDirectorySetting({ name: 'MCP_RESOURCES_PATH', value: dir })).toBe(dir);

    const missing = path.join(dir, 'gone');
    expect(() =>
      assertUsableDirectorySetting({ name: 'MCP_RESOURCES_PATH', value: missing }, { verb: 'run' })
    ).toThrow(
      `Refusing to run: the MCP_RESOURCES_PATH environment variable is set to "${missing}", which resolves to ${missing}, and that path does not exist.\nExpected an existing directory at that path, or unset MCP_RESOURCES_PATH.`
    );
  });
});
