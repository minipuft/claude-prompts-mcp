import { afterEach, describe, expect, it } from '@jest/globals';
import path from 'node:path';

import { PathResolver } from '../../../src/runtime/paths.js';

const originalRuntimeRoot = process.env['MCP_RUNTIME_ROOT'];
const originalWorkspace = process.env['MCP_WORKSPACE'];

afterEach(() => {
  if (originalRuntimeRoot === undefined) delete process.env['MCP_RUNTIME_ROOT'];
  else process.env['MCP_RUNTIME_ROOT'] = originalRuntimeRoot;
  if (originalWorkspace === undefined) delete process.env['MCP_WORKSPACE'];
  else process.env['MCP_WORKSPACE'] = originalWorkspace;
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
