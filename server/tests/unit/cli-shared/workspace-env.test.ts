import { describe, expect, it } from '@jest/globals';

import { workspaceFromEnv } from '../../../src/cli-shared/workspace-env.js';

describe('workspaceFromEnv', () => {
  it('prefers MCP_WORKSPACE when both variables are set', () => {
    expect(
      workspaceFromEnv({ MCP_WORKSPACE: '/own/library', CLAUDE_PLUGIN_DATA: '/plugin/data' })
    ).toEqual({ value: '/own/library', source: 'MCP_WORKSPACE' });
  });

  it('falls back to CLAUDE_PLUGIN_DATA when only the plugin variable is set', () => {
    expect(workspaceFromEnv({ CLAUDE_PLUGIN_DATA: '/plugin/data' })).toEqual({
      value: '/plugin/data',
      source: 'CLAUDE_PLUGIN_DATA',
    });
  });

  it('counts an empty string as unset, so the next variable answers', () => {
    expect(workspaceFromEnv({ MCP_WORKSPACE: '', CLAUDE_PLUGIN_DATA: '/plugin/data' })).toEqual({
      value: '/plugin/data',
      source: 'CLAUDE_PLUGIN_DATA',
    });
    expect(workspaceFromEnv({ MCP_WORKSPACE: '', CLAUDE_PLUGIN_DATA: '' })).toBeUndefined();
  });

  it('returns undefined when neither variable is set', () => {
    expect(workspaceFromEnv({})).toBeUndefined();
  });

  it('reads process.env by default', () => {
    const saved = {
      workspace: process.env['MCP_WORKSPACE'],
      plugin: process.env['CLAUDE_PLUGIN_DATA'],
    };
    try {
      delete process.env['MCP_WORKSPACE'];
      process.env['CLAUDE_PLUGIN_DATA'] = '/plugin/data';
      expect(workspaceFromEnv()?.source).toBe('CLAUDE_PLUGIN_DATA');
    } finally {
      if (saved.workspace === undefined) delete process.env['MCP_WORKSPACE'];
      else process.env['MCP_WORKSPACE'] = saved.workspace;
      if (saved.plugin === undefined) delete process.env['CLAUDE_PLUGIN_DATA'];
      else process.env['CLAUDE_PLUGIN_DATA'] = saved.plugin;
    }
  });
});
