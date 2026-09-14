import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ConfigPathError, PathResolver } from '../../../src/runtime/paths.js';

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
      expect(error).toBeInstanceOf(ConfigPathError);
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

  it('does not check the default resolution, which ConfigLoader still answers with defaults', () => {
    // The package root here does not exist, so a check applied to every source would throw.
    expect(new PathResolver({ cli: {}, packageRoot }).getConfigPath()).toBe(packagedDefault);
  });
});
