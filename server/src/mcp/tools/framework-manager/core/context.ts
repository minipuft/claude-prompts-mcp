// @lifecycle canonical - Shared context for framework resource services.

import type { FrameworkManager } from '../../../../engine/frameworks/framework-manager.js';
import type { FrameworkStateStore } from '../../../../engine/frameworks/framework-state-store.js';
import type { VersionHistoryService } from '../../../../modules/versioning/index.js';
import type { ConfigManager, Logger } from '../../../../shared/types/index.js';
import type { ObjectDiffGenerator } from '../../resource-manager/prompt/analysis/object-diff-generator.js';
import type { FrameworkFileWriter } from '../services/framework-file-writer.js';

export interface FrameworkResourceContext {
  logger: Logger;
  frameworkManager: FrameworkManager;
  /** Mutable — set via late initialization after construction */
  frameworkStateStore?: FrameworkStateStore;
  configManager: ConfigManager;
  fileService: FrameworkFileWriter;
  textDiffService: ObjectDiffGenerator;
  versionHistoryService: VersionHistoryService;
  onRefresh?: () => Promise<void>;
  onToolsUpdate?: () => Promise<void>;
}
