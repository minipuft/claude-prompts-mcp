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
import { createMethodologyRegistry } from './methodology/index.js';
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
export class FrameworkManager extends BaseResourceManager {
    constructor(logger, config = {}) {
        super(logger, config);
        this.frameworks = new Map();
        this.methodologyRegistry = null;
        this.defaultFramework = 'CAGEERF';
        if (config.defaultFramework) {
            this.defaultFramework = config.defaultFramework;
        }
    }
    // ============================================================================
    // BaseResourceManager Abstract Method Implementations
    // ============================================================================
    get managerName() {
        return 'FrameworkManager';
    }
    async initializeRegistry() {
        // Initialize methodology registry
        this.methodologyRegistry = await createMethodologyRegistry(this.logger);
        this.logger.debug('MethodologyRegistry initialized');
    }
    async postRegistryInit() {
        // Generate framework definitions from methodology guides
        await this.generateFrameworkDefinitions();
        this.logger.info(`Generated ${this.frameworks.size} framework definitions`);
    }
    applyDefaultConfig(config) {
        return {
            defaultFramework: config.defaultFramework ?? 'CAGEERF',
            debug: config.debug ?? false,
        };
    }
    getResource(id) {
        // Normalize to lowercase - all keys are stored lowercase
        const framework = this.frameworks.get(id.toLowerCase());
        return framework?.enabled ? framework : undefined;
    }
    hasResource(id) {
        // All keys are stored lowercase
        return this.frameworks.has(id.toLowerCase());
    }
    listResources(enabledOnly) {
        const frameworks = Array.from(this.frameworks.values());
        return enabledOnly ? frameworks.filter((f) => f.enabled) : frameworks;
    }
    getResourceEntries(enabledOnly) {
        const entries = [];
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
    setResourceEnabled(id, enabled) {
        const framework = this.getFrameworkById(id);
        if (framework) {
            framework.enabled = enabled;
            this.logger.info(`Framework ${id} ${enabled ? 'enabled' : 'disabled'}`);
            return true;
        }
        return false;
    }
    async reloadResource(id) {
        // For frameworks, reloading means regenerating from methodology guide
        const guide = this.methodologyRegistry?.getGuide(id.toLowerCase());
        if (!guide)
            return false;
        const definition = this.generateSingleFrameworkDefinition(guide);
        if (definition) {
            // Store with lowercase key for consistent lookup
            this.frameworks.set(definition.id.toLowerCase(), definition);
            this.logger.debug(`Reloaded framework: ${definition.id}`);
            return true;
        }
        return false;
    }
    unregisterResource(id) {
        const lowerId = id.toLowerCase();
        let removed = false;
        // All keys are stored lowercase
        if (this.frameworks.has(lowerId)) {
            this.frameworks.delete(lowerId);
            removed = true;
        }
        if (this.methodologyRegistry) {
            const guideRemoved = this.methodologyRegistry.unregisterGuide(lowerId);
            if (guideRemoved)
                removed = true;
        }
        if (removed) {
            this.logger.info(`Framework '${id}' unregistered`);
        }
        return removed;
    }
    clearResourceCache(_id) {
        // MethodologyRegistry manages its own cache internally
        // Cache is cleared automatically on loadAndRegisterById()
    }
    getResourceStats() {
        const frameworks = Array.from(this.frameworks.values());
        const enabled = frameworks.filter((f) => f.enabled);
        let activeFramework = null;
        if (this.frameworkStateManager?.isFrameworkSystemEnabled()) {
            const active = this.frameworkStateManager.getActiveFramework();
            if (active)
                activeFramework = active.type;
        }
        return {
            totalFrameworks: frameworks.length,
            enabledFrameworks: enabled.length,
            totalMethodologies: this.methodologyRegistry?.getAllGuides(false).length ?? 0,
            activeFramework,
        };
    }
    isSystemEnabled() {
        if (!this.frameworkStateManager)
            return true;
        return this.frameworkStateManager.isFrameworkSystemEnabled();
    }
    // ============================================================================
    // Domain-Specific Methods
    // ============================================================================
    /**
     * Set the framework state manager for synchronization
     */
    setFrameworkStateManager(frameworkStateManager) {
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
    async switchFramework(frameworkId, reason) {
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
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            this.logger.error(`Framework switch failed: ${errorMsg}`);
            return { success: false, error: errorMsg };
        }
    }
    /**
     * Select appropriate framework based on criteria
     */
    selectFramework(criteria = {}) {
        this.ensureInitialized();
        // User preference takes priority
        if (criteria.userPreference && criteria.userPreference !== 'AUTO') {
            const preferred = this.getFramework(criteria.userPreference);
            if (preferred?.enabled) {
                this.logger.debug(`Framework selected by user preference: ${preferred.name}`);
                return preferred;
            }
            else {
                this.logger.warn(`Requested framework ${criteria.userPreference} not found or disabled, using default`);
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
    generateExecutionContext(prompt, criteria = {}) {
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
    getFramework(methodology) {
        return this.get(methodology);
    }
    /**
     * List available frameworks
     */
    listFrameworks(enabledOnly = false) {
        return this.list(enabledOnly);
    }
    /**
     * Check if a framework exists and is enabled
     *
     * @param id - Framework identifier (case-insensitive)
     * @returns true if framework exists and is enabled
     */
    isFrameworkEnabled(id) {
        const framework = this.getFramework(id);
        return framework?.enabled ?? false;
    }
    /**
     * Get list of framework IDs
     *
     * @param enabledOnly - Only return enabled frameworks (default: false)
     * @returns Array of framework IDs in uppercase
     */
    getFrameworkIds(enabledOnly = false) {
        return this.listFrameworks(enabledOnly).map((f) => f.id);
    }
    /**
     * Validate framework identifier and return normalized ID or error details
     *
     * @param id - Framework identifier to validate
     * @returns Validation result with normalized ID or error message
     */
    validateIdentifier(id) {
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
    getMethodologyGuide(frameworkId) {
        this.ensureInitialized();
        return this.methodologyRegistry.getGuide(frameworkId.toLowerCase());
    }
    /**
     * List available methodology guides
     */
    listMethodologyGuides() {
        this.ensureInitialized();
        return this.methodologyRegistry.getAllGuides(true);
    }
    /**
     * Expose the methodology registry for integrations
     */
    getMethodologyRegistry() {
        this.ensureInitialized();
        if (!this.methodologyRegistry) {
            throw new Error('Methodology registry not initialized');
        }
        return this.methodologyRegistry;
    }
    /**
     * Set default framework
     */
    setDefaultFramework(methodology) {
        if (this.hasResource(methodology)) {
            this.defaultFramework = methodology;
            this.logger.info(`Default framework set to: ${methodology}`);
        }
        else {
            throw new Error(`Framework ${methodology} not found`);
        }
    }
    /**
     * Register a new framework by loading from disk
     */
    async registerFramework(frameworkId) {
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
        }
        catch (error) {
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
    getFrameworkById(id) {
        return this.frameworks.get(id.toLowerCase());
    }
    /**
     * Generate framework definitions from methodology guides
     */
    async generateFrameworkDefinitions() {
        try {
            const guides = this.methodologyRegistry.getAllGuides(true);
            for (const guide of guides) {
                const definition = this.generateSingleFrameworkDefinition(guide);
                if (definition) {
                    // Store with lowercase key for consistent lookup
                    this.frameworks.set(definition.id.toLowerCase(), definition);
                    this.logger.debug(`Generated framework definition for ${guide.frameworkName}`);
                }
            }
            this.logger.info(`Generated ${this.frameworks.size} framework definitions from methodology guides`);
        }
        catch (error) {
            this.logger.error('Failed to generate framework definitions:', error);
            throw error;
        }
    }
    /**
     * Generate a single framework definition from a methodology guide
     */
    generateSingleFrameworkDefinition(guide) {
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
        }
        catch (error) {
            this.logger.error(`Failed to generate definition for ${guide.frameworkId}:`, error);
            return null;
        }
    }
    /**
     * Generate system prompt template wrapper
     */
    generateSystemPromptTemplate(guide) {
        return `You are operating under the ${guide.frameworkName} methodology for {PROMPT_NAME}.

{METHODOLOGY_GUIDANCE}

Apply this methodology systematically to ensure comprehensive and structured responses.`;
    }
    /**
     * Get framework description
     */
    getFrameworkDescription(guide) {
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
    getExecutionGuidelines(guide) {
        const processingGuidance = guide.guideTemplateProcessing('', 'single');
        return processingGuidance.templateEnhancements.systemPromptAdditions;
    }
    /**
     * Get applicable types for framework
     */
    getApplicableTypes(guide) {
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
    getFrameworkPriority(guide) {
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
    generateSystemPrompt(framework, prompt) {
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
    getSelectionReason(framework, criteria) {
        if (criteria.userPreference && criteria.userPreference !== 'AUTO') {
            return `User preference: ${criteria.userPreference}`;
        }
        return 'Default framework selection';
    }
}
/**
 * Create and initialize a FrameworkManager instance
 */
export async function createFrameworkManager(logger, config) {
    const manager = new FrameworkManager(logger, config);
    await manager.initialize();
    return manager;
}
//# sourceMappingURL=framework-manager.js.map