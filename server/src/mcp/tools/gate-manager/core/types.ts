// @lifecycle canonical - Types for gate manager MCP tool.
/**
 * Gate Manager Types
 */

import type { GateManager } from '#engine/gates/gate-manager.js';
import type { ConfigManager, Logger } from '#shared/types/index.js';

/**
 * Gate manager action identifiers
 */
export type GateManagerActionId =
  | 'create'
  | 'update'
  | 'delete'
  | 'list'
  | 'inspect'
  | 'preview'
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
  /**
   * Severity for prioritization. Reaches `gate.yaml` through `PRESERVED_GATE_YAML_KEYS`:
   * supplied here it is written, omitted it is carried forward from the existing file, so an
   * update never silently resets a hand-authored value to the loader default.
   */
  severity?: 'critical' | 'high' | 'medium' | 'low';
  /** Enforcement mode override; absent, the loader derives it from `severity`. */
  enforcementMode?: 'blocking' | 'advisory' | 'informational';
  description?: string;
  /**
   * Free kebab-case tag naming what this gate reminds about (e.g. `code-quality`). An
   * installation's `gates.harnessCovers` (config.json) suppresses reminders whose subject
   * it lists; checks (`shell_verify`/`script_tool`) are never suppressed.
   */
  subject?: string;
  guidance?: string;
  /**
   * min_length/required_patterns/keyword_count/regex_patterns are deliberately not
   * declared — they never had an evaluator (B9) and are refused at load; a `shell_verify`
   * or `script_tool` criterion, or a reminder line in `guidance`, is what enforces instead.
   */
  pass_criteria?: Array<{
    type?: string;
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
  /**
   * What `action: 'preview'` would do.
   *
   * A gate preview targets `delete` or `rollback` — the two that touch files or the version table.
   * `update` is deliberately not previewable here: no gate update path ever read the old `dry_run`,
   * so accepting it would perform the update. The router refuses it by name.
   */
  preview_action?: 'delete' | 'rollback';
  /** Workspace whose version history to READ. Honoured by `history`/`compare`; the router
   * refuses it on `rollback`. */
  source_workspace?: string;
  reason?: string;
  /** Skip automatic version saving for this update */
  skip_version?: boolean;
  /** Optional description for the version entry */
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
  /**
   * Keys `GateFileWriter` builds no value for, carried here under their gate.yaml spelling so
   * `resolvePreservedGateYamlFields` finds a supplied value by the same name it preserves.
   * Until P4.4 nothing populated these, and that resolver's supplied-value branch was
   * unreachable — it is the settable half of a preservation mechanism that already existed.
   */
  severity?: GateManagerInput['severity'];
  enforcementMode?: GateManagerInput['enforcementMode'];
  /** Same class as `severity`/`enforcementMode` above — settable half of `PRESERVED_GATE_YAML_KEYS`. */
  subject?: GateManagerInput['subject'];
}
