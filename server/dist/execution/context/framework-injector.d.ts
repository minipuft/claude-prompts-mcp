/**
 * Framework Injector - Phase 3
 * Handles framework system prompt injection into execution context
 * Integrates with FrameworkManager to provide methodology-based system prompts
 */
import { Logger } from "../../logging/index.js";
import { ConfigManager } from "../../config/index.js";
import type { ConvertedPrompt } from "../../types/index.js";
import { FrameworkManager } from "../../frameworks/framework-manager.js";
import { FrameworkExecutionContext } from "../../frameworks/types/index.js";
import { FrameworkStateManager } from "../../frameworks/framework-state-manager.js";
import type { ContentAnalysisResult } from "../../semantic/types.js";
import { MethodologyEnhancement } from "../../frameworks/types/index.js";
/**
 * Framework injection result
 */
export interface FrameworkInjectionResult {
    originalPrompt: ConvertedPrompt;
    frameworkContext: FrameworkExecutionContext;
    enhancedPrompt: ConvertedPrompt & {
        frameworkSystemPrompt?: string;
        frameworkGuidelines?: string[];
        frameworkMetadata?: {
            selectedFramework: string;
            selectionReason: string;
            confidence: number;
        };
        methodologyEnhancement?: MethodologyEnhancement;
    };
    injectionMetadata: {
        injectedAt: Date;
        frameworkId: string;
        injectionMethod: 'system_prompt' | 'user_prefix' | 'guidelines';
        originalSystemMessage?: string;
    };
}
/**
 * Framework injection configuration
 */
export interface FrameworkInjectionConfig {
    enableInjection: boolean;
    injectionMethod: 'system_prompt' | 'user_prefix' | 'guidelines';
    preserveOriginalSystemMessage: boolean;
    includeFrameworkMetadata: boolean;
    userPreferenceOverride?: string;
    enableMethodologyGuides: boolean;
}
/**
 * Framework Injector Implementation
 * Injects framework system prompts into prompt execution context
 */
export declare class FrameworkInjector {
    private frameworkManager;
    private frameworkStateManager?;
    private logger;
    private config;
    private configManager;
    private frameworksConfig;
    private frameworksConfigListener;
    constructor(frameworkManager: FrameworkManager, logger: Logger, configManager: ConfigManager, config?: Partial<FrameworkInjectionConfig>, frameworkStateManager?: FrameworkStateManager);
    /**
     * Main framework injection method
     * Enhances prompt with appropriate framework system prompt based on semantic analysis
     */
    injectFrameworkContext(prompt: ConvertedPrompt, semanticAnalysis: ContentAnalysisResult, userFrameworkPreference?: string): Promise<FrameworkInjectionResult>;
    /**
     * Quick framework system prompt injection for execution
     */
    injectSystemPrompt(prompt: ConvertedPrompt, semanticAnalysis: ContentAnalysisResult): Promise<string>;
    /**
     * Get framework guidelines for execution context
     */
    getFrameworkGuidelines(prompt: ConvertedPrompt, semanticAnalysis: ContentAnalysisResult): Promise<string[]>;
    /**
     * Perform the actual framework injection based on configuration
     */
    private performFrameworkInjection;
    /**
     * Get methodology guide for a specific framework
     */
    private getMethodologyGuide;
    /**
     * Create passthrough result when injection is disabled or fails
     */
    private createPassthroughResult;
    /**
     * Update injection configuration
     */
    updateConfig(newConfig: Partial<FrameworkInjectionConfig>): void;
    /**
     * Get current injection configuration
     */
    getConfig(): FrameworkInjectionConfig;
    private shouldApplyMethodologyGuides;
}
/**
 * Create and configure framework injector
 */
export declare function createFrameworkInjector(frameworkManager: FrameworkManager, logger: Logger, configManager: ConfigManager, config?: Partial<FrameworkInjectionConfig>, frameworkStateManager?: FrameworkStateManager): Promise<FrameworkInjector>;
