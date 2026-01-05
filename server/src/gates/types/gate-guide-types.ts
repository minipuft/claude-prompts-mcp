// @lifecycle canonical - Core gate guide interface and related type definitions.
/**
 * Gate Guide Type Definitions
 *
 * Contains the IGateGuide interface and related types for the registry-based
 * gate system architecture. This mirrors the IMethodologyGuide pattern from
 * the framework system while being tailored for gate-specific functionality.
 *
 * Key differences from IMethodologyGuide:
 * - No dynamic tool descriptions (gates don't modify MCP tool descriptions)
 * - No judge prompt system (gate selection remains activation-rule based)
 * - Simpler interface focused on guidance and validation
 */

import type { ValidationResult } from '../../execution/types.js';
import type {
  GateEnforcementMode,
  GatePassCriteria,
  GateSeverity,
  ValidationContext,
} from '../types.js';

// ============================================================================
// Gate Activation Types
// ============================================================================

/**
 * Rules that determine when a gate should be activated.
 * Gates can be activated based on prompt categories, frameworks, or explicit requests.
 */
export interface GateActivationRules {
  /** Prompt categories that trigger this gate (e.g., ['code', 'documentation']) */
  prompt_categories?: string[];
  /** If true, gate only activates when explicitly requested */
  explicit_request?: boolean;
  /** Framework contexts that trigger this gate (e.g., ['CAGEERF', 'ReACT']) */
  framework_context?: string[];
}

/**
 * Context provided when checking if a gate should be activated.
 * Used by IGateGuide.isActive() to determine activation.
 */
export interface GateActivationContext {
  /** Current prompt category */
  promptCategory?: string;
  /** Currently active framework */
  framework?: string;
  /** Whether this gate was explicitly requested */
  explicitRequest?: boolean;
  /** Prompt ID for context-specific activation */
  promptId?: string;
}

// ============================================================================
// Gate Definition Types (YAML Schema)
// ============================================================================

/**
 * Retry configuration for validation gates.
 * All fields are optional with defaults applied at runtime.
 */
export interface GateRetryConfig {
  /** Maximum number of retry attempts (default: 2) */
  max_attempts?: number;
  /** Whether to provide improvement hints on retry (default: true) */
  improvement_hints?: boolean;
  /** Whether to preserve context between retries (default: true) */
  preserve_context?: boolean;
}

/**
 * YAML-based gate definition structure.
 * This is the schema for gate.yaml files in /server/gates/{id}/
 *
 * @example
 * ```yaml
 * id: code-quality
 * name: Code Quality Standards
 * type: validation
 * description: Ensures generated code follows best practices
 * severity: medium
 * gate_type: category
 * guidanceFile: guidance.md
 *
 * pass_criteria:
 *   - type: content_check
 *     min_length: 100
 *
 * activation:
 *   prompt_categories: [code, development]
 * ```
 */
export interface GateDefinitionYaml {
  /** Unique identifier for the gate (must match directory name) */
  id: string;
  /** Human-readable name */
  name: string;
  /** Gate type: 'validation' runs checks, 'guidance' only provides instructional text */
  type: 'validation' | 'guidance';
  /** Description of what this gate checks/guides */
  description: string;
  /** Severity level for prioritization */
  severity?: GateSeverity;
  /** Enforcement mode override (defaults to severity-based mapping) */
  enforcementMode?: GateEnforcementMode;
  /**
   * Gate type classification for dynamic identification.
   * - 'framework': Methodology-related gates, filtered when frameworks disabled
   * - 'category': Category-based gates (code, documentation, etc.)
   * - 'custom': User-defined custom gates
   */
  gate_type?: 'framework' | 'category' | 'custom';

  // File references (inlined by loader)
  /** Reference to guidance.md file (inlined into guidance field) */
  guidanceFile?: string;
  /** Guidance text (either directly specified or inlined from guidanceFile) */
  guidance?: string;

  // Validation configuration
  /** Pass/fail criteria for validation gates */
  pass_criteria?: GatePassCriteria[];
  /** Retry configuration for failed validations */
  retry_config?: GateRetryConfig;

  // Activation rules
  /** Rules determining when this gate should be activated */
  activation?: GateActivationRules;
}

// ============================================================================
// Gate Validation Result Types
// ============================================================================

/**
 * Result of a gate validation operation.
 * Extends the base ValidationResult with gate-specific information.
 */
export interface GateValidationResult extends ValidationResult {
  /** The gate ID that produced this result */
  gateId: string;
  /** Human-readable status message */
  message?: string;
  /** Validation score (0.0 to 1.0) */
  score?: number;
  /** Structured details from validation checks */
  details?: Record<string, unknown>;
  /** Hints for improving on retry */
  retryHints?: string[];
  /** Suggestions for improvement */
  suggestions?: string[];
  /** Whether the gate was skipped (e.g., not active for context) */
  skipped?: boolean;
  /** Reason for skipping, if applicable */
  skipReason?: string;
}

// ============================================================================
// IGateGuide Interface
// ============================================================================

/**
 * Core interface for gate guides in the registry-based system.
 *
 * This interface mirrors IMethodologyGuide's pattern but is tailored for gates:
 * - No getToolDescriptions() - gates don't modify MCP tool descriptions
 * - No getJudgePrompt() - gate selection uses activation rules, not LLM selection
 * - Focus on guidance rendering and validation
 *
 * Implementations:
 * - GenericGateGuide: Data-driven implementation from YAML definitions
 * - (Future) Custom gate guides can implement this interface directly
 *
 * @example
 * ```typescript
 * const guide = registry.getGuide('code-quality');
 * if (guide?.isActive({ promptCategory: 'code' })) {
 *   const guidance = guide.getGuidance();
 *   const result = await guide.validate(content, context);
 * }
 * ```
 */
export interface IGateGuide {
  // -------------------------------------------------------------------------
  // Identification (readonly properties)
  // -------------------------------------------------------------------------

  /** Unique gate identifier */
  readonly gateId: string;

  /** Human-readable gate name */
  readonly name: string;

  /** Gate type: 'validation' or 'guidance' */
  readonly type: 'validation' | 'guidance';

  /** Severity level (critical, high, medium, low) */
  readonly severity: GateSeverity;

  /** Enforcement mode (blocking, advisory, informational) */
  readonly enforcementMode: GateEnforcementMode;

  /** Gate classification (framework, category, custom) */
  readonly gateType: 'framework' | 'category' | 'custom';

  /** Gate description */
  readonly description: string;

  // -------------------------------------------------------------------------
  // Core Methods
  // -------------------------------------------------------------------------

  /**
   * Get the guidance text for this gate.
   * This text is injected into prompts to guide the LLM's output.
   *
   * @returns Guidance text (may be empty for validation-only gates)
   */
  getGuidance(): string;

  /**
   * Get the pass criteria for validation gates.
   * Returns empty array for guidance-only gates.
   *
   * @returns Array of pass criteria definitions
   */
  getPassCriteria(): GatePassCriteria[];

  /**
   * Get the activation rules for this gate.
   *
   * @returns Activation rules object
   */
  getActivationRules(): GateActivationRules;

  /**
   * Get the retry configuration for this gate.
   *
   * @returns Retry config or undefined if not configured
   */
  getRetryConfig(): GateRetryConfig | undefined;

  // -------------------------------------------------------------------------
  // Activation Methods
  // -------------------------------------------------------------------------

  /**
   * Check if this gate should be active for the given context.
   * Evaluates activation rules against the provided context.
   *
   * @param context - The context to check activation against
   * @returns true if the gate should be active
   */
  isActive(context: GateActivationContext): boolean;

  // -------------------------------------------------------------------------
  // Validation Methods
  // -------------------------------------------------------------------------

  /**
   * Validate content against this gate's criteria.
   * Only meaningful for validation-type gates.
   *
   * @param content - The content to validate
   * @param context - Additional validation context
   * @returns Validation result with pass/fail status and details
   */
  validate(content: string, context: ValidationContext): Promise<GateValidationResult>;

  // -------------------------------------------------------------------------
  // Introspection Methods
  // -------------------------------------------------------------------------

  /**
   * Get the underlying gate definition.
   * Useful for debugging and introspection.
   *
   * @returns The YAML definition that created this guide
   */
  getDefinition(): GateDefinitionYaml;
}

// ============================================================================
// Registry Types
// ============================================================================

/**
 * Source type for tracking how a gate guide was loaded.
 * - 'yaml-runtime': Loaded from YAML files at runtime
 * - 'custom': Programmatically registered custom gate
 * - 'temporary': Created via TemporaryGateRegistry for session scope
 */
export type GateSource = 'yaml-runtime' | 'custom' | 'temporary';

/**
 * Registry entry for a gate guide, including metadata.
 */
export interface GateGuideEntry {
  /** The gate guide instance */
  guide: IGateGuide;
  /** When this guide was registered */
  registeredAt: Date;
  /** Whether this is a built-in gate */
  isBuiltIn: boolean;
  /** Whether this gate is currently enabled */
  enabled: boolean;
  /** How this guide was loaded */
  source: GateSource;
  /** Additional metadata */
  metadata: {
    /** Time taken to load this gate (ms) */
    loadTime: number;
    /** Validation status from schema validation */
    validationStatus: 'passed' | 'failed' | 'not_validated';
    /** Last time this gate was accessed */
    lastUsed?: Date;
  };
}

/**
 * Statistics for the gate registry.
 */
export interface GateRegistryStats {
  /** Total number of registered gates */
  totalGates: number;
  /** Number of enabled gates */
  enabledGates: number;
  /** Number of built-in gates */
  builtInGates: number;
  /** Number of custom gates */
  customGates: number;
  /** Gates by source type */
  bySource: Record<GateSource, number>;
  /** Gates by type (validation vs guidance) */
  byType: Record<'validation' | 'guidance', number>;
  /** Average load time (ms) */
  averageLoadTime: number;
}

// ============================================================================
// Gate Selection Types
// ============================================================================

/**
 * Context for gate selection operations.
 */
export interface GateSelectionContext {
  /** Prompt category for category-based selection */
  promptCategory?: string;
  /** Active framework for framework-aware selection */
  framework?: string;
  /** Explicit gate IDs to always include */
  explicitGateIds?: readonly string[];
  /** Whether to include only enabled gates */
  enabledOnly?: boolean;
}

/**
 * Result of a gate selection operation.
 */
export interface GateSelectionResult {
  /** Selected gate guides */
  guides: IGateGuide[];
  /** Gate IDs that were selected */
  selectedIds: string[];
  /** Gates that were skipped (disabled or inactive) */
  skippedIds: string[];
  /** Selection metadata */
  metadata: {
    /** How selection was performed */
    selectionMethod: 'explicit' | 'category' | 'framework' | 'combined';
    /** Time taken for selection (ms) */
    selectionTime: number;
  };
}
