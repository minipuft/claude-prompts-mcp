// @lifecycle canonical - Coordinates methodology selection and framework execution contexts.
/**
 * Framework Manager
 *
 * Orchestration layer for the framework system.
 * Extends BaseResourceManager to provide unified resource management patterns.
 *
 * Coordinates between:
 * - MethodologyRegistry: Manages methodology guides (source of truth)
 * - FrameworkDefinitions: Generated from methodology guides
 * - FrameworkStateManager: Runtime enable/disable state
 */

import { BaseResourceManager } from '../core/resource-manager/index.js';
import { Logger } from '../logging/index.js';
import { ConvertedPrompt } from '../types/index.js';
import { MethodologyRegistry, createMethodologyRegistry } from './methodology/index.js';
import {
  FrameworkDefinition,
  FrameworkExecutionContext,
  FrameworkMethodology,
  FrameworkSelectionCriteria,
  IMethodologyGuide,
} from './types/index.js';

/**
 * Framework switch request (matches FrameworkStateManager interface)
 */
interface FrameworkSwitchRequest {
  targetFramework: string;
  reason?: string;
}

/**
 * Framework state accessor interface
 */
interface FrameworkStateAccessor {
  isFrameworkSystemEnabled(): boolean;
  getActiveFramework(): { id: string; type: string; methodology: string } | null | undefined;
  switchFramework(request: FrameworkSwitchRequest): Promise<boolean>;
}

/**
 * Configuration for FrameworkManager
 */
export interface FrameworkManagerConfig {
  /** Default framework to use when none specified */
  defaultFramework?: string;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Statistics for FrameworkManager
 */
export interface FrameworkManagerStats {
  /** Total number of registered frameworks */
  totalFrameworks: number;
  /** Number of enabled frameworks */
  enabledFrameworks: number;
  /** Total methodology guides loaded */
  totalMethodologies: number;
  /** Currently active framework */
  activeFramework: string | null;
}

/**
 * Registry entry for frameworks (minimal wrapper since we use direct Map)
 */
export interface FrameworkEntry {
  framework: FrameworkDefinition;
  enabled: boolean;
  registeredAt: Date;
  source: 'methodology' | 'custom';
}

/**
 * Framework Manager
 *
 * Provides methodology selection and system prompt generation.
 * Generates FrameworkDefinitions from MethodologyGuides.
 *
 * @example
 * ```typescript
 * const manager = await createFrameworkManager(logger);
 *
 * // Select framework based on criteria
 * const framework = manager.selectFramework({ userPreference: 'CAGEERF' });
 *
 * // Generate execution context
 * const context = manager.generateExecutionContext(prompt);
 * ```
 */
export class FrameworkManager extends BaseResourceManager<
  FrameworkDefinition,
  FrameworkEntry,
  FrameworkManagerConfig,
  FrameworkManagerStats
> {
  private frameworks: Map<string, FrameworkDefinition> = new Map();
  private methodologyRegistry: MethodologyRegistry | null = null;
  private defaultFramework: string = 'CAGEERF';
  private frameworkStateManager?: FrameworkStateAccessor;

  constructor(logger: Logger, config: FrameworkManagerConfig = {}) {
    super(logger, config);
    if (config.defaultFramework) {
      this.defaultFramework = config.defaultFramework;
    }
  }

  // ============================================================================
  // BaseResourceManager Abstract Method Implementations
  // ============================================================================

  protected get managerName(): string {
    return 'FrameworkManager';
  }

  protected async initializeRegistry(): Promise<void> {
    // Initialize methodology registry
    this.methodologyRegistry = await createMethodologyRegistry(this.logger);
    this.logger.debug('MethodologyRegistry initialized');
  }

  protected override async postRegistryInit(): Promise<void> {
    // Generate framework definitions from methodology guides
    await this.generateFrameworkDefinitions();
    this.logger.info(`Generated ${this.frameworks.size} framework definitions`);
  }

  protected applyDefaultConfig(config: FrameworkManagerConfig): FrameworkManagerConfig {
    return {
      defaultFramework: config.defaultFramework ?? 'CAGEERF',
      debug: config.debug ?? false,
    };
  }

  protected getResource(id: string): FrameworkDefinition | undefined {
    // Normalize to lowercase - all keys are stored lowercase
    const framework = this.frameworks.get(id.toLowerCase());
    return framework?.enabled ? framework : undefined;
  }

  protected hasResource(id: string): boolean {
    // All keys are stored lowercase
    return this.frameworks.has(id.toLowerCase());
  }

  protected listResources(enabledOnly: boolean): FrameworkDefinition[] {
    const frameworks = Array.from(this.frameworks.values());
    return enabledOnly ? frameworks.filter((f) => f.enabled) : frameworks;
  }

  protected getResourceEntries(enabledOnly: boolean): FrameworkEntry[] {
    const entries: FrameworkEntry[] = [];
    for (const [, framework] of this.frameworks) {
      if (!enabledOnly || framework.enabled) {
        entries.push({
          framework,
          enabled: framework.enabled,
          registeredAt: new Date(),
          source: 'methodology',
        });
      }
    }
    return entries;
  }

  protected setResourceEnabled(id: string, enabled: boolean): boolean {
    const framework = this.getFrameworkById(id);
    if (framework) {
      framework.enabled = enabled;
      this.logger.info(`Framework ${id} ${enabled ? 'enabled' : 'disabled'}`);
      return true;
    }
    return false;
  }

  protected async reloadResource(id: string): Promise<boolean> {
    // For frameworks, reloading means regenerating from methodology guide
    const guide = this.methodologyRegistry?.getGuide(id.toLowerCase());
    if (!guide) return false;

    const definition = this.generateSingleFrameworkDefinition(guide);
    if (definition) {
      // Store with lowercase key for consistent lookup
      this.frameworks.set(definition.id.toLowerCase(), definition);
      this.logger.debug(`Reloaded framework: ${definition.id}`);
      return true;
    }
    return false;
  }

  protected unregisterResource(id: string): boolean {
    const lowerId = id.toLowerCase();
    let removed = false;

    // All keys are stored lowercase
    if (this.frameworks.has(lowerId)) {
      this.frameworks.delete(lowerId);
      removed = true;
    }

    if (this.methodologyRegistry) {
      const guideRemoved = this.methodologyRegistry.unregisterGuide(lowerId);
      if (guideRemoved) removed = true;
    }

    if (removed) {
      this.logger.info(`Framework '${id}' unregistered`);
    }
    return removed;
  }

  protected clearResourceCache(_id?: string): void {
    // MethodologyRegistry manages its own cache internally
    // Cache is cleared automatically on loadAndRegisterById()
  }

  protected getResourceStats(): FrameworkManagerStats {
    const frameworks = Array.from(this.frameworks.values());
    const enabled = frameworks.filter((f) => f.enabled);

    let activeFramework: string | null = null;
    if (this.frameworkStateManager?.isFrameworkSystemEnabled()) {
      const active = this.frameworkStateManager.getActiveFramework();
      if (active) activeFramework = active.type;
    }

    return {
      totalFrameworks: frameworks.length,
      enabledFrameworks: enabled.length,
      totalMethodologies: this.methodologyRegistry?.getAllGuides(false).length ?? 0,
      activeFramework,
    };
  }

  protected override isSystemEnabled(): boolean {
    if (!this.frameworkStateManager) return true;
    return this.frameworkStateManager.isFrameworkSystemEnabled();
  }

  // ============================================================================
  // Domain-Specific Methods
  // ============================================================================

  /**
   * Set the framework state manager for synchronization
   */
  setFrameworkStateManager(frameworkStateManager: FrameworkStateAccessor): void {
    this.frameworkStateManager = frameworkStateManager;
    this.logger.debug('Framework State Manager synchronized with Framework Manager');
  }

  /**
   * Switch to a new framework. Single authority for framework switching.
   * Handles normalization, validation, and delegates persistence to FrameworkStateManager.
   *
   * @param frameworkId - Framework identifier (case-insensitive)
   * @param reason - Optional reason for the switch
   * @returns Result object with success status, framework definition, or error message
   */
  async switchFramework(
    frameworkId: string,
    reason?: string
  ): Promise<{ success: boolean; framework?: FrameworkDefinition; error?: string }> {
    this.ensureInitialized();

    // 1. Normalize ID once at the boundary
    const normalizedId = frameworkId.toLowerCase();

    // 2. Validate framework exists and is enabled
    const framework = this.getFramework(normalizedId);
    if (!framework) {
      const available = this.listFrameworks(true)
        .map((f) => f.id)
        .join(', ');
      return {
        success: false,
        error: `Framework '${frameworkId}' not found. Available: ${available}`,
      };
    }

    if (!framework.enabled) {
      return { success: false, error: `Framework '${frameworkId}' is disabled` };
    }

    // 3. Delegate persistence to state manager
    if (!this.frameworkStateManager) {
      return { success: false, error: 'Framework state manager not initialized' };
    }

    try {
      const success = await this.frameworkStateManager.switchFramework({
        targetFramework: normalizedId,
        reason: reason || `Switched to ${framework.name}`,
      });

      if (success) {
        this.logger.info(`Framework switched to '${framework.name}' (${framework.id})`);
        return { success: true, framework };
      }

      return { success: false, error: 'Framework switch failed in state manager' };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Framework switch failed: ${errorMsg}`);
      return { success: false, error: errorMsg };
    }
  }

  /**
   * Select appropriate framework based on criteria
   */
  selectFramework(criteria: FrameworkSelectionCriteria = {}): FrameworkDefinition {
    this.ensureInitialized();

    // User preference takes priority
    if (criteria.userPreference && criteria.userPreference !== 'AUTO') {
      const preferred = this.getFramework(criteria.userPreference);
      if (preferred?.enabled) {
        this.logger.debug(`Framework selected by user preference: ${preferred.name}`);
        return preferred;
      } else {
        this.logger.warn(
          `Requested framework ${criteria.userPreference} not found or disabled, using default`
        );
      }
    }

    // Check state manager for active framework
    if (this.frameworkStateManager?.isFrameworkSystemEnabled()) {
      const activeFramework = this.frameworkStateManager.getActiveFramework();
      if (activeFramework) {
        const framework = this.getFramework(activeFramework.type);
        if (framework?.enabled) {
          this.logger.debug(`Framework selected: ${framework.name} (from active state manager)`);
          return framework;
        }
      }
    }

    // Fallback to default framework
    const defaultFw = this.getFramework(this.defaultFramework);
    if (!defaultFw) {
      throw new Error(`Default framework ${this.defaultFramework} not found`);
    }

    this.logger.debug(`Framework selected: ${defaultFw.name} (default fallback)`);
    return defaultFw;
  }

  /**
   * Generate execution context with system prompts and guidelines
   */
  generateExecutionContext(
    prompt: ConvertedPrompt,
    criteria: FrameworkSelectionCriteria = {}
  ): FrameworkExecutionContext {
    const selectedFramework = this.selectFramework(criteria);
    const systemPrompt = this.generateSystemPrompt(selectedFramework, prompt);

    return {
      selectedFramework,
      systemPrompt,
      executionGuidelines: [...selectedFramework.executionGuidelines],
      metadata: {
        selectionReason: this.getSelectionReason(selectedFramework, criteria),
        confidence: 1.0,
        appliedAt: new Date(),
      },
    };
  }

  /**
   * Get framework by methodology type (case-insensitive)
   */
  getFramework(methodology: string): FrameworkDefinition | undefined {
    return this.get(methodology);
  }

  /**
   * List available frameworks
   */
  listFrameworks(enabledOnly: boolean = false): FrameworkDefinition[] {
    return this.list(enabledOnly);
  }

  /**
   * Check if a framework exists and is enabled
   *
   * @param id - Framework identifier (case-insensitive)
   * @returns true if framework exists and is enabled
   */
  isFrameworkEnabled(id: string): boolean {
    const framework = this.getFramework(id);
    return framework?.enabled ?? false;
  }

  /**
   * Get list of framework IDs
   *
   * @param enabledOnly - Only return enabled frameworks (default: false)
   * @returns Array of framework IDs in uppercase
   */
  getFrameworkIds(enabledOnly: boolean = false): string[] {
    return this.listFrameworks(enabledOnly).map((f) => f.id);
  }

  /**
   * Validate framework identifier and return normalized ID or error details
   *
   * @param id - Framework identifier to validate
   * @returns Validation result with normalized ID or error message
   */
  validateIdentifier(id: string): {
    valid: boolean;
    normalizedId?: string;
    error?: string;
    suggestions?: string[];
  } {
    if (id === '' || typeof id !== 'string') {
      return {
        valid: false,
        error: 'Framework identifier is required',
        suggestions: this.getFrameworkIds(false),
      };
    }

    const trimmed = id.trim();
    if (trimmed === '') {
      return {
        valid: false,
        error: 'Framework identifier cannot be empty',
        suggestions: this.getFrameworkIds(false),
      };
    }

    const normalizedId = trimmed.toUpperCase();
    const framework = this.getFramework(normalizedId);

    if (framework !== undefined) {
      return {
        valid: true,
        normalizedId: framework.id,
      };
    }

    return {
      valid: false,
      error: `Framework '${id}' not found`,
      suggestions: this.getFrameworkIds(false),
    };
  }

  /**
   * Get methodology guide by framework ID
   */
  getMethodologyGuide(frameworkId: string): IMethodologyGuide | undefined {
    this.ensureInitialized();
    return this.methodologyRegistry!.getGuide(frameworkId.toLowerCase());
  }

  /**
   * List available methodology guides
   */
  listMethodologyGuides(): IMethodologyGuide[] {
    this.ensureInitialized();
    return this.methodologyRegistry!.getAllGuides(true);
  }

  /**
   * Expose the methodology registry for integrations
   */
  getMethodologyRegistry(): MethodologyRegistry {
    this.ensureInitialized();
    if (!this.methodologyRegistry) {
      throw new Error('Methodology registry not initialized');
    }
    return this.methodologyRegistry;
  }

  /**
   * Set default framework
   */
  setDefaultFramework(methodology: FrameworkMethodology): void {
    if (this.hasResource(methodology)) {
      this.defaultFramework = methodology;
      this.logger.info(`Default framework set to: ${methodology}`);
    } else {
      throw new Error(`Framework ${methodology} not found`);
    }
  }

  /**
   * Register a new framework by loading from disk
   */
  async registerFramework(frameworkId: string): Promise<boolean> {
    this.ensureInitialized();

    const normalizedId = frameworkId.toLowerCase();

    try {
      if (!this.methodologyRegistry) {
        this.logger.error('MethodologyRegistry not available');
        return false;
      }

      const guideLoaded = await this.methodologyRegistry.loadAndRegisterById(normalizedId);
      if (!guideLoaded) {
        this.logger.warn(`Failed to load methodology guide for '${frameworkId}'`);
        return false;
      }

      const guide = this.methodologyRegistry.getGuide(normalizedId);
      if (!guide) {
        this.logger.error(`Guide loaded but cannot be retrieved: ${frameworkId}`);
        return false;
      }

      const definition = this.generateSingleFrameworkDefinition(guide);
      if (definition) {
        // Store with lowercase key for consistent lookup
        this.frameworks.set(normalizedId, definition);
        this.logger.info(`Framework '${frameworkId}' registered`);
        return true;
      }

      return false;
    } catch (error) {
      this.logger.error(`Failed to register framework '${frameworkId}':`, error);
      return false;
    }
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  /**
   * Get framework by ID (all keys are stored lowercase)
   */
  private getFrameworkById(id: string): FrameworkDefinition | undefined {
    return this.frameworks.get(id.toLowerCase());
  }

  /**
   * Generate framework definitions from methodology guides
   */
  private async generateFrameworkDefinitions(): Promise<void> {
    try {
      const guides = this.methodologyRegistry!.getAllGuides(true);

      for (const guide of guides) {
        const definition = this.generateSingleFrameworkDefinition(guide);
        if (definition) {
          // Store with lowercase key for consistent lookup
          this.frameworks.set(definition.id.toLowerCase(), definition);
          this.logger.debug(`Generated framework definition for ${guide.frameworkName}`);
        }
      }

      this.logger.info(
        `Generated ${this.frameworks.size} framework definitions from methodology guides`
      );
    } catch (error) {
      this.logger.error('Failed to generate framework definitions:', error);
      throw error;
    }
  }

  /**
   * Generate a single framework definition from a methodology guide
   */
  private generateSingleFrameworkDefinition(guide: IMethodologyGuide): FrameworkDefinition | null {
    try {
      const systemPromptTemplate = this.generateSystemPromptTemplate(guide);

      return {
        id: guide.frameworkId.toUpperCase(),
        name: guide.frameworkName,
        description: this.getFrameworkDescription(guide),
        type: guide.type,
        methodology: guide.type, // Backward compat: methodology mirrors type
        systemPromptTemplate,
        executionGuidelines: this.getExecutionGuidelines(guide),
        applicableTypes: this.getApplicableTypes(guide),
        priority: this.getFrameworkPriority(guide),
        enabled: true,
      };
    } catch (error) {
      this.logger.error(`Failed to generate definition for ${guide.frameworkId}:`, error);
      return null;
    }
  }

  /**
   * Generate system prompt template wrapper
   */
  private generateSystemPromptTemplate(guide: IMethodologyGuide): string {
    return `You are operating under the ${guide.frameworkName} methodology for {PROMPT_NAME}.

{METHODOLOGY_GUIDANCE}

Apply this methodology systematically to ensure comprehensive and structured responses.`;
  }

  /**
   * Get framework description
   */
  private getFrameworkDescription(guide: IMethodologyGuide): string {
    switch (guide.type) {
      case 'CAGEERF':
        return 'Comprehensive structured approach: Context, Analysis, Goals, Execution, Evaluation, Refinement, Framework';
      case 'ReACT':
        return 'Reasoning and Acting pattern for systematic problem-solving';
      case '5W1H':
        return 'Who, What, When, Where, Why, How systematic analysis';
      case 'SCAMPER':
        return 'Creative problem-solving: Substitute, Combine, Adapt, Modify, Put to other uses, Eliminate, Reverse';
      default:
        return `${guide.type} methodology for systematic approach`;
    }
  }

  /**
   * Get execution guidelines from methodology guide
   */
  private getExecutionGuidelines(guide: IMethodologyGuide): string[] {
    const processingGuidance = guide.guideTemplateProcessing('', 'single');
    return processingGuidance.templateEnhancements.systemPromptAdditions;
  }

  /**
   * Get applicable types for framework
   */
  private getApplicableTypes(guide: IMethodologyGuide): string[] {
    switch (guide.type) {
      case 'CAGEERF':
        return ['chain', 'template'];
      case 'ReACT':
        return ['chain'];
      case '5W1H':
        return ['template', 'chain'];
      case 'SCAMPER':
        return ['template'];
      default:
        return ['template'];
    }
  }

  /**
   * Get framework priority
   */
  private getFrameworkPriority(guide: IMethodologyGuide): number {
    switch (guide.type) {
      case 'CAGEERF':
        return 10;
      case 'ReACT':
        return 8;
      case '5W1H':
        return 7;
      case 'SCAMPER':
        return 6;
      default:
        return 5;
    }
  }

  /**
   * Generate framework-specific system prompt
   */
  private generateSystemPrompt(framework: FrameworkDefinition, prompt: ConvertedPrompt): string {
    let systemPrompt = framework.systemPromptTemplate;

    systemPrompt = systemPrompt.replace(/\{PROMPT_NAME\}/g, prompt.name || 'Prompt');
    systemPrompt = systemPrompt.replace(/\{PROMPT_CATEGORY\}/g, prompt.category || 'general');
    systemPrompt = systemPrompt.replace(/\{FRAMEWORK_NAME\}/g, framework.name);

    const guide = this.getMethodologyGuide(framework.id);
    if (guide) {
      const guidance = guide.getSystemPromptGuidance({
        promptName: prompt.name,
        promptCategory: prompt.category,
      });
      systemPrompt = systemPrompt.replace(/\{METHODOLOGY_GUIDANCE\}/g, guidance);
    }

    return systemPrompt;
  }

  /**
   * Get selection reason for context metadata
   */
  private getSelectionReason(
    framework: FrameworkDefinition,
    criteria: FrameworkSelectionCriteria
  ): string {
    if (criteria.userPreference && criteria.userPreference !== 'AUTO') {
      return `User preference: ${criteria.userPreference}`;
    }
    return 'Default framework selection';
  }
}

/**
 * Create and initialize a FrameworkManager instance
 */
export async function createFrameworkManager(
  logger: Logger,
  config?: FrameworkManagerConfig
): Promise<FrameworkManager> {
  const manager = new FrameworkManager(logger, config);
  await manager.initialize();
  return manager;
}

// Export types
export type { FrameworkDefinition, FrameworkExecutionContext, FrameworkSelectionCriteria };
