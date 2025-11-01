/**
 * Framework Manager - Phase 2 Implementation
 * Manages methodology selection and system prompt guidelines
 * Framework = Constitutional guidelines for HOW to execute prompts, not analysis tools
 */

import { Logger } from "../logging/index.js";
import { ConvertedPrompt } from "../types/index.js";
import {
  IMethodologyGuide,
  FrameworkMethodology,
  FrameworkDefinition,
  FrameworkExecutionContext,
  FrameworkSelectionCriteria
} from "./types/index.js";
import { MethodologyRegistry, createMethodologyRegistry } from "./methodology/index.js";

interface FrameworkStateAccessor {
  isFrameworkSystemEnabled(): boolean;
  getActiveFramework(): { methodology: string } | null | undefined;
}

/**
 * Framework Manager Implementation
 * Provides methodology selection and system prompt generation
 */
export class FrameworkManager {
  private frameworks: Map<string, FrameworkDefinition> = new Map();
  private methodologyRegistry: MethodologyRegistry | null = null;
  private defaultFramework: string = "CAGEERF";
  private logger: Logger;
  private initialized: boolean = false;
  private frameworkStateManager?: FrameworkStateAccessor;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Set the framework state manager for synchronization
   * FIXED: Allows Framework Manager to sync with active framework state
   */
  setFrameworkStateManager(frameworkStateManager: FrameworkStateAccessor): void {
    this.frameworkStateManager = frameworkStateManager;
    this.logger.debug("Framework State Manager synchronized with Framework Manager");
  }

  /**
   * Initialize framework definitions and system templates
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      this.logger.debug("FrameworkManager already initialized");
      return;
    }

    this.logger.info("Initializing FrameworkManager with methodology registry...");

    // Initialize methodology registry (Phase 2: NEW)
    this.methodologyRegistry = await createMethodologyRegistry(this.logger);

    // Generate framework definitions from methodology guides
    await this.generateFrameworkDefinitions();

    this.initialized = true;
    this.logger.info(`FrameworkManager initialized with ${this.frameworks.size} frameworks`);
  }

  /**
   * Select appropriate framework based on criteria
   * Simplified selection since frameworks are user-controlled via MCP tools
   */
  selectFramework(criteria: FrameworkSelectionCriteria = {}): FrameworkDefinition {
    this.ensureInitialized();

    // User preference takes priority (this is the primary selection mechanism)
    if (criteria.userPreference && criteria.userPreference !== "AUTO") {
      const preferred = this.getFramework(criteria.userPreference);
      if (preferred && preferred.enabled) {
        this.logger.debug(`Framework selected by user preference: ${preferred.name}`);
        return preferred;
      } else {
        this.logger.warn(`Requested framework ${criteria.userPreference} not found or disabled, using default`);
      }
    }

    // FIXED: Check Framework State Manager for active framework before using hardcoded default
    // This ensures all injection points get the same active framework
    if (this.frameworkStateManager?.isFrameworkSystemEnabled()) {
      const activeFramework = this.frameworkStateManager.getActiveFramework();
      if (activeFramework) {
        const framework = this.getFramework(activeFramework.methodology);
        if (framework && framework.enabled) {
          this.logger.debug(`Framework selected: ${framework.name} (from active state manager)`);
          return framework;
        }
      }
    }

    // Fallback to default framework only if state manager is not available
    const defaultFramework = this.getFramework(this.defaultFramework);
    if (!defaultFramework) {
      throw new Error(`Default framework ${this.defaultFramework} not found`);
    }

    this.logger.debug(`Framework selected: ${defaultFramework.name} (default fallback)`);
    return defaultFramework;
  }

  /**
   * Generate execution context with system prompts and guidelines
   */
  generateExecutionContext(
    prompt: ConvertedPrompt, 
    criteria: FrameworkSelectionCriteria = {}
  ): FrameworkExecutionContext {
    const selectedFramework = this.selectFramework(criteria);
    
    // Generate framework-specific system prompt
    const systemPrompt = this.generateSystemPrompt(selectedFramework, prompt);
    
    return {
      selectedFramework,
      systemPrompt,
      executionGuidelines: [...selectedFramework.executionGuidelines],
      metadata: {
        selectionReason: this.getSelectionReason(selectedFramework, criteria),
        confidence: 1.0, // High confidence since frameworks are user-selected
        appliedAt: new Date()
      }
    };
  }

  /**
   * Get framework by methodology type
   * Supports case-insensitive lookup for robust framework switching
   */
  getFramework(methodology: string): FrameworkDefinition | undefined {
    this.ensureInitialized();
    
    // Try exact match first (fastest path)
    let framework = this.frameworks.get(methodology);
    if (framework) {
      this.logger.debug(`Framework found via exact match: ${methodology} -> ${framework.name}`);
      return framework;
    }
    
    // Try uppercase match (most common conversion)
    const upperCaseId = methodology.toUpperCase();
    framework = this.frameworks.get(upperCaseId);
    if (framework) {
      this.logger.debug(`Framework found via uppercase match: ${methodology} -> ${framework.name}`);
      return framework;
    }
    
    // Try case-insensitive search through all frameworks
    for (const [id, def] of this.frameworks) {
      if (id.toLowerCase() === methodology.toLowerCase()) {
        this.logger.debug(`Framework found via case-insensitive match: ${methodology} -> ${def.name}`);
        return def;
      }
      
      // Also check methodology field for additional matching
      if (def.methodology.toLowerCase() === methodology.toLowerCase()) {
        this.logger.debug(`Framework found via methodology match: ${methodology} -> ${def.name}`);
        return def;
      }
    }
    
    // Log available frameworks for debugging
    const availableIds = Array.from(this.frameworks.keys());
    this.logger.warn(`Framework '${methodology}' not found. Available frameworks: [${availableIds.join(', ')}]`);
    return undefined;
  }

  /**
   * List available frameworks
   */
  listFrameworks(enabledOnly: boolean = false): FrameworkDefinition[] {
    const frameworks = Array.from(this.frameworks.values());
    return enabledOnly ? frameworks.filter(f => f.enabled) : frameworks;
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
   * Check if framework is applicable for given criteria
   */
  private isApplicable(framework: FrameworkDefinition, criteria: FrameworkSelectionCriteria): boolean {
    // Check execution type compatibility
    if (criteria.executionType && framework.applicableTypes.length > 0) {
      if (!framework.applicableTypes.includes(criteria.executionType)) {
        return false;
      }
    }

    // All enabled frameworks are generally applicable
    return framework.enabled;
  }

  /**
   * Calculate fit score for framework selection
   */
  private calculateFitScore(framework: FrameworkDefinition, criteria: FrameworkSelectionCriteria): number {
    let score = framework.priority;

    // Execution type match bonus
    if (criteria.executionType && framework.applicableTypes.includes(criteria.executionType)) {
      score += 10;
    }

    // Complexity match bonus
    if (criteria.complexity) {
      switch (criteria.complexity) {
        case 'high':
          if (framework.methodology === 'CAGEERF') score += 15;
          break;
        case 'medium':
          if (framework.methodology === 'ReACT' || framework.methodology === '5W1H') score += 10;
          break;
        case 'low':
          if (framework.methodology === 'SCAMPER') score += 5;
          break;
      }
    }

    return score;
  }

  /**
   * Generate framework-specific system prompt
   */
  private generateSystemPrompt(framework: FrameworkDefinition, prompt: ConvertedPrompt): string {
    let systemPrompt = framework.systemPromptTemplate;
    
    // Replace template variables
    systemPrompt = systemPrompt.replace(/\{PROMPT_NAME\}/g, prompt.name || 'Prompt');
    systemPrompt = systemPrompt.replace(/\{PROMPT_CATEGORY\}/g, prompt.category || 'general');
    systemPrompt = systemPrompt.replace(/\{FRAMEWORK_NAME\}/g, framework.name);
    
    return systemPrompt;
  }

  /**
   * Get selection reason for context metadata (simplified)
   */
  private getSelectionReason(framework: FrameworkDefinition, criteria: FrameworkSelectionCriteria): string {
    if (criteria.userPreference && criteria.userPreference !== "AUTO") {
      return `User preference: ${criteria.userPreference}`;
    }
    
    return "Default framework selection";
  }

  /**
   * Initialize methodology guides registry (REMOVED - Phase 2)
   * Functionality moved to MethodologyRegistry for better separation of concerns
   */

  /**
   * Generate framework definitions from methodology guides
   */
  private async generateFrameworkDefinitions(): Promise<void> {
    try {
      const guides = this.methodologyRegistry!.getAllGuides(true);

      for (const guide of guides) {
        // Generate system prompt template from methodology guide
        const systemPromptTemplate = this.generateSystemPromptTemplate(guide);

        // Create framework definition from methodology guide
        const frameworkDefinition: FrameworkDefinition = {
          id: guide.frameworkId.toUpperCase(),
          name: guide.frameworkName,
          description: this.getFrameworkDescription(guide),
          methodology: guide.methodology as FrameworkMethodology,
          systemPromptTemplate,
          executionGuidelines: this.getExecutionGuidelines(guide),
          applicableTypes: this.getApplicableTypes(guide),
          priority: this.getFrameworkPriority(guide),
          enabled: true
        };

        this.frameworks.set(frameworkDefinition.id, frameworkDefinition);
        this.logger.debug(`Generated framework definition for ${guide.frameworkName}`);
      }

      this.logger.info(`Generated ${this.frameworks.size} framework definitions from methodology guides`);
    } catch (error) {
      this.logger.error("Failed to generate framework definitions:", error);
      throw error;
    }
  }

  /**
   * Generate system prompt template from methodology guide
   */
  private generateSystemPromptTemplate(guide: IMethodologyGuide): string {
    const baseGuidance = guide.getSystemPromptGuidance({});
    return `You are operating under the ${guide.frameworkName} methodology for {PROMPT_NAME}.

${baseGuidance}

Apply this methodology systematically to ensure comprehensive and structured responses.`;
  }

  /**
   * Get framework description from methodology guide
   */
  private getFrameworkDescription(guide: IMethodologyGuide): string {
    // Generate descriptions based on methodology type
    switch (guide.methodology) {
      case "CAGEERF":
        return "Comprehensive structured approach: Context, Analysis, Goals, Execution, Evaluation, Refinement, Framework";
      case "ReACT":
        return "Reasoning and Acting pattern for systematic problem-solving";
      case "5W1H":
        return "Who, What, When, Where, Why, How systematic analysis";
      case "SCAMPER":
        return "Creative problem-solving: Substitute, Combine, Adapt, Modify, Put to other uses, Eliminate, Reverse";
      default:
        return `${guide.methodology} methodology for systematic approach`;
    }
  }

  /**
   * Get execution guidelines from methodology guide
   */
  private getExecutionGuidelines(guide: IMethodologyGuide): string[] {
    // Generate basic guidelines from methodology guide context
    const processingGuidance = guide.guideTemplateProcessing("", "template");
    return processingGuidance.templateEnhancements.systemPromptAdditions;
  }

  /**
   * Get applicable types for framework based on methodology
   */
  private getApplicableTypes(guide: IMethodologyGuide): string[] {
    switch (guide.methodology) {
      case "CAGEERF":
        return ["chain", "template"];
      case "ReACT":
        return ["chain"];
      case "5W1H":
        return ["template", "chain"];
      case "SCAMPER":
        return ["template"];
      default:
        return ["template"];
    }
  }

  /**
   * Get framework priority based on methodology
   */
  private getFrameworkPriority(guide: IMethodologyGuide): number {
    switch (guide.methodology) {
      case "CAGEERF":
        return 10;
      case "ReACT":
        return 8;
      case "5W1H":
        return 7;
      case "SCAMPER":
        return 6;
      default:
        return 5;
    }
  }

  /**
   * Ensure manager is initialized before use
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error("FrameworkManager not initialized. Call initialize() first.");
    }
  }

  /**
   * Get initialization status
   */
  get isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Enable/disable specific framework
   */
  setFrameworkEnabled(methodology: FrameworkMethodology, enabled: boolean): void {
    const framework = this.frameworks.get(methodology);
    if (framework) {
      framework.enabled = enabled;
      this.logger.info(`Framework ${methodology} ${enabled ? 'enabled' : 'disabled'}`);
    }
  }

  /**
   * Set default framework
   */
  setDefaultFramework(methodology: FrameworkMethodology): void {
    if (this.frameworks.has(methodology)) {
      this.defaultFramework = methodology;
      this.logger.info(`Default framework set to: ${methodology}`);
    } else {
      throw new Error(`Framework ${methodology} not found`);
    }
  }
}

/**
 * Create and initialize a FrameworkManager instance
 */
export async function createFrameworkManager(logger: Logger): Promise<FrameworkManager> {
  const manager = new FrameworkManager(logger);
  await manager.initialize();
  return manager;
}

// Export types that are used by other modules
export type { FrameworkDefinition, FrameworkExecutionContext, FrameworkSelectionCriteria };
