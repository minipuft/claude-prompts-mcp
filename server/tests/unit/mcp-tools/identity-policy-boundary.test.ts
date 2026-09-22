import { describe, expect, test } from '@jest/globals';

import {
  resolveRequestIdentityContext,
  validateLockedIdentityContext,
  validateStrictIdentityClaims,
} from '../../../src/shared/utils/request-identity-resolver.js';

import type {
  McpRequestExtra,
  RequestIdentityResolverOptions,
} from '../../../src/shared/utils/request-identity-resolver.js';
import type { IdentityConfig, IdentityLaunchDefaults } from '../../../src/shared/types/index.js';

function resolveOrRejectToolRequest(
  toolName: string,
  extra: McpRequestExtra | undefined,
  options: RequestIdentityResolverOptions
) {
  const context = resolveRequestIdentityContext(extra, options);

  if (options.mode === 'strict') {
    const strictResult = validateStrictIdentityClaims(context);
    if (!strictResult.valid) {
      throw new Error(
        `Strict identity mode rejected ${toolName} request: ${strictResult.message ?? 'Missing strict identity claims.'}`
      );
    }
  }

  if (options.mode === 'locked') {
    const lockedResult = validateLockedIdentityContext(context);
    if (!lockedResult.valid) {
      throw new Error(
        `Locked identity mode rejected ${toolName} request: ${lockedResult.message ?? 'Invalid locked identity context.'}`
      );
    }
  }

  return context;
}

function toResolverOptions(config: IdentityConfig): RequestIdentityResolverOptions {
  return {
    mode: config.mode,
    allowPerRequestOverride: config.allowPerRequestOverride ?? true,
    launchDefaults: config.launchDefaults,
    transportMode: 'stdio',
  };
}

function applyLaunchProfile(
  config: IdentityConfig,
  launchDefaults: IdentityLaunchDefaults,
  mode: IdentityConfig['mode']
): RequestIdentityResolverOptions {
  return {
    ...toResolverOptions(config),
    mode,
    launchDefaults,
  };
}

describe('MCP identity boundary enforcement', () => {
  test('rejects default fallback in strict mode before tool execution', () => {
    const identityConfig: IdentityConfig = {
      mode: 'strict',
      allowPerRequestOverride: true,
      launchDefaults: {},
    };

    expect(() =>
      resolveOrRejectToolRequest('system_control', undefined, toResolverOptions(identityConfig))
    ).toThrow('Strict identity mode rejected system_control request');
  });

  test('rejects request-scope override in locked mode', () => {
    const identityConfig: IdentityConfig = {
      mode: 'locked',
      allowPerRequestOverride: false,
      launchDefaults: {
        organizationId: 'org-launch',
        workspaceId: 'workspace-launch',
      },
    };

    expect(() =>
      resolveOrRejectToolRequest(
        'prompt_engine',
        {
          http: {
            authInfo: {
              extra: {
                organizationId: 'org-request',
                workspaceId: 'workspace-request',
              },
            },
          },
        },
        toResolverOptions(identityConfig)
      )
    ).toThrow('Locked identity mode rejected prompt_engine request');
  });

  test('rejects locked mode when launch defaults are missing', () => {
    const identityConfig: IdentityConfig = {
      mode: 'locked',
      allowPerRequestOverride: false,
      launchDefaults: {},
    };

    expect(() =>
      resolveOrRejectToolRequest('resource_manager', undefined, toResolverOptions(identityConfig))
    ).toThrow('Locked identity mode rejected resource_manager request');
  });

  test('accepts launch defaults in strict mode', () => {
    const identityConfig: IdentityConfig = {
      mode: 'strict',
      allowPerRequestOverride: false,
      launchDefaults: {
        organizationId: 'org-launch',
        workspaceId: 'workspace-launch',
      },
    };

    const context = resolveOrRejectToolRequest(
      'system_control',
      undefined,
      toResolverOptions(identityConfig)
    );

    expect(context.organizationId).toBe('org-launch');
    expect(context.workspaceId).toBe('workspace-launch');
    expect(context.continuityScopeId).toBe('workspace-launch');
    expect(context.identitySource).toBe('launch-default');
  });

  test('launch profile overrides config identity policy at boundary', () => {
    const configIdentity: IdentityConfig = {
      mode: 'permissive',
      allowPerRequestOverride: true,
      launchDefaults: {},
    };

    const launchProfileOptions = applyLaunchProfile(
      configIdentity,
      {
        organizationId: 'org-launch',
        workspaceId: 'workspace-launch',
      },
      'locked'
    );

    expect(() =>
      resolveOrRejectToolRequest(
        'system_control',
        {
          http: {
            authInfo: {
              extra: {
                organizationId: 'org-request',
                workspaceId: 'workspace-request',
              },
            },
          },
        },
        launchProfileOptions
      )
    ).toThrow('Locked identity mode rejected system_control request');
  });
});
