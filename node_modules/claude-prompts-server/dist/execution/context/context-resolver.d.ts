/**
 * Context Resolution System
 *
 * Intelligent context resolution with priority-based fallbacks that replaces
 * the hardcoded {{previous_message}} pattern with flexible, multi-source context aggregation.
 *
 * Features:
 * - Priority-based context resolution strategies
 * - Multi-source context aggregation
 * - Context validation and sanitization
 * - Smart fallback context generation
 * - Context caching for performance
 */
import { Logger } from '../../logging/index.js';
/**
 * Context source types
 */
export type ContextSource = 'user_provided' | 'conversation_history' | 'environment_variables' | 'prompt_defaults' | 'system_context' | 'cached_context' | 'generated_placeholder' | 'empty_fallback';
/**
 * Context resolution result
 */
export interface ContextResolution {
    value: any;
    source: ContextSource;
    confidence: number;
    metadata: {
        resolvedAt: number;
        strategy: string;
        alternativeValues?: Array<{
            value: any;
            source: ContextSource;
            confidence: number;
        }>;
        warnings: string[];
    };
}
/**
 * Context provider interface
 */
export interface ContextProvider {
    name: string;
    priority: number;
    isAvailable: () => boolean;
    resolve: (key: string, hint?: any) => Promise<ContextResolution | null>;
}
/**
 * Context aggregation options
 */
export interface ContextAggregationOptions {
    preferredSources?: ContextSource[];
    excludedSources?: ContextSource[];
    cacheResults?: boolean;
    includeAlternatives?: boolean;
    minimumConfidence?: number;
}
/**
 * Context resolver class
 */
export declare class ContextResolver {
    private logger;
    private providers;
    private cache;
    private cacheTimeout;
    private stats;
    constructor(logger: Logger);
    /**
     * Resolve context value using priority-based strategy
     */
    resolveContext(key: string, hint?: any, options?: ContextAggregationOptions): Promise<ContextResolution>;
    /**
     * Register a custom context provider
     */
    registerProvider(provider: ContextProvider): void;
    /**
     * Unregister a context provider
     */
    unregisterProvider(name: string): boolean;
    /**
     * Initialize default context providers
     */
    private initializeDefaultProviders;
    /**
     * Get available providers based on options
     */
    private getAvailableProviders;
    /**
     * Map provider name to context source
     */
    private mapProviderToSource;
    /**
     * Check if resolution meets minimum confidence
     */
    private meetsMinimumConfidence;
    /**
     * Collect alternative values from other providers
     */
    private collectAlternatives;
    /**
     * Generate smart placeholder based on key characteristics
     */
    private generateSmartPlaceholder;
    /**
     * Create fallback resolution when no providers succeed
     */
    private createFallbackResolution;
    /**
     * Get cached resolution if available and not expired
     */
    private getCachedResolution;
    /**
     * Cache resolution result
     */
    private cacheResolution;
    /**
     * Update resolution statistics
     */
    private updateStats;
    /**
     * Clear cache
     */
    clearCache(): void;
    /**
     * Get context resolution statistics
     */
    getStats(): typeof this.stats;
    /**
     * Reset statistics
     */
    resetStats(): void;
}
/**
 * Factory function to create context resolver
 */
export declare function createContextResolver(logger: Logger): ContextResolver;
