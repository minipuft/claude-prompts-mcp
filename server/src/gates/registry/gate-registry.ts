// @lifecycle canonical - Loads gate guides and tracks their registration state.
/**
 * Gate Registry
 *
 * Centralized registry for loading and managing gate guides.
 * Mirrors the MethodologyRegistry pattern from the framework system.
 *
 * Features:
 * - YAML-based loading via GateDefinitionLoader
 * - Per-gate enable/disable
 * - Registration metadata tracking
 * - Statistics and introspection
 *
 * @see MethodologyRegistry for the pattern this follows
 */

import { createGenericGateGuide } from './generic-gate-guide.js';
import { Logger } from '../../logging/index.js';
import {
  GateDefinitionLoader,
  type GateDefinitionLoaderConfig,
} from '../core/gate-definition-loader.js';

import type {
  GateDefinitionYaml,
  IGateGuide,
  GateSource,
  GateGuideEntry,
  GateRegistryStats,
} from '../types/index.js';

/**
 * Gate registry configuration
 */
export interface GateRegistryConfig {
  /** Whether to auto-load built-in gates on initialization */
  autoLoadBuiltIn: boolean;
  /** Custom gate guides to load */
  customGuides?: IGateGuide[];
  /** Whether to validate guides on registration */
  validateOnRegistration: boolean;
  /** Configuration for the gate definition loader */
  loaderConfig?: Partial<GateDefinitionLoaderConfig>;
}

/**
 * Gate Registry
 *
 * Manages the loading, registration, and lifecycle of gate guides.
 * Provides a clean separation between guide management and gate orchestration.
 *
 * @example
 * ```typescript
 * const registry = new GateRegistry(logger);
 * await registry.initialize();
 *
 * const guide = registry.getGuide('code-quality');
 * if (guide?.isActive({ promptCategory: 'code' })) {
 *   console.log(guide.getGuidance());
 * }
 * ```
 */
export class GateRegistry {
  private guides = new Map<string, GateGuideEntry>();
  private logger: Logger;
  private config: GateRegistryConfig;
  private initialized = false;
  private loader: GateDefinitionLoader;

  constructor(logger: Logger, config: Partial<GateRegistryConfig> = {}) {
    this.logger = logger;
    this.config = {
      autoLoadBuiltIn: config.autoLoadBuiltIn ?? true,
      customGuides: config.customGuides ?? [],
      validateOnRegistration: config.validateOnRegistration ?? true,
      ...(config.loaderConfig !== undefined ? { loaderConfig: config.loaderConfig } : {}),
    };

    // Create the definition loader
    this.loader =
      this.config.loaderConfig !== undefined
        ? new GateDefinitionLoader(this.config.loaderConfig)
        : new GateDefinitionLoader();
  }

  /**
   * Initialize the gate registry
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      this.logger.debug('GateRegistry already initialized');
      return;
    }

    this.logger.info('Initializing GateRegistry...');
    const startTime = performance.now();

    try {
      // Load built-in gate guides if enabled
      if (this.config.autoLoadBuiltIn) {
        await this.loadBuiltInGuides();
      }

      // Load custom guides if provided
      if (this.config.customGuides && this.config.customGuides.length > 0) {
        await this.loadCustomGuides(this.config.customGuides);
      }

      const loadTime = performance.now() - startTime;
      this.initialized = true;

      this.logger.info(
        `GateRegistry initialized with ${this.guides.size} guides in ${loadTime.toFixed(1)}ms`
      );
    } catch (error) {
      this.logger.error('Failed to initialize GateRegistry:', error);
      throw error;
    }
  }

  /**
   * Register a gate guide
   *
   * @param guide - The gate guide to register
   * @param isBuiltIn - Whether this is a built-in gate
   * @param source - How this guide was loaded
   * @returns true if registration succeeded
   */
  async registerGuide(
    guide: IGateGuide,
    isBuiltIn: boolean = false,
    source: GateSource = 'custom'
  ): Promise<boolean> {
    const startTime = performance.now();

    try {
      // Validate guide if required
      if (this.config.validateOnRegistration) {
        const validationResult = this.validateGuide(guide);
        if (!validationResult.valid) {
          this.logger.warn(
            `Guide validation failed for ${guide.gateId}: ${validationResult.errors.join(', ')}`
          );
          return false;
        }
      }

      // Check for existing guide with same ID
      const normalizedId = guide.gateId.toLowerCase();
      if (this.guides.has(normalizedId)) {
        this.logger.warn(`Guide with ID '${guide.gateId}' already registered, replacing...`);
      }

      // Create registry entry
      const entry: GateGuideEntry = {
        guide,
        registeredAt: new Date(),
        isBuiltIn,
        enabled: true,
        source,
        metadata: {
          loadTime: performance.now() - startTime,
          validationStatus: this.config.validateOnRegistration ? 'passed' : 'not_validated',
        },
      };

      this.guides.set(normalizedId, entry);

      this.logger.debug(`Registered gate guide: ${guide.name} (${guide.gateId}) [${source}]`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to register guide ${guide.gateId}:`, error);
      return false;
    }
  }

  /**
   * Get a gate guide by ID
   *
   * @param gateId - The gate ID (case-insensitive)
   * @returns The guide or undefined if not found/disabled
   */
  getGuide(gateId: string): IGateGuide | undefined {
    const normalizedId = gateId.toLowerCase();
    const entry = this.guides.get(normalizedId);

    if (!entry) {
      return undefined;
    }

    if (!entry.enabled) {
      this.logger.debug(`Gate guide '${gateId}' is disabled`);
      return undefined;
    }

    // Update last used timestamp
    entry.metadata.lastUsed = new Date();

    return entry.guide;
  }

  /**
   * Get all registered guides
   *
   * @param enabledOnly - If true, only return enabled guides
   * @returns Array of gate guides
   */
  getAllGuides(enabledOnly: boolean = true): IGateGuide[] {
    const guides: IGateGuide[] = [];

    for (const entry of this.guides.values()) {
      if (!enabledOnly || entry.enabled) {
        guides.push(entry.guide);
      }
    }

    return guides;
  }

  /**
   * Get guide entries with metadata
   *
   * @param enabledOnly - If true, only return enabled guides
   * @returns Array of guide entries
   */
  getGuideEntries(enabledOnly: boolean = true): GateGuideEntry[] {
    const entries: GateGuideEntry[] = [];

    for (const entry of this.guides.values()) {
      if (!enabledOnly || entry.enabled) {
        entries.push(entry);
      }
    }

    return entries;
  }

  /**
   * Check if a guide exists
   *
   * @param gateId - The gate ID to check
   * @returns true if the guide exists (regardless of enabled state)
   */
  hasGuide(gateId: string): boolean {
    return this.guides.has(gateId.toLowerCase());
  }

  /**
   * Enable or disable a guide
   *
   * @param gateId - The gate ID
   * @param enabled - Whether to enable or disable
   * @returns true if the operation succeeded
   */
  setGuideEnabled(gateId: string, enabled: boolean): boolean {
    const normalizedId = gateId.toLowerCase();
    const entry = this.guides.get(normalizedId);

    if (!entry) {
      this.logger.warn(`Cannot ${enabled ? 'enable' : 'disable'} unknown gate: ${gateId}`);
      return false;
    }

    entry.enabled = enabled;
    this.logger.info(`Gate '${gateId}' ${enabled ? 'enabled' : 'disabled'}`);
    return true;
  }

  /**
   * Unregister a guide from the registry
   *
   * @param gateId - The gate ID to unregister
   * @returns true if the guide was found and removed
   */
  unregisterGuide(gateId: string): boolean {
    const normalizedId = gateId.toLowerCase();

    if (!this.guides.has(normalizedId)) {
      this.logger.warn(`Cannot unregister unknown gate: ${gateId}`);
      return false;
    }

    this.guides.delete(normalizedId);
    this.logger.info(`Gate '${gateId}' unregistered from registry`);
    return true;
  }

  /**
   * Get registry statistics
   */
  getRegistryStats(): GateRegistryStats {
    let totalLoadTime = 0;
    const bySource: Record<GateSource, number> = {
      'yaml-runtime': 0,
      custom: 0,
      temporary: 0,
    };
    const byType: Record<'validation' | 'guidance', number> = {
      validation: 0,
      guidance: 0,
    };

    let enabledCount = 0;
    let builtInCount = 0;
    let customCount = 0;

    for (const entry of this.guides.values()) {
      totalLoadTime += entry.metadata.loadTime;
      bySource[entry.source]++;
      byType[entry.guide.type]++;

      if (entry.enabled) enabledCount++;
      if (entry.isBuiltIn) builtInCount++;
      else customCount++;
    }

    return {
      totalGates: this.guides.size,
      enabledGates: enabledCount,
      builtInGates: builtInCount,
      customGates: customCount,
      bySource,
      byType,
      averageLoadTime: this.guides.size > 0 ? totalLoadTime / this.guides.size : 0,
    };
  }

  /**
   * Get the underlying definition loader
   */
  getLoader(): GateDefinitionLoader {
    return this.loader;
  }

  /**
   * Reload a specific gate
   *
   * @param gateId - The gate ID to reload
   * @returns true if reload succeeded
   */
  async reloadGuide(gateId: string): Promise<boolean> {
    const normalizedId = gateId.toLowerCase();
    const existingEntry = this.guides.get(normalizedId);

    // Clear loader cache for this gate
    this.loader.clearCache(normalizedId);

    // Load fresh definition
    const definition = this.loader.loadGate(normalizedId) as GateDefinitionYaml;
    if (!definition) {
      this.logger.warn(`Failed to reload gate '${gateId}': definition not found`);
      return false;
    }

    // Create new guide
    const guide = createGenericGateGuide(definition);

    // Re-register with existing metadata where appropriate
    const entry: GateGuideEntry = {
      guide,
      registeredAt: new Date(),
      isBuiltIn: existingEntry?.isBuiltIn ?? false,
      enabled: existingEntry?.enabled ?? true,
      source: 'yaml-runtime',
      metadata: {
        loadTime: 0, // Will be updated
        validationStatus: 'passed',
        ...(existingEntry?.metadata.lastUsed ? { lastUsed: existingEntry.metadata.lastUsed } : {}),
      },
    };

    this.guides.set(normalizedId, entry);
    this.logger.info(`Reloaded gate guide: ${guide.name} (${gateId})`);
    return true;
  }

  // ============================================================================
  // Private Implementation
  // ============================================================================

  /**
   * Load built-in gates from YAML files
   */
  private async loadBuiltInGuides(): Promise<void> {
    const gateIds = this.loader.discoverGates();

    this.logger.debug(`Discovered ${gateIds.length} gates to load`);

    for (const gateId of gateIds) {
      const startTime = performance.now();
      const definition = this.loader.loadGate(gateId) as GateDefinitionYaml | undefined;

      if (!definition) {
        this.logger.warn(`Failed to load gate definition: ${gateId}`);
        continue;
      }

      try {
        const guide = createGenericGateGuide(definition);
        await this.registerGuide(guide, true, 'yaml-runtime');

        // Update load time in entry
        const entry = this.guides.get(gateId.toLowerCase());
        if (entry) {
          entry.metadata.loadTime = performance.now() - startTime;
        }
      } catch (error) {
        this.logger.error(`Failed to create guide for gate '${gateId}':`, error);
      }
    }
  }

  /**
   * Load custom guides provided in config
   */
  private async loadCustomGuides(guides: IGateGuide[]): Promise<void> {
    for (const guide of guides) {
      await this.registerGuide(guide, false, 'custom');
    }
  }

  /**
   * Validate a gate guide
   */
  private validateGuide(guide: IGateGuide): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check required properties
    if (!guide.gateId || guide.gateId.trim() === '') {
      errors.push('Gate ID is required');
    }
    if (!guide.name || guide.name.trim() === '') {
      errors.push('Gate name is required');
    }
    if (!guide.type || !['validation', 'guidance'].includes(guide.type)) {
      errors.push('Gate type must be "validation" or "guidance"');
    }

    // Check required methods
    if (typeof guide.getGuidance !== 'function') {
      errors.push('getGuidance() method is required');
    }
    if (typeof guide.isActive !== 'function') {
      errors.push('isActive() method is required');
    }
    if (typeof guide.validate !== 'function') {
      errors.push('validate() method is required');
    }

    return { valid: errors.length === 0, errors };
  }
}

/**
 * Create a gate registry with default configuration
 */
export async function createGateRegistry(
  logger: Logger,
  config?: Partial<GateRegistryConfig>
): Promise<GateRegistry> {
  const registry = new GateRegistry(logger, config);
  await registry.initialize();
  return registry;
}
