/**
 * Prompt Guidance Service - Simplified Implementation
 *
 * Unified service that orchestrates prompt guidance components.
 * Simplified: System prompt injection is now inlined (was SystemPromptInjector).
 */
import { Logger } from '../../logging/index.js';
import { ConvertedPrompt } from '../../types/index.js';
import { FrameworkManager } from '../framework-manager.js';
import { type MethodologyTrackerConfig } from './methodology-tracker.js';
import { MethodologyState, MethodologySwitchRequest, ProcessingGuidance, StepGuidance, SystemPromptInjectionResult } from '../types/index.js';
import type { ContentAnalysisResult } from '../../semantic/types.js';
/**
 * Prompt guidance service configuration (simplified)
 */
type MethodologyTrackingServiceConfig = Partial<MethodologyTrackerConfig> & {
    enabled: boolean;
};
export interface PromptGuidanceServiceConfig {
    systemPromptInjection: {
        enabled: boolean;
    };
    templateEnhancement: {
        enabled: boolean;
        enhancementLevel: 'minimal' | 'moderate' | 'comprehensive';
        enableArgumentSuggestions: boolean;
        enableStructureOptimization: boolean;
    };
    methodologyTracking: MethodologyTrackingServiceConfig;
}
/**
 * Comprehensive prompt guidance result
 */
export interface PromptGuidanceResult {
    originalPrompt: ConvertedPrompt;
    enhancedPrompt?: ConvertedPrompt;
    systemPromptInjection?: SystemPromptInjectionResult;
    templateProcessingGuidance?: ProcessingGuidance;
    executionStepGuidance?: StepGuidance;
    activeMethodology: string;
    guidanceApplied: boolean;
    processingTimeMs: number;
    metadata: {
        frameworkUsed: string;
        enhancementsApplied: string[];
        confidenceScore: number;
        semanticAware?: boolean;
        semanticComplexity?: 'low' | 'medium' | 'high';
        semanticConfidence?: number;
    };
}
export type ServicePromptGuidanceResult = PromptGuidanceResult;
/**
 * Prompt Guidance Service
 *
 * Orchestrates prompt guidance: methodology tracking, template enhancement,
 * and simple system prompt injection (inlined, no separate injector class).
 */
export declare class PromptGuidanceService {
    private logger;
    private config;
    private methodologyTracker;
    private templateEnhancer;
    private frameworkManager?;
    private initialized;
    constructor(logger: Logger, config?: Partial<PromptGuidanceServiceConfig>);
    /**
     * Initialize the prompt guidance service
     */
    initialize(frameworkManager?: FrameworkManager): Promise<void>;
    /**
     * Apply comprehensive prompt guidance to a prompt
     */
    applyGuidance(prompt: ConvertedPrompt, options?: {
        includeSystemPromptInjection?: boolean;
        includeTemplateEnhancement?: boolean;
        frameworkOverride?: string;
        semanticAnalysis?: ContentAnalysisResult;
        selectedResources?: string[];
        availableResources?: ConvertedPrompt[];
    }): Promise<PromptGuidanceResult>;
    /**
     * Inject methodology guidance into system prompt (inlined from SystemPromptInjector)
     *
     * Simple implementation: get guidance from methodology guide, combine with template.
     */
    private injectMethodologyGuidance;
    /**
     * Apply runtime enhancement based on LLM judge result
     */
    applyRuntimeEnhancement(template: string, judgeResult: any, availableResources: ConvertedPrompt[], frameworkOverride?: string): Promise<string>;
    /**
     * Switch methodology using the tracker
     */
    switchMethodology(request: MethodologySwitchRequest): Promise<boolean>;
    /**
     * Get current methodology state
     */
    getCurrentMethodologyState(): MethodologyState;
    /**
     * Get methodology system health
     */
    getSystemHealth(): import("../types/prompt-guidance-types.js").MethodologyHealth;
    /**
     * Enable or disable the guidance system
     */
    setGuidanceEnabled(enabled: boolean): void;
    /**
     * Update service configuration
     */
    updateConfig(config: Partial<PromptGuidanceServiceConfig>): void;
    /**
     * Shutdown the service
     */
    shutdown(): Promise<void>;
    /**
     * Set framework manager for guidance operations
     */
    setFrameworkManager(frameworkManager: FrameworkManager): void;
    /**
     * Check if service is initialized
     */
    isInitialized(): boolean;
    /**
     * Get current configuration
     */
    getConfig(): PromptGuidanceServiceConfig;
    /**
     * Get active framework definition
     */
    private getActiveFramework;
    /**
     * Get methodology guide for framework
     */
    private getMethodologyGuide;
}
/**
 * Create and initialize a PromptGuidanceService instance
 */
export declare function createPromptGuidanceService(logger: Logger, config?: Partial<PromptGuidanceServiceConfig>, frameworkManager?: FrameworkManager): Promise<PromptGuidanceService>;
export {};
