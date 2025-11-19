// @lifecycle canonical - Loads methodology guides and tracks their registration state.
/**
 * Methodology Registry
 *
 * Centralized registry for loading and managing methodology guides.
 * Extracted from FrameworkManager to provide clear separation of concerns
 * and enable better methodology guide management.
 */

import { Logger } from '../../logging/index.js';
import { IMethodologyGuide } from '../types/index.js';
import { FiveW1HMethodologyGuide } from './guides/5w1h-guide.js';
import { CAGEERFMethodologyGuide } from './guides/cageerf-guide.js';
import { ReACTMethodologyGuide } from './guides/react-guide.js';
import { SCAMPERMethodologyGuide } from './guides/scamper-guide.js';

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
}

/**
 * Methodology guide registry entry
 */
export interface MethodologyGuideEntry {
  guide: IMethodologyGuide;
  registeredAt: Date;
  isBuiltIn: boolean;
  enabled: boolean;
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

  constructor(logger: Logger, config: Partial<MethodologyRegistryConfig> = {}) {
    this.logger = logger;
    this.config = {
      autoLoadBuiltIn: config.autoLoadBuiltIn ?? true,
      customGuides: config.customGuides ?? [],
      validateOnRegistration: config.validateOnRegistration ?? true,
    };
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
  async registerGuide(guide: IMethodologyGuide, isBuiltIn: boolean = false): Promise<boolean> {
    const startTime = performance.now();

    try {
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
      if (this.guides.has(guide.frameworkId)) {
        this.logger.warn(`Guide with ID '${guide.frameworkId}' already registered, replacing...`);
      }

      // Create registry entry
      const entry: MethodologyGuideEntry = {
        guide,
        registeredAt: new Date(),
        isBuiltIn,
        enabled: true,
        metadata: {
          loadTime: performance.now() - startTime,
          validationStatus: this.config.validateOnRegistration ? 'passed' : 'not_validated',
        },
      };

      this.guides.set(guide.frameworkId, entry);

      this.logger.debug(
        `Registered ${isBuiltIn ? 'built-in' : 'custom'} methodology guide: ${guide.frameworkName} (${guide.frameworkId})`
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
    if (entry && entry.enabled) {
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
   * Get registry statistics
   */
  getRegistryStats() {
    this.ensureInitialized();

    const entries = Array.from(this.guides.values());
    const enabledCount = entries.filter((e) => e.enabled).length;
    const builtInCount = entries.filter((e) => e.isBuiltIn).length;

    return {
      totalGuides: entries.length,
      enabledGuides: enabledCount,
      builtInGuides: builtInCount,
      customGuides: entries.length - builtInCount,
      averageLoadTime:
        entries.reduce((sum, e) => sum + e.metadata.loadTime, 0) / entries.length || 0,
      initialized: this.initialized,
    };
  }

  // Private implementation methods

  /**
   * Load built-in methodology guides
   */
  private async loadBuiltInGuides(): Promise<void> {
    this.logger.debug('Loading built-in methodology guides...');

    const builtInGuides = [
      new CAGEERFMethodologyGuide(),
      new ReACTMethodologyGuide(),
      new FiveW1HMethodologyGuide(),
      new SCAMPERMethodologyGuide(),
    ];

    for (const guide of builtInGuides) {
      const success = await this.registerGuide(guide, true);
      if (!success) {
        this.logger.warn(`Failed to register built-in guide: ${guide.frameworkName}`);
      }
    }

    this.logger.info(`Loaded ${builtInGuides.length} built-in methodology guides`);
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

    if (!guide.methodology || typeof guide.methodology !== 'string') {
      errors.push('methodology is required and must be a string');
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
