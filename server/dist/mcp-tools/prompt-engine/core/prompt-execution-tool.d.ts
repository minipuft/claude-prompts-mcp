/**
 * Pipeline-driven prompt execution tool.
 *
 * Wires the canonical PromptExecutionPipeline together with the surrounding
 * services (sessions, gates, framework state) so the MCP tool only needs to
 * pass validated requests into the pipeline.
 */
import { ConfigManager } from '../../../config/index.js';
import { Logger } from '../../../logging/index.js';
import { PromptManager } from '../../../prompts/index.js';
import { ConvertedPrompt, PromptData, ToolResponse } from '../../../types/index.js';
import { FrameworkManager } from '../../../frameworks/framework-manager.js';
import { FrameworkStateManager } from '../../../frameworks/framework-state-manager.js';
import { ContentAnalyzer } from '../../../semantic/configurable-semantic-analyzer.js';
import { ConversationManager } from '../../../text-references/conversation.js';
import { TextReferenceManager } from '../../../text-references/index.js';
import { LightweightGateSystem, type TemporaryGateRegistryDefinition as TemporaryGateDefinition } from '../../../gates/core/index.js';
import { GateGuidanceRenderer } from '../../../gates/guidance/GateGuidanceRenderer.js';
import { PromptGuidanceService } from '../../../frameworks/prompt-guidance/index.js';
import { createSymbolicCommandParser } from '../../../execution/parsers/symbolic-command-parser.js';
import { ToolDescriptionManager } from '../../tool-description-manager.js';
import type { MetricsCollector } from '../../../metrics/index.js';
export declare class PromptExecutionService {
    readonly inlineGateParser: ReturnType<typeof createSymbolicCommandParser>;
    private readonly logger;
    private readonly mcpServer;
    private readonly promptManager;
    private readonly configManager;
    private readonly semanticAnalyzer;
    private readonly conversationManager;
    private readonly textReferenceManager;
    private readonly responseFormatter;
    private readonly executionPlanner;
    private readonly parsingSystem;
    private readonly chainManagementService;
    private readonly lightweightGateSystem;
    private readonly gateGuidanceRenderer;
    private readonly chainSessionManager;
    private readonly argumentHistoryTracker;
    private frameworkStateManager?;
    private frameworkManager?;
    private promptGuidanceService?;
    private chainOperatorExecutor?;
    private frameworkValidator;
    private toolDescriptionManager?;
    private analyticsService?;
    private promptPipeline?;
    private mcpToolsManager?;
    private convertedPrompts;
    private readonly serverRoot;
    constructor(logger: Logger, mcpServer: any, promptManager: PromptManager, configManager: ConfigManager, semanticAnalyzer: ContentAnalyzer, conversationManager: ConversationManager, textReferenceManager: TextReferenceManager, mcpToolsManager?: any, promptGuidanceService?: PromptGuidanceService);
    updateData(_promptsData: PromptData[], convertedPrompts: ConvertedPrompt[]): void;
    setFrameworkStateManager(frameworkStateManager: FrameworkStateManager): void;
    setFrameworkManager(frameworkManager: FrameworkManager): void;
    setToolDescriptionManager(manager: ToolDescriptionManager): void;
    setAnalyticsService(analyticsService: MetricsCollector): void;
    setGateSystemManager(gateSystemManager: any): void;
    getLightweightGateSystem(): LightweightGateSystem;
    getGateGuidanceRenderer(): GateGuidanceRenderer;
    cleanup(): Promise<void>;
    executePromptCommand(args: {
        command: string;
        execution_mode?: 'auto' | 'prompt' | 'template' | 'chain';
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
    private routeToTool;
    private initializePromptGuidanceService;
    private resetPipeline;
    private rebuildFrameworkValidator;
    private createChainOperatorExecutor;
    private resolveFrameworkContextForPrompt;
    private getFrameworkExecutionContext;
    private getPromptExecutionPipeline;
    private buildPromptExecutionPipeline;
    private createGateService;
}
export declare function createPromptExecutionService(logger: Logger, mcpServer: any, promptManager: PromptManager, configManager: ConfigManager, semanticAnalyzer: ContentAnalyzer, conversationManager: ConversationManager, textReferenceManager: TextReferenceManager, mcpToolsManager?: any, promptGuidanceService?: PromptGuidanceService): PromptExecutionService;
export declare function cleanupPromptExecutionService(tool: PromptExecutionService): Promise<void>;
