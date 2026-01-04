/**
 * Gate Selection Engine - Intelligent Gate Selection
 *
 * Single responsibility: Select appropriate gates based on semantic analysis and context.
 * Clean dependencies: Only content analysis types and framework definitions.
 */
import { ConfigManager } from '../../config/index.js';
import { GateSelectionCriteria, GateSelectionResult } from '../core/gate-definitions.js';
import type { FrameworkDefinition } from '../../frameworks/types/index.js';
import type { Logger } from '../../logging/index.js';
import type { ContentAnalysisResult } from '../../semantic/types.js';
/**
 * User preferences for gate selection
 */
export interface UserPreferences {
    strictValidation?: boolean;
    performanceMode?: boolean;
    qualityFocus?: 'speed' | 'accuracy' | 'balanced';
}
/**
 * Extended gate selection criteria with semantic analysis
 * Explicitly includes all base properties for strict TypeScript compilation compatibility
 */
export interface ExtendedGateSelectionCriteria extends GateSelectionCriteria {
    framework?: string;
    category?: string;
    promptId?: string;
    executionMode?: 'single' | 'prompt' | 'template' | 'chain';
    complexityLevel?: 'low' | 'medium' | 'high';
    semanticAnalysis?: ContentAnalysisResult;
    frameworkContext?: FrameworkDefinition;
    userPreferences?: UserPreferences;
}
/**
 * Gate selection engine with semantic awareness
 */
export declare class GateSelectionEngine {
    private logger;
    private selectionHistory;
    private configManager;
    private frameworksConfig;
    private frameworksConfigListener;
    private static readonly METHODOLOGY_GATES;
    constructor(logger: Logger, configManager: ConfigManager);
    /**
     * Select appropriate gates based on criteria and semantic analysis
     *
     * @param criteria - Extended selection criteria with semantic analysis
     * @returns Gate selection result with reasoning
     */
    selectGates(criteria: ExtendedGateSelectionCriteria): Promise<GateSelectionResult>;
    /**
     * Select primary gates based on framework and category
     */
    private selectPrimaryGates;
    /**
     * Select gates based on semantic analysis
     */
    private selectSemanticGates;
    /**
     * Merge multiple gate selections and remove duplicates
     */
    private mergeGateSelections;
    /**
     * Generate human-readable reasoning for gate selection
     */
    private generateSelectionReasoning;
    /**
     * Calculate confidence score for gate selection
     */
    private calculateSelectionConfidence;
    /**
     * Estimate execution time for selected gates
     */
    private estimateExecutionTime;
    /**
     * Determine fallback gates if primary selection fails
     */
    private determineFallbackGates;
    /**
     * Get selection history for analysis
     */
    getSelectionHistory(): GateSelectionResult[];
    /**
     * Clear selection history
     */
    clearHistory(): void;
    /**
     * Get selection statistics
     */
    getStatistics(): {
        totalSelections: number;
        averageGatesSelected: number;
        averageConfidence: number;
        historySize: number;
    };
    /**
     * Cleanup method - removes event listeners to prevent memory leaks
     */
    cleanup(): Promise<void>;
}
/**
 * Factory function for creating gate selection engine
 */
export declare function createGateSelectionEngine(logger: Logger, configManager: ConfigManager): GateSelectionEngine;
