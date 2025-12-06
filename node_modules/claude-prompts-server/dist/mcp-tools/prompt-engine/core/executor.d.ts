/**
 * Chain Executor - Handles chain execution logic
 *
 * Extracted from PromptExecutionService to provide focused
 * chain execution capabilities with clear separation of concerns.
 */
import { ConvertedPrompt, ToolResponse } from "../../../types/index.js";
import { ChainExecutionOptions, StepArgumentsContext } from "./types.js";
import { ConversationManager } from "../../../text-references/conversation.js";
import { LightweightGateSystem } from "../../../gates/core/index.js";
import { FrameworkManager } from "../../../frameworks/framework-manager.js";
import { FrameworkStateManager } from "../../../frameworks/framework-state-manager.js";
import { ChainSessionManager } from "../../../chain-session/manager.js";
/**
 * ChainExecutor handles all chain-related execution logic
 *
 * This class provides:
 * - Chain instruction generation
 * - Step argument building and command formatting
 * - Chain management commands (validate, list, etc.)
 * - Gate integration for chain validation
 * - Framework integration for methodology guidance
 */
export declare class ChainExecutor {
    private conversationManager;
    private lightweightGateSystem;
    private frameworkManager;
    private frameworkStateManager;
    private responseFormatter;
    private chainSessionManager;
    constructor(conversationManager: ConversationManager, lightweightGateSystem: LightweightGateSystem, frameworkManager: FrameworkManager, frameworkStateManager: FrameworkStateManager, responseFormatter: any, chainSessionManager: ChainSessionManager);
    /**
     * Phase 4: Legacy cleanup - Advanced gate orchestrator setter removed
     */
    /**
     * Detects if a command is a chain management command
     */
    detectChainManagementCommand(command: string): {
        isChainManagement: boolean;
        action?: string;
        target?: string;
        parameters?: Record<string, any>;
    };
    /**
     * Parses key-value parameters from a string
     */
    private parseKeyValueParams;
    /**
     * Handles chain management commands (validate, list, etc.)
     */
    handleChainManagementCommand(chainCommand: {
        action: string;
        target: string;
        parameters: Record<string, any>;
    }): Promise<ToolResponse>;
    /**
     * Executes a chain with dual support (instructions generation)
     */
    executeChainWithDualSupport(convertedPrompt: ConvertedPrompt, promptArgs: Record<string, any>, enableGates: boolean, options?: ChainExecutionOptions): Promise<ToolResponse>;
    /**
     * Handles chain management operations
     */
    executeChainManagement(action: string, parameters: Record<string, any>, options: Record<string, any>): Promise<ToolResponse>;
    /**
     * Generates comprehensive chain execution instructions
     */
    generateChainInstructions(prompt: ConvertedPrompt, steps: any[], enableGates: boolean, options?: ChainExecutionOptions): Promise<ToolResponse>;
    /**
     * Builds step arguments from context and mappings
     */
    buildStepArguments(context: StepArgumentsContext): Record<string, any>;
    /**
     * Formats a step command with arguments
     */
    formatStepCommand(promptId: string, stepArgs: Record<string, any>): string;
    /**
     * Handles validate command for chains
     */
    handleValidateCommand(target: string, parameters: Record<string, any>): Promise<ToolResponse>;
    /**
     * Handles list chains command
     */
    handleListChainsCommand(parameters: Record<string, any>): Promise<ToolResponse>;
    /**
     * Gets gate information for a chain
     */
    getGateInfo(target: string): Promise<ToolResponse>;
    /**
     * Generates metadata section for chain instructions
     */
    generateMetadataSection(prompt: ConvertedPrompt, steps: any[], enableGates: boolean): Promise<string>;
}
