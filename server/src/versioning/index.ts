// @lifecycle canonical - Barrel export for versioning module

export { VersionHistoryService } from './version-history-service.js';
export type { VersioningConfigProvider } from './version-history-service.js';
export type {
  VersioningConfig,
  VersionEntry,
  HistoryFile,
  SaveVersionResult,
  RollbackResult,
  SaveVersionOptions,
} from './types.js';
export { DEFAULT_VERSIONING_CONFIG } from './types.js';
