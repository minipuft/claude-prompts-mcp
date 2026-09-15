// @lifecycle canonical - Core gate guide interface and related type definitions.
/**
 * Gate Guide Type Definitions
 *
 * Contains the GateGuide interface and related types for the registry-based
 * gate system architecture. This mirrors the FrameworkGuide pattern from
 * the framework system while being tailored for gate-specific functionality.
 *
 * Key differences from FrameworkGuide:
 * - No dynamic tool descriptions (gates don't modify MCP tool descriptions)
 * - No judge prompt system (gate selection remains activation-rule based)
 * - Simpler interface focused on guidance and validation
 */

import type { GateEnforcementMode, GatePassCriteria, GateSeverity } from './gate-primitives.js';
import type { GateDefinitionYaml } from '../core/gate-schema.js';
import type { ArtifactKind } from '../utils/artifact-kinds.js';

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
  /**
   * Artifact kinds this gate checks (ruling B13). When present, artifacts decide activation and
   * `prompt_categories` is ignored — categories stay the fallback for gates naming no artifact.
   */
  artifacts?: ArtifactKind[];
}

/**
 * Context provided when checking if a gate should be activated.
 * Used by GateGuide.isActive() to determine activation.
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
  /**
   * Artifact kinds this run declares (ruling B13), from the prompt's `artifacts.produces` unioned
   * with the kinds classified out of the argument its `artifacts.fromArgument` names. Empty or
   * absent means the run declared nothing, so every artifact-gated gate stays off.
   */
  artifacts?: readonly ArtifactKind[];
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
 * YAML-based gate definition structure — the shape of a `gate.yaml` in `resources/gates/{id}/`.
 *
 * Re-exported, not re-declared. `GateDefinitionSchema` (`../core/gate-schema.js`) is the one
 * source: it is what the loader validates against and what the gate-manager's key derivation
 * walks, so a second hand-written interface here could only ever agree with it by hand — and
 * twice already did not, until `subject` (row 0.2) and the six pattern/length fields (row 1.5)
 * were each edited in both places. The import path stays `../types.js` for every consumer.
 *
 * It is the schema's INPUT side (`z.input`), which is what a consumer holds: the loader returns
 * the raw YAML object and validates beside it, so zod's defaults have not been applied. A key the
 * schema does not declare is `unknown` and reachable only via `definition['key']`, which is the
 * pressure that keeps a runtime-read key declared in the schema.
 */
export type { GateDefinitionYaml };

// ============================================================================
// GateGuide Interface
// ============================================================================

/**
 * Core interface for gate guides in the registry-based system.
 *
 * This interface mirrors FrameworkGuide's pattern but is tailored for gates:
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
 *   // For validation, use GateValidator.validateGate() instead
 * }
 * ```
 */
export interface GateGuide {
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
  guide: GateGuide;
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
  /**
   * Artifact kinds this run declares (B13), forwarded onto the activation context `selectGates`
   * builds. Absent means the caller could not say — never "no artifacts of any kind exist".
   */
  declaredArtifacts?: readonly ArtifactKind[];
}

/**
 * Result of a gate selection operation.
 */
export interface GateSelectionResult {
  /** Selected gate guides */
  guides: GateGuide[];
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
