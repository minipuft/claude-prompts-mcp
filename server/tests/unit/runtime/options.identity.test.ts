import { afterEach, describe, expect, test } from '@jest/globals';

import { parseServerCliArgs } from '../../../src/runtime/cli.js';
import { deriveProjectScopeId, resolveRuntimeLaunchOptions } from '../../../src/runtime/options.js';

describe('runtime identity launch options', () => {
  const originalWorkspaceId = process.env['MCP_WORKSPACE_ID'];
  const originalOrganizationId = process.env['MCP_ORGANIZATION_ID'];
  const originalIdentityMode = process.env['MCP_IDENTITY_MODE'];

  afterEach(() => {
    process.env['MCP_WORKSPACE_ID'] = originalWorkspaceId;
    process.env['MCP_ORGANIZATION_ID'] = originalOrganizationId;
    process.env['MCP_IDENTITY_MODE'] = originalIdentityMode;
  });

  test('parses identity CLI flags', () => {
    const cli = parseServerCliArgs([
      '--client',
      'codex',
      '--workspace-id',
      'workspace-cli',
      '--organization-id',
      'org-cli',
      '--identity-mode',
      'locked',
    ]);

    expect(cli.workspaceId).toBe('workspace-cli');
    expect(cli.organizationId).toBe('org-cli');
    expect(cli.identityMode).toBe('locked');
    expect(cli.client).toBe('codex');
  });

  test('uses CLI identity defaults and does not hydrate from environment variables', () => {
    process.env['MCP_WORKSPACE_ID'] = 'workspace-env';
    process.env['MCP_ORGANIZATION_ID'] = 'org-env';
    process.env['MCP_IDENTITY_MODE'] = 'strict';

    const options = resolveRuntimeLaunchOptions(
      parseServerCliArgs([
        '--transport',
        'stdio',
        '--identity-mode',
        'locked',
        '--client',
        'codex',
      ]),
      ['node', 'index.js']
    );

    expect(options.identityMode).toBe('locked');
    expect(options.identityDefaults).toEqual({
      clientFamily: 'codex',
      clientId: 'codex',
      delegationProfile: 'spawn_agent_v1',
    });
  });

  test('maps --client preset to client launch defaults', () => {
    const options = resolveRuntimeLaunchOptions(
      parseServerCliArgs(['--transport', 'stdio', '--client', 'codex']),
      ['node', 'index.js']
    );

    expect(options.identityDefaults).toEqual({
      clientFamily: 'codex',
      clientId: 'codex',
      delegationProfile: 'spawn_agent_v1',
    });
  });

  test('maps additional client presets to launch defaults', () => {
    const gemini = resolveRuntimeLaunchOptions(
      parseServerCliArgs(['--transport', 'stdio', '--client', 'gemini']),
      ['node', 'index.js']
    );
    expect(gemini.identityDefaults).toEqual({
      clientFamily: 'gemini',
      clientId: 'gemini',
      delegationProfile: 'gemini_subagent_v1',
    });

    const opencode = resolveRuntimeLaunchOptions(
      parseServerCliArgs(['--transport', 'stdio', '--client', 'opencode']),
      ['node', 'index.js']
    );
    expect(opencode.identityDefaults).toEqual({
      clientFamily: 'opencode',
      clientId: 'opencode',
      delegationProfile: 'opencode_agent_v1',
    });

    const cursor = resolveRuntimeLaunchOptions(
      parseServerCliArgs(['--transport', 'stdio', '--client', 'cursor']),
      ['node', 'index.js']
    );
    expect(cursor.identityDefaults).toEqual({
      clientFamily: 'cursor',
      clientId: 'cursor',
      delegationProfile: 'cursor_agent_v1',
    });
  });

  test('ignores invalid --client preset values', () => {
    const options = resolveRuntimeLaunchOptions(
      parseServerCliArgs(['--transport', 'stdio', '--client', 'not-a-client']),
      ['node', 'index.js']
    );

    expect(options.identityDefaults).toBeUndefined();
  });
});

describe('deriveProjectScopeId', () => {
  test('prefers CLAUDE_PROJECT_DIR over the working directory', () => {
    const derived = deriveProjectScopeId(
      { CLAUDE_PROJECT_DIR: '/home/dev/spicetify-theme' },
      '/home/dev/some-other-place'
    );

    expect(derived).toEqual({ value: 'spicetify-theme', source: 'CLAUDE_PROJECT_DIR' });
  });

  test('falls back to the working directory when CLAUDE_PROJECT_DIR is absent', () => {
    const derived = deriveProjectScopeId({}, '/home/dev/claude-prompts-mcp');

    expect(derived).toEqual({ value: 'claude-prompts-mcp', source: 'cwd' });
  });

  test('reduces a path to its basename so raw paths stay out of state and logs', () => {
    const derived = deriveProjectScopeId({ CLAUDE_PROJECT_DIR: '/a/deeply/nested/project' }, '/x');

    expect(derived?.value).toBe('project');
  });

  test('treats trailing separators as equivalent to none', () => {
    const withSlash = deriveProjectScopeId({ CLAUDE_PROJECT_DIR: '/home/dev/theme/' }, '/x');
    const withoutSlash = deriveProjectScopeId({ CLAUDE_PROJECT_DIR: '/home/dev/theme' }, '/x');

    expect(withSlash).toEqual(withoutSlash);
  });

  test('ignores a blank CLAUDE_PROJECT_DIR rather than deriving an empty id', () => {
    const derived = deriveProjectScopeId({ CLAUDE_PROJECT_DIR: '   ' }, '/home/dev/fallback');

    expect(derived).toEqual({ value: 'fallback', source: 'cwd' });
  });

  test('returns undefined when no directory yields a basename', () => {
    expect(deriveProjectScopeId({}, '/')).toBeUndefined();
  });

  test('distinguishes two different project directories', () => {
    const a = deriveProjectScopeId({ CLAUDE_PROJECT_DIR: '/home/dev/claude-prompts-mcp' }, '/x');
    const b = deriveProjectScopeId({ CLAUDE_PROJECT_DIR: '/home/dev/spicetify-theme' }, '/x');

    expect(a?.value).not.toBe(b?.value);
  });
});
