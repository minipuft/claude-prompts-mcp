// @lifecycle canonical - Coordinates gate hot reload between file watcher and registry
/**
 * Gate Hot Reload Coordinator
 *
 * Handles the integration between file system watching and gate registry,
 * enabling hot reload of gate definitions when YAML files change.
 *
 * @see MethodologyHotReloadCoordinator for the pattern this follows
 */

import { GateDefinitionLoader } from '../core/gate-definition-loader.js';
import { createGenericGateGuide } from '../registry/generic-gate-guide.js';

import type { Logger } from '../../logging/index.js';
import type { GateRegistry } from '../registry/gate-registry.js';
import type {
  GateActivationRules,
  GateDefinitionYaml,
  GateEnforcementMode,
  GatePassCriteria,
  GateRetryConfig,
} from '../types.js';

/**
 * File change operation types for hot reload events
 */
export type FileChangeOperation = 'added' | 'modified' | 'removed';

/**
 * Hot reload event for gates
 * Compatible with HotReloadManager's event structure
 */
export interface GateHotReloadEvent {
  type: 'gate_changed';
  reason: string;
  affectedFiles: string[];
  gateId?: string;
  /** The type of file change (added, modified, removed) */
  changeType?: FileChangeOperation;
  timestamp: number;
  requiresFullReload: boolean;
}

/**
 * Configuration for GateHotReloadCoordinator
 */
export interface GateHotReloadConfig {
  /** Enable debug logging */
  debug?: boolean;
  /** Reload timeout in ms */
  reloadTimeoutMs?: number;
  /** Optional callback invoked after successful gate reload (for cache invalidation) */
  onReload?: (gateId: string) => void;
}

/**
 * Statistics for hot reload operations
 */
export interface GateHotReloadStats {
  reloadsAttempted: number;
  reloadsSucceeded: number;
  reloadsFailed: number;
  lastReloadTime?: number;
  lastReloadedGate?: string;
}

/**
 * Result returned when creating a gate hot reload registration
 */
export interface GateHotReloadRegistration {
  /** Directories that should be watched for gate changes */
  directories: string[];
  /** Bound handler for use with HotReloadManager */
  handler: (event: GateHotReloadEvent) => Promise<void>;
  /** Coordinator instance handling cache clear + re-register */
  coordinator: GateHotReloadCoordinator;
}

/**
 * Gate Hot Reload Coordinator
 *
 * Coordinates between the file watching system and gate registry to
 * enable seamless hot reload of gate definitions.
 *
 * @example
 * ```typescript
 * const coordinator = new GateHotReloadCoordinator(logger, registry, loader);
 *
 * // Register with hot reload manager
 * hotReloadManager.setGateReloadCallback(
 *   (event) => coordinator.handleGateChange(event)
 * );
 * ```
 */
export class GateHotReloadCoordinator {
  private logger: Logger;
  private registry: GateRegistry;
  private loader: GateDefinitionLoader;
  private config: Required<Omit<GateHotReloadConfig, 'onReload'>> &
    Pick<GateHotReloadConfig, 'onReload'>;
  private stats: GateHotReloadStats;

  constructor(
    logger: Logger,
    registry: GateRegistry,
    loader?: GateDefinitionLoader,
    config: GateHotReloadConfig = {}
  ) {
    this.logger = logger;
    this.registry = registry;
    this.loader = loader ?? registry.getLoader();
    this.config = {
      debug: config.debug ?? false,
      reloadTimeoutMs: config.reloadTimeoutMs ?? 5000,
      ...(config.onReload ? { onReload: config.onReload } : {}),
    };
    this.stats = {
      reloadsAttempted: 0,
      reloadsSucceeded: 0,
      reloadsFailed: 0,
    };
  }

  /**
   * Handle a gate file change event
   *
   * For 'removed' events: unregisters the gate from the registry
   * For other events: reloads the definition from YAML and re-registers
   *
   * @param event - Hot reload event from the file watcher
   */
  async handleGateChange(event: GateHotReloadEvent): Promise<void> {
    this.stats.reloadsAttempted++;

    const gateId = event.gateId;
    if (!gateId) {
      this.logger.warn('Gate hot reload event missing gateId, skipping');
      this.stats.reloadsFailed++;
      return;
    }

    if (this.config.debug) {
      this.logger.debug(
        `Processing gate hot reload for: ${gateId} (changeType: ${event.changeType ?? 'unknown'})`
      );
    }

    // Handle deletion events
    if (event.changeType === 'removed') {
      return this.handleGateDeletion(gateId);
    }

    // Handle add/modify events
    return this.handleGateReload(gateId);
  }

  /**
   * Handle gate deletion - unregister from registry
   */
  private async handleGateDeletion(gateId: string): Promise<void> {
    try {
      // Step 1: Clear loader cache
      this.loader.clearCache(gateId);

      // Step 2: Unregister from registry
      const removed = this.registry.unregisterGuide(gateId);

      if (removed) {
        this.stats.reloadsSucceeded++;
        this.stats.lastReloadTime = Date.now();
        this.stats.lastReloadedGate = gateId;

        // Invoke reload callback for cache invalidation
        if (this.config.onReload) {
          try {
            this.config.onReload(gateId);
          } catch (callbackError) {
            this.logger.warn(`Gate reload callback failed for '${gateId}':`, callbackError);
          }
        }

        this.logger.info(`🗑️ Gate '${gateId}' unregistered (files deleted)`);
      } else {
        this.logger.debug(`Gate '${gateId}' was not registered, nothing to remove`);
        this.stats.reloadsSucceeded++; // Not a failure, just nothing to do
      }
    } catch (error) {
      this.stats.reloadsFailed++;
      this.logger.error(`Failed to unregister gate '${gateId}':`, error);
      throw error;
    }
  }

  /**
   * Handle gate reload - reload from YAML and re-register
   */
  private async handleGateReload(gateId: string): Promise<void> {
    try {
      // Step 1: Clear loader cache for this gate
      this.loader.clearCache(gateId);
      if (this.config.debug) {
        this.logger.debug(`Cleared cache for gate: ${gateId}`);
      }

      // Step 2: Reload definition from YAML
      const definition = this.loader.loadGate(gateId);
      if (!definition) {
        throw new Error(`Failed to load gate definition for '${gateId}'`);
      }

      if (this.config.debug) {
        this.logger.debug(`Reloaded definition for gate: ${definition.name}`);
      }

      // Step 3: Create new guide from definition
      const normalizedDefinition: GateDefinitionYaml = {
        id: definition.id,
        name: definition.name,
        type: definition.type,
        description: definition.description,
        severity: definition.severity,
        enforcementMode: definition.enforcementMode ?? ('informational' as GateEnforcementMode),
        gate_type: definition.gate_type,
      };

      if (definition.guidanceFile) {
        normalizedDefinition.guidanceFile = definition.guidanceFile;
      }
      if (definition.guidance) {
        normalizedDefinition.guidance = definition.guidance;
      }
      if (definition.pass_criteria) {
        normalizedDefinition.pass_criteria = definition.pass_criteria.map((criteria) => {
          const normalizedCriteria: GatePassCriteria = {
            type: criteria.type,
          };

          if (criteria.min_length !== undefined) {
            normalizedCriteria.min_length = criteria.min_length;
          }
          if (criteria.max_length !== undefined) {
            normalizedCriteria.max_length = criteria.max_length;
          }
          if (criteria.required_patterns) {
            normalizedCriteria.required_patterns = criteria.required_patterns;
          }
          if (criteria.forbidden_patterns) {
            normalizedCriteria.forbidden_patterns = criteria.forbidden_patterns;
          }
          if (criteria.methodology) {
            normalizedCriteria.methodology = criteria.methodology;
          }
          if (criteria.min_compliance_score !== undefined) {
            normalizedCriteria.min_compliance_score = criteria.min_compliance_score;
          }
          if (criteria.severity) {
            normalizedCriteria.severity = criteria.severity;
          }
          if (criteria.quality_indicators) {
            const qualityIndicators: Record<string, { keywords?: string[]; patterns?: string[] }> =
              {};
            for (const [indicator, value] of Object.entries(criteria.quality_indicators)) {
              const normalizedIndicator: { keywords?: string[]; patterns?: string[] } = {};
              if (value.keywords) {
                normalizedIndicator.keywords = value.keywords;
              }
              if (value.patterns) {
                normalizedIndicator.patterns = value.patterns;
              }
              qualityIndicators[indicator] = normalizedIndicator;
            }
            normalizedCriteria.quality_indicators = qualityIndicators;
          }
          if (criteria.prompt_template) {
            normalizedCriteria.prompt_template = criteria.prompt_template;
          }
          if (criteria.pass_threshold !== undefined) {
            normalizedCriteria.pass_threshold = criteria.pass_threshold;
          }
          if (criteria.regex_patterns) {
            normalizedCriteria.regex_patterns = criteria.regex_patterns;
          }
          if (criteria.keyword_count) {
            normalizedCriteria.keyword_count = criteria.keyword_count;
          }

          return normalizedCriteria;
        });
      }
      if (definition.retry_config) {
        const retryConfig: GateRetryConfig = {
          max_attempts: definition.retry_config.max_attempts ?? 2,
          improvement_hints: definition.retry_config.improvement_hints ?? true,
          preserve_context: definition.retry_config.preserve_context ?? true,
        };
        normalizedDefinition.retry_config = retryConfig;
      }
      if (definition.activation) {
        const activation: GateActivationRules = {};
        if (definition.activation.prompt_categories) {
          activation.prompt_categories = definition.activation.prompt_categories;
        }
        if (definition.activation.explicit_request !== undefined) {
          activation.explicit_request = definition.activation.explicit_request;
        }
        if (definition.activation.framework_context) {
          activation.framework_context = definition.activation.framework_context;
        }
        normalizedDefinition.activation = activation;
      }
      const guide = createGenericGateGuide(normalizedDefinition);

      // Step 4: Re-register with registry (replace existing)
      const success = await this.registry.registerGuide(guide, true, 'yaml-runtime');
      if (!success) {
        throw new Error(`Failed to re-register gate '${gateId}' with registry`);
      }

      // Update stats
      this.stats.reloadsSucceeded++;
      this.stats.lastReloadTime = Date.now();
      this.stats.lastReloadedGate = gateId;

      // Invoke reload callback for cache invalidation
      if (this.config.onReload) {
        try {
          this.config.onReload(gateId);
        } catch (callbackError) {
          this.logger.warn(`Gate reload callback failed for '${gateId}':`, callbackError);
        }
      }

      this.logger.info(`🔄 Gate '${definition.name}' (${gateId}) hot reloaded successfully`);
    } catch (error) {
      this.stats.reloadsFailed++;
      this.logger.error(`Failed to hot reload gate '${gateId}':`, error);
      throw error;
    }
  }

  /**
   * Get hot reload statistics
   */
  getStats(): GateHotReloadStats {
    return { ...this.stats };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      reloadsAttempted: 0,
      reloadsSucceeded: 0,
      reloadsFailed: 0,
    };
  }

  /**
   * Get the definition loader being used
   */
  getLoader(): GateDefinitionLoader {
    return this.loader;
  }
}

/**
 * Create a registration bundle for gate hot reload.
 * Keeps HotReloadManager generic by returning only the callback + watch paths.
 */
export function createGateHotReloadRegistration(
  logger: Logger,
  registry: GateRegistry,
  loader?: GateDefinitionLoader,
  config?: GateHotReloadConfig
): GateHotReloadRegistration {
  const definitionLoader = loader ?? registry.getLoader();
  const coordinator = new GateHotReloadCoordinator(logger, registry, definitionLoader, config);

  return {
    directories: [definitionLoader.getGatesDir()],
    handler: (event: GateHotReloadEvent) => coordinator.handleGateChange(event),
    coordinator,
  };
}

/**
 * Factory function to create a GateHotReloadCoordinator
 */
export function createGateHotReloadCoordinator(
  logger: Logger,
  registry: GateRegistry,
  loader?: GateDefinitionLoader,
  config?: GateHotReloadConfig
): GateHotReloadCoordinator {
  return new GateHotReloadCoordinator(logger, registry, loader, config);
}
