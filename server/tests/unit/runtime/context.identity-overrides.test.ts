import { describe, expect, test } from '@jest/globals';

import { applyRuntimeIdentityOverrides } from '../../../src/runtime/context.js';

import type { Config } from '../../../src/shared/types/index.js';
import type { RuntimeLaunchOptions } from '../../../src/runtime/options.js';

function createBaseConfig(): Config {
  return {
    server: {
      name: 'test-server',
      version: '1.0.0',
      port: 3456,
    },
    prompts: {
      directory: 'resources/prompts',
    },
  };
}

function createRuntimeOptions(overrides: Partial<RuntimeLaunchOptions> = {}): RuntimeLaunchOptions {
  return {
    args: [],
    verbose: false,
    quiet: true,
    startupTest: false,
    testEnvironment: true,
    paths: {},
    ...overrides,
  };
}

// Derivation is injected so these assertions do not depend on the directory the
// suite happens to run from.
const deriveNothing = (): undefined => undefined;
const deriveProject = () => ({ value: 'derived-project', source: 'cwd' as const });

describe('applyRuntimeIdentityOverrides', () => {
  test('applies runtime client defaults when config has no identity section', () => {
    const config = createBaseConfig();
    const runtimeOptions = createRuntimeOptions({
      identityDefaults: {
        clientFamily: 'codex',
        clientId: 'codex-cli',
        delegationProfile: 'spawn_agent_v1',
      },
    });

    applyRuntimeIdentityOverrides(config, runtimeOptions, deriveNothing);

    expect(config.identity).toEqual({
      launchDefaults: {
        clientFamily: 'codex',
        clientId: 'codex-cli',
        delegationProfile: 'spawn_agent_v1',
      },
    });
  });

  test('merges runtime identity defaults with existing config identity defaults', () => {
    const config = createBaseConfig();
    config.identity = {
      mode: 'permissive',
      allowPerRequestOverride: false,
      launchDefaults: {
        workspaceId: 'workspace-from-config',
        clientFamily: 'claude-code',
      },
    };

    const runtimeOptions = createRuntimeOptions({
      identityMode: 'locked',
      identityDefaults: {
        clientFamily: 'codex',
        delegationProfile: 'spawn_agent_v1',
      },
    });

    applyRuntimeIdentityOverrides(config, runtimeOptions, deriveProject);

    expect(config.identity).toEqual({
      mode: 'locked',
      allowPerRequestOverride: false,
      launchDefaults: {
        workspaceId: 'workspace-from-config',
        clientFamily: 'codex',
        delegationProfile: 'spawn_agent_v1',
      },
    });
  });

  test('derives a workspaceId when neither CLI nor config supplies one', () => {
    const config = createBaseConfig();

    const derived = applyRuntimeIdentityOverrides(config, createRuntimeOptions(), deriveProject);

    expect(config.identity?.launchDefaults?.workspaceId).toBe('derived-project');
    expect(derived).toEqual({ value: 'derived-project', source: 'cwd' });
  });

  test('config workspaceId outranks the derived one', () => {
    const config = createBaseConfig();
    config.identity = { launchDefaults: { workspaceId: 'workspace-from-config' } };

    const derived = applyRuntimeIdentityOverrides(config, createRuntimeOptions(), deriveProject);

    expect(config.identity?.launchDefaults?.workspaceId).toBe('workspace-from-config');
    // Nothing was derived, so startup reports the id as explicitly configured.
    expect(derived).toBeUndefined();
  });

  test('CLI workspaceId outranks both config and the derived one', () => {
    const config = createBaseConfig();
    config.identity = { launchDefaults: { workspaceId: 'workspace-from-config' } };
    const runtimeOptions = createRuntimeOptions({
      identityDefaults: { workspaceId: 'workspace-from-cli' },
    });

    applyRuntimeIdentityOverrides(config, runtimeOptions, deriveProject);

    expect(config.identity?.launchDefaults?.workspaceId).toBe('workspace-from-cli');
  });

  test('a blank configured workspaceId does not suppress derivation', () => {
    const config = createBaseConfig();
    config.identity = { launchDefaults: { workspaceId: '   ' } };

    applyRuntimeIdentityOverrides(config, createRuntimeOptions(), deriveProject);

    expect(config.identity?.launchDefaults?.workspaceId).toBe('derived-project');
  });
});
