# Dependency Updates Plan

Tracking progress on Renovate bot dependency updates from [Issue #16](https://github.com/minipuft/claude-prompts-mcp/issues/16).

**Created**: 2025-12-05
**Status**: In Progress

---

## Completed Updates

| Update | PR | Risk | Date | Notes |
|--------|-----|------|------|-------|
| actions/checkout v4 → v6 | #23 | Low | 2025-12-05 | GitHub Action |
| actions/github-script v7 → v8 | #24 | Low | 2025-12-05 | GitHub Action |
| sigstore/cosign-installer v3.3.0 → v3.10.1 | #25 | Low | 2025-12-05 | Patch update |
| actions/setup-node v4 → v6 | #26 | Low | 2025-12-05 | GitHub Action |
| docker/build-push-action v5 → v6 | #27 | Low | 2025-12-05 | GitHub Action |
| sigstore/cosign-installer v3 → v4 | #28 | Low | 2025-12-05 | GitHub Action major |
| Remove `@types/handlebars` | - | Low | 2025-12-05 | Deprecated, unused |
| Remove `handlebars` | - | Low | 2025-12-05 | Not directly used |

---

## Pending Updates

### Medium Risk (Require Testing)

#### [ ] Jest v29 → v30
- **Current**: `^29.7.0`
- **Target**: `v30.x`
- **Risk**: Medium - Major version, may have breaking changes in test APIs
- **Files affected**: `server/package.json`, test files
- **Pre-merge checklist**:
  - [ ] Review [Jest 30 changelog](https://jestjs.io/blog)
  - [ ] Run full test suite locally
  - [ ] Check for deprecated APIs in test files
  - [ ] Verify ts-jest compatibility

#### [ ] Node v24 (Engine Constraint)
- **Current**: `>=16`
- **Target**: `v24.x` engine requirement
- **Risk**: Medium - Updates engine constraint and @types/node
- **Files affected**: `server/package.json`
- **Pre-merge checklist**:
  - [ ] Verify CI runs on Node 18+ (current)
  - [ ] Check for Node 24-specific API usage
  - [ ] Review @types/node changes

---

### High Risk (Require Migration Work)

#### [ ] Express v4 → v5
- **Current**: `^4.18.2`
- **Target**: `v5.x`
- **Risk**: High - Significant API changes
- **Files affected**: `server/src/api/index.ts`, `server/src/server/`
- **Breaking changes to review**:
  - [ ] Async error handling changes
  - [ ] Router API changes
  - [ ] Middleware signature changes
  - [ ] Request/Response API changes
- **Pre-merge checklist**:
  - [ ] Read [Express 5 migration guide](https://expressjs.com/en/guide/migrating-5.html)
  - [ ] Audit all Express usage in codebase
  - [ ] Update error handling patterns
  - [ ] Test all API endpoints
  - [ ] Update @types/express

#### [ ] Zod v3 → v4
- **Current**: `^3.22.4`
- **Target**: `v4.x`
- **Risk**: High - Schema API changes
- **Files affected**: Multiple validation files across codebase
- **Breaking changes to review**:
  - [ ] Schema definition syntax changes
  - [ ] Error formatting changes
  - [ ] Inference type changes
  - [ ] Transform/refine API changes
- **Pre-merge checklist**:
  - [ ] Read Zod v4 migration guide
  - [ ] Audit all Zod schemas in codebase
  - [ ] Update schema definitions as needed
  - [ ] Verify generated types still work
  - [ ] Run full test suite

---

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2025-12-05 | Merged GitHub Action updates first | Low risk, no code changes |
| 2025-12-05 | Removed handlebars deps | Deprecated @types/handlebars, not directly used |
| 2025-12-05 | Deferred Express v5 | Requires migration work, high risk |
| 2025-12-05 | Deferred Zod v4 | Requires migration work, high risk |

---

## Notes

- **MCP Protocol Compliance workflow** fails due to pre-existing lint issues (6168 errors) - tracked separately in `plans/lint-fix/`
- Renovate Dashboard: https://github.com/minipuft/claude-prompts-mcp/issues/16
- Rate-limited updates can be triggered by checking boxes in the dashboard issue
