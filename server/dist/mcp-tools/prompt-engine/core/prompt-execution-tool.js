/**
 * Pipeline-driven prompt execution tool.
 *
 * Wires the canonical PromptExecutionPipeline together with the surrounding
 * services (sessions, gates, framework state) so the MCP tool only needs to
 * pass validated requests into the pipeline.
 */
import * as path from 'node:path';
import { ArgumentHistoryTracker } from '../../../text-references/index.js';
import { createChainSessionManager } from '../../../chain-session/manager.js';
import { createLightweightGateSystem, } from '../../../gates/core/index.js';
import { createGateGuidanceRenderer } from '../../../gates/guidance/GateGuidanceRenderer.js';
import { createPromptGuidanceService } from '../../../frameworks/prompt-guidance/index.js';
import { ExecutionPlanner } from '../../../execution/planning/execution-planner.js';
import { FrameworkValidator } from '../../../frameworks/framework-validator.js';
import { FrameworkRegistry } from '../../../frameworks/methodology/framework-registry.js';
import { ResponseFormatter } from '../processors/response-formatter.js';
import { ChainManagementService } from './chain-management.js';
import { ChainOperatorExecutor } from '../../../execution/operators/chain-operator-executor.js';
import { createParsingSystem } from '../../../execution/parsers/index.js';
import { createSymbolicCommandParser } from '../../../execution/parsers/symbolic-command-parser.js';
import { PromptExecutionPipeline } from '../../../execution/pipeline/prompt-execution-pipeline.js';
import { RequestNormalizationStage } from '../../../execution/pipeline/stages/00-request-normalization-stage.js';
import { DependencyInjectionStage } from '../../../execution/pipeline/stages/00-dependency-injection-stage.js';
import { ExecutionLifecycleStage } from '../../../execution/pipeline/stages/00-execution-lifecycle-stage.js';
import { CommandParsingStage } from '../../../execution/pipeline/stages/01-parsing-stage.js';
import { InlineGateExtractionStage } from '../../../execution/pipeline/stages/02-inline-gate-stage.js';
import { OperatorValidationStage } from '../../../execution/pipeline/stages/03-operator-validation-stage.js';
import { ExecutionPlanningStage } from '../../../execution/pipeline/stages/04-planning-stage.js';
import { GateEnhancementStage } from '../../../execution/pipeline/stages/05-gate-enhancement-stage.js';
import { FrameworkResolutionStage } from '../../../execution/pipeline/stages/06-framework-stage.js';
import { PromptGuidanceStage } from '../../../execution/pipeline/stages/06b-prompt-guidance-stage.js';
import { SessionManagementStage } from '../../../execution/pipeline/stages/07-session-stage.js';
import { StepResponseCaptureStage } from '../../../execution/pipeline/stages/08-response-capture-stage.js';
import { StepExecutionStage } from '../../../execution/pipeline/stages/09-execution-stage.js';
import { GateReviewStage } from '../../../execution/pipeline/stages/10-gate-review-stage.js';
import { CallToActionStage } from '../../../execution/pipeline/stages/11-call-to-action-stage.js';
import { ResponseFormattingStage } from '../../../execution/pipeline/stages/10-formatting-stage.js';
import { PostFormattingCleanupStage } from '../../../execution/pipeline/stages/12-post-formatting-cleanup-stage.js';
import { GateServiceFactory } from '../../../gates/services/gate-service-factory.js';
export class PromptExecutionTool {
    constructor(logger, mcpServer, promptManager, configManager, semanticAnalyzer, conversationManager, textReferenceManager, mcpToolsManager, promptGuidanceService) {
        this.frameworkValidator = null;
        this.convertedPrompts = [];
        this.logger = logger;
        this.mcpServer = mcpServer;
        this.promptManager = promptManager;
        this.configManager = configManager;
        this.semanticAnalyzer = semanticAnalyzer;
        this.conversationManager = conversationManager;
        this.textReferenceManager = textReferenceManager;
        this.responseFormatter = new ResponseFormatter();
        this.executionPlanner = new ExecutionPlanner(semanticAnalyzer, logger);
        this.parsingSystem = createParsingSystem(logger);
        this.inlineGateParser = createSymbolicCommandParser(logger);
        this.mcpToolsManager = mcpToolsManager;
        this.promptGuidanceService = promptGuidanceService;
        const resolvedServerRoot = typeof configManager.getServerRoot === 'function'
            ? configManager.getServerRoot()
            : path.dirname(configManager.getConfigPath?.() ?? path.join(process.cwd(), 'config.json'));
        this.serverRoot = resolvedServerRoot;
        const sessionConfig = configManager.getChainSessionConfig?.();
        const chainSessionOptions = sessionConfig
            ? {
                defaultSessionTimeoutMs: sessionConfig.sessionTimeoutMinutes * 60 * 1000,
                reviewSessionTimeoutMs: sessionConfig.reviewTimeoutMinutes * 60 * 1000,
                cleanupIntervalMs: sessionConfig.cleanupIntervalMinutes * 60 * 1000,
            }
            : undefined;
        this.argumentHistoryTracker = new ArgumentHistoryTracker(logger, 50, path.join(this.serverRoot, 'runtime-state', 'argument-history.json'));
        this.chainSessionManager = createChainSessionManager(logger, textReferenceManager, this.serverRoot, chainSessionOptions, this.argumentHistoryTracker);
        this.conversationManager.setTextReferenceManager(textReferenceManager);
        this.conversationManager.setChainSessionManager(this.chainSessionManager);
        const config = configManager.getConfig();
        const gatesDirectory = config.gates?.definitionsDirectory
            ? path.isAbsolute(config.gates.definitionsDirectory)
                ? config.gates.definitionsDirectory
                : path.resolve(this.serverRoot, config.gates.definitionsDirectory)
            : path.resolve(this.serverRoot, 'src/gates/definitions');
        const llmConfig = config.analysis?.semanticAnalysis?.llmIntegration;
        this.lightweightGateSystem = createLightweightGateSystem(logger, gatesDirectory, undefined, {
            enableTemporaryGates: true,
            maxMemoryGates: 100,
            defaultExpirationMs: 30 * 60 * 1000,
            llmConfig,
        });
        this.gateGuidanceRenderer = createGateGuidanceRenderer(logger, gatesDirectory, this.lightweightGateSystem.getTemporaryGateRegistry?.());
        this.chainManagementService = new ChainManagementService([], this.chainSessionManager, this.responseFormatter, this.lightweightGateSystem);
        this.chainOperatorExecutor = this.createChainOperatorExecutor();
        this.logger.info('[PromptExecutionTool] Initialized pipeline dependencies');
    }
    updateData(_promptsData, convertedPrompts) {
        this.convertedPrompts = convertedPrompts;
        this.chainManagementService.updatePrompts(convertedPrompts);
        this.chainOperatorExecutor = this.createChainOperatorExecutor();
        this.resetPipeline();
    }
    setFrameworkStateManager(frameworkStateManager) {
        this.frameworkStateManager = frameworkStateManager;
    }
    setFrameworkManager(frameworkManager) {
        this.frameworkManager = frameworkManager;
        this.executionPlanner.setFrameworkManager(frameworkManager);
        this.rebuildFrameworkValidator();
        this.chainOperatorExecutor = this.createChainOperatorExecutor();
        this.resetPipeline();
        void this.initializePromptGuidanceService();
    }
    setToolDescriptionManager(manager) {
        this.toolDescriptionManager = manager;
    }
    setAnalyticsService(analyticsService) {
        this.analyticsService = analyticsService;
        this.responseFormatter.setAnalyticsService(analyticsService);
    }
    setGateSystemManager(gateSystemManager) {
        this.lightweightGateSystem.setGateSystemManager(gateSystemManager);
    }
    getLightweightGateSystem() {
        return this.lightweightGateSystem;
    }
    getGateGuidanceRenderer() {
        return this.gateGuidanceRenderer;
    }
    async cleanup() {
        this.logger.debug('[PromptExecutionTool] Cleaning up');
        if (this.analyticsService && 'shutdown' in this.analyticsService) {
            await this.analyticsService.shutdown?.();
        }
        if (this.toolDescriptionManager && 'shutdown' in this.toolDescriptionManager) {
            await this.toolDescriptionManager.shutdown?.();
        }
        if ('shutdown' in this.configManager && typeof this.configManager.shutdown === 'function') {
            this.configManager.shutdown();
        }
        if ('shutdown' in this.promptManager && typeof this.promptManager.shutdown === 'function') {
            await this.promptManager.shutdown();
        }
        if (this.frameworkStateManager && 'shutdown' in this.frameworkStateManager) {
            await this.frameworkStateManager.shutdown?.();
        }
        if ('cleanup' in this.chainSessionManager && typeof this.chainSessionManager.cleanup === 'function') {
            await this.chainSessionManager.cleanup();
        }
        this.argumentHistoryTracker.shutdown();
        if ('cleanup' in this.lightweightGateSystem && typeof this.lightweightGateSystem.cleanup === 'function') {
            await this.lightweightGateSystem.cleanup();
        }
        if (this.promptGuidanceService && 'shutdown' in this.promptGuidanceService) {
            await this.promptGuidanceService.shutdown?.();
        }
    }
    async executePromptCommand(args, extra) {
        void extra;
        const normalizedCommand = typeof args.command === 'string' ? args.command.trim() : '';
        const hasSimplifiedGates = (args.quality_gates?.length ?? 0) > 0 || (args.custom_checks?.length ?? 0) > 0;
        const resolvedGateMode = args.gate_mode ?? (hasSimplifiedGates ? 'enforce' : 'advise');
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
        this.logger.info('[PromptExecutionTool] Executing request', {
            command: request.command ?? '<resume>',
            executionMode: request.execution_mode,
        });
        const pipeline = this.getPromptExecutionPipeline();
        return pipeline.execute(request);
    }
    async routeToTool(targetTool, params, originalCommand) {
        if (!this.mcpToolsManager) {
            throw new Error('MCP tool registry unavailable');
        }
        try {
            switch (targetTool) {
                case 'prompt_manager':
                    if (this.mcpToolsManager.promptManagerTool) {
                        return this.mcpToolsManager.promptManagerTool.handleAction(params, {});
                    }
                    break;
                case 'system_control':
                    if (this.mcpToolsManager.systemControl) {
                        return this.mcpToolsManager.systemControl.handleAction(params, {});
                    }
                    break;
                default:
                    break;
            }
            throw new Error(`Unknown target tool: ${targetTool}`);
        }
        catch (error) {
            const message = error instanceof Error
                ? `Tool routing failed (${targetTool}): ${error.message}`
                : `Tool routing failed (${targetTool}): ${String(error)}`;
            this.logger.error('[PromptExecutionTool] Tool routing failed', {
                targetTool,
                originalCommand,
                error,
            });
            return this.responseFormatter.formatErrorResponse(message);
        }
    }
    async initializePromptGuidanceService() {
        if (this.promptGuidanceService || !this.frameworkManager) {
            return;
        }
        try {
            const methodologyStatePath = path.join(this.serverRoot, 'runtime-state', 'framework-state.json');
            this.promptGuidanceService = await createPromptGuidanceService(this.logger, {
                systemPromptInjection: {
                    enabled: true,
                    injectionMethod: 'smart',
                    enableTemplateVariables: true,
                    enableContextualEnhancement: true,
                },
                templateEnhancement: {
                    enabled: true,
                    enhancementLevel: 'moderate',
                    enableArgumentSuggestions: true,
                    enableStructureOptimization: true,
                },
                methodologyTracking: {
                    enabled: true,
                    persistStateToDisk: true,
                    enableHealthMonitoring: true,
                    stateFilePath: methodologyStatePath,
                },
            }, this.frameworkManager);
        }
        catch (error) {
            this.logger.warn('[PromptExecutionTool] Failed to initialize PromptGuidanceService', { error });
        }
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
            registry.loadDefinitions(this.frameworkManager.listFrameworks(false));
            this.frameworkValidator = new FrameworkValidator(registry, this.logger, {
                defaultStage: 'operator_validation',
            });
        }
        catch (error) {
            this.logger.warn('[PromptExecutionTool] Failed to rebuild framework validator', { error });
            this.frameworkValidator = null;
        }
    }
    createChainOperatorExecutor() {
        return new ChainOperatorExecutor(this.logger, this.convertedPrompts, this.gateGuidanceRenderer, this.resolveFrameworkContextForPrompt.bind(this));
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
    async getFrameworkExecutionContext(prompt) {
        if (!this.frameworkManager || !this.frameworkStateManager) {
            return null;
        }
        if (!this.frameworkStateManager.isFrameworkSystemEnabled()) {
            return null;
        }
        try {
            const activeFramework = this.frameworkStateManager.getActiveFramework();
            return this.frameworkManager.generateExecutionContext(prompt, {
                userPreference: activeFramework.methodology,
            });
        }
        catch (error) {
            this.logger.warn('[PromptExecutionTool] Failed to generate framework execution context', {
                promptId: prompt.id,
                error,
            });
            return null;
        }
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
            throw new Error('Temporary gate registry unavailable');
        }
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
        const frameworkStage = this.frameworkManager
            ? new FrameworkResolutionStage(this.frameworkManager, () => this.frameworkStateManager?.isFrameworkSystemEnabled() ?? false, this.logger)
            : {
                name: 'FrameworkResolution',
                execute: async () => {
                    this.logger.debug('[PromptExecutionTool] Framework stage skipped (framework manager unavailable)');
                },
            };
        const promptGuidanceStage = new PromptGuidanceStage(this.promptGuidanceService ?? null, this.logger);
        const gateStage = new GateEnhancementStage(this.createGateService(), temporaryGateRegistry, () => this.configManager.getFrameworksConfig(), this.logger, () => this.analyticsService);
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
}
export function createPromptExecutionTool(logger, mcpServer, promptManager, configManager, semanticAnalyzer, conversationManager, textReferenceManager, mcpToolsManager, promptGuidanceService) {
    return new PromptExecutionTool(logger, mcpServer, promptManager, configManager, semanticAnalyzer, conversationManager, textReferenceManager, mcpToolsManager, promptGuidanceService);
}
export async function cleanupPromptExecutionTool(tool) {
    await tool.cleanup();
}
//# sourceMappingURL=prompt-execution-tool.js.map