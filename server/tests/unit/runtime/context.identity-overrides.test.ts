import { describe, expect, test } from '@jest/globals';

import { applyRuntimeIdentityOverrides } from '../../../src/runtime/context.js';

import type { Config } from '../../../src/shared/types/index.js';
import type { RuntimeLaunchOptions } from '../../../src/runtime/options.js';

import {
  DEFAULT_PROMPTS_CONFIG,
  DEFAULT_VERSIONING_CONFIG,
  DEFAULT_TELEMETRY_CONFIG,
} from '../../../src/shared/types/core-config.js';

// Every section is resolved at load (row 6.2 / R57), so a fixture typed `Config` has to carry
// all of them — not just the two this suite exercises. Values mirror the loader's own defaults
// (`src/infra/config/index.ts` DEFAULT_*_CONFIG constants) so a fixture drifting from what the
// loader actually resolves is a fixture bug, not a passing test.
function createBaseConfig(): Config {
  return {
    server: {
      name: 'test-server',
      version: '1.0.0',
      port: 3456,
    },
    prompts: DEFAULT_PROMPTS_CONFIG,
    gates: {
      directory: 'resources/gates',
      enabled: true,
      frameworkGates: true,
      executeInlineGateDefinitions: false,
      evaluation: { defaultMode: 'self' },
      harnessCovers: [],
      reminderTokenBudget: 800,
    },
    phaseGuards: { mode: 'enforce', maxRetries: 2 },
    execution: { judge: true },
    frameworks: {
      enabled: true,
      dynamicToolDescriptions: true,
      defaultFramework: 'CAGEERF',
      injection: {
        systemPrompt: { enabled: true, frequency: 3, target: 'steps' },
        gateGuidance: { frequency: 0, target: 'both' },
        styleGuidance: { enabled: true, frequency: 0, target: 'steps' },
      },
    },
    chainSessions: {
      sessionTimeoutMinutes: 24 * 60,
      reviewTimeoutMinutes: 30,
      cleanupIntervalMinutes: 5,
    },
    logging: { directory: './logs', level: 'info' },
    versioning: DEFAULT_VERSIONING_CONFIG,
    verification: {},
    resources: {},
    telemetry: DEFAULT_TELEMETRY_CONFIG,
    identity: { mode: 'permissive', allowPerRequestOverride: true, launchDefaults: {} },
  };
}

function createRuntimeOptions(overrides: Partial<RuntimeLaunchOptions> = {}): RuntimeLaunchOptions {
  return {
    args: [],
    verbose: false,
    quiet: true,
    startupTest: false,
    testEnvironment: true,
    transport: 'stdio',
    paths: {},
    ...overrides,
  };
}

// Derivation is injected so these assertions do not depend on the directory the
// suite happens to run from.
const deriveNothing = (): undefined => undefined;
const deriveProject = () => ({ value: 'derived-project', source: 'cwd' as const });

describe('applyRuntimeIdentityOverrides', () => {
  test('applies runtime client defaults when config carries no launch defaults', () => {
    const config = createBaseConfig();
    const runtimeOptions = createRuntimeOptions({
      identityDefaults: {
        clientFamily: 'codex',
        clientId: 'codex-cli',
        delegationProfile: 'spawn_agent_v1',
      },
    });

    applyRuntimeIdentityOverrides(config, runtimeOptions, deriveNothing);

    // mode/allowPerRequestOverride pass through unchanged from the base fixture: the loader
    // always resolves them, so nothing in this call ever fabricates or drops them.
    expect(config.identity).toEqual({
      mode: 'permissive',
      allowPerRequestOverride: true,
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
    config.identity = {
      mode: 'permissive',
      allowPerRequestOverride: true,
      launchDefaults: { workspaceId: 'workspace-from-config' },
    };

    const derived = applyRuntimeIdentityOverrides(config, createRuntimeOptions(), deriveProject);

    expect(config.identity?.launchDefaults?.workspaceId).toBe('workspace-from-config');
    // Nothing was derived, so startup reports the id as explicitly configured.
    expect(derived).toBeUndefined();
  });

  test('CLI workspaceId outranks both config and the derived one', () => {
    const config = createBaseConfig();
    config.identity = {
      mode: 'permissive',
      allowPerRequestOverride: true,
      launchDefaults: { workspaceId: 'workspace-from-config' },
    };
    const runtimeOptions = createRuntimeOptions({
      identityDefaults: { workspaceId: 'workspace-from-cli' },
    });

    applyRuntimeIdentityOverrides(config, runtimeOptions, deriveProject);

    expect(config.identity?.launchDefaults?.workspaceId).toBe('workspace-from-cli');
  });

  test('a blank configured workspaceId does not suppress derivation', () => {
    const config = createBaseConfig();
    config.identity = {
      mode: 'permissive',
      allowPerRequestOverride: true,
      launchDefaults: { workspaceId: '   ' },
    };

    applyRuntimeIdentityOverrides(config, createRuntimeOptions(), deriveProject);

    expect(config.identity?.launchDefaults?.workspaceId).toBe('derived-project');
  });
});
