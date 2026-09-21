// @lifecycle canonical - Barrel export for versioning module

export { VersionHistoryService } from './version-history-service.js';
export type { VersioningConfigProvider } from './version-history-service.js';
export type { VersioningConfig } from '#shared/types/index.js';
export { DEFAULT_VERSIONING_CONFIG } from '#shared/types/index.js';
export type {
  VersionEntry,
  HistoryFile,
  SaveVersionResult,
  RollbackResult,
  SaveVersionOptions,
  ResourceType,
} from './types.js';
export type { SnapshotContract, RestoreResult } from './snapshot-contract.js';
export {
  missingRequiredFields,
  copyPresentFields,
  canonicalizeSnapshot,
  projectWriteModel,
  describeRollbackPreview,
  describeIncompleteSnapshot,
  describeVersionRecord,
  describeRollbackRecord,
} from './snapshot-contract.js';

// The per-resource-type projections: what a version row RECORDS for a gate, a framework and a
// category. Exported from the domain module rather than from the tool layer because `cpm` records
// versions too and `cli-shared/` may not import `mcp/` — one projection per resource type, read by
// both surfaces (R69).
export {
  GATE_SNAPSHOT_PROJECTED_KEYS,
  GATE_REQUIRED_SNAPSHOT_FIELDS,
  GATE_OPTIONAL_SNAPSHOT_FIELDS,
  projectGateSnapshot,
} from './projections/gate-snapshot.js';
export {
  FRAMEWORK_SNAPSHOT_PROJECTED_KEYS,
  FRAMEWORK_REQUIRED_SNAPSHOT_FIELDS,
  FRAMEWORK_OPTIONAL_SNAPSHOT_FIELDS,
  projectFrameworkSnapshot,
} from './projections/framework-snapshot.js';
export {
  CATEGORY_SNAPSHOT_PROJECTED_KEYS,
  CATEGORY_REQUIRED_SNAPSHOT_FIELDS,
  CATEGORY_OPTIONAL_SNAPSHOT_FIELDS,
  projectCategorySnapshot,
} from './projections/category-snapshot.js';
