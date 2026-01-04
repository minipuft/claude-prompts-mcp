/**
 * Consolidated Prompt Engine - Unified Execution Tool
 *
 * Consolidates all prompt execution functionality into a single systematic tool:
 * - execute_prompt (from index.ts)
 * - Chain execution with progress tracking
 * - Structural execution mode detection
 * - Gate validation and retry logic
 */
import * as path from "node:path";
// REMOVED: ModularChainDefinition from deleted chain-scaffolding.ts
import { isChainPrompt, handleError as utilsHandleError, } from "../../../utils/index.js";
import { ArgumentHistoryTracker } from "../../../text-references/index.js";
import { createChainSessionManager, } from "../../../chain-session/manager.js";
// Legacy gate system removed - using lightweight gates only
// NEW: Lightweight gate system
import { createLightweightGateSystem, } from "../../../gates/core/index.js";
// NEW: Role-based gate components (Phase 3)
import { createGateGuidanceRenderer, } from "../../../gates/guidance/GateGuidanceRenderer.js";
// Gate validation integration
import { EngineValidator, } from "../utils/validation.js";
// Phase 4: Clean architecture gate intelligence (replaced advanced orchestrator)
import { createGateSelectionEngine, } from "../../../gates/intelligence/GateSelectionEngine.js";
// Phase 3: Prompt guidance system integration
import { createPromptGuidanceService } from "../../../frameworks/prompt-guidance/index.js";
// REMOVED: ChainOrchestrator and detectChainType/isModularChain - modular chain system completely removed
// REMOVED: Chain URI addressing system - deprecated with markdown-embedded chains
// New unified parsing system
import { createParsingSystem, } from "../../../execution/parsers/index.js";
import { createSymbolicCommandParser } from "../../../execution/parsers/symbolic-command-parser.js";
import { ChainOperatorExecutor, } from "../../../execution/operators/index.js";
import { ChainManagementService } from "./chain-management.js";
// Response formatter
import { ResponseFormatter } from "../processors/response-formatter.js";
import { PromptExecutionPipeline } from "../../../execution/pipeline/prompt-execution-pipeline.js";
import { RequestNormalizationStage } from "../../../execution/pipeline/stages/00-request-normalization-stage.js";
import { DependencyInjectionStage } from "../../../execution/pipeline/stages/00-dependency-injection-stage.js";
import { ExecutionLifecycleStage } from "../../../execution/pipeline/stages/00-execution-lifecycle-stage.js";
import { CommandParsingStage } from "../../../execution/pipeline/stages/01-parsing-stage.js";
import { InlineGateExtractionStage } from "../../../execution/pipeline/stages/02-inline-gate-stage.js";
import { OperatorValidationStage } from "../../../execution/pipeline/stages/03-operator-validation-stage.js";
import { ExecutionPlanningStage } from "../../../execution/pipeline/stages/04-planning-stage.js";
import { GateEnhancementStage } from "../../../execution/pipeline/stages/05-gate-enhancement-stage.js";
import { FrameworkResolutionStage } from "../../../execution/pipeline/stages/06-framework-stage.js";
import { PromptGuidanceStage } from "../../../execution/pipeline/stages/06b-prompt-guidance-stage.js";
import { SessionManagementStage } from "../../../execution/pipeline/stages/07-session-stage.js";
import { StepResponseCaptureStage } from "../../../execution/pipeline/stages/08-response-capture-stage.js";
import { StepExecutionStage } from "../../../execution/pipeline/stages/09-execution-stage.js";
import { GateReviewStage } from "../../../execution/pipeline/stages/10-gate-review-stage.js";
import { CallToActionStage } from "../../../execution/pipeline/stages/11-call-to-action-stage.js";
import { ResponseFormattingStage } from "../../../execution/pipeline/stages/10-formatting-stage.js";
import { PostFormattingCleanupStage } from "../../../execution/pipeline/stages/12-post-formatting-cleanup-stage.js";
import { FrameworkValidator } from "../../../frameworks/framework-validator.js";
import { FrameworkRegistry } from "../../../frameworks/methodology/framework-registry.js";
import { ExecutionPlanner } from "../../../execution/planning/execution-planner.js";
import { GateServiceFactory } from "../../../gates/services/gate-service-factory.js";
/**
 * Consolidated Prompt Engine Tool
 */
export class ConsolidatedPromptEngine {
    // NEW: Temporary gate registry access (Phase 3 enhancement)
    get temporaryGateRegistry() {
        return this.lightweightGateSystem.getTemporaryGateRegistry?.();
    }
    // Execution state tracking
    constructor(logger, mcpServer, promptManager, configManager, semanticAnalyzer, conversationManager, textReferenceManager, 
    // Legacy gateEvaluationService parameter removed - using lightweight system only
    mcpToolsManager, 
    // Phase 3: Removed executionCoordinator parameter - no longer needed
    // Test Infrastructure: Optional PromptGuidanceService injection for testing
    promptGuidanceService) {
        this.frameworkValidator = null;
        // Data references
        this.promptsData = [];
        this.convertedPrompts = [];
        this.logger = logger;
        this.mcpServer = mcpServer;
        this.promptManager = promptManager;
        this.configManager = configManager;
        this.semanticAnalyzer = semanticAnalyzer;
        this.conversationManager = conversationManager;
        this.textReferenceManager = textReferenceManager;
        const config = configManager.getConfig();
        const resolvedServerRoot = typeof this.configManager.getServerRoot === 'function'
            ? this.configManager.getServerRoot()
            : path.dirname(this.configManager.getConfigPath?.() ?? path.join(process.cwd(), 'config.json'));
        this.serverRoot = resolvedServerRoot;
        const sessionConfig = typeof this.configManager.getChainSessionConfig === 'function'
            ? this.configManager.getChainSessionConfig()
            : undefined;
        const chainSessionOptions = sessionConfig
            ? {
                defaultSessionTimeoutMs: sessionConfig.sessionTimeoutMinutes * 60 * 1000,
                reviewSessionTimeoutMs: sessionConfig.reviewTimeoutMinutes * 60 * 1000,
                cleanupIntervalMs: sessionConfig.cleanupIntervalMinutes * 60 * 1000,
            }
            : undefined;
        this.argumentHistoryTracker = new ArgumentHistoryTracker(logger, 50, path.join(this.serverRoot, 'runtime-state', 'argument-history.json'));
        // Initialize chain session manager with proper persistence configuration
        this.chainSessionManager = createChainSessionManager(logger, textReferenceManager, this.serverRoot, chainSessionOptions, this.argumentHistoryTracker);
        this.conversationManager.setTextReferenceManager(textReferenceManager);
        this.conversationManager.setChainSessionManager(this.chainSessionManager);
        // Legacy gate evaluation service assignment removed
        this.mcpToolsManager = mcpToolsManager;
        // Phase 3: Removed executionCoordinator assignment - using LLM-driven chain model
        // Test Infrastructure: Accept injected PromptGuidanceService (for testing with mocks)
        if (promptGuidanceService) {
            this.promptGuidanceService = promptGuidanceService;
            this.logger.debug("Using injected PromptGuidanceService (test mode)");
        }
        // else: will be created lazily in initializePromptGuidanceService() as before
        // Initialize lightweight gate system with temporary gates (Phase 3 enhancement)
        const gatesConfig = config.gates;
        const gatesDirectory = gatesConfig?.definitionsDirectory
            ? path.isAbsolute(gatesConfig.definitionsDirectory)
                ? gatesConfig.definitionsDirectory
                : path.resolve(this.serverRoot, gatesConfig.definitionsDirectory)
            : path.resolve(this.serverRoot, 'src/gates/definitions');
        // Get LLM config for gate validator
        const llmConfig = config.analysis?.semanticAnalysis?.llmIntegration;
        this.lightweightGateSystem = createLightweightGateSystem(logger, gatesDirectory, undefined, // gateSystemManager - will be set later if needed
        {
            enableTemporaryGates: true,
            maxMemoryGates: 100, // Allow up to 100 temporary gates in memory
            defaultExpirationMs: 30 * 60 * 1000, // 30 minutes default expiration
            llmConfig // Pass LLM config to gate validator
        });
        // NEW: Initialize role-based gate guidance renderer (Phase 3)
        // Phase 3 Enhancement: Pass temporary gate registry to renderer for temp gate support
        const temporaryGateRegistry = this.lightweightGateSystem.getTemporaryGateRegistry();
        this.gateGuidanceRenderer = createGateGuidanceRenderer(logger, gatesDirectory, temporaryGateRegistry);
        // Initialize EngineValidator with gate system (Phase 1.1 fix)
        this.engineValidator = new EngineValidator(this.lightweightGateSystem);
        // Initialize symbolic operator executors
        this.chainOperatorExecutor = this.createChainOperatorExecutor();
        // Phase 4: Initialize clean architecture gate intelligence
        this.gateSelectionEngine = createGateSelectionEngine(logger, this.configManager);
        // Note: Performance analytics now handled separately through system control
        // No need to connect gate selection engine to other components
        // Initialize new parsing system
        this.parsingSystem = createParsingSystem(logger);
        this.inlineGateParser = createSymbolicCommandParser(logger);
        // Initialize dynamic template discovery
        // REMOVED: Dynamic template discovery initialization - scaffolding system deprecated
        // Initialize response formatter
        this.responseFormatter = new ResponseFormatter();
        this.chainManagementService = new ChainManagementService([], this.chainSessionManager, this.responseFormatter, this.lightweightGateSystem);
        this.executionPlanner = new ExecutionPlanner(this.semanticAnalyzer, this.logger);
        this.logger.info("ConsolidatedPromptEngine initialized with new unified parsing system, dynamic template discovery, and response formatter");
    }
    /**
     * Update data references
     */
    updateData(promptsData, convertedPrompts) {
        this.promptsData = promptsData;
        this.convertedPrompts = convertedPrompts;
        this.chainManagementService.updatePrompts(convertedPrompts);
        this.chainOperatorExecutor = this.createChainOperatorExecutor();
        this.resetPipeline();
    }
    createChainOperatorExecutor() {
        return new ChainOperatorExecutor(this.logger, this.convertedPrompts, this.gateGuidanceRenderer, this.resolveFrameworkContextForPrompt.bind(this));
    }
    /**
     * Set framework state manager (called after initialization)
     */
    setFrameworkStateManager(frameworkStateManager) {
        this.frameworkStateManager = frameworkStateManager;
    }
    /**
     * Set framework manager (called after initialization)
     */
    setFrameworkManager(frameworkManager) {
        this.frameworkManager = frameworkManager;
        this.executionPlanner.setFrameworkManager(frameworkManager);
        this.rebuildFrameworkValidator();
        this.chainOperatorExecutor = this.createChainOperatorExecutor();
        this.resetPipeline();
        this.initializePromptGuidanceService();
    }
    /**
     * Initialize PromptGuidanceService once framework manager is available
     */
    async initializePromptGuidanceService() {
        // Test Infrastructure: Skip initialization if service was already injected
        if (this.promptGuidanceService) {
            this.logger.debug("PromptGuidanceService already injected, skipping creation");
            return;
        }
        if (this.frameworkManager && !this.promptGuidanceService) {
            try {
                const methodologyStatePath = path.join(this.serverRoot, 'runtime-state', 'framework-state.json');
                this.promptGuidanceService = await createPromptGuidanceService(this.logger, {
                    systemPromptInjection: {
                        enabled: true,
                        injectionMethod: 'smart',
                        enableTemplateVariables: true,
                        enableContextualEnhancement: true
                    },
                    templateEnhancement: {
                        enabled: true,
                        enhancementLevel: 'moderate',
                        enableArgumentSuggestions: true,
                        enableStructureOptimization: true
                    },
                    methodologyTracking: {
                        enabled: true,
                        persistStateToDisk: true,
                        enableHealthMonitoring: true,
                        stateFilePath: methodologyStatePath
                    }
                }, this.frameworkManager);
                this.logger.debug("PromptGuidanceService initialized successfully");
            }
            catch (error) {
                this.logger.warn("Failed to initialize PromptGuidanceService:", error);
                // Continue without guidance service - it's optional
            }
        }
    }
    /**
     * Set analytics service (called after initialization)
     */
    setAnalyticsService(analyticsService) {
        this.analyticsService = analyticsService;
        this.responseFormatter.setAnalyticsService(analyticsService);
    }
    /**
     * Set tool description manager (called after initialization)
     */
    setToolDescriptionManager(manager) {
        this.toolDescriptionManager = manager;
    }
    resetPipeline() {
        this.promptPipeline = undefined;
    }
    rebuildFrameworkValidator() {
        if (!this.frameworkManager) {
            this.frameworkValidator = null;
            return;
        }
        try {
            const registry = new FrameworkRegistry(this.logger);
            const definitions = this.frameworkManager.listFrameworks(false);
            registry.loadDefinitions(definitions);
            this.frameworkValidator = new FrameworkValidator(registry, this.logger, {
                defaultStage: 'operator_validation',
            });
        }
        catch (error) {
            this.logger.warn('Failed to rebuild framework validator', error);
            this.frameworkValidator = null;
        }
    }
    requireFrameworkManager() {
        if (!this.frameworkManager) {
            throw new Error('Framework manager not initialized. Ensure setFrameworkManager() is called before executing commands.');
        }
        return this.frameworkManager;
    }
    getPromptExecutionPipeline() {
        if (!this.promptPipeline) {
            this.promptPipeline = this.buildPromptExecutionPipeline();
        }
        return this.promptPipeline;
    }
    buildPromptExecutionPipeline() {
        const temporaryGateRegistry = this.lightweightGateSystem.getTemporaryGateRegistry();
        if (!temporaryGateRegistry) {
            throw new Error('Temporary gate registry unavailable - enable temporary gates in configuration');
        }
        const frameworkManager = this.requireFrameworkManager();
        if (!this.chainOperatorExecutor) {
            this.chainOperatorExecutor = this.createChainOperatorExecutor();
        }
        const requestStage = new RequestNormalizationStage(this.chainManagementService ?? null, this.routeToTool.bind(this), this.logger);
        const dependencyStage = new DependencyInjectionStage(temporaryGateRegistry, () => this.frameworkStateManager?.isFrameworkSystemEnabled() ?? false, () => this.analyticsService, 'canonical-stage-0', this.logger);
        const lifecycleStage = new ExecutionLifecycleStage(temporaryGateRegistry, this.logger);
        const commandParsingStage = new CommandParsingStage(this.parsingSystem.commandParser, this.parsingSystem.argumentParser, this.convertedPrompts, this.logger, this.chainSessionManager);
        const inlineGateStage = new InlineGateExtractionStage(temporaryGateRegistry, this.logger);
        const operatorValidationStage = new OperatorValidationStage(this.frameworkValidator, this.logger);
        const planningStage = new ExecutionPlanningStage(this.executionPlanner, () => this.frameworkStateManager?.isFrameworkSystemEnabled() ?? false, this.logger);
        const frameworkStage = new FrameworkResolutionStage(frameworkManager, () => this.frameworkStateManager?.isFrameworkSystemEnabled() ?? false, this.logger);
        const promptGuidanceStage = new PromptGuidanceStage(this.promptGuidanceService ?? null, this.logger);
        const gateService = this.createGateService();
        const gateStage = new GateEnhancementStage(gateService, temporaryGateRegistry, () => this.configManager.getFrameworksConfig(), this.logger, () => this.analyticsService);
        const sessionStage = new SessionManagementStage(this.chainSessionManager, this.logger);
        const responseCaptureStage = new StepResponseCaptureStage(this.chainSessionManager, this.logger);
        const executionStage = new StepExecutionStage(this.chainOperatorExecutor, this.chainSessionManager, this.logger);
        const gateReviewStage = new GateReviewStage(this.chainOperatorExecutor, this.chainSessionManager, this.logger);
        const callToActionStage = new CallToActionStage(this.logger);
        const formattingStage = new ResponseFormattingStage(this.responseFormatter, this.logger);
        const postFormattingStage = new PostFormattingCleanupStage(this.chainSessionManager, temporaryGateRegistry, this.logger);
        return new PromptExecutionPipeline(requestStage, dependencyStage, lifecycleStage, commandParsingStage, inlineGateStage, operatorValidationStage, planningStage, frameworkStage, promptGuidanceStage, gateStage, sessionStage, responseCaptureStage, executionStage, gateReviewStage, callToActionStage, formattingStage, postFormattingStage, this.logger, () => this.analyticsService);
    }
    createGateService() {
        const factory = new GateServiceFactory(this.logger, this.configManager, this.gateGuidanceRenderer, this.lightweightGateSystem.gateValidator);
        return factory.createGateService();
    }
    /**
     * Get the prompts base path using ConfigManager for cross-platform compatibility
     */
    getPromptsBasePath() {
        // Use environment variable override if available
        if (process.env.MCP_PROMPTS_PATH) {
            return process.env.MCP_PROMPTS_PATH;
        }
        // Use ConfigManager to get proper path resolution
        const promptsFilePath = this.configManager.getPromptsFilePath();
        // Get the directory containing the prompts config file
        return path.dirname(promptsFilePath);
    }
    // REMOVED: setChainOrchestrator method - modular chain system removed
    /**
     * Get lightweight gate system for external access
     */
    getLightweightGateSystem() {
        return this.lightweightGateSystem;
    }
    /**
     * Expose gate guidance renderer for discovery operations
     */
    getGateGuidanceRenderer() {
        return this.gateGuidanceRenderer;
    }
    /**
     * Set gate system manager for runtime gate management
     */
    setGateSystemManager(gateSystemManager) {
        this.lightweightGateSystem.setGateSystemManager(gateSystemManager);
        this.logger.debug("Gate system manager configured for prompt engine");
    }
    /**
     * Cleanup method for proper resource management and preventing async handle leaks
     * Follows the defensive cleanup pattern from Application.shutdown()
     */
    async cleanup() {
        try {
            this.logger.debug("Starting ConsolidatedPromptEngine cleanup...");
            // Phase 1: Shutdown analytics service (has interval timers)
            if (this.analyticsService && 'shutdown' in this.analyticsService && typeof this.analyticsService.shutdown === 'function') {
                try {
                    await this.analyticsService.shutdown();
                    this.logger.debug("Analytics service shutdown completed");
                }
                catch (error) {
                    this.logger.warn("Error shutting down analytics service:", error);
                }
            }
            // Phase 2: Shutdown tool description manager (has file watchers, EventEmitter listeners)
            if (this.toolDescriptionManager && 'shutdown' in this.toolDescriptionManager && typeof this.toolDescriptionManager.shutdown === 'function') {
                try {
                    await this.toolDescriptionManager.shutdown();
                    this.logger.debug("Tool description manager shutdown completed");
                }
                catch (error) {
                    this.logger.warn("Error shutting down tool description manager:", error);
                }
            }
            // Phase 2.1: Shutdown config manager (file watcher, EventEmitter)
            if (this.configManager && 'shutdown' in this.configManager && typeof this.configManager.shutdown === 'function') {
                try {
                    this.configManager.shutdown();
                    this.logger.debug("Config manager shutdown completed");
                }
                catch (error) {
                    this.logger.warn("Error shutting down config manager:", error);
                }
            }
            // Phase 2.2: Shutdown prompt manager (HotReloadManager with FileObserver)
            if (this.promptManager && 'shutdown' in this.promptManager && typeof this.promptManager.shutdown === 'function') {
                try {
                    await this.promptManager.shutdown();
                    this.logger.debug("Prompt manager shutdown completed");
                }
                catch (error) {
                    this.logger.warn("Error shutting down prompt manager:", error);
                }
            }
            // Phase 3: Shutdown framework state manager (if it has shutdown method)
            if (this.frameworkStateManager && 'shutdown' in this.frameworkStateManager && typeof this.frameworkStateManager.shutdown === 'function') {
                try {
                    await this.frameworkStateManager.shutdown();
                    this.logger.debug("Framework state manager shutdown completed");
                }
                catch (error) {
                    this.logger.warn("Error shutting down framework state manager:", error);
                }
            }
            // Phase 4: Cleanup chain session manager (if it has cleanup method)
            if (this.chainSessionManager && 'cleanup' in this.chainSessionManager && typeof this.chainSessionManager.cleanup === 'function') {
                try {
                    await this.chainSessionManager.cleanup();
                    this.logger.debug("Chain session manager cleanup completed");
                }
                catch (error) {
                    this.logger.warn("Error cleaning up chain session manager:", error);
                }
            }
            if (this.argumentHistoryTracker) {
                try {
                    this.argumentHistoryTracker.shutdown();
                    this.logger.debug("Argument history tracker shutdown completed");
                }
                catch (error) {
                    this.logger.warn("Error shutting down argument history tracker:", error);
                }
            }
            // Phase 5: Cleanup lightweight gate system (if it has cleanup method)
            if (this.lightweightGateSystem && 'cleanup' in this.lightweightGateSystem && typeof this.lightweightGateSystem.cleanup === 'function') {
                try {
                    await this.lightweightGateSystem.cleanup();
                    this.logger.debug("Lightweight gate system cleanup completed");
                }
                catch (error) {
                    this.logger.warn("Error cleaning up lightweight gate system:", error);
                }
            }
            // Phase 6: Cleanup prompt guidance service (if it has shutdown method)
            if (this.promptGuidanceService && 'shutdown' in this.promptGuidanceService && typeof this.promptGuidanceService.shutdown === 'function') {
                try {
                    await this.promptGuidanceService.shutdown();
                    this.logger.debug("Prompt guidance service shutdown completed");
                }
                catch (error) {
                    this.logger.warn("Error shutting down prompt guidance service:", error);
                }
            }
            // Phase 7: Cleanup gate selection engine (EventEmitter listeners on configManager)
            if (this.gateSelectionEngine && 'cleanup' in this.gateSelectionEngine && typeof this.gateSelectionEngine.cleanup === 'function') {
                try {
                    await this.gateSelectionEngine.cleanup();
                    this.logger.debug("Gate selection engine cleanup completed");
                }
                catch (error) {
                    this.logger.warn("Error cleaning up gate selection engine:", error);
                }
            }
            this.logger.debug("ConsolidatedPromptEngine cleanup completed successfully");
        }
        catch (error) {
            this.logger.error("Error during ConsolidatedPromptEngine cleanup:", error);
            throw error;
        }
    }
    /**
     * Get framework-enhanced system prompt injection
     */
    async getFrameworkExecutionContext(prompt) {
        this.logger.debug(`[ENGINE DEBUG] getFrameworkExecutionContext called for prompt: ${prompt.id}`);
        if (!this.frameworkManager || !this.frameworkStateManager) {
            this.logger.debug(`[ENGINE DEBUG] Missing dependencies - frameworkManager: ${!!this.frameworkManager}, frameworkStateManager: ${!!this.frameworkStateManager}`);
            return null;
        }
        // NEW: Check if framework system is enabled before generating context
        const isEnabled = this.frameworkStateManager.isFrameworkSystemEnabled();
        this.logger.debug(`[ENGINE DEBUG] Framework system enabled: ${isEnabled}`);
        if (!isEnabled) {
            return null;
        }
        try {
            // Get current active framework from state manager
            const activeFramework = this.frameworkStateManager.getActiveFramework();
            this.logger.debug(`[ENGINE DEBUG] Active framework:`, {
                methodology: activeFramework.methodology,
                name: activeFramework.name
            });
            // Generate execution context using the framework manager
            const context = this.frameworkManager.generateExecutionContext(prompt, {
                userPreference: activeFramework.methodology,
            });
            this.logger.debug(`[ENGINE DEBUG] Generated execution context:`, {
                hasContext: !!context,
                contextType: context ? typeof context : 'null',
                hasSystemPrompt: context?.systemPrompt ? true : false,
                systemPromptLength: context?.systemPrompt?.length || 0
            });
            return context;
        }
        catch (error) {
            this.logger.warn("Failed to generate framework execution context:", error);
            return null;
        }
    }
    async resolveFrameworkContextForPrompt(promptId) {
        const prompt = this.convertedPrompts.find((p) => p.id === promptId);
        if (!prompt) {
            return null;
        }
        const frameworkContext = await this.getFrameworkExecutionContext(prompt);
        if (!frameworkContext) {
            return {
                selectedFramework: undefined,
                category: prompt.category,
            };
        }
        return {
            selectedFramework: frameworkContext.selectedFramework,
            category: prompt.category,
            systemPrompt: frameworkContext.systemPrompt,
        };
    }
    createParserArgumentContext() {
        return {
            conversationHistory: [],
            environmentVars: process.env,
            promptDefaults: {},
            systemContext: {},
        };
    }
    async parseSymbolicStepArguments(rawArgs, prompt) {
        if (!rawArgs?.trim()) {
            return {};
        }
        try {
            const result = await this.parsingSystem.argumentParser.parseArguments(rawArgs, prompt, this.createParserArgumentContext());
            return result.processedArgs ?? {};
        }
        catch (error) {
            this.logger.warn('[SymbolicExecution] Failed to parse step arguments', {
                promptId: prompt.id,
                error: error instanceof Error ? error.message : String(error),
            });
            return {};
        }
    }
    /**
     * Main prompt execution handler
     */
    async executePromptCommand(args, extra) {
        const normalizedCommand = typeof args.command === 'string' ? args.command.trim() : '';
        void extra;
        const hasSimplifiedGates = (args.quality_gates?.length ?? 0) > 0 ||
            (args.custom_checks?.length ?? 0) > 0;
        const resolvedGateMode = args.gate_mode ?? (hasSimplifiedGates ? 'enforce' : 'advise');
        this.logger.info(`🚀 [ENTRY] Prompt Engine: Executing "${normalizedCommand || '<resume>'}" (mode: ${args.execution_mode ?? 'auto'})`);
        const request = {
            command: normalizedCommand || undefined,
            session_id: args.session_id,
            chain_id: args.chain_id,
            user_response: args.user_response,
            force_restart: args.force_restart,
            execution_mode: args.execution_mode ?? 'auto',
            gate_validation: args.gate_validation,
            gate_mode: resolvedGateMode,
            quality_gates: args.quality_gates,
            custom_checks: args.custom_checks,
            temporary_gates: args.temporary_gates,
            gate_scope: args.gate_scope,
            inherit_chain_gates: args.inherit_chain_gates,
            chain_uri: args.chain_uri,
            timeout: args.timeout,
            options: args.options,
        };
        try {
            const pipeline = this.getPromptExecutionPipeline();
            return await pipeline.execute(request);
        }
        catch (error) {
            this.logger.error('[PromptEngine] Pipeline execution failed', error);
            throw error;
        }
    }
    /**
     * Route command to appropriate tool with safe error handling
     */
    async routeToTool(targetTool, params, originalCommand) {
        this.logger.info(`🔀 Routing command "${originalCommand}" to ${targetTool}`);
        try {
            switch (targetTool) {
                case 'prompt_manager':
                    if (this.mcpToolsManager?.promptManagerTool) {
                        this.logger.debug(`Calling prompt_manager with params:`, params);
                        return await this.mcpToolsManager.promptManagerTool.handleAction(params, {});
                    }
                    else {
                        throw new Error('Prompt manager tool not available');
                    }
                case 'system_control':
                    if (this.mcpToolsManager?.systemControl) {
                        this.logger.debug(`Calling system_control with params:`, params);
                        return await this.mcpToolsManager.systemControl.handleAction(params, {});
                    }
                    else {
                        throw new Error('System control tool not available');
                    }
                default:
                    throw new Error(`Unknown target tool: ${targetTool}`);
            }
        }
        catch (error) {
            this.logger.error(`Tool routing failed for ${targetTool}:`, error);
            // Return formatted error response
            const message = error instanceof Error
                ? `Tool routing failed (${targetTool}): ${error.message}`
                : `Tool routing failed (${targetTool}): ${String(error)}`;
            return this.responseFormatter.formatErrorResponse(message);
        }
    }
    /**
     * Detect execution mode using semantic analysis - THREE-TIER MODEL
     * Returns appropriate execution strategy based on prompt characteristics
     */
    async detectExecutionMode(convertedPrompt) {
        if (convertedPrompt.executionMode) {
            return convertedPrompt.executionMode;
        }
        const classification = await this.analyzePrompt(convertedPrompt);
        this.autoAssignQualityGates(convertedPrompt, classification);
        this.logger.debug(`Semantic analysis: ${classification.executionType} (${Math.round(classification.confidence * 100)}%)`);
        // Return the semantic analysis result directly - it now handles the three-tier distinction
        return classification.executionType;
    }
    /**
     * Create fallback analysis when semantic analysis is disabled
     */
    createDisabledAnalysisFallback(prompt) {
        const hasChainSteps = Boolean(prompt.chainSteps?.length);
        const argCount = prompt.arguments?.length || 0;
        const hasTemplateVars = /\{\{.*?\}\}/g.test(prompt.userMessageTemplate || "");
        // Reliable structural detection: only use verifiable indicators
        const hasComplexTemplateLogic = /\{\{.*?\|.*?\}\}|\{%-.*?-%\}|\{%.*?if.*?%\}|\{%.*?for.*?%\}/g.test(prompt.userMessageTemplate || "");
        const hasMultipleArgs = argCount > 1; // More than one argument suggests complexity
        // Three-tier detection based on structural indicators only
        let executionType = "prompt";
        if (hasChainSteps) {
            executionType = "chain";
        }
        else if (hasComplexTemplateLogic) {
            // Complex Nunjucks logic always needs template mode
            executionType = "template";
        }
        else if (hasTemplateVars && hasMultipleArgs) {
            // Template variables with multiple args suggests framework benefit
            executionType = "template";
        }
        // Default to 'prompt' for simple cases (no vars, single arg, or static content)
        return {
            executionType,
            requiresExecution: true,
            confidence: 0.9, // High confidence in structural detection
            reasoning: [
                "Structural auto detection (semantic analysis disabled)",
                `Args: ${argCount}, Template vars: ${hasTemplateVars}, Complex logic: ${hasComplexTemplateLogic}`,
                `Selected ${executionType} mode based on verifiable structural indicators`,
            ],
            suggestedGates: ["basic_validation"],
            framework: "disabled",
        };
    }
    /**
     * Detect analysis intent using LLM semantic understanding (FUTURE IMPLEMENTATION)
     *
     * This method will be implemented when the LLM semantic layer is completed.
     * It will provide intelligent analysis intent detection by examining:
     * - Template content and complexity
     * - Argument semantics and naming patterns
     * - Task complexity indicators
     * - Context and domain-specific signals
     *
     * @param prompt - The prompt to analyze for analysis intent
     * @returns Promise<boolean> - True if prompt requires analytical framework processing
     *
     * @todo Implement when ContentAnalyzer LLM integration is enabled
     * @todo Design proper interface for semantic intent classification
     * @todo Add confidence scoring and reasoning for intent decisions
     */
    async detectAnalysisIntentLLM(prompt) {
        // STUB: Always return false until LLM semantic analysis is implemented
        // When implemented, this will use the LLM to intelligently detect:
        // - Analysis vs formatting tasks
        // - Complex reasoning requirements
        // - Domain-specific analytical patterns
        // - Context-dependent intent signals
        this.logger.debug(`LLM analysis intent detection not yet implemented for ${prompt.id}`);
        return false;
    }
    /**
     * Analyze prompt for execution strategy (configuration-aware)
     */
    async analyzePrompt(prompt) {
        // Check if semantic analysis is enabled via the analyzer
        if (!this.semanticAnalyzer.isLLMEnabled()) {
            this.logger.debug(`Semantic analysis disabled for ${prompt.id} - using structural fallback`);
            return this.createDisabledAnalysisFallback(prompt);
        }
        try {
            const analysis = await this.semanticAnalyzer.analyzePrompt(prompt);
            return {
                executionType: analysis.executionType,
                requiresExecution: analysis.requiresExecution,
                confidence: analysis.confidence,
                reasoning: analysis.reasoning,
                suggestedGates: analysis.suggestedGates,
                framework: "semantic",
            };
        }
        catch (error) {
            this.logger.error(`Semantic analysis failed for ${prompt.id}:`, error);
            return {
                executionType: isChainPrompt(prompt) ? "chain" : "template",
                requiresExecution: true,
                confidence: 0.5,
                reasoning: [`Fallback analysis: ${error}`],
                suggestedGates: ["execution_validation"],
                framework: "fallback",
            };
        }
    }
    /**
     * Auto-assign quality gates based on classification
     */
    autoAssignQualityGates(prompt, classification) {
        const autoGates = [];
        if (classification.requiresExecution && classification.confidence > 0.5) {
            autoGates.push({
                id: "content_length_validation",
                name: "Content Length Validation",
                type: "validation",
                requirements: [
                    {
                        type: "content_length",
                        criteria: { min: 50 },
                        required: true,
                    },
                ],
                failureAction: "retry",
            });
        }
        if (autoGates.length > 0) {
            prompt.autoAssignedGates = autoGates;
            this.logger.debug(`Auto-assigned ${autoGates.length} gates for ${prompt.id}`);
        }
    }
    /**
     * Get execution analytics from analytics service
     */
    getAnalytics() {
        if (this.analyticsService) {
            return this.analyticsService.getExecutionStats();
        }
        // Fallback for backward compatibility
        return {
            totalExecutions: 0,
            successfulExecutions: 0,
            failedExecutions: 0,
            averageExecutionTime: 0,
            executionsByMode: {
                prompt: 0,
                template: 0,
                chain: 0,
            },
            executionsByTool: {
                prompt_engine: 0,
                prompt_manager: 0,
                system_control: 0,
            },
            lastUpdated: Date.now(),
        };
    }
    /**
     * Get parsing system statistics for monitoring
     */
    getParsingStats() {
        return {
            commandParser: this.parsingSystem.commandParser.getStats(),
            argumentParser: this.parsingSystem.argumentParser.getStats(),
            contextResolver: this.parsingSystem.contextResolver.getStats(),
        };
    }
    /**
     * Reset parsing statistics
     */
    resetParsingStats() {
        this.parsingSystem.commandParser.resetStats();
        this.parsingSystem.argumentParser.resetStats();
        this.parsingSystem.contextResolver.resetStats();
        this.logger.debug("Parsing system statistics reset");
    }
    /**
     * Error handling helper
     */
    handleError(error, context) {
        utilsHandleError(error, context, this.logger);
        const message = error instanceof Error
            ? `Error in ${context}: ${error.message}`
            : `Error in ${context}: ${String(error)}`;
        return this.responseFormatter.formatErrorResponse(message);
    }
}
/**
 * Create consolidated prompt engine with enhanced parsing system
 */
export function createConsolidatedPromptEngine(logger, mcpServer, promptManager, configManager, semanticAnalyzer, conversationManager, textReferenceManager, mcpToolsManager, 
// Phase 3: Removed executionCoordinator parameter - using LLM-driven chain model
// Test Infrastructure: Optional PromptGuidanceService injection
promptGuidanceService) {
    const engine = new ConsolidatedPromptEngine(logger, mcpServer, promptManager, configManager, semanticAnalyzer, conversationManager, textReferenceManager, 
    // Phase 3: Legacy gateEvaluationService removed - using lightweight system only
    mcpToolsManager, 
    // Phase 3: Removed executionCoordinator parameter
    // Test Infrastructure: Pass through optional PromptGuidanceService
    promptGuidanceService);
    logger.info("ConsolidatedPromptEngine created with enhanced features:");
    logger.info("- Unified multi-strategy command parsing");
    logger.info("- Advanced argument processing pipeline");
    logger.info("- Optional gate evaluation service for template-driven verification");
    logger.info("- Intelligent context resolution system");
    logger.info("- Backward compatibility with legacy parsing");
    return engine;
}
/**
 * Cleanup helper function for test convenience
 * Safely cleans up a ConsolidatedPromptEngine instance
 */
export async function cleanupPromptEngine(engine) {
    if (engine && 'cleanup' in engine && typeof engine.cleanup === 'function') {
        try {
            await engine.cleanup();
        }
        catch (error) {
            // Log error but don't throw to prevent test failures
            console.error('Error cleaning up prompt engine:', error);
        }
    }
}
//# sourceMappingURL=engine.js.map