// @lifecycle canonical - Loads gate definitions from disk with hot reload support.
/**
 * Gate Loader - Adapter over GateDefinitionLoader (YAML + guidance.md)
 *
 * Uses GateDefinitionLoader for path resolution, validation, and guidance inlining.
 */

import { GateDefinitionLoader, type GateDefinitionLoaderConfig } from './gate-definition-loader.js';
import { Logger } from '../../logging/index.js';

import type {
  GateDefinitionYaml,
  LightweightGateDefinition,
  GateActivationResult,
} from '../types.js';
import type { TemporaryGateRegistry } from './temporary-gate-registry.js';

/**
 * Minimal provider contract for loading gate definitions.
 * Implemented by GateLoader (YAML-based) and can be implemented by registry adapters.
 */
export interface GateDefinitionProvider {
  loadGate(gateId: string): Promise<LightweightGateDefinition | null>;
  loadGates(gateIds: string[]): Promise<LightweightGateDefinition[]>;
  getActiveGates(
    gateIds: string[],
    context: { promptCategory?: string; framework?: string; explicitRequest?: boolean }
  ): Promise<GateActivationResult>;
  listAvailableGates(): Promise<string[]>;
  listAvailableGateDefinitions(): Promise<LightweightGateDefinition[]>;
  clearCache(gateId?: string): void;
  isGateActive(
    gate: LightweightGateDefinition,
    context: { promptCategory?: string; framework?: string; explicitRequest?: boolean }
  ): boolean;
  getStatistics(): { cachedGates: number; totalLoads: number; lastAccess: Date | null };
  isMethodologyGate(gateId: string): Promise<boolean>;
  isMethodologyGateCached(gateId: string): boolean;
  getMethodologyGateIds(): Promise<string[]>;
}

/**
 * Gate loader with caching and hot-reload support
 */
export class GateLoader implements GateDefinitionProvider {
  private gateCache = new Map<string, LightweightGateDefinition>();
  private lastModified = new Map<string, number>();
  private logger: Logger;
  private gatesDirectory: string;
  private definitionLoader: GateDefinitionLoader;
  private temporaryGateRegistry: TemporaryGateRegistry | undefined;

  constructor(
    logger: Logger,
    gatesDirectory?: string,
    temporaryGateRegistry?: TemporaryGateRegistry,
    loaderConfig?: Partial<GateDefinitionLoaderConfig>
  ) {
    this.logger = logger;

    // Prefer explicit directory, otherwise let GateDefinitionLoader resolve.
    const definitionLoaderConfig: GateDefinitionLoaderConfig = {
      ...(loaderConfig ?? {}),
    };

    if (gatesDirectory !== undefined) {
      definitionLoaderConfig.gatesDir = gatesDirectory;
    }

    this.definitionLoader = new GateDefinitionLoader(definitionLoaderConfig);
    this.gatesDirectory = this.definitionLoader.getGatesDir();
    this.logger.debug('[GateLoader] Using resolved gates directory:', this.gatesDirectory);

    this.temporaryGateRegistry = temporaryGateRegistry;
  }

  setTemporaryGateRegistry(temporaryGateRegistry?: TemporaryGateRegistry): void {
    this.temporaryGateRegistry = temporaryGateRegistry;
  }

  /**
   * Load a gate definition by ID with caching
   */
  async loadGate(gateId: string): Promise<LightweightGateDefinition | null> {
    try {
      const tempGate = this.temporaryGateRegistry?.getTemporaryGate(gateId);
      if (tempGate !== undefined) {
        const lightweight = this.temporaryGateRegistry?.convertToLightweightGate(tempGate);
        if (lightweight) {
          this.gateCache.set(gateId, lightweight);
          return lightweight;
        }
      }

      const definition = this.definitionLoader.loadGate(gateId);
      if (!definition) {
        this.logger.warn(`Gate definition not found: ${gateId}`);
        return null;
      }

      // Normalize to lightweight shape used by existing pipeline
      const gate = this.toLightweightGate(definition as GateDefinitionYaml);

      this.gateCache.set(gateId, gate);
      this.lastModified.set(gateId, Date.now());

      this.logger.debug(`Gate loaded successfully: ${gateId}`);
      return gate;
    } catch (error) {
      this.logger.error(`Failed to load gate ${gateId}:`, error);
      return null;
    }
  }

  /**
   * Load multiple gates by IDs
   */
  async loadGates(gateIds: string[]): Promise<LightweightGateDefinition[]> {
    const gates: LightweightGateDefinition[] = [];

    for (const gateId of gateIds) {
      const gate = await this.loadGate(gateId);
      if (gate !== null) {
        gates.push(gate);
      }
    }

    return gates;
  }

  /**
   * Get active gates based on context and criteria
   */
  async getActiveGates(
    gateIds: string[],
    context: {
      promptCategory?: string;
      framework?: string;
      explicitRequest?: boolean;
    }
  ): Promise<GateActivationResult> {
    const allGates = await this.loadGates(gateIds);
    const activeGates: LightweightGateDefinition[] = [];
    const guidanceText: string[] = [];
    const validationGates: LightweightGateDefinition[] = [];

    for (const gate of allGates) {
      if (this.isGateActive(gate, context)) {
        activeGates.push(gate);

        // Collect guidance text
        if (gate.guidance !== undefined && gate.guidance !== '') {
          guidanceText.push(`**${gate.name}:**\n${gate.guidance}`);
        }

        // Collect validation gates
        if (gate.type === 'validation') {
          validationGates.push(gate);
        }
      }
    }

    return {
      activeGates,
      guidanceText,
      validationGates,
    };
  }

  /**
   * List all available gate IDs
   */
  async listAvailableGates(): Promise<string[]> {
    try {
      return this.definitionLoader.discoverGates();
    } catch (error) {
      this.logger.error('Failed to list available gates:', error);
      return [];
    }
  }

  /**
   * List all available gate definitions (full objects)
   * Used by JudgeSelectionStage to build resource menu for LLM selection.
   */
  async listAvailableGateDefinitions(): Promise<LightweightGateDefinition[]> {
    try {
      const loaded = this.definitionLoader.loadAllGates();
      return Array.from(loaded.values()).map((definition) =>
        this.toLightweightGate(definition as GateDefinitionYaml)
      );
    } catch (error) {
      this.logger.error('Failed to list available gate definitions:', error);
      return [];
    }
  }

  /**
   * Clear gate cache (for hot-reloading)
   */
  clearCache(gateId?: string): void {
    if (gateId !== undefined) {
      this.gateCache.delete(gateId);
      this.lastModified.delete(gateId);
      this.logger.debug(`Cleared cache for gate: ${gateId}`);
    } else {
      this.gateCache.clear();
      this.lastModified.clear();
      this.logger.debug('Cleared all gate cache');
    }
  }

  /**
   * Check if a gate should be activated based on context
   */
  /**
   * Determine if a gate should be active for the provided context.
   * Exposed so other systems (e.g., guidance rendering) can reuse the
   * canonical activation logic instead of duplicating it.
   */
  public isGateActive(
    gate: LightweightGateDefinition,
    context: {
      promptCategory?: string;
      framework?: string;
      explicitRequest?: boolean;
    }
  ): boolean {
    const activation = gate.activation;
    if (activation === undefined) {
      // No activation rules means always active
      return true;
    }

    // Check explicit request
    if (activation.explicit_request === true && context.explicitRequest !== true) {
      return false;
    }

    // Check prompt categories (empty array means no restriction)
    if ((activation.prompt_categories?.length ?? 0) > 0 && context.promptCategory !== undefined) {
      if (activation.prompt_categories?.includes(context.promptCategory) === false) {
        return false;
      }
    }

    // Check framework context (empty array means no restriction)
    // Case-insensitive comparison to handle CAGEERF vs cageerf mismatches
    if ((activation.framework_context?.length ?? 0) > 0 && context.framework !== undefined) {
      const normalizedFramework = context.framework.toUpperCase();
      const normalizedContexts = activation.framework_context?.map((f) => f.toUpperCase()) ?? [];
      if (!normalizedContexts.includes(normalizedFramework)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Get gate statistics
   */
  getStatistics(): {
    cachedGates: number;
    totalLoads: number;
    lastAccess: Date | null;
  } {
    return {
      cachedGates: this.gateCache.size,
      totalLoads: this.lastModified.size,
      lastAccess: this.lastModified.size > 0 ? new Date() : null,
    };
  }

  /**
   * Check if a gate is a methodology/framework gate by loading and inspecting its definition.
   * Framework gates have gate_type === 'framework' and are filtered when methodology gates are disabled.
   *
   * @param gateId - Gate identifier to check
   * @returns true if gate has gate_type === 'framework', false otherwise
   */
  async isMethodologyGate(gateId: string): Promise<boolean> {
    const gate = await this.loadGate(gateId);
    return gate?.gate_type === 'framework';
  }

  /**
   * Check if a gate ID is a methodology gate using cached data only (synchronous).
   * Returns false if gate is not in cache - use isMethodologyGate for definitive check.
   *
   * @param gateId - Gate identifier to check
   * @returns true if cached gate has gate_type === 'framework', false otherwise
   */
  isMethodologyGateCached(gateId: string): boolean {
    const cached = this.gateCache.get(gateId) ?? this.gateCache.get(gateId.toLowerCase());
    return cached?.gate_type === 'framework';
  }

  /**
   * Get all methodology gate IDs from loaded definitions.
   * Scans the definitions directory and returns IDs of gates with gate_type === 'framework'.
   *
   * @returns Array of methodology gate IDs
   */
  async getMethodologyGateIds(): Promise<string[]> {
    const allGates = this.definitionLoader.loadAllGates();
    return Array.from(allGates.values())
      .filter((gate) => gate.gate_type === 'framework')
      .map((gate) => gate.id);
  }

  /**
   * Convert GateDefinitionYaml to LightweightGateDefinition shape expected by legacy consumers.
   */
  private toLightweightGate(definition: GateDefinitionYaml): LightweightGateDefinition {
    const retryConfig = this.normalizeRetryConfig(definition.retry_config);

    return {
      id: definition.id,
      name: definition.name,
      type: definition.type,
      description: definition.description,
      ...(definition.severity !== undefined ? { severity: definition.severity } : {}),
      ...(definition.enforcementMode !== undefined
        ? { enforcementMode: definition.enforcementMode }
        : {}),
      ...(definition.guidanceFile !== undefined ? { guidanceFile: definition.guidanceFile } : {}),
      ...(definition.guidance !== undefined ? { guidance: definition.guidance } : {}),
      ...(definition.pass_criteria !== undefined
        ? { pass_criteria: definition.pass_criteria }
        : {}),
      ...(retryConfig !== undefined ? { retry_config: retryConfig } : {}),
      ...(definition.activation !== undefined ? { activation: definition.activation } : {}),
      ...(definition.gate_type !== undefined ? { gate_type: definition.gate_type } : {}),
    };
  }

  private normalizeRetryConfig(
    retry?: GateDefinitionYaml['retry_config']
  ): LightweightGateDefinition['retry_config'] {
    if (!retry) return undefined;
    return {
      max_attempts: retry.max_attempts ?? 2,
      improvement_hints: retry.improvement_hints ?? true,
      preserve_context: retry.preserve_context ?? true,
    };
  }
}

/**
 * Create a gate loader instance
 */
export function createGateLoader(
  logger: Logger,
  gatesDirectory?: string,
  temporaryGateRegistry?: TemporaryGateRegistry
): GateLoader {
  return new GateLoader(logger, gatesDirectory, temporaryGateRegistry);
}
