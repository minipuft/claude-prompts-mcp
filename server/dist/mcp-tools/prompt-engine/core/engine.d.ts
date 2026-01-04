/**
 * Consolidated Prompt Engine - Unified Execution Tool
 *
 * Consolidates all prompt execution functionality into a single systematic tool:
 * - execute_prompt (from index.ts)
 * - Chain execution with progress tracking
 * - Structural execution mode detection
 * - Gate validation and retry logic
 */
import { ConfigManager } from "../../../config/index.js";
import { Logger } from "../../../logging/index.js";
import { PromptManager } from "../../../prompts/index.js";
import { ConvertedPrompt, PromptData, ToolResponse } from "../../../types/index.js";
import { FrameworkManager } from "../../../frameworks/framework-manager.js";
import { FrameworkStateManager } from "../../../frameworks/framework-state-manager.js";
import { ContentAnalyzer } from "../../../semantic/configurable-semantic-analyzer.js";
import { ConversationManager } from "../../../text-references/conversation.js";
import { TextReferenceManager } from "../../../text-references/index.js";
import { LightweightGateSystem, type TemporaryGateRegistryDefinition as TemporaryGateDefinition } from "../../../gates/core/index.js";
import { GateGuidanceRenderer } from "../../../gates/guidance/GateGuidanceRenderer.js";
import { ToolDescriptionManager } from "../../tool-description-manager.js";
import { MetricsCollector } from "../../../metrics/index.js";
/**
 * Prompt classification interface for execution strategy
 */
export interface PromptClassification {
    executionType: "prompt" | "template" | "chain";
    requiresExecution: boolean;
    confidence: number;
    reasoning: string[];
    suggestedGates: string[];
    framework?: string;
}
/**
 * Consolidated Prompt Engine Tool
 */
export declare class PromptExecutionService {
    private logger;
    private mcpServer;
    private promptManager;
    private configManager;
    private readonly serverRoot;
    private semanticAnalyzer;
    private conversationManager;
    private textReferenceManager;
    private argumentHistoryTracker?;
    private chainSessionManager;
    private frameworkStateManager?;
    private frameworkManager?;
    private lightweightGateSystem;
    private get temporaryGateRegistry();
    private gateGuidanceRenderer;
    private engineValidator?;
    private gateSelectionEngine?;
    private chainOperatorExecutor?;
    private mcpToolsManager?;
    private analyticsService?;
    private executionPlanner;
    private frameworkValidator;
    private promptPipeline?;
    private responseFormatter;
    private chainManagementService;
    private parsingSystem;
    private inlineGateParser;
    private toolDescriptionManager?;
    private promptGuidanceService?;
    private activeGateRequest?;
    private promptsData;
    private convertedPrompts;
    constructor(logger: Logger, mcpServer: any, promptManager: PromptManager, configManager: ConfigManager, semanticAnalyzer: ContentAnalyzer, conversationManager: ConversationManager, textReferenceManager: TextReferenceManager, mcpToolsManager?: any, promptGuidanceService?: any);
    /**
     * Update data references
     */
    updateData(promptsData: PromptData[], convertedPrompts: ConvertedPrompt[]): void;
    private createChainOperatorExecutor;
    /**
     * Set framework state manager (called after initialization)
     */
    setFrameworkStateManager(frameworkStateManager: FrameworkStateManager): void;
    /**
     * Set framework manager (called after initialization)
     */
    setFrameworkManager(frameworkManager: FrameworkManager): void;
    /**
     * Initialize PromptGuidanceService once framework manager is available
     */
    private initializePromptGuidanceService;
    /**
     * Set analytics service (called after initialization)
     */
    setAnalyticsService(analyticsService: MetricsCollector): void;
    /**
     * Set tool description manager (called after initialization)
     */
    setToolDescriptionManager(manager: ToolDescriptionManager): void;
    private resetPipeline;
    private rebuildFrameworkValidator;
    private requireFrameworkManager;
    private getPromptExecutionPipeline;
    private buildPromptExecutionPipeline;
    private createGateService;
    /**
     * Get the prompts base path using ConfigManager for cross-platform compatibility
     */
    private getPromptsBasePath;
    /**
     * Get lightweight gate system for external access
     */
    getLightweightGateSystem(): LightweightGateSystem;
    /**
     * Expose gate guidance renderer for discovery operations
     */
    getGateGuidanceRenderer(): GateGuidanceRenderer;
    /**
     * Set gate system manager for runtime gate management
     */
    setGateSystemManager(gateSystemManager: any): void;
    /**
     * Cleanup method for proper resource management and preventing async handle leaks
     * Follows the defensive cleanup pattern from Application.shutdown()
     */
    cleanup(): Promise<void>;
    /**
     * Get framework-enhanced system prompt injection
     */
    private getFrameworkExecutionContext;
    private resolveFrameworkContextForPrompt;
    private createParserArgumentContext;
    private parseSymbolicStepArguments;
    /**
     * Main prompt execution handler
     */
    executePromptCommand(args: {
        command: string;
        execution_mode?: "auto" | "prompt" | "template" | "chain";
        gate_validation?: boolean;
        force_restart?: boolean;
        session_id?: string;
        chain_id?: string;
        user_response?: string;
        chain_uri?: string;
        timeout?: number;
        temporary_gates?: TemporaryGateDefinition[];
        gate_scope?: 'execution' | 'session' | 'chain' | 'step';
        inherit_chain_gates?: boolean;
        quality_gates?: string[];
        custom_checks?: Array<{
            name: string;
            description: string;
        }>;
        gate_mode?: 'enforce' | 'advise' | 'report';
        options?: Record<string, unknown>;
    }, extra: any): Promise<ToolResponse>;
    /**
     * Route command to appropriate tool with safe error handling
     */
    private routeToTool;
    /**
     * Detect execution mode using semantic analysis - THREE-TIER MODEL
     * Returns appropriate execution strategy based on prompt characteristics
     */
    private detectExecutionMode;
    /**
     * Create fallback analysis when semantic analysis is disabled
     */
    private createDisabledAnalysisFallback;
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
    private detectAnalysisIntentLLM;
    /**
     * Analyze prompt for execution strategy (configuration-aware)
     */
    private analyzePrompt;
    /**
     * Auto-assign quality gates based on classification
     */
    private autoAssignQualityGates;
    /**
     * Get execution analytics from analytics service
     */
    getAnalytics(): import("../../../metrics/types.js").ExecutionStats;
    /**
     * Get parsing system statistics for monitoring
     */
    getParsingStats(): {
        commandParser: {
            totalParses: number;
            successfulParses: number;
            failedParses: number;
            strategyUsage: Map<string, number>;
            averageConfidence: number;
        };
        argumentParser: {
            totalProcessed: number;
            successfulProcessing: number;
            validationFailures: number;
            typeCoercions: number;
            defaultsApplied: number;
            contextResolutions: number;
        };
        contextResolver: {
            totalResolutions: number;
            successfulResolutions: number;
            cacheHits: number;
            cacheMisses: number;
            providerUsage: Map<string, number>;
            averageConfidence: number;
            averageResolutionTime: number;
        };
    };
    /**
     * Reset parsing statistics
     */
    resetParsingStats(): void;
    /**
     * Error handling helper
     */
    private handleError;
}
/**
 * Create consolidated prompt engine with enhanced parsing system
 */
export declare function createPromptExecutionService(logger: Logger, mcpServer: any, promptManager: PromptManager, configManager: ConfigManager, semanticAnalyzer: ContentAnalyzer, conversationManager: ConversationManager, textReferenceManager: TextReferenceManager, mcpToolsManager?: any, promptGuidanceService?: any): PromptExecutionService;
/**
 * Cleanup helper function for test convenience
 * Safely cleans up a PromptExecutionService instance
 */
export declare function cleanupPromptEngine(engine: PromptExecutionService): Promise<void>;
