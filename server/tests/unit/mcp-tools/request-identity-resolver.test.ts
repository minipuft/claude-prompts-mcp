import { describe, expect, test } from '@jest/globals';

import {
  resolveRequestIdentity,
  resolveRequestIdentityContext,
  toIdentityContext,
  validateLockedIdentityContext,
  validateStrictIdentityClaims,
} from '../../../src/shared/utils/request-identity-resolver.js';

import type { McpRequestExtra } from '../../../src/shared/utils/request-identity-resolver.js';

/**
 * The handler context the SDK v2 builds for one Streamable HTTP request: the request itself at
 * `http.req` and validated auth at `http.authInfo`. The headers go through a real `Request`, so
 * the resolver reads a web `Headers` object exactly as it does in production — a plain-object
 * fixture passes against a shape the SDK never produces, which is how header scoping broke
 * unnoticed when the SDK moved these fields.
 */
function httpExtra(parts: {
  headers?: Record<string, string>;
  authInfo?: { extra?: Record<string, unknown>; sub?: string };
  sessionId?: string;
}): McpRequestExtra {
  return {
    http: {
      ...(parts.authInfo != null ? { authInfo: parts.authInfo } : {}),
      ...(parts.headers != null
        ? { req: new Request('http://localhost/mcp', { method: 'POST', headers: parts.headers }) }
        : {}),
    },
    ...(parts.sessionId != null ? { sessionId: parts.sessionId } : {}),
  };
}

const UNKNOWN_CLIENT_PROFILE = {
  clientFamily: 'unknown',
  clientId: 'unknown',
  clientVersion: 'unknown',
  delegationProfile: 'neutral_v1',
};

describe('resolveRequestIdentity', () => {
  test('returns default identity when request extra is missing', () => {
    expect(resolveRequestIdentity(undefined)).toEqual({
      organizationId: 'default',
      workspaceId: 'default',
      identitySource: 'default',
      clientProfile: UNKNOWN_CLIENT_PROFILE,
    });
  });

  test('extracts organization/workspace/actor from token claims', () => {
    const extra = httpExtra({
      authInfo: {
        extra: {
          organizationId: 'org-acme',
          workspaceId: 'workspace-core',
          actorId: 'user-42',
        },
      },
      sessionId: 'transport-sess-1',
    });

    expect(resolveRequestIdentity(extra)).toEqual({
      organizationId: 'org-acme',
      workspaceId: 'workspace-core',
      actorId: 'user-42',
      transportSessionId: 'transport-sess-1',
      identitySource: 'token',
      clientProfile: UNKNOWN_CLIENT_PROFILE,
    });
  });

  test('derives workspace from organization claim when workspace claim is absent', () => {
    const extra = httpExtra({
      authInfo: {
        extra: {
          organizationId: 'org-shared',
        },
      },
    });

    expect(resolveRequestIdentity(extra)).toEqual({
      organizationId: 'org-shared',
      workspaceId: 'org-shared',
      identitySource: 'token',
      clientProfile: UNKNOWN_CLIENT_PROFILE,
    });
  });

  test('falls back to header claims when token claims are missing', () => {
    const extra = httpExtra({
      headers: {
        'x-organization-id': 'org-header',
        'x-workspace-id': 'workspace-header',
        'x-user-id': 'actor-header',
        'mcp-session-id': 'sess-header',
      },
    });

    expect(resolveRequestIdentity(extra)).toEqual({
      organizationId: 'org-header',
      workspaceId: 'workspace-header',
      actorId: 'actor-header',
      transportSessionId: 'sess-header',
      identitySource: 'header',
      clientProfile: UNKNOWN_CLIENT_PROFILE,
    });
  });

  test('uses token claims over conflicting header claims', () => {
    const extra = httpExtra({
      authInfo: {
        extra: {
          organizationId: 'org-token',
          workspaceId: 'workspace-token',
        },
      },
      headers: {
        'x-organization-id': 'org-header',
        'x-workspace-id': 'workspace-header',
      },
    });

    expect(resolveRequestIdentity(extra)).toEqual({
      organizationId: 'org-token',
      workspaceId: 'workspace-token',
      identitySource: 'token',
      clientProfile: UNKNOWN_CLIENT_PROFILE,
    });
  });

  test('uses authInfo.sub as actor fallback', () => {
    const extra = httpExtra({
      authInfo: {
        sub: 'subject-99',
        extra: {
          organizationId: 'org-subject',
        },
      },
    });

    expect(resolveRequestIdentity(extra)).toEqual({
      organizationId: 'org-subject',
      workspaceId: 'org-subject',
      actorId: 'subject-99',
      identitySource: 'token',
      clientProfile: UNKNOWN_CLIENT_PROFILE,
    });
  });
});

describe('toIdentityContext', () => {
  test('builds flattened canonical context', () => {
    const context = toIdentityContext({
      organizationId: 'org-a',
      workspaceId: 'workspace-a',
      actorId: 'actor-a',
      transportSessionId: 'session-a',
      identitySource: 'token',
    });

    expect(context).toMatchObject({
      identity: {
        organizationId: 'org-a',
        workspaceId: 'workspace-a',
        actorId: 'actor-a',
        transportSessionId: 'session-a',
        identitySource: 'token',
      },
      organizationId: 'org-a',
      workspaceId: 'workspace-a',
      continuityScopeId: 'workspace-a',
      actorId: 'actor-a',
      transportSessionId: 'session-a',
      identitySource: 'token',
      organizationSource: 'token',
      workspaceSource: 'token',
    });
    expect(context.provenance).toBeDefined();
  });

  test('sets continuity scope to workspace first and organization fallback', () => {
    const workspaceContext = toIdentityContext({
      organizationId: 'org-a',
      workspaceId: 'workspace-a',
      identitySource: 'token',
    });
    expect(workspaceContext.continuityScopeId).toBe('workspace-a');

    const organizationFallbackContext = toIdentityContext({
      organizationId: 'org-b',
      workspaceId: 'org-b',
      identitySource: 'header',
    });
    expect(organizationFallbackContext.continuityScopeId).toBe('org-b');
  });
});

describe('resolveRequestIdentityContext', () => {
  test('stdio prefers launch defaults over per-request claims', () => {
    const context = resolveRequestIdentityContext(
      httpExtra({
        authInfo: {
          extra: {
            organizationId: 'org-request',
            workspaceId: 'workspace-request',
          },
        },
      }),
      {
        mode: 'permissive',
        allowPerRequestOverride: true,
        launchDefaults: {
          organizationId: 'org-launch',
          workspaceId: 'workspace-launch',
        },
        transportMode: 'stdio',
      }
    );

    expect(context.organizationId).toBe('org-launch');
    expect(context.workspaceId).toBe('workspace-launch');
    expect(context.identitySource).toBe('launch-default');
    expect(context.provenance?.transport).toBe('stdio');
  });

  test('stdio can use request claims when launch defaults are absent', () => {
    const context = resolveRequestIdentityContext(
      httpExtra({
        authInfo: {
          extra: {
            organizationId: 'org-request',
            workspaceId: 'workspace-request',
          },
        },
      }),
      {
        mode: 'permissive',
        allowPerRequestOverride: true,
        transportMode: 'stdio',
      }
    );

    expect(context.organizationId).toBe('org-request');
    expect(context.workspaceId).toBe('workspace-request');
    expect(context.identitySource).toBe('token');
  });

  test('http prefers request claims over launch defaults', () => {
    const context = resolveRequestIdentityContext(
      httpExtra({
        headers: {
          'x-organization-id': 'org-header',
          'x-workspace-id': 'workspace-header',
        },
      }),
      {
        mode: 'permissive',
        allowPerRequestOverride: true,
        launchDefaults: {
          organizationId: 'org-launch',
          workspaceId: 'workspace-launch',
        },
        transportMode: 'streamable-http',
      }
    );

    expect(context.organizationId).toBe('org-header');
    expect(context.workspaceId).toBe('workspace-header');
    expect(context.identitySource).toBe('header');
    expect(context.provenance?.transport).toBe('http');
  });

  test('http uses launch defaults when per-request overrides are disabled', () => {
    const context = resolveRequestIdentityContext(
      httpExtra({
        headers: {
          'x-organization-id': 'org-header',
          'x-workspace-id': 'workspace-header',
        },
      }),
      {
        mode: 'permissive',
        allowPerRequestOverride: false,
        launchDefaults: {
          organizationId: 'org-launch',
          workspaceId: 'workspace-launch',
        },
        transportMode: 'streamable-http',
      }
    );

    expect(context.organizationId).toBe('org-launch');
    expect(context.workspaceId).toBe('workspace-launch');
    expect(context.identitySource).toBe('launch-default');
    expect(context.provenance?.transport).toBe('http');
  });

  test('transport=both resolves stdio precedence when no headers are present', () => {
    const context = resolveRequestIdentityContext(
      httpExtra({
        authInfo: {
          extra: {
            organizationId: 'org-request',
            workspaceId: 'workspace-request',
          },
        },
      }),
      {
        mode: 'permissive',
        allowPerRequestOverride: true,
        launchDefaults: {
          organizationId: 'org-launch',
          workspaceId: 'workspace-launch',
        },
        transportMode: 'both',
      }
    );

    expect(context.organizationId).toBe('org-launch');
    expect(context.workspaceId).toBe('workspace-launch');
    expect(context.identitySource).toBe('launch-default');
    expect(context.provenance?.transport).toBe('stdio');
  });

  test('transport=both resolves http precedence when request headers are present', () => {
    const context = resolveRequestIdentityContext(
      httpExtra({
        headers: {
          'x-organization-id': 'org-header',
          'x-workspace-id': 'workspace-header',
        },
      }),
      {
        mode: 'permissive',
        allowPerRequestOverride: true,
        launchDefaults: {
          organizationId: 'org-launch',
          workspaceId: 'workspace-launch',
        },
        transportMode: 'both',
      }
    );

    expect(context.organizationId).toBe('org-header');
    expect(context.workspaceId).toBe('workspace-header');
    expect(context.identitySource).toBe('header');
    expect(context.provenance?.transport).toBe('http');
  });

  test('locked mode binds to launch defaults and flags override attempts', () => {
    const context = resolveRequestIdentityContext(
      httpExtra({
        authInfo: {
          extra: {
            organizationId: 'org-request',
            workspaceId: 'workspace-request',
          },
        },
      }),
      {
        mode: 'locked',
        allowPerRequestOverride: false,
        launchDefaults: {
          organizationId: 'org-launch',
          workspaceId: 'workspace-launch',
        },
        transportMode: 'stdio',
      }
    );

    expect(context.organizationId).toBe('org-launch');
    expect(context.workspaceId).toBe('workspace-launch');
    expect(context.identitySource).toBe('launch-default');
    expect(context.provenance?.overrideAttempted).toBe(true);
  });

  test('client profile prefers launch defaults over trusted metadata and request hint', () => {
    const context = resolveRequestIdentityContext(
      httpExtra({
        authInfo: {
          extra: {
            clientFamily: 'codex',
            clientId: 'codex-from-token',
            delegationProfile: 'spawn_agent_v1',
          },
        },
        headers: {
          'x-client-family': 'codex',
          'x-client-id': 'codex-from-header',
        },
      }),
      {
        mode: 'permissive',
        allowPerRequestOverride: true,
        launchDefaults: {
          clientFamily: 'claude-code',
          clientId: 'claude-launch',
          delegationProfile: 'task_tool_v1',
        },
        requestClientProfileHint: {
          clientFamily: 'unknown',
          delegationProfile: 'neutral_v1',
        },
      }
    );

    expect(context.clientProfile).toMatchObject({
      clientFamily: 'claude-code',
      clientId: 'claude-launch',
      delegationProfile: 'task_tool_v1',
    });
    expect(context.provenance?.clientProfileSource).toBe('launch-default');
  });

  test('client profile uses trusted request metadata when launch defaults are absent', () => {
    const context = resolveRequestIdentityContext(
      httpExtra({
        authInfo: {
          extra: {
            clientFamily: 'codex',
            clientId: 'codex-auth',
            clientVersion: '1.2.3',
          },
        },
      }),
      {
        mode: 'permissive',
        allowPerRequestOverride: true,
      }
    );

    expect(context.clientProfile).toMatchObject({
      clientFamily: 'codex',
      clientId: 'codex-auth',
      clientVersion: '1.2.3',
      delegationProfile: 'spawn_agent_v1',
    });
    expect(context.provenance?.clientProfileSource).toBe('trusted-request');
  });

  test('client profile uses request hint when trusted metadata is unavailable', () => {
    const context = resolveRequestIdentityContext(undefined, {
      mode: 'permissive',
      allowPerRequestOverride: true,
      requestClientProfileHint: {
        clientFamily: 'codex',
        clientId: 'codex-hint',
        delegationProfile: 'spawn_agent_v1',
      },
    });

    expect(context.clientProfile).toMatchObject({
      clientFamily: 'codex',
      clientId: 'codex-hint',
      delegationProfile: 'spawn_agent_v1',
    });
    expect(context.provenance?.clientProfileSource).toBe('request-hint');
  });

  test('client profile falls back to clientInfo heuristic, then unknown default', () => {
    const heuristic = resolveRequestIdentityContext(
      {
        clientInfo: {
          name: 'Claude Code',
          version: '0.9.1',
        },
      },
      {
        mode: 'permissive',
        allowPerRequestOverride: true,
      }
    );

    expect(heuristic.clientProfile).toMatchObject({
      clientFamily: 'claude-code',
      clientId: 'Claude Code',
      clientVersion: '0.9.1',
      delegationProfile: 'task_tool_v1',
    });
    expect(heuristic.provenance?.clientProfileSource).toBe('client-info');

    const unknown = resolveRequestIdentityContext(undefined, {
      mode: 'permissive',
      allowPerRequestOverride: true,
    });
    expect(unknown.clientProfile).toEqual(UNKNOWN_CLIENT_PROFILE);
    expect(unknown.provenance?.clientProfileSource).toBe('default');
  });

  test('clientInfo heuristic maps gemini/cursor/opencode names to client families', () => {
    const gemini = resolveRequestIdentityContext(
      {
        clientInfo: {
          name: 'Gemini CLI',
          version: '1.1.0',
        },
      },
      {
        mode: 'permissive',
        allowPerRequestOverride: true,
      }
    );
    expect(gemini.clientProfile).toMatchObject({
      clientFamily: 'gemini',
      delegationProfile: 'gemini_subagent_v1',
    });

    const cursor = resolveRequestIdentityContext(
      {
        clientInfo: {
          name: 'Cursor',
          version: '0.5.0',
        },
      },
      {
        mode: 'permissive',
        allowPerRequestOverride: true,
      }
    );
    expect(cursor.clientProfile).toMatchObject({
      clientFamily: 'cursor',
      delegationProfile: 'cursor_agent_v1',
    });

    const opencode = resolveRequestIdentityContext(
      {
        clientInfo: {
          name: 'OpenCode',
          version: '0.8.0',
        },
      },
      {
        mode: 'permissive',
        allowPerRequestOverride: true,
      }
    );
    expect(opencode.clientProfile).toMatchObject({
      clientFamily: 'opencode',
      delegationProfile: 'opencode_agent_v1',
    });
  });
});

describe('validateStrictIdentityClaims', () => {
  test('accepts identity with non-default organization/workspace claims', () => {
    const result = validateStrictIdentityClaims({
      organizationId: 'org-acme',
      workspaceId: 'workspace-acme',
      identitySource: 'token',
    });

    expect(result).toEqual({
      valid: true,
      missingClaims: [],
    });
  });

  test('rejects default-fallback identity', () => {
    const result = validateStrictIdentityClaims({
      organizationId: 'default',
      workspaceId: 'default',
      identitySource: 'default',
    });

    expect(result.valid).toBe(false);
    expect(result.missingClaims).toEqual(['organizationId', 'workspaceId']);
    expect(result.message).toContain('Strict identity mode');
  });

  test('rejects organization-missing identity in strict mode', () => {
    const result = validateStrictIdentityClaims({
      workspaceId: 'workspace-legacy',
      identitySource: 'token',
    } as any);

    expect(result.valid).toBe(false);
    expect(result.missingClaims).toContain('organizationId');
  });

  test('accepts request identity context input shape', () => {
    const result = validateStrictIdentityClaims({
      identity: {
        organizationId: 'org-a',
        workspaceId: 'workspace-a',
        identitySource: 'header',
      },
      organizationId: 'org-a',
      workspaceId: 'workspace-a',
      continuityScopeId: 'workspace-a',
      identitySource: 'header',
      organizationSource: 'header',
    });

    expect(result.valid).toBe(true);
    expect(result.missingClaims).toEqual([]);
  });
});

describe('validateLockedIdentityContext', () => {
  test('fails when launch defaults are missing', () => {
    const context = resolveRequestIdentityContext(undefined, {
      mode: 'locked',
      allowPerRequestOverride: false,
      transportMode: 'stdio',
    });

    const validation = validateLockedIdentityContext(context);
    expect(validation.valid).toBe(false);
    expect(validation.reason).toBe('missing-launch-default');
  });

  test('passes when launch defaults are present and no override attempted', () => {
    const context = resolveRequestIdentityContext(undefined, {
      mode: 'locked',
      allowPerRequestOverride: false,
      launchDefaults: {
        organizationId: 'org-launch',
        workspaceId: 'workspace-launch',
      },
      transportMode: 'stdio',
    });

    const validation = validateLockedIdentityContext(context);
    expect(validation.valid).toBe(true);
  });
});
