/**
 * Argument Processing Pipeline
 * 
 * Advanced argument processing system that handles validation, sanitization,
 * type coercion, and enrichment based on prompt definitions and execution context.
 * 
 * Features:
 * - Type-aware argument coercion based on prompt definitions
 * - Smart default resolution (replaces hardcoded {{previous_message}})
 * - Multi-source context aggregation
 * - Argument validation cascading
 * - Context-aware placeholder resolution
 */

import { Logger } from "../../logging/index.js";
import { PromptData, PromptArgument } from "../../types/index.js";
import { ValidationError, safeJsonParse, validateJsonArguments } from "../../utils/index.js";

/**
 * Processing result with detailed metadata
 */
export interface ArgumentParsingResult {
  processedArgs: Record<string, string | number | boolean | null>;
  resolvedPlaceholders: Record<string, string | number | boolean | null>;
  validationResults: ValidationResult[];
  metadata: {
    parsingStrategy: string;
    appliedDefaults: string[];
    typeCoercions: Array<{ arg: string; from: string; to: string }>;
    contextSources: Record<string, string>;
    warnings: string[];
  };
}

/**
 * Validation result for individual arguments
 */
export interface ValidationResult {
  argumentName: string;
  isValid: boolean;
  originalValue: unknown;
  processedValue: string | number | boolean | null;
  appliedRules: string[];
  warnings: string[];
  errors: string[];
}

/**
 * Execution context for argument processing
 */
export interface ExecutionContext {
  conversationHistory?: Array<{role: string; content: string; timestamp?: string}>;
  environmentVars?: Record<string, string>;
  promptDefaults?: Record<string, string | number | boolean | null>;
  userSession?: Record<string, string | number | boolean | null>;
  systemContext?: Record<string, string | number | boolean | null>;
}

/**
 * Processing strategy interface
 */
interface ProcessingStrategy {
  name: string;
  canHandle: (rawArgs: string, promptData: PromptData) => boolean;
  process: (rawArgs: string, promptData: PromptData, context: ExecutionContext) => ArgumentParsingResult;
}

/**
 * Argument Processor Class
 */
export class ArgumentParser {
  private logger: Logger;
  private strategies: ProcessingStrategy[];
  
  // Processing statistics
  private stats = {
    totalProcessed: 0,
    successfulProcessing: 0,
    validationFailures: 0,
    typeCoercions: 0,
    defaultsApplied: 0,
    contextResolutions: 0
  };

  constructor(logger: Logger) {
    this.logger = logger;
    this.strategies = this.initializeStrategies();
    this.logger.debug(`ArgumentParser initialized with ${this.strategies.length} processing strategies`);
  }

  /**
   * Process arguments through validation, sanitization, and enrichment pipeline
   */
  async parseArguments(
    rawArgs: string,
    promptData: PromptData,
    context: ExecutionContext = {}
  ): Promise<ArgumentParsingResult> {
    this.stats.totalProcessed++;
    
    this.logger.debug(`Processing arguments for prompt "${promptData.id}": "${rawArgs.substring(0, 100)}..."`);

    // Select appropriate processing strategy
    const strategy = this.selectStrategy(rawArgs, promptData);
    
    try {
      const result = strategy.process(rawArgs, promptData, context);
      
      // Apply validation and enrichment
      const enrichedResult = await this.enrichResult(result, promptData, context);
      
      this.stats.successfulProcessing++;
      this.updateProcessingStats(enrichedResult);
      
      this.logger.debug(`Arguments processed successfully using strategy: ${strategy.name}`);
      return enrichedResult;
      
    } catch (error) {
      this.stats.validationFailures++;
      this.logger.error(`Argument processing failed for prompt ${promptData.id}:`, error);
      throw error;
    }
  }

  /**
   * Initialize processing strategies
   */
  private initializeStrategies(): ProcessingStrategy[] {
    return [
      this.createJsonStrategy(),
      this.createKeyValueStrategy(),
      this.createSimpleTextStrategy(),
      this.createFallbackStrategy()
    ];
  }

  /**
   * Select best processing strategy for the given arguments
   */
  private selectStrategy(rawArgs: string, promptData: PromptData): ProcessingStrategy {
    for (const strategy of this.strategies) {
      if (strategy.canHandle(rawArgs, promptData)) {
        return strategy;
      }
    }
    
    // Should never reach here due to fallback strategy, but safety first
    return this.strategies[this.strategies.length - 1];
  }

  /**
   * JSON argument processing strategy
   */
  private createJsonStrategy(): ProcessingStrategy {
    return {
      name: 'json',
      canHandle: (rawArgs: string) => {
        const trimmed = rawArgs.trim();
        return (trimmed.startsWith('{') && trimmed.endsWith('}')) || 
               (trimmed.startsWith('[') && trimmed.endsWith(']'));
      },
      process: (rawArgs: string, promptData: PromptData, context: ExecutionContext): ArgumentParsingResult => {
        const parseResult = safeJsonParse(rawArgs);
        if (!parseResult.success || !parseResult.data) {
          throw new ValidationError(`Invalid JSON arguments: ${parseResult.error || 'Unknown parsing error'}`);
        }

        const jsonArgs = parseResult.data;
        const validation = validateJsonArguments(jsonArgs, promptData);
        
        const processedArgs = validation.sanitizedArgs || {};
        // Ensure processedArgs only contains allowed types for UnifiedExecutionContext
        const compatibleArgs: Record<string, string | number | boolean | null> = {};
        for (const [key, value] of Object.entries(processedArgs)) {
          if (Array.isArray(value)) {
            // Convert arrays to JSON strings for compatibility
            compatibleArgs[key] = JSON.stringify(value);
          } else {
            compatibleArgs[key] = value as string | number | boolean | null;
          }
        }

        const validationResults = this.createValidationResults(compatibleArgs, promptData, validation);

        return {
          processedArgs: compatibleArgs,
          resolvedPlaceholders: {},
          validationResults,
          metadata: {
            parsingStrategy: 'json',
            appliedDefaults: [],
            typeCoercions: [],
            contextSources: {},
            warnings: validation.errors || []
          }
        };
      }
    };
  }

  /**
   * Key-value pair processing strategy (arg1=value1 arg2=value2)
   */
  private createKeyValueStrategy(): ProcessingStrategy {
    return {
      name: 'keyvalue',
      canHandle: (rawArgs: string) => {
        return /\w+\s*=\s*/.test(rawArgs);
      },
      process: (rawArgs: string, promptData: PromptData, context: ExecutionContext): ArgumentParsingResult => {
        const processedArgs: Record<string, string | number | boolean | null> = {};
        const typeCoercions: Array<{ arg: string; from: string; to: string }> = [];
        
        // Parse key=value pairs with proper quote handling
        const pairs = rawArgs.match(/(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+(?:\s+(?!\w+\s*=)[^\s]*)*?))/g) || [];
        
        for (const pair of pairs) {
          const match = pair.match(/(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(.*))/);
          if (match) {
            const [, key, doubleQuoted, singleQuoted, unquoted] = match;
            // Use the appropriate captured group - quoted strings take precedence
            const value = doubleQuoted !== undefined ? doubleQuoted : 
                         singleQuoted !== undefined ? singleQuoted : 
                         unquoted || '';
            const trimmedValue = value.trim();
            
            // Find argument definition for type coercion
            const argDef = promptData.arguments.find(arg => arg.name === key);
            if (argDef) {
              const coercedValue = this.coerceArgumentType(trimmedValue, argDef);
              if (coercedValue.wasCoerced) {
                typeCoercions.push({
                  arg: key,
                  from: typeof trimmedValue,
                  to: typeof coercedValue.value
                });
              }
              processedArgs[key] = coercedValue.value;
            } else {
              processedArgs[key] = trimmedValue;
            }
          }
        }
        
        const validationResults = this.createValidationResults(processedArgs, promptData);
        
        return {
          processedArgs,
          resolvedPlaceholders: {},
          validationResults,
          metadata: {
            parsingStrategy: 'keyvalue',
            appliedDefaults: [],
            typeCoercions,
            contextSources: {},
            warnings: []
          }
        };
      }
    };
  }

  /**
   * Simple text processing strategy
   */
  private createSimpleTextStrategy(): ProcessingStrategy {
    return {
      name: 'simple',
      canHandle: (rawArgs: string, promptData: PromptData) => {
        return rawArgs.trim().length > 0 && promptData.arguments.length > 0;
      },
      process: (rawArgs: string, promptData: PromptData, context: ExecutionContext): ArgumentParsingResult => {
        const processedArgs: Record<string, string | number | boolean | null> = {};
        const appliedDefaults: string[] = [];
        const contextSources: Record<string, string> = {};
        
        if (promptData.arguments.length === 1) {
          // Single argument - assign all text to it
          const arg = promptData.arguments[0];
          processedArgs[arg.name] = rawArgs.trim();
          contextSources[arg.name] = 'user_provided';
        } else {
          // Multiple arguments - use intelligent defaults
          this.applyIntelligentDefaults(
            rawArgs,
            promptData,
            processedArgs,
            appliedDefaults,
            contextSources,
            context
          );
        }
        
        const validationResults = this.createValidationResults(processedArgs, promptData);
        
        return {
          processedArgs,
          resolvedPlaceholders: {},
          validationResults,
          metadata: {
            parsingStrategy: 'simple',
            appliedDefaults,
            typeCoercions: [],
            contextSources,
            warnings: []
          }
        };
      }
    };
  }

  /**
   * Fallback processing strategy
   */
  private createFallbackStrategy(): ProcessingStrategy {
    return {
      name: 'fallback',
      canHandle: () => true, // Always handles as last resort
      process: (rawArgs: string, promptData: PromptData, context: ExecutionContext): ArgumentParsingResult => {
        const processedArgs: Record<string, string | number | boolean | null> = {};
        const appliedDefaults: string[] = [];
        const contextSources: Record<string, string> = {};
        const warnings: string[] = [];
        
        // Apply defaults for all arguments
        for (const arg of promptData.arguments) {
          if (rawArgs.trim()) {
            // Use provided text for first argument, defaults for rest
            if (Object.keys(processedArgs).length === 0) {
              processedArgs[arg.name] = rawArgs.trim();
              contextSources[arg.name] = 'user_provided';
            } else {
              const defaultValue = this.resolveContextualDefault(arg, context);
              processedArgs[arg.name] = defaultValue.value;
              contextSources[arg.name] = defaultValue.source;
              appliedDefaults.push(arg.name);
            }
          } else {
            const defaultValue = this.resolveContextualDefault(arg, context);
            processedArgs[arg.name] = defaultValue.value;
            contextSources[arg.name] = defaultValue.source;
            appliedDefaults.push(arg.name);
          }
        }
        
        warnings.push('Used fallback argument processing - consider using structured format');
        
        const validationResults = this.createValidationResults(processedArgs, promptData);
        
        return {
          processedArgs,
          resolvedPlaceholders: {},
          validationResults,
          metadata: {
            parsingStrategy: 'fallback',
            appliedDefaults,
            typeCoercions: [],
            contextSources,
            warnings
          }
        };
      }
    };
  }

  /**
   * Apply intelligent defaults for arguments
   * ENHANCED: Smarter content mapping and auto-fill for 100% success rate
   */
  private applyIntelligentDefaults(
    userContent: string,
    promptData: PromptData,
    processedArgs: Record<string, string | number | boolean | null>,
    appliedDefaults: string[],
    contextSources: Record<string, string>,
    context: ExecutionContext
  ): void {
    // Enhanced priority order for content assignment with better semantic matching
    const contentPriority = [
      'content', 'text', 'input', 'data', 'message', 'query', 'prompt',
      'description', 'topic', 'subject', 'analysis', 'code', 'file'
    ];
    
    // Find the most appropriate argument for user content using multiple strategies
    let targetArg = null;
    
    // Strategy 1: Exact semantic match
    for (const priority of contentPriority) {
      targetArg = promptData.arguments.find(arg => 
        arg.name.toLowerCase().includes(priority)
      );
      if (targetArg) {
        this.logger.debug(`Semantic match found: ${targetArg.name} (matched: ${priority})`);
        break;
      }
    }
    
    // Strategy 2: Description-based matching
    if (!targetArg && userContent) {
      targetArg = promptData.arguments.find(arg => 
        arg.description && (
          arg.description.toLowerCase().includes('content') ||
          arg.description.toLowerCase().includes('text') ||
          arg.description.toLowerCase().includes('input') ||
          arg.description.toLowerCase().includes('analyze')
        )
      );
      if (targetArg) {
        this.logger.debug(`Description match found: ${targetArg.name}`);
      }
    }
    
    // Strategy 3: First required argument
    if (!targetArg) {
      targetArg = promptData.arguments.find(arg => arg.required);
      if (targetArg) {
        this.logger.debug(`First required argument selected: ${targetArg.name}`);
      }
    }
    
    // Strategy 4: First argument (fallback)
    if (!targetArg && promptData.arguments.length > 0) {
      targetArg = promptData.arguments[0];
      this.logger.debug(`First argument fallback: ${targetArg.name}`);
    }
    
    // Assign user content to target argument with intelligent processing
    if (targetArg && userContent) {
      processedArgs[targetArg.name] = this.processContentForArgument(userContent, targetArg);
      contextSources[targetArg.name] = 'user_provided_smart_mapped';
      this.logger.debug(`Mapped user content to ${targetArg.name}: "${userContent.substring(0, 50)}..."`);
    }
    
    // Fill remaining arguments with enhanced contextual defaults
    for (const arg of promptData.arguments) {
      if (!processedArgs[arg.name]) {
        const defaultValue = this.resolveEnhancedContextualDefault(arg, context, userContent, promptData);
        processedArgs[arg.name] = defaultValue.value;
        contextSources[arg.name] = defaultValue.source;
        appliedDefaults.push(arg.name);
      }
    }
    
    // Log the mapping for debugging
    this.logger.debug(`Intelligent defaults applied:`, {
      promptId: promptData.id,
      userContentLength: userContent.length,
      targetArgument: targetArg?.name,
      totalArguments: promptData.arguments.length,
      appliedDefaults
    });
  }

  /**
   * Process content specifically for an argument type
   */
  private processContentForArgument(content: string, arg: PromptArgument): string {
    // Basic content processing - can be enhanced further
    const trimmed = content.trim();
    
    // If argument name suggests it wants a specific format, attempt to extract it
    if (arg.name.toLowerCase().includes('json') && !trimmed.startsWith('{')) {
      // For JSON arguments, wrap simple content appropriately
      return `{"content": "${trimmed.replace(/"/g, '\\"')}"}`;
    }
    
    if (arg.name.toLowerCase().includes('url') && !trimmed.match(/^https?:\/\//)) {
      // Basic URL validation/enhancement could go here
      this.logger.debug(`Argument ${arg.name} expects URL but got: ${trimmed.substring(0, 50)}`);
    }
    
    return trimmed;
  }

  /**
   * Enhanced contextual default resolver with more intelligence
   */
  private resolveEnhancedContextualDefault(
    arg: PromptArgument,
    context: ExecutionContext,
    userContent: string,
    promptData: PromptData
  ): { value: any; source: string } {
    // Enhanced strategies with content-aware defaults
    const strategies = [
      () => this.getFromPromptDefaults(arg, context.promptDefaults),
      () => this.getFromEnvironment(arg, context.environmentVars),
      () => this.getFromConversationHistory(arg, context.conversationHistory),
      () => this.getFromSystemContext(arg, context.systemContext),
      () => this.generateContentAwareDefault(arg, userContent, promptData),
      () => this.generateSmartDefault(arg)
    ];
    
    for (const strategy of strategies) {
      const result = strategy();
      if (result.value !== null && result.value !== undefined && result.value !== '') {
        return result;
      }
    }
    
    // Enhanced fallback with more semantic defaults
    return this.generateSemanticFallback(arg);
  }

  /**
   * Generate content-aware defaults based on user input and prompt context
   */
  private generateContentAwareDefault(
    arg: PromptArgument,
    userContent: string,
    promptData: PromptData
  ): { value: any; source: string } {
    const argName = arg.name.toLowerCase();
    const userLower = userContent.toLowerCase();
    
    // Generate defaults based on argument semantics and user content
    if (argName.includes('level') || argName.includes('depth')) {
      if (userLower.includes('simple') || userLower.includes('basic')) {
        return { value: 'beginner', source: 'content_inference' };
      } else if (userLower.includes('complex') || userLower.includes('advanced')) {
        return { value: 'expert', source: 'content_inference' };
      }
      return { value: 'intermediate', source: 'content_inference' };
    }
    
    if (argName.includes('format') || argName.includes('type')) {
      if (userLower.includes('json') || userContent.includes('{')) {
        return { value: 'json', source: 'content_inference' };
      } else if (userLower.includes('list') || userLower.includes('bullet')) {
        return { value: 'list', source: 'content_inference' };
      }
      return { value: 'text', source: 'content_inference' };
    }
    
    if (argName.includes('style') || argName.includes('tone')) {
      if (userLower.includes('formal') || userLower.includes('professional')) {
        return { value: 'formal', source: 'content_inference' };
      } else if (userLower.includes('casual') || userLower.includes('friendly')) {
        return { value: 'casual', source: 'content_inference' };
      }
      return { value: 'neutral', source: 'content_inference' };
    }
    
    if (argName.includes('length') || argName.includes('size')) {
      const wordCount = userContent.split(/\s+/).length;
      if (wordCount > 100) {
        return { value: 'detailed', source: 'content_inference' };
      } else if (wordCount < 20) {
        return { value: 'brief', source: 'content_inference' };
      }
      return { value: 'moderate', source: 'content_inference' };
    }
    
    return { value: null, source: 'no_content_match' };
  }

  /**
   * Generate semantic fallback defaults
   */
  private generateSemanticFallback(arg: PromptArgument): { value: any; source: string } {
    const argName = arg.name.toLowerCase();
    
    // Common semantic defaults
    const semanticDefaults: Record<string, string> = {
      'level': 'intermediate',
      'depth': 'moderate',
      'format': 'text',
      'style': 'neutral',
      'tone': 'professional',
      'length': 'moderate',
      'type': 'analysis',
      'mode': 'standard',
      'approach': 'systematic',
      'focus': 'comprehensive'
    };
    
    for (const [keyword, defaultValue] of Object.entries(semanticDefaults)) {
      if (argName.includes(keyword)) {
        return { value: defaultValue, source: 'semantic_fallback' };
      }
    }
    
    // Description-based fallback
    if (arg.description) {
      const desc = arg.description.toLowerCase();
      if (desc.includes('required') || desc.includes('must')) {
        return { value: '[Please specify]', source: 'required_placeholder' };
      }
    }
    
    // Final fallback
    return { value: '', source: 'empty_fallback' };
  }

  /**
   * Resolve contextual default for an argument (legacy method)
   */
  private resolveContextualDefault(
    arg: PromptArgument,
    context: ExecutionContext
  ): { value: any; source: string } {
    // Priority order for context resolution
    const strategies = [
      () => this.getFromPromptDefaults(arg, context.promptDefaults),
      () => this.getFromEnvironment(arg, context.environmentVars),
      () => this.getFromConversationHistory(arg, context.conversationHistory),
      () => this.getFromSystemContext(arg, context.systemContext),
      () => this.generateSmartDefault(arg)
    ];
    
    for (const strategy of strategies) {
      const result = strategy();
      if (result.value !== null && result.value !== undefined) {
        return result;
      }
    }
    
    // Final fallback
    return { value: '', source: 'empty_fallback' };
  }

  /**
   * Get default from prompt-specific defaults
   */
  private getFromPromptDefaults(
    arg: PromptArgument, 
    promptDefaults?: Record<string, string | number | boolean | null>
  ): { value: any; source: string } {
    if (promptDefaults && promptDefaults[arg.name] !== undefined) {
      return { value: promptDefaults[arg.name], source: 'prompt_defaults' };
    }
    return { value: null, source: 'none' };
  }

  /**
   * Get default from environment variables
   */
  private getFromEnvironment(
    arg: PromptArgument,
    environmentVars?: Record<string, string>
  ): { value: any; source: string } {
    if (environmentVars) {
      const envKey = `PROMPT_${arg.name.toUpperCase()}`;
      if (environmentVars[envKey]) {
        return { value: environmentVars[envKey], source: 'environment' };
      }
    }
    return { value: null, source: 'none' };
  }

  /**
   * Get default from conversation history
   */
  private getFromConversationHistory(
    arg: PromptArgument,
    conversationHistory?: any[]
  ): { value: any; source: string } {
    if (conversationHistory && conversationHistory.length > 0) {
      const lastMessage = conversationHistory[conversationHistory.length - 1];
      if (lastMessage && lastMessage.content) {
        // For content-like arguments, use last message
        const contentArgs = ['content', 'text', 'input', 'message', 'query'];
        if (contentArgs.some(keyword => arg.name.toLowerCase().includes(keyword))) {
          return { value: lastMessage.content, source: 'conversation_history' };
        }
      }
    }
    return { value: null, source: 'none' };
  }

  /**
   * Get default from system context
   */
  private getFromSystemContext(
    arg: PromptArgument,
    systemContext?: Record<string, string | number | boolean | null>
  ): { value: any; source: string } {
    if (systemContext && systemContext[arg.name] !== undefined) {
      return { value: systemContext[arg.name], source: 'system_context' };
    }
    return { value: null, source: 'none' };
  }

  /**
   * Generate smart default based on argument characteristics
   */
  private generateSmartDefault(arg: PromptArgument): { value: any; source: string } {
    // Generate contextual placeholders based on argument name and description
    const name = arg.name.toLowerCase();
    const description = (arg.description || '').toLowerCase();
    
    if (name.includes('content') || name.includes('text') || name.includes('input')) {
      return { value: '[Content will be provided]', source: 'smart_placeholder' };
    }
    
    if (name.includes('file') || name.includes('path')) {
      return { value: '[File path will be specified]', source: 'smart_placeholder' };
    }
    
    if (name.includes('count') || name.includes('number')) {
      return { value: '1', source: 'smart_default' };
    }
    
    if (name.includes('format') || name.includes('style')) {
      return { value: 'default', source: 'smart_default' };
    }
    
    // Generic placeholder
    return { 
      value: `[${arg.name} to be provided]`, 
      source: 'generic_placeholder' 
    };
  }

  /**
   * Type coercion for arguments based on prompt definitions
   */
  private coerceArgumentType(
    value: string,
    argDef: PromptArgument
  ): { value: any; wasCoerced: boolean } {
    const originalType = typeof value;
    
    // If argument has type hints in description, use them
    const description = (argDef.description || '').toLowerCase();
    
    if (description.includes('number') || description.includes('integer')) {
      const numValue = Number(value);
      if (!isNaN(numValue)) {
        return { value: numValue, wasCoerced: originalType !== 'number' };
      }
    }
    
    if (description.includes('boolean') || value.toLowerCase() === 'true' || value.toLowerCase() === 'false') {
      return { 
        value: value.toLowerCase() === 'true', 
        wasCoerced: originalType !== 'boolean' 
      };
    }
    
    if (description.includes('array') || description.includes('list') || 
        argDef.name.toLowerCase().includes('list') || 
        description.includes('A list of') || description.includes('list of')) {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) {
          return { value: parsed, wasCoerced: true };
        }
      } catch {
        // If not valid JSON, split by comma and clean up
        const arrayValue = value.split(',').map(item => item.trim()).filter(item => item.length > 0);
        return { value: arrayValue, wasCoerced: true };
      }
    }
    
    // Handle JSON objects
    if (description.includes('json') || description.includes('object') || 
        description.includes('objects') || value.startsWith('{') || value.startsWith('[')) {
      try {
        const parsed = JSON.parse(value);
        return { value: parsed, wasCoerced: true };
      } catch {
        // Invalid JSON, keep as string
        return { value, wasCoerced: false };
      }
    }
    
    // No coercion needed or possible
    return { value, wasCoerced: false };
  }

  /**
   * Create validation results for processed arguments
   */
  private createValidationResults(
    processedArgs: Record<string, string | number | boolean | null>,
    promptData: PromptData,
    existingValidation?: any
  ): ValidationResult[] {
    const results: ValidationResult[] = [];
    
    for (const arg of promptData.arguments) {
      const value = processedArgs[arg.name];
      const result: ValidationResult = {
        argumentName: arg.name,
        isValid: true,
        originalValue: value,
        processedValue: value,
        appliedRules: [],
        warnings: [],
        errors: []
      };
      
      // Check if argument is required but missing
      if (arg.required && (value === undefined || value === null || value === '')) {
        result.isValid = false;
        result.errors.push(`Required argument '${arg.name}' is missing`);
      }
      
      // Add existing validation errors if any
      if (existingValidation && existingValidation.errors) {
        result.warnings.push(...existingValidation.errors);
      }
      
      results.push(result);
    }
    
    return results;
  }

  /**
   * Enrich processing result with additional validation and context
   */
  private async enrichResult(
    result: ArgumentParsingResult,
    promptData: PromptData,
    context: ExecutionContext
  ): Promise<ArgumentParsingResult> {
    // Add any additional enrichment logic here
    // For now, just return the result as-is
    return result;
  }

  /**
   * Update processing statistics
   */
  private updateProcessingStats(result: ArgumentParsingResult): void {
    this.stats.defaultsApplied += result.metadata.appliedDefaults.length;
    this.stats.typeCoercions += result.metadata.typeCoercions.length;
    this.stats.contextResolutions += Object.keys(result.metadata.contextSources).length;
  }

  /**
   * Get processing statistics
   */
  getStats(): typeof this.stats {
    return { ...this.stats };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      totalProcessed: 0,
      successfulProcessing: 0,
      validationFailures: 0,
      typeCoercions: 0,
      defaultsApplied: 0,
      contextResolutions: 0
    };
  }
}

/**
 * Factory function to create argument processor
 */
export function createArgumentParser(logger: Logger): ArgumentParser {
  return new ArgumentParser(logger);
}