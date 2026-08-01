// @lifecycle canonical - Shared context for gate resource services.

import type { GateManager } from '#engine/gates/gate-manager.js';
import type { VersionHistoryService } from '#modules/versioning/index.js';
import type { ConfigManager, Logger } from '#shared/types/index.js';
import type { ObjectDiffGenerator } from '../../resource-manager/prompt/analysis/object-diff-generator.js';
import type { GateFileWriter } from '../services/gate-file-writer.js';

export interface GateResourceContext {
  logger: Logger;
  gateManager: GateManager;
  configManager: ConfigManager;
  textDiffService: ObjectDiffGenerator;
  versionHistoryService: VersionHistoryService;
  gateFileService: GateFileWriter;
  onRefresh?: () => Promise<void>;
}
