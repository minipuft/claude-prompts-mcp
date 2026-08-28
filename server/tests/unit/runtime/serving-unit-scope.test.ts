import { describe, expect, test } from '@jest/globals';

import { resolveServingUnitScope } from '../../../src/runtime/serving-unit-scope.js';

/**
 * The advertised tool surface is built per serving unit, from workspace-scoped
 * state. If the scope it reads and the scope a client's toggle writes ever
 * disagree, the surface silently describes the wrong workspace: it would not
 * narrow for the client that asked, and a change to the default row would
 * reshape the surface for everyone.
 *
 * That failure is invisible at runtime — the schema is well-formed either way
 * — so the derivation is pinned here rather than left to the e2e path, whose
 * client resolves to the default scope and cannot distinguish the two.
 */

describe('resolveServingUnitScope', () => {
  test('returns undefined for STDIO, which sets neither field', () => {
    // `serveStdio` never populates authInfo or requestInfo, and serves one
    // workspace per process — the default scope is correct there.
    expect(resolveServingUnitScope({})).toBeUndefined();
  });

  test('returns undefined when no context is supplied at all', () => {
    expect(resolveServingUnitScope()).toBeUndefined();
    expect(resolveServingUnitScope(undefined)).toBeUndefined();
  });

  // Every expectation below carries `workspaceId` as well as `continuityScopeId` (2026-08-27).
  // The single-key shape these previously pinned is the truncation that
  // `sqlite-layer-remediation-2026-08-03` Tier 4.1 fixed at one site and missed here: stores keyed
  // on `resolveContinuityScopeId` never read `continuityScopeId`, so this scope resolved to the
  // `'default'` bucket and the advertised `inputSchema` never narrowed however the gate switch was
  // set. `organizationId` appears only where the organization claim was the source, because
  // `resolveRequestIdentity` already promotes it into `workspaceId`.

  test('derives the scope from a workspace auth claim', () => {
    const scope = resolveServingUnitScope({
      authInfo: { extra: { workspaceId: 'workspace-alpha' } },
    });

    expect(scope).toEqual({
      continuityScopeId: 'workspace-alpha',
      workspaceId: 'workspace-alpha',
    });
  });

  test('falls back to the organization claim when no workspace claim exists', () => {
    const scope = resolveServingUnitScope({
      authInfo: { extra: { organizationId: 'org-beta' } },
    });

    expect(scope).toEqual({
      continuityScopeId: 'org-beta',
      workspaceId: 'org-beta',
      organizationId: 'org-beta',
    });
  });

  test('prefers the workspace claim over the organization claim', () => {
    const scope = resolveServingUnitScope({
      authInfo: { extra: { organizationId: 'org-beta', workspaceId: 'workspace-alpha' } },
    });

    expect(scope).toEqual({
      continuityScopeId: 'workspace-alpha',
      workspaceId: 'workspace-alpha',
      organizationId: 'org-beta',
    });
  });

  test('reads a workspace id carried as an HTTP header', () => {
    // `Request.headers` is a `Headers` instance: iterable, but with no
    // enumerable own properties. Treating it as a plain object yields an empty
    // record and silently loses the scope, so the conversion is asserted.
    const headers = new Headers({ 'x-workspace-id': 'workspace-from-header' });

    const scope = resolveServingUnitScope({ requestInfo: { headers } });

    expect(scope).toEqual({
      continuityScopeId: 'workspace-from-header',
      workspaceId: 'workspace-from-header',
    });
  });

  test('accepts plain-object headers as well as a Headers instance', () => {
    const scope = resolveServingUnitScope({
      requestInfo: { headers: { 'x-workspace-id': 'workspace-plain' } },
    });

    expect(scope).toEqual({
      continuityScopeId: 'workspace-plain',
      workspaceId: 'workspace-plain',
    });
  });

  test('returns undefined when the resolved scope is the default', () => {
    // `undefined` means "process default" everywhere else in this codebase.
    // Passing `{continuityScopeId: 'default'}` explicitly would be a different
    // key, so the default has to collapse back to undefined here.
    const scope = resolveServingUnitScope({
      authInfo: { extra: { workspaceId: 'default' } },
    });

    expect(scope).toBeUndefined();
  });

  test('two different workspaces resolve to two different scopes', () => {
    // The property that makes the surface per-workspace rather than global.
    const alpha = resolveServingUnitScope({ authInfo: { extra: { workspaceId: 'alpha' } } });
    const beta = resolveServingUnitScope({ authInfo: { extra: { workspaceId: 'beta' } } });

    expect(alpha).not.toEqual(beta);
  });
});
