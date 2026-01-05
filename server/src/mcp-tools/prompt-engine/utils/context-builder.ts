// @lifecycle canonical - Builds execution context for prompt engine.
/**
 * Context Builder - Handles execution context building
 *
 * Extracted from PromptExecutionService to provide focused
 * context building capabilities with clear separation of concerns.
 */

import os from 'node:os';
import path from 'node:path';

import { ExecutionContext } from '../../../execution/parsers/index.js';
import { FrameworkManager } from '../../../frameworks/framework-manager.js';
import { FrameworkStateManager } from '../../../frameworks/framework-state-manager.js';
import { FrameworkExecutionContext } from '../../../frameworks/types/index.js';
import { createLogger, getDefaultLoggerConfig } from '../../../logging/index.js';
import { ConvertedPrompt } from '../../../types/index.js';

const logger = createLogger(
  getDefaultLoggerConfig({
    logFile: path.join(os.tmpdir(), 'context-builder.log'),
    transport: 'stdio',
    enableDebug: false,
  })
);

export interface EnhancedExecutionContext extends ExecutionContext {
  promptId: string;
  promptArgs: Record<string, any>;
  sessionId: string;
  forceRestart: boolean;
  enableGates: boolean;
  frameworkId?: string;
  contextData: Record<string, any>;
  frameworkContext?: FrameworkExecutionContext;
  metadata?: Record<string, any>;
  performance?: {
    startTime: number;
    memoryUsage?: number;
  };
}

/**
 * ContextBuilder handles all execution context building
 *
 * This class provides:
 * - Execution context creation and enhancement
 * - Framework integration and context injection
 * - Performance tracking and metadata collection
 * - Context validation and preparation
 */
export class ContextBuilder {
  private frameworkManager: FrameworkManager | undefined;
  private frameworkStateManager: FrameworkStateManager | undefined;

  constructor(frameworkManager?: FrameworkManager, frameworkStateManager?: FrameworkStateManager) {
    this.frameworkManager = frameworkManager;
    this.frameworkStateManager = frameworkStateManager;
  }

  /**
   * Build enhanced execution context
   */
  public buildExecutionContext(
    promptId: string,
    promptArgs: Record<string, any>,
    convertedPrompt: ConvertedPrompt,
    options: Record<string, any> = {}
  ): EnhancedExecutionContext {
    try {
      logger.debug('🔧 [ContextBuilder] Building execution context', {
        promptId,
        argsCount: Object.keys(promptArgs).length,
        hasFrameworkManager: !!this.frameworkManager,
      });

      const startTime = Date.now();
      const memoryUsage = this.getMemoryUsage();

      // Build base context - properly typed for execution parsers
      const baseExecutionContext: ExecutionContext = {
        conversationHistory: options['conversationHistory'],
        environmentVars: options['environmentVars'],
        promptDefaults: options['promptDefaults'],
        userSession: options['userSession'],
        systemContext: options['systemContext'],
      };

      // Build enhanced context
      const enhancedContext: EnhancedExecutionContext = {
        ...baseExecutionContext,
        promptId,
        promptArgs,
        sessionId: options['sessionId'] || this.generateSessionId(),
        forceRestart: options['forceRestart'] || false,
        enableGates: options['enableGates'] !== false,
        frameworkId: options['frameworkId'],
        contextData: options['contextData'] || {},
        metadata: this.buildMetadata(convertedPrompt, options),
        performance: {
          startTime,
          memoryUsage,
        },
      };

      // Add framework context if available
      if (this.frameworkManager && this.frameworkStateManager) {
        const frameworkContext = this.buildFrameworkContext(convertedPrompt, promptArgs, options);
        if (frameworkContext) {
          enhancedContext.frameworkContext = frameworkContext;
        }
      }

      logger.debug('✅ [ContextBuilder] Execution context built successfully', {
        promptId,
        hasFrameworkContext: !!enhancedContext.frameworkContext,
        sessionId: enhancedContext.sessionId,
      });

      return enhancedContext;
    } catch (error) {
      logger.error('❌ [ContextBuilder] Context building failed', {
        promptId,
        error: error instanceof Error ? error.message : String(error),
      });

      // Return minimal context on error
      return {
        promptId,
        promptArgs,
        sessionId: this.generateSessionId(),
        forceRestart: false,
        enableGates: true,
        contextData: {},
        metadata: { error: error instanceof Error ? error.message : String(error) },
        performance: { startTime: Date.now() },
      };
    }
  }

  /**
   * Build framework-specific execution context
   */
  private buildFrameworkContext(
    convertedPrompt: ConvertedPrompt,
    promptArgs: Record<string, any>,
    options: Record<string, any>
  ): FrameworkExecutionContext | undefined {
    try {
      if (!this.frameworkManager || !this.frameworkStateManager) {
        return undefined;
      }

      logger.debug('🎯 [ContextBuilder] Building framework context');

      const activeFramework = this.frameworkStateManager.getActiveFramework();
      const frameworkId = options['frameworkId'] || activeFramework;

      if (!frameworkId) {
        logger.debug('No framework specified, skipping framework context');
        return undefined;
      }

      const frameworkContext = this.frameworkManager.generateExecutionContext(convertedPrompt, {
        promptType: options['executionType'] || 'prompt',
        complexity: 'medium',
        userPreference: frameworkId,
      });

      logger.debug('✅ [ContextBuilder] Framework context built', {
        frameworkId,
        hasSystemPrompt: !!frameworkContext.systemPrompt,
      });

      return frameworkContext;
    } catch (error) {
      logger.warn('⚠️ [ContextBuilder] Framework context building failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  /**
   * Build execution metadata
   */
  private buildMetadata(
    convertedPrompt: ConvertedPrompt,
    options: Record<string, any>
  ): Record<string, any> {
    return {
      promptId: convertedPrompt.id,
      promptTitle: convertedPrompt.name,
      promptCategory: convertedPrompt.category,
      promptVersion: '1.0', // ConvertedPrompt doesn't have version property
      executionId: this.generateExecutionId(),
      timestamp: new Date().toISOString(),
      userAgent: options['userAgent'],
      clientInfo: options['clientInfo'],
      environment: process.env['NODE_ENV'] || 'development',
      nodeVersion: process.version,
      platform: process.platform,
    };
  }

  /**
   * Generate unique session ID
   */
  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Generate unique execution ID
   */
  private generateExecutionId(): string {
    return `exec_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Get current memory usage
   */
  private getMemoryUsage(): number {
    try {
      return process.memoryUsage().heapUsed;
    } catch (error) {
      logger.warn('⚠️ [ContextBuilder] Failed to get memory usage', {
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  /**
   * Validate execution context
   */
  public validateContext(context: EnhancedExecutionContext): {
    isValid: boolean;
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      // Required fields validation
      if (!context.promptId) {
        errors.push('Prompt ID is required');
      }

      if (!context.sessionId) {
        errors.push('Session ID is required');
      }

      if (!context.promptArgs) {
        warnings.push('No prompt arguments provided');
      }

      // Context data validation
      if (context.contextData && typeof context.contextData !== 'object') {
        errors.push('Context data must be an object');
      }

      // Performance data validation
      if (context.performance && !context.performance.startTime) {
        warnings.push('Performance tracking missing start time');
      }

      // Framework context validation
      if (context.frameworkContext) {
        if (!context.frameworkContext.selectedFramework) {
          warnings.push('Framework context missing selected framework');
        }
      }

      const isValid = errors.length === 0;

      logger.debug('🔍 [ContextBuilder] Context validation completed', {
        isValid,
        errorsCount: errors.length,
        warningsCount: warnings.length,
      });

      return { isValid, errors, warnings };
    } catch (error) {
      logger.error('❌ [ContextBuilder] Context validation failed', {
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        isValid: false,
        errors: [`Validation error: ${error instanceof Error ? error.message : String(error)}`],
        warnings,
      };
    }
  }

  /**
   * Clone context for reuse
   */
  public cloneContext(
    context: EnhancedExecutionContext,
    overrides: Partial<EnhancedExecutionContext> = {}
  ): EnhancedExecutionContext {
    try {
      const clonedContext: EnhancedExecutionContext = {
        ...context,
        ...overrides,
        promptArgs: { ...context.promptArgs, ...(overrides.promptArgs || {}) },
        contextData: { ...context.contextData, ...(overrides.contextData || {}) },
        metadata: { ...context.metadata, ...(overrides.metadata || {}) },
        performance: {
          startTime: context.performance?.startTime || Date.now(),
          ...(context.performance?.memoryUsage !== undefined
            ? { memoryUsage: context.performance.memoryUsage }
            : {}),
          ...(overrides.performance || {}),
        },
      };

      // Update execution tracking
      if (clonedContext.metadata) {
        clonedContext.metadata['clonedFrom'] = context.metadata?.['executionId'];
        clonedContext.metadata['executionId'] = this.generateExecutionId();
      }

      logger.debug('🔄 [ContextBuilder] Context cloned successfully', {
        originalId: context.metadata?.['executionId'],
        clonedId: clonedContext.metadata?.['executionId'],
      });

      return clonedContext;
    } catch (error) {
      logger.error('❌ [ContextBuilder] Context cloning failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
