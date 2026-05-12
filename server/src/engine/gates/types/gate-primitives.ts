// @lifecycle canonical - Leaf-level gate primitive types (no barrel imports).
/**
 * Gate Primitives
 *
 * Primitive type definitions extracted from gates/types.ts to break the
 * circular dependency: types.ts → types/index.ts → gate-guide-types.ts → types.ts.
 *
 * Both gates/types.ts and types/gate-guide-types.ts import from this leaf file
 * instead of from each other.
 *
 * IMPORTANT: This file must NOT import from ../types.ts or ./index.ts.
 */

/**
 * Gate enforcement mode determines behavior on validation failure.
 * - blocking: Execution pauses until gate criteria are met (default for critical)
 * - advisory: Logs warning but allows advancement (default for high/medium)
 * - informational: Logs only, no user impact (default for low)
 */
export type GateEnforcementMode = 'blocking' | 'advisory' | 'informational';

/**
 * Gate severity levels for prioritization
 */
export type GateSeverity = 'critical' | 'high' | 'medium' | 'low';

/**
 * Default mapping from severity to enforcement mode
 */
export const SEVERITY_TO_ENFORCEMENT: Record<GateSeverity, GateEnforcementMode> = {
  critical: 'blocking',
  high: 'advisory',
  medium: 'advisory',
  low: 'informational',
};

/**
 * Pass/fail criteria for validation (lightweight gate format)
 */
export interface GatePassCriteria {
  /**
   * Type of check to perform.
   *
   * Enforcement modes (see gate-schema.ts header for full taxonomy):
   * - `inline_guidance`: agent-facing self-assessment text (replaces former
   *   `content_check` and `pattern_check`; both were inert at runtime)
   * - `llm_self_check`: reserved, runner not yet implemented
   * - `methodology_compliance`: enforced by phase guards (stage 09b)
   * - `shell_verify`: exit-code ground truth (supports response injection)
   * - `script_tool`: registered script with JSON stdin
   */
  type:
    | 'inline_guidance'
    | 'llm_self_check'
    | 'methodology_compliance'
    | 'shell_verify'
    | 'script_tool';

  // Content check options
  min_length?: number;
  max_length?: number;
  required_patterns?: string[];
  forbidden_patterns?: string[];

  // Methodology compliance options
  methodology?: string;
  min_compliance_score?: number;
  severity?: 'warn' | 'fail';
  quality_indicators?: Record<
    string,
    {
      keywords?: string[];
      patterns?: string[];
    }
  >;

  // LLM self-check options
  prompt_template?: string;
  pass_threshold?: number;

  // Pattern check options
  regex_patterns?: string[];
  keyword_count?: { [keyword: string]: number };

  // Shell verification options (ground-truth validation via exit code)
  /** Shell command to execute for verification (exit 0 = pass) */
  shell_command?: string;
  /** Timeout in milliseconds for shell command (default: 300000) */
  shell_timeout?: number;
  /** Working directory for shell command execution */
  shell_working_dir?: string;
  /** Additional environment variables for shell command */
  shell_env?: Record<string, string>;
  /** Maximum verification attempts before escalation (default: 5) */
  shell_max_attempts?: number;
  /** Preset for shell verification (:fast, :full, :extended) */
  shell_preset?: 'fast' | 'full' | 'extended';
  /**
   * Inject the current execution's agent response into the shell command.
   * When set to 'agent_response', the response is piped to stdin (truncated
   * to SHELL_VERIFY_MAX_RESPONSE_BYTES). Scripts parse claims from stdin and
   * verify against ground truth (file existence, line counts, symbols).
   */
  shell_stdin_source?: 'agent_response';
  /**
   * Optional env var name to receive the agent response (mirror of stdin).
   * Only meaningful when `shell_stdin_source: 'agent_response'` is set.
   * Useful for scripts that need to re-read the response without buffering stdin.
   */
  shell_response_env_var?: string;

  // Script tool verification options (structured JSON pass/fail)
  /** Script or command to execute for verification */
  script_tool_id?: string;
  /** JSON input sent via stdin to the script */
  script_tool_input?: Record<string, unknown>;
  /** Timeout in milliseconds for script execution (default: 30000) */
  script_tool_timeout?: number;
  /** Working directory for script execution */
  script_tool_working_dir?: string;
}
