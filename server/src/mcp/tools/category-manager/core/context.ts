// @lifecycle canonical - Shared context for category resource services.

import type { VersionHistoryService } from '#modules/versioning/index.js';
import type { ConfigManager, Logger } from '#shared/types/index.js';
import type { ObjectDiffGenerator } from '../../resource-manager/prompt/analysis/object-diff-generator.js';
import type { CategoryFileWriter } from '../services/category-file-writer.js';

export interface CategoryResourceContext {
  logger: Logger;
  configManager: ConfigManager;
  textDiffService: ObjectDiffGenerator;
  versionHistoryService: VersionHistoryService;
  categoryFileService: CategoryFileWriter;
  onRefresh?: () => Promise<void>;
}
