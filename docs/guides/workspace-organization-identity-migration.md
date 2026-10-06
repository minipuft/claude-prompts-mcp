# Workspace + Organization Identity Migration

## Scope

This guide records the completed legacy-identity -> `workspaceId`/`organizationId` migration.

Canonical behavior:

- Writes persist canonical identity fields (`workspace_id`, `organization_id`).
- Continuity scope precedence is `workspaceId -> organizationId -> default`.
- `tenant_id` remains a storage column for state table keys, but the legacy alias is not part of request identity contracts.

## Rollout + Removal Timeline

- Compatibility window: two release cycles after canonical identity rollout.
- Alias removal date: 2026-02-14.
- Phase 8 status: legacy alias removed from request identity contracts, resolver outputs, and tool/state public scope APIs.
- New code should pass `continuityScopeId`/`workspaceId`/`organizationId`.
