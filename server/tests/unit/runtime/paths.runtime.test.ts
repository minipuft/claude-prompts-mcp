import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import path from 'node:path';

import { PathResolver } from '../../../src/runtime/paths.js';

/**
 * Every environment variable PathResolver reads, cleared before each case.
 *
 * Saving only the two the tests SET left the rest ambient, so the suite's answer depended on the
 * developer's shell: with `MCP_RESOURCES_PATH` exported — a supported way to point the server at a
 * personal resource library — `getResourcesPath()` returned that path and the assertion failed on
 * a machine where nothing was wrong. A test that reads an override must own every override.
 */
const PATH_ENV_KEYS = [
  'MCP_RUNTIME_ROOT',
  'MCP_WORKSPACE',
  'MCP_RESOURCES_PATH',
  'MCP_CONFIG_PATH',
] as const;

const originalEnv = new Map(PATH_ENV_KEYS.map((key) => [key, process.env[key]]));

beforeEach(() => {
  for (const key of PATH_ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  for (const [key, value] of originalEnv) {
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
