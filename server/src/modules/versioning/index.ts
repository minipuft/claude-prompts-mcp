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
} from './snapshot-contract.js';
