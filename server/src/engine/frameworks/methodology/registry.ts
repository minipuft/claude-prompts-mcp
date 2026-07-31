// @lifecycle canonical - Loads framework guides and tracks their registration state.
/**
 * Framework Registry
 *
 * Centralized registry for loading and managing framework guides.
 * Uses YAML-based loading exclusively with fail-fast behavior.
 * All frameworks must be defined in resources/frameworks/<id>/framework.yaml.
 */

import { createGenericGuide } from './generic-methodology-guide.js';
import {
  RuntimeFrameworkLoader,
  type RuntimeFrameworkLoaderConfig,
} from './runtime-methodology-loader.js';
import { Logger } from '../../../infra/logging/index.js';
import { FrameworkGuide } from '../types/index.js';

// Data-driven framework system (YAML-only)

/**
 * Framework source type for tracking how a guide was loaded
 * YAML-runtime is the only production source; 'custom' for user-provided guides
 */
export type FrameworkSource = 'yaml-runtime' | 'custom';

/**
 * Framework registry configuration
 */
export interface FrameworkRegistryConfig {
  /** Whether to auto-load built-in framework guides */
  autoLoadBuiltIn: boolean;
  /** Custom framework guides to load */
  customGuides?: FrameworkGuide[];
  /** Whether to validate guides on registration */
  validateOnRegistration: boolean;
  /** Configuration for the runtime YAML loader */
  runtimeLoaderConfig?: Partial<RuntimeFrameworkLoaderConfig>;
}

/**
 * Framework guide registry entry
 */
export interface FrameworkGuideEntry {
  guide: FrameworkGuide;
  registeredAt: Date;
  isBuiltIn: boolean;
  enabled: boolean;
  /** How this guide was loaded */
  source: FrameworkSource;
  metadata: {
    loadTime: number;
    validationStatus: 'passed' | 'failed' | 'not_validated';
    lastUsed?: Date;
  };
}

/**
 * Framework Registry
 *
 * Manages the loading, registration, and lifecycle of framework guides.
 * Provides a clean separation between guide management and framework orchestration.
 */
export class FrameworkRegistry {
  private guides = new Map<string, FrameworkGuideEntry>();
  private logger: Logger;
  private config: FrameworkRegistryConfig;
  private initialized = false;
  private runtimeLoader: RuntimeFrameworkLoader | null = null;

  constructor(logger: Logger, config: Partial<FrameworkRegistryConfig> = {}) {
    this.logger = logger;
    this.config = {
      autoLoadBuiltIn: config.autoLoadBuiltIn ?? true,
      customGuides: config.customGuides ?? [],
      validateOnRegistration: config.validateOnRegistration ?? true,
      ...(config.runtimeLoaderConfig ? { runtimeLoaderConfig: config.runtimeLoaderConfig } : {}),
    };

    // RuntimeFrameworkLoader is mandatory - YAML loading is required
    this.runtimeLoader = new RuntimeFrameworkLoader(this.config.runtimeLoaderConfig);
  }

  /**
   * Initialize the framework registry
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      this.logger.debug('FrameworkRegistry already initialized');
      return;
    }

    this.logger.info('Initializing FrameworkRegistry...');
    const startTime = performance.now();

    try {
      // Load built-in framework guides if enabled
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
        `FrameworkRegistry initialized with ${this.guides.size} guides in ${loadTime.toFixed(1)}ms`
      );
    } catch (error) {
      this.logger.error('Failed to initialize FrameworkRegistry:', error);
      throw error;
    }
  }

  /**
   * Register a framework guide
   */
  async registerGuide(
    guide: FrameworkGuide,
    isBuiltIn: boolean = false,
    source: FrameworkSource = 'custom'
  ): Promise<boolean> {
    const startTime = performance.now();

    try {
      // Normalize ID once at the boundary for consistent storage/lookup
      const normalizedId = guide.frameworkId.toLowerCase();

      // Validate guide if required
      if (this.config.validateOnRegistration) {
        const validationResult = this.validateGuide(guide);
        if (!validationResult.valid) {
          this.logger.warn(
            `Guide validation failed for ${guide.frameworkId}: ${validationResult.errors.join(', ')}`
          );
          return false;
        }
      }

      // Check for existing guide with same ID
      if (this.guides.has(normalizedId)) {
        this.logger.warn(`Guide with ID '${guide.frameworkId}' already registered, replacing...`);
      }

      // Create registry entry
      const entry: FrameworkGuideEntry = {
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

      this.logger.debug(
        `Registered ${isBuiltIn ? 'built-in' : 'custom'} methodology guide: ${guide.frameworkName} (${guide.frameworkId}) [${source}]`
      );

      return true;
    } catch (error) {
      this.logger.error(`Failed to register methodology guide ${guide.frameworkId}:`, error);
      return false;
    }
  }

  /**
   * Get a framework guide by ID
   */
  getGuide(guideId: string): FrameworkGuide | undefined {
    this.ensureInitialized();

    const entry = this.guides.get(guideId.toLowerCase());
    if (entry?.enabled) {
      // Update last used timestamp
      entry.metadata.lastUsed = new Date();
      return entry.guide;
    }

    return undefined;
  }

  /**
   * Get all registered framework guides
   */
  getAllGuides(enabledOnly: boolean = true): FrameworkGuide[] {
    this.ensureInitialized();

    const guides: FrameworkGuide[] = [];
    for (const [_, entry] of this.guides) {
      if (!enabledOnly || entry.enabled) {
        guides.push(entry.guide);
      }
    }

    return guides;
  }

  /**
   * Get guide entries with metadata
   */
  getGuideEntries(enabledOnly: boolean = true): FrameworkGuideEntry[] {
    this.ensureInitialized();

    const entries: FrameworkGuideEntry[] = [];
    for (const [_, entry] of this.guides) {
      if (!enabledOnly || entry.enabled) {
        entries.push(entry);
      }
    }

    return entries;
  }

  /**
   * Check if a guide is registered
   */
  hasGuide(guideId: string): boolean {
    this.ensureInitialized();
    return this.guides.has(guideId.toLowerCase());
  }

  /**
   * Enable or disable a framework guide
   */
  setGuideEnabled(guideId: string, enabled: boolean): boolean {
    this.ensureInitialized();

    const entry = this.guides.get(guideId.toLowerCase());
    if (entry) {
      entry.enabled = enabled;
      this.logger.info(`Methodology guide '${guideId}' ${enabled ? 'enabled' : 'disabled'}`);
      return true;
    }

    this.logger.warn(`Cannot ${enabled ? 'enable' : 'disable'} guide '${guideId}': not found`);
    return false;
  }

  /**
   * Unregister a framework guide from the registry
   *
   * @param guideId - The guide ID to unregister
   * @returns true if the guide was found and removed
   */
  unregisterGuide(guideId: string): boolean {
    this.ensureInitialized();
    const normalizedId = guideId.toLowerCase();

    if (!this.guides.has(normalizedId)) {
      this.logger.warn(`Cannot unregister unknown methodology guide: ${guideId}`);
      return false;
    }

    this.guides.delete(normalizedId);
    this.logger.info(`Methodology guide '${guideId}' unregistered from registry`);
    return true;
  }

  /**
   * Get registry statistics
   */
  getRegistryStats() {
    this.ensureInitialized();

    const entries = Array.from(this.guides.values());
    const enabledCount = entries.filter((e) => e.enabled).length;
    const builtInCount = entries.filter((e) => e.isBuiltIn).length;

    // Count by source
    const sourceDistribution: Record<FrameworkSource, number> = {
      'yaml-runtime': 0,
      custom: 0,
    };
    for (const entry of entries) {
      sourceDistribution[entry.source]++;
    }

    return {
      totalGuides: entries.length,
      enabledGuides: enabledCount,
      builtInGuides: builtInCount,
      customGuides: entries.length - builtInCount,
      sourceDistribution,
      averageLoadTime:
        entries.reduce((sum, e) => sum + e.metadata.loadTime, 0) / entries.length || 0,
      initialized: this.initialized,
      runtimeLoaderStats: this.runtimeLoader?.getStats() ?? null,
    };
  }

  /**
   * Load and register a framework by ID from disk
   *
   * Used for hot-reload when a new framework is created via MCP tools.
   * Loads the YAML definition and creates a guide, then registers it.
   *
   * @param id - Framework ID to load
   * @returns true if successfully loaded and registered
   */
  async loadAndRegisterById(id: string): Promise<boolean> {
    this.ensureInitialized();

    const normalizedId = id.toLowerCase();

    if (!this.runtimeLoader) {
      this.logger.error('RuntimeFrameworkLoader not available for loadAndRegisterById');
      return false;
    }

    try {
      // Clear cache to force fresh load
      this.runtimeLoader.clearCache();

      // Load definition from disk
      const definition = this.runtimeLoader.loadFramework(normalizedId);

      if (!definition) {
        this.logger.warn(`Methodology '${id}' not found on disk`);
        return false;
      }

      // Create guide from definition
      const guide = createGenericGuide(definition);

      // Register the guide (will replace if exists)
      const success = await this.registerGuide(guide, false, 'yaml-runtime');

      if (success) {
        this.logger.info(`Dynamically loaded and registered methodology: ${id}`);
      }

      return success;
    } catch (error) {
      this.logger.error(`Failed to load and register methodology '${id}':`, error);
      return false;
    }
  }

  // Private implementation methods

  /**
   * Load built-in framework guides
   *
   * YAML loading is mandatory with fail-fast behavior.
   * All frameworks must be defined in resources/frameworks/<id>/framework.yaml.
   */
  private async loadBuiltInGuides(): Promise<void> {
    this.logger.debug('Loading built-in methodology guides from YAML...');

    // Required built-in framework IDs
    const builtInIds = ['cageerf', 'react', '5w1h', 'scamper'];

    // Fail-fast: RuntimeFrameworkLoader is required
    if (!this.runtimeLoader) {
      throw new Error('RuntimeFrameworkLoader required. YAML loading is mandatory.');
    }

    let loadedCount = 0;

    for (const id of builtInIds) {
      const definition = this.runtimeLoader.loadFramework(id);

      if (!definition) {
        throw new Error(
          `FATAL: Methodology '${id}' not found. Expected: resources/frameworks/${id}/framework.yaml`
        );
      }

      const guide = createGenericGuide(definition);
      const success = await this.registerGuide(guide, true, 'yaml-runtime');

      if (!success) {
        throw new Error(`Failed to register built-in methodology guide: ${id}`);
      }

      loadedCount++;
      this.logger.debug(`Loaded methodology from YAML: ${id}`);
    }

    this.logger.info(`Loaded ${loadedCount} built-in methodology guides from YAML`);

    // Discover and load additional frameworks from YAML
    const discoveredIds = this.runtimeLoader.discoverFrameworks();
    const additionalIds = discoveredIds.filter((id) => !builtInIds.includes(id));

    for (const id of additionalIds) {
      try {
        const definition = this.runtimeLoader.loadFramework(id);
        if (definition) {
          const guide = createGenericGuide(definition);
          const success = await this.registerGuide(guide, false, 'yaml-runtime');
          if (success) {
            this.logger.info(`Discovered additional methodology from YAML: ${id}`);
          }
        }
      } catch (error) {
        this.logger.warn(`Failed to load discovered methodology '${id}':`, error);
      }
    }
  }

  /**
   * Load custom framework guides
   */
  private async loadCustomGuides(customGuides: FrameworkGuide[]): Promise<void> {
    this.logger.debug(`Loading ${customGuides.length} custom methodology guides...`);

    for (const guide of customGuides) {
      const success = await this.registerGuide(guide, false);
      if (!success) {
        this.logger.warn(`Failed to register custom guide: ${guide.frameworkName}`);
      }
    }

    this.logger.info(`Loaded ${customGuides.length} custom methodology guides`);
  }

  /**
   * Validate a framework guide
   */
  private validateGuide(guide: FrameworkGuide): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check required properties
    if (!guide.frameworkId || typeof guide.frameworkId !== 'string') {
      errors.push('frameworkId is required and must be a string');
    }

    if (!guide.frameworkName || typeof guide.frameworkName !== 'string') {
      errors.push('frameworkName is required and must be a string');
    }

    if (!guide.type || typeof guide.type !== 'string') {
      errors.push('type is required and must be a string');
    }

    if (!guide.version || typeof guide.version !== 'string') {
      errors.push('version is required and must be a string');
    }

    // Check required methods exist
    const requiredMethods = [
      'guidePromptCreation',
      'guideTemplateProcessing',
      'guideExecutionSteps',
      'enhanceWithFramework',
      'validateFrameworkCompliance',
      'getSystemPromptGuidance',
    ];

    for (const method of requiredMethods) {
      if (typeof (guide as any)[method] !== 'function') {
        errors.push(`Required method '${method}' is missing or not a function`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Ensure registry is initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('FrameworkRegistry not initialized. Call initialize() first.');
    }
  }

  /**
   * Get initialization status
   */
  get isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Expose the runtime loader so other components (e.g., hot reload) can reuse
   * the same cache and directory resolution.
   */
  getRuntimeLoader(): RuntimeFrameworkLoader {
    if (!this.runtimeLoader) {
      throw new Error('RuntimeFrameworkLoader not initialized');
    }
    return this.runtimeLoader;
  }
}

/**
 * Create and initialize a FrameworkRegistry instance
 */
export async function createFrameworkRegistry(
  logger: Logger,
  config?: Partial<FrameworkRegistryConfig>
): Promise<FrameworkRegistry> {
  const registry = new FrameworkRegistry(logger, config);
  await registry.initialize();
  return registry;
}
