// @lifecycle canonical - Resolves dependencies and merges execution context state.
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
import { PromptArgument } from '../../types/index.js';

/**
 * Context source types
 */
export type ContextSource =
  | 'user_provided'
  | 'conversation_history'
  | 'environment_variables'
  | 'prompt_defaults'
  | 'system_context'
  | 'cached_context'
  | 'generated_placeholder'
  | 'empty_fallback';

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
    alternativeValues?: Array<{ value: any; source: ContextSource; confidence: number }>;
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
export class ContextResolver {
  private logger: Logger;
  private providers: Map<string, ContextProvider> = new Map();
  private cache: Map<string, ContextResolution> = new Map();
  private cacheTimeout: number = 30000; // 30 seconds

  // Resolution statistics
  private stats = {
    totalResolutions: 0,
    successfulResolutions: 0,
    cacheHits: 0,
    cacheMisses: 0,
    providerUsage: new Map<string, number>(),
    averageConfidence: 0,
    averageResolutionTime: 0,
  };

  constructor(logger: Logger) {
    this.logger = logger;
    this.initializeDefaultProviders();
    this.logger.debug(`ContextResolver initialized with ${this.providers.size} providers`);
  }

  /**
   * Resolve context value using priority-based strategy
   */
  async resolveContext(
    key: string,
    hint?: any,
    options: ContextAggregationOptions = {}
  ): Promise<ContextResolution> {
    const startTime = Date.now();
    this.stats.totalResolutions++;

    this.logger.debug(`Resolving context for key: "${key}"`);

    // Check cache first
    if (options.cacheResults !== false) {
      const cached = this.getCachedResolution(key);
      if (cached) {
        this.stats.cacheHits++;
        this.logger.debug(`Context resolved from cache: ${key} -> ${cached.source}`);
        return cached;
      }
    }

    this.stats.cacheMisses++;

    // Get available providers sorted by priority
    const availableProviders = this.getAvailableProviders(options);
    const alternatives: Array<{ value: any; source: ContextSource; confidence: number }> = [];

    // Try each provider in priority order
    for (const provider of availableProviders) {
      try {
        const resolution = await provider.resolve(key, hint);
        if (resolution && this.meetsMinimumConfidence(resolution, options)) {
          // Collect alternatives if requested
          if (options.includeAlternatives) {
            // Continue trying other providers for alternatives
            await this.collectAlternatives(key, hint, availableProviders, provider, alternatives);
            resolution.metadata.alternativeValues = alternatives;
          }

          // Cache the result
          if (options.cacheResults !== false) {
            this.cacheResolution(key, resolution);
          }

          // Update statistics
          this.updateStats(provider.name, resolution, startTime);

          this.logger.debug(
            `Context resolved: ${key} -> ${resolution.source} (confidence: ${resolution.confidence})`
          );
          return resolution;
        } else if (resolution) {
          alternatives.push({
            value: resolution.value,
            source: resolution.source,
            confidence: resolution.confidence,
          });
        }
      } catch (error) {
        this.logger.debug(`Provider ${provider.name} failed for key ${key}:`, error);
        continue;
      }
    }

    // If no provider succeeded, create a fallback resolution
    const fallbackResolution = this.createFallbackResolution(key, hint, alternatives);

    // Cache fallback if enabled
    if (options.cacheResults !== false) {
      this.cacheResolution(key, fallbackResolution);
    }

    this.updateStats('fallback', fallbackResolution, startTime);
    this.logger.debug(`Context resolved using fallback: ${key} -> ${fallbackResolution.source}`);

    return fallbackResolution;
  }

  /**
   * Register a custom context provider
   */
  registerProvider(provider: ContextProvider): void {
    this.providers.set(provider.name, provider);
    this.stats.providerUsage.set(provider.name, 0);
    this.logger.debug(
      `Registered context provider: ${provider.name} (priority: ${provider.priority})`
    );
  }

  /**
   * Unregister a context provider
   */
  unregisterProvider(name: string): boolean {
    const removed = this.providers.delete(name);
    this.stats.providerUsage.delete(name);
    if (removed) {
      this.logger.debug(`Unregistered context provider: ${name}`);
    }
    return removed;
  }

  /**
   * Initialize default context providers
   */
  private initializeDefaultProviders(): void {
    // Conversation history provider
    this.registerProvider({
      name: 'conversation_history',
      priority: 80,
      isAvailable: () => true,
      resolve: async (key: string, hint?: any): Promise<ContextResolution | null> => {
        if (hint?.conversationHistory && hint.conversationHistory.length > 0) {
          const lastMessage = hint.conversationHistory[hint.conversationHistory.length - 1];
          if (lastMessage?.content) {
            return {
              value: lastMessage.content,
              source: 'conversation_history',
              confidence: 0.8,
              metadata: {
                resolvedAt: Date.now(),
                strategy: 'last_message',
                warnings: [],
              },
            };
          }
        }
        return null;
      },
    });

    // Environment variables provider
    this.registerProvider({
      name: 'environment_variables',
      priority: 70,
      isAvailable: () => true,
      resolve: async (key: string): Promise<ContextResolution | null> => {
        const envKey = `PROMPT_${key.toUpperCase()}`;
        const value = process.env[envKey];
        if (value) {
          return {
            value,
            source: 'environment_variables',
            confidence: 0.9,
            metadata: {
              resolvedAt: Date.now(),
              strategy: 'env_var',
              warnings: [],
            },
          };
        }
        return null;
      },
    });

    // Prompt defaults provider
    this.registerProvider({
      name: 'prompt_defaults',
      priority: 60,
      isAvailable: () => true,
      resolve: async (key: string, hint?: any): Promise<ContextResolution | null> => {
        if (hint?.promptDefaults?.[key] !== undefined) {
          return {
            value: hint.promptDefaults[key],
            source: 'prompt_defaults',
            confidence: 0.7,
            metadata: {
              resolvedAt: Date.now(),
              strategy: 'prompt_specific',
              warnings: [],
            },
          };
        }
        return null;
      },
    });

    // System context provider
    this.registerProvider({
      name: 'system_context',
      priority: 50,
      isAvailable: () => true,
      resolve: async (key: string, hint?: any): Promise<ContextResolution | null> => {
        if (hint?.systemContext?.[key] !== undefined) {
          return {
            value: hint.systemContext[key],
            source: 'system_context',
            confidence: 0.6,
            metadata: {
              resolvedAt: Date.now(),
              strategy: 'system_provided',
              warnings: [],
            },
          };
        }
        return null;
      },
    });

    // Smart placeholder generator
    this.registerProvider({
      name: 'placeholder_generator',
      priority: 30,
      isAvailable: () => true,
      resolve: async (key: string, hint?: any): Promise<ContextResolution | null> => {
        const placeholder = this.generateSmartPlaceholder(key, hint);
        return {
          value: placeholder.value,
          source: 'generated_placeholder',
          confidence: placeholder.confidence,
          metadata: {
            resolvedAt: Date.now(),
            strategy: 'smart_generation',
            warnings: placeholder.warnings,
          },
        };
      },
    });
  }

  /**
   * Get available providers based on options
   */
  private getAvailableProviders(options: ContextAggregationOptions): ContextProvider[] {
    return Array.from(this.providers.values())
      .filter((provider) => {
        // Check if provider is available
        if (!provider.isAvailable()) return false;

        // Check preferred sources
        if (options.preferredSources?.length) {
          // This is a simplistic check - in practice you'd map provider names to sources
          const providerSource = this.mapProviderToSource(provider.name);
          if (!options.preferredSources.includes(providerSource)) return false;
        }

        // Check excluded sources
        if (options.excludedSources?.length) {
          const providerSource = this.mapProviderToSource(provider.name);
          if (options.excludedSources.includes(providerSource)) return false;
        }

        return true;
      })
      .sort((a, b) => b.priority - a.priority); // Higher priority first
  }

  /**
   * Map provider name to context source
   */
  private mapProviderToSource(providerName: string): ContextSource {
    const mapping: Record<string, ContextSource> = {
      conversation_history: 'conversation_history',
      environment_variables: 'environment_variables',
      prompt_defaults: 'prompt_defaults',
      system_context: 'system_context',
      placeholder_generator: 'generated_placeholder',
    };

    return mapping[providerName] || 'system_context';
  }

  /**
   * Check if resolution meets minimum confidence
   */
  private meetsMinimumConfidence(
    resolution: ContextResolution,
    options: ContextAggregationOptions
  ): boolean {
    if (options.minimumConfidence === undefined) return true;
    return resolution.confidence >= options.minimumConfidence;
  }

  /**
   * Collect alternative values from other providers
   */
  private async collectAlternatives(
    key: string,
    hint: any,
    allProviders: ContextProvider[],
    usedProvider: ContextProvider,
    alternatives: Array<{ value: any; source: ContextSource; confidence: number }>
  ): Promise<void> {
    const remainingProviders = allProviders.filter((p) => p !== usedProvider);

    for (const provider of remainingProviders.slice(0, 3)) {
      // Limit to 3 alternatives
      try {
        const resolution = await provider.resolve(key, hint);
        if (resolution) {
          alternatives.push({
            value: resolution.value,
            source: resolution.source,
            confidence: resolution.confidence,
          });
        }
      } catch (error) {
        // Ignore errors when collecting alternatives
        continue;
      }
    }
  }

  /**
   * Generate smart placeholder based on key characteristics
   */
  private generateSmartPlaceholder(
    key: string,
    hint?: any
  ): { value: string; confidence: number; warnings: string[] } {
    const keyLower = key.toLowerCase();
    const warnings: string[] = [];

    // Argument-specific placeholders
    if (hint?.argumentDef) {
      const arg = hint.argumentDef as PromptArgument;
      const description = (arg.description || '').toLowerCase();

      if (description.includes('file') || keyLower.includes('file')) {
        return { value: '[File path required]', confidence: 0.4, warnings };
      }

      if (description.includes('url') || keyLower.includes('url')) {
        return { value: '[URL required]', confidence: 0.4, warnings };
      }

      if (description.includes('number') || keyLower.includes('count')) {
        return { value: '1', confidence: 0.5, warnings };
      }
    }

    // Generic semantic placeholders
    if (keyLower.includes('content') || keyLower.includes('text') || keyLower.includes('input')) {
      return {
        value: '[Content to be provided]',
        confidence: 0.3,
        warnings: ['Generic content placeholder - consider providing specific content'],
      };
    }

    if (keyLower.includes('name') || keyLower.includes('title')) {
      return { value: `[${key} required]`, confidence: 0.3, warnings };
    }

    if (keyLower.includes('format') || keyLower.includes('style')) {
      return { value: 'default', confidence: 0.4, warnings };
    }

    if (keyLower.includes('language') || keyLower.includes('lang')) {
      return { value: 'en', confidence: 0.4, warnings };
    }

    // Ultra-generic fallback
    warnings.push(`No semantic match found for "${key}" - using generic placeholder`);
    return {
      value: `[${key.replace(/_/g, ' ')} to be specified]`,
      confidence: 0.2,
      warnings,
    };
  }

  /**
   * Create fallback resolution when no providers succeed
   */
  private createFallbackResolution(
    key: string,
    hint: any,
    alternatives: Array<{ value: any; source: ContextSource; confidence: number }>
  ): ContextResolution {
    // If we have alternatives, use the best one
    if (alternatives.length > 0) {
      const best = [...alternatives].sort((a, b) => b.confidence - a.confidence)[0];
      if (!best) {
        return {
          value: '',
          source: 'empty_fallback',
          confidence: 0.1,
          metadata: {
            resolvedAt: Date.now(),
            strategy: 'empty_fallback',
            warnings: [`No context available for "${key}" - using empty value`],
          },
        };
      }
      return {
        value: best.value,
        source: best.source,
        confidence: best.confidence,
        metadata: {
          resolvedAt: Date.now(),
          strategy: 'best_alternative',
          alternativeValues: alternatives,
          warnings: ['Used alternative resolution after primary strategies failed'],
        },
      };
    }

    // Last resort: empty fallback
    return {
      value: '',
      source: 'empty_fallback',
      confidence: 0.1,
      metadata: {
        resolvedAt: Date.now(),
        strategy: 'empty_fallback',
        warnings: [`No context available for "${key}" - using empty value`],
      },
    };
  }

  /**
   * Get cached resolution if available and not expired
   */
  private getCachedResolution(key: string): ContextResolution | null {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.metadata.resolvedAt < this.cacheTimeout) {
      return cached;
    } else if (cached) {
      // Remove expired cache entry
      this.cache.delete(key);
    }
    return null;
  }

  /**
   * Cache resolution result
   */
  private cacheResolution(key: string, resolution: ContextResolution): void {
    this.cache.set(key, resolution);

    // Cleanup old entries periodically
    if (this.cache.size > 1000) {
      const cutoff = Date.now() - this.cacheTimeout;
      for (const [k, v] of this.cache.entries()) {
        if (v.metadata.resolvedAt < cutoff) {
          this.cache.delete(k);
        }
      }
    }
  }

  /**
   * Update resolution statistics
   */
  private updateStats(
    providerName: string,
    resolution: ContextResolution,
    startTime: number
  ): void {
    this.stats.successfulResolutions++;

    const current = this.stats.providerUsage.get(providerName) || 0;
    this.stats.providerUsage.set(providerName, current + 1);

    // Update average confidence
    const totalSuccessful = this.stats.successfulResolutions;
    this.stats.averageConfidence =
      (this.stats.averageConfidence * (totalSuccessful - 1) + resolution.confidence) /
      totalSuccessful;

    // Update average resolution time
    const resolutionTime = Date.now() - startTime;
    this.stats.averageResolutionTime =
      (this.stats.averageResolutionTime * (totalSuccessful - 1) + resolutionTime) / totalSuccessful;
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
    this.logger.debug('Context cache cleared');
  }

  /**
   * Get context resolution statistics
   */
  getStats(): typeof this.stats {
    return {
      ...this.stats,
      providerUsage: new Map(this.stats.providerUsage),
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      totalResolutions: 0,
      successfulResolutions: 0,
      cacheHits: 0,
      cacheMisses: 0,
      providerUsage: new Map(Array.from(this.providers.keys()).map((name) => [name, 0])),
      averageConfidence: 0,
      averageResolutionTime: 0,
    };
  }
}

/**
 * Factory function to create context resolver
 */
export function createContextResolver(logger: Logger): ContextResolver {
  return new ContextResolver(logger);
}
