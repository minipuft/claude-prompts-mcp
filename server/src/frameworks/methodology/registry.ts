// @lifecycle canonical - Loads methodology guides and tracks their registration state.
/**
 * Methodology Registry
 *
 * Centralized registry for loading and managing methodology guides.
 * Uses YAML-based loading exclusively with fail-fast behavior.
 * All methodologies must be defined in resources/methodologies/<id>/methodology.yaml.
 */

import { createGenericGuide } from './generic-methodology-guide.js';
import {
  RuntimeMethodologyLoader,
  type RuntimeMethodologyLoaderConfig,
} from './runtime-methodology-loader.js';
import { Logger } from '../../logging/index.js';
import { IMethodologyGuide } from '../types/index.js';

// Data-driven methodology system (YAML-only)

/**
 * Methodology source type for tracking how a guide was loaded
 * YAML-runtime is the only production source; 'custom' for user-provided guides
 */
export type MethodologySource = 'yaml-runtime' | 'custom';

/**
 * Methodology registry configuration
 */
export interface MethodologyRegistryConfig {
  /** Whether to auto-load built-in methodology guides */
  autoLoadBuiltIn: boolean;
  /** Custom methodology guides to load */
  customGuides?: IMethodologyGuide[];
  /** Whether to validate guides on registration */
  validateOnRegistration: boolean;
  /** Configuration for the runtime YAML loader */
  runtimeLoaderConfig?: Partial<RuntimeMethodologyLoaderConfig>;
}

/**
 * Methodology guide registry entry
 */
export interface MethodologyGuideEntry {
  guide: IMethodologyGuide;
  registeredAt: Date;
  isBuiltIn: boolean;
  enabled: boolean;
  /** How this guide was loaded */
  source: MethodologySource;
  metadata: {
    loadTime: number;
    validationStatus: 'passed' | 'failed' | 'not_validated';
    lastUsed?: Date;
  };
}

/**
 * Methodology Registry
 *
 * Manages the loading, registration, and lifecycle of methodology guides.
 * Provides a clean separation between guide management and framework orchestration.
 */
export class MethodologyRegistry {
  private guides = new Map<string, MethodologyGuideEntry>();
  private logger: Logger;
  private config: MethodologyRegistryConfig;
  private initialized = false;
  private runtimeLoader: RuntimeMethodologyLoader | null = null;

  constructor(logger: Logger, config: Partial<MethodologyRegistryConfig> = {}) {
    this.logger = logger;
    this.config = {
      autoLoadBuiltIn: config.autoLoadBuiltIn ?? true,
      customGuides: config.customGuides ?? [],
      validateOnRegistration: config.validateOnRegistration ?? true,
      ...(config.runtimeLoaderConfig ? { runtimeLoaderConfig: config.runtimeLoaderConfig } : {}),
    };

    // RuntimeMethodologyLoader is mandatory - YAML loading is required
    this.runtimeLoader = new RuntimeMethodologyLoader(this.config.runtimeLoaderConfig);
  }

  /**
   * Initialize the methodology registry
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      this.logger.debug('MethodologyRegistry already initialized');
      return;
    }

    this.logger.info('Initializing MethodologyRegistry...');
    const startTime = performance.now();

    try {
      // Load built-in methodology guides if enabled
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
        `MethodologyRegistry initialized with ${this.guides.size} guides in ${loadTime.toFixed(1)}ms`
      );
    } catch (error) {
      this.logger.error('Failed to initialize MethodologyRegistry:', error);
      throw error;
    }
  }

  /**
   * Register a methodology guide
   */
  async registerGuide(
    guide: IMethodologyGuide,
    isBuiltIn: boolean = false,
    source: MethodologySource = 'custom'
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
      const entry: MethodologyGuideEntry = {
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
   * Get a methodology guide by ID
   */
  getGuide(guideId: string): IMethodologyGuide | undefined {
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
   * Get all registered methodology guides
   */
  getAllGuides(enabledOnly: boolean = true): IMethodologyGuide[] {
    this.ensureInitialized();

    const guides: IMethodologyGuide[] = [];
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
  getGuideEntries(enabledOnly: boolean = true): MethodologyGuideEntry[] {
    this.ensureInitialized();

    const entries: MethodologyGuideEntry[] = [];
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
   * Enable or disable a methodology guide
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
   * Unregister a methodology guide from the registry
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
    const sourceDistribution: Record<MethodologySource, number> = {
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
   * Load and register a methodology by ID from disk
   *
   * Used for hot-reload when a new methodology is created via MCP tools.
   * Loads the YAML definition and creates a guide, then registers it.
   *
   * @param id - Methodology ID to load
   * @returns true if successfully loaded and registered
   */
  async loadAndRegisterById(id: string): Promise<boolean> {
    this.ensureInitialized();

    const normalizedId = id.toLowerCase();

    if (!this.runtimeLoader) {
      this.logger.error('RuntimeMethodologyLoader not available for loadAndRegisterById');
      return false;
    }

    try {
      // Clear cache to force fresh load
      this.runtimeLoader.clearCache();

      // Load definition from disk
      const definition = this.runtimeLoader.loadMethodology(normalizedId);

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
   * Load built-in methodology guides
   *
   * YAML loading is mandatory with fail-fast behavior.
   * All methodologies must be defined in resources/methodologies/<id>/methodology.yaml.
   */
  private async loadBuiltInGuides(): Promise<void> {
    this.logger.debug('Loading built-in methodology guides from YAML...');

    // Required built-in methodology IDs
    const builtInIds = ['cageerf', 'react', '5w1h', 'scamper'];

    // Fail-fast: RuntimeMethodologyLoader is required
    if (!this.runtimeLoader) {
      throw new Error('RuntimeMethodologyLoader required. YAML loading is mandatory.');
    }

    let loadedCount = 0;

    for (const id of builtInIds) {
      const definition = this.runtimeLoader.loadMethodology(id);

      if (!definition) {
        throw new Error(
          `FATAL: Methodology '${id}' not found. Expected: resources/methodologies/${id}/methodology.yaml`
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

    // Discover and load additional methodologies from YAML
    const discoveredIds = this.runtimeLoader.discoverMethodologies();
    const additionalIds = discoveredIds.filter((id) => !builtInIds.includes(id));

    for (const id of additionalIds) {
      try {
        const definition = this.runtimeLoader.loadMethodology(id);
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
   * Load custom methodology guides
   */
  private async loadCustomGuides(customGuides: IMethodologyGuide[]): Promise<void> {
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
   * Validate a methodology guide
   */
  private validateGuide(guide: IMethodologyGuide): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check required properties
    if (!guide.frameworkId || typeof guide.frameworkId !== 'string') {
      errors.push('frameworkId is required and must be a string');
    }

    if (!guide.frameworkName || typeof guide.frameworkName !== 'string') {
      errors.push('frameworkName is required and must be a string');
    }

    // Accept either 'type' (preferred) or 'methodology' (deprecated)
    if (
      (!guide.type && !guide.methodology) ||
      (guide.type && typeof guide.type !== 'string') ||
      (guide.methodology && typeof guide.methodology !== 'string')
    ) {
      errors.push('type (or methodology) is required and must be a string');
    }

    if (!guide.version || typeof guide.version !== 'string') {
      errors.push('version is required and must be a string');
    }

    // Check required methods exist
    const requiredMethods = [
      'guidePromptCreation',
      'guideTemplateProcessing',
      'guideExecutionSteps',
      'enhanceWithMethodology',
      'validateMethodologyCompliance',
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
      throw new Error('MethodologyRegistry not initialized. Call initialize() first.');
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
  getRuntimeLoader(): RuntimeMethodologyLoader {
    if (!this.runtimeLoader) {
      throw new Error('RuntimeMethodologyLoader not initialized');
    }
    return this.runtimeLoader;
  }
}

/**
 * Create and initialize a MethodologyRegistry instance
 */
export async function createMethodologyRegistry(
  logger: Logger,
  config?: Partial<MethodologyRegistryConfig>
): Promise<MethodologyRegistry> {
  const registry = new MethodologyRegistry(logger, config);
  await registry.initialize();
  return registry;
}
