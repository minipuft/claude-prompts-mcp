// @lifecycle canonical - Shared context for prompt resource services.

import { VersionHistoryService } from '../../../../versioning/index.js';

import type { PromptResourceData, PromptResourceDependencies } from './types.js';
import type { ComparisonEngine } from '../analysis/comparison-engine.js';
import type { GateAnalyzer } from '../analysis/gate-analyzer.js';
import type { PromptAnalyzer } from '../analysis/prompt-analyzer.js';
import type { TextDiffService } from '../analysis/text-diff-service.js';
import type { FileOperations } from '../operations/file-operations.js';
import type { FilterParser } from '../search/filter-parser.js';
import type { PromptMatcher } from '../search/prompt-matcher.js';

export interface PromptResourceContext {
  dependencies: PromptResourceDependencies;
  promptAnalyzer: PromptAnalyzer;
  comparisonEngine: ComparisonEngine;
  gateAnalyzer: GateAnalyzer;
  textDiffService: TextDiffService;
  filterParser: FilterParser;
  promptMatcher: PromptMatcher;
  fileOperations: FileOperations;
  versionHistoryService: VersionHistoryService;
  getData: () => PromptResourceData;
}
