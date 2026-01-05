// @lifecycle canonical - Types for gate manager MCP tool.
/**
 * Gate Manager Types
 */

import type { ConfigManager } from '../../../config/index.js';
import type { GateManager } from '../../../gates/gate-manager.js';
import type { Logger } from '../../../logging/index.js';

/**
 * Gate manager action identifiers
 */
export type GateManagerActionId =
  | 'create'
  | 'update'
  | 'delete'
  | 'list'
  | 'inspect'
  | 'reload'
  | 'history'
  | 'rollback'
  | 'compare';

/**
 * Gate manager input parameters
 */
export interface GateManagerInput {
  action: GateManagerActionId;
  id?: string;
  name?: string;
  type?: 'validation' | 'guidance';
  description?: string;
  guidance?: string;
  pass_criteria?: Array<{
    type?: string;
    min_length?: number;
    required_patterns?: string[];
    keyword_count?: Record<string, number>;
    regex_patterns?: string[];
  }>;
  activation?: {
    prompt_categories?: string[];
    frameworks?: string[];
    explicit_request?: boolean;
  };
  retry_config?: {
    max_attempts?: number;
    improvement_hints?: boolean;
    preserve_context?: boolean;
  };
  enabled_only?: boolean;
  confirm?: boolean;
  reason?: string;
  /** Skip automatic version saving for this update */
  skip_version?: boolean;
  /** Optional description for the version entry */
  version_description?: string;
  /** Target version for rollback action */
  version?: number;
  /** Starting version for compare action */
  from_version?: number;
  /** Ending version for compare action */
  to_version?: number;
  /** Maximum number of versions to show in history */
  limit?: number;
}

/**
 * Dependencies for gate manager
 */
export interface GateManagerDependencies {
  logger: Logger;
  gateManager: GateManager;
  configManager: ConfigManager;
  onRefresh?: () => Promise<void>;
}

/**
 * Gate creation data
 */
export interface GateCreationData {
  id: string;
  name: string;
  type: 'validation' | 'guidance';
  description: string;
  guidance: string;
  pass_criteria?: GateManagerInput['pass_criteria'];
  activation?: GateManagerInput['activation'];
  retry_config?: GateManagerInput['retry_config'];
}
