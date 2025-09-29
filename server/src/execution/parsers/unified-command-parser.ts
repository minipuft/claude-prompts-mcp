/**
 * Unified Command Parser
 * 
 * Robust multi-strategy command parsing system that replaces fragile regex-based parsing
 * with intelligent format detection, fallback strategies, and comprehensive validation.
 * 
 * Features:
 * - Multi-format detection (simple >>prompt, JSON objects, structured commands)
 * - Fallback parsing strategies with confidence scoring
 * - Comprehensive error messages with suggestions
 * - Command validation and sanitization
 */

import { Logger } from "../../logging/index.js";
import { PromptData } from "../../types/index.js";
import { ValidationError, PromptError, safeJsonParse } from "../../utils/index.js";

/**
 * Command parsing result with metadata
 */
export interface CommandParseResult {
  promptId: string;
  rawArgs: string;
  format: 'simple' | 'json' | 'structured' | 'legacy';
  confidence: number;
  metadata: {
    originalCommand: string;
    parseStrategy: string;
    detectedFormat: string;
    warnings: string[];
  };
}

/**
 * Parsing strategy interface
 */
interface ParsingStrategy {
  name: string;
  canHandle: (command: string) => boolean;
  parse: (command: string) => CommandParseResult | null;
  confidence: number;
}

/**
 * Unified Command Parser Class
 */
export class UnifiedCommandParser {
  private logger: Logger;
  private strategies: ParsingStrategy[];
  
  // Parsing statistics for monitoring
  private stats = {
    totalParses: 0,
    successfulParses: 0,
    failedParses: 0,
    strategyUsage: new Map<string, number>(),
    averageConfidence: 0
  };

  constructor(logger: Logger) {
    this.logger = logger;
    this.strategies = this.initializeStrategies();
    this.logger.debug(`UnifiedCommandParser initialized with ${this.strategies.length} parsing strategies`);
  }

  /**
   * Parse command string using multi-strategy approach
   */
  async parseCommand(command: string, availablePrompts: PromptData[]): Promise<CommandParseResult> {
    this.stats.totalParses++;
    
    if (!command || command.trim().length === 0) {
      this.stats.failedParses++;
      throw new ValidationError("Command cannot be empty");
    }

    const normalizedCommand = command.trim();
    this.logger.debug(`Parsing command: "${normalizedCommand.substring(0, 100)}..."`);

    // Try each strategy in order of confidence
    const sortedStrategies = [...this.strategies].sort((a, b) => b.confidence - a.confidence);
    
    for (const strategy of sortedStrategies) {
      if (strategy.canHandle(normalizedCommand)) {
        try {
          const result = strategy.parse(normalizedCommand);
          if (result) {
            // Validate that the prompt ID exists
            await this.validatePromptExists(result.promptId, availablePrompts);
            
            // Update statistics
            this.stats.successfulParses++;
            this.updateStrategyStats(strategy.name);
            this.updateConfidenceStats(result.confidence);
            
            this.logger.debug(`Command parsed successfully using strategy: ${strategy.name} (confidence: ${result.confidence})`);
            return result;
          }
        } catch (error) {
          this.logger.debug(`Strategy ${strategy.name} failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
          continue;
        }
      }
    }

    // If no strategy succeeded, provide helpful error message
    this.stats.failedParses++;
    const errorMessage = this.generateHelpfulError(normalizedCommand, availablePrompts);
    throw new ValidationError(errorMessage);
  }

  /**
   * Initialize parsing strategies (STREAMLINED: Reduced from 4 to 2 strategies)
   */
  private initializeStrategies(): ParsingStrategy[] {
    return [
      this.createSimpleCommandStrategy(),
      this.createJsonCommandStrategy()
      // Removed: createStructuredCommandStrategy() - too complex
      // Removed: createLegacyCommandStrategy() - unreliable
    ];
  }

  /**
   * Simple command strategy: >>prompt_name arguments (ENHANCED: More AI-friendly)
   */
  private createSimpleCommandStrategy(): ParsingStrategy {
    return {
      name: 'simple',
      confidence: 0.95, // Increased confidence for primary strategy
      canHandle: (command: string) => {
        // More flexible pattern - handles spaces in prompt names via underscore conversion
        return /^(>>|\/)[a-zA-Z0-9_\-\s]+(\s|$)/.test(command.trim());
      },
      parse: (command: string): CommandParseResult | null => {
        // Enhanced regex to handle more natural command formats
        const match = command.trim().match(/^(>>|\/)([a-zA-Z0-9_\-\s]+?)(?:\s+(.*?))?$/);
        if (!match) return null;

        const [, prefix, rawPromptId, rawArgs] = match;
        
        // Clean up prompt ID: convert spaces to underscores, normalize
        const promptId = rawPromptId.trim()
          .toLowerCase()
          .replace(/\s+/g, '_')           // Spaces to underscores
          .replace(/[^a-z0-9_-]/g, '')    // Remove invalid characters
          .replace(/_+/g, '_')            // Collapse multiple underscores
          .replace(/^_|_$/g, '');         // Trim leading/trailing underscores

        const warnings: string[] = [];
        if (rawPromptId !== promptId) {
          warnings.push(`Normalized prompt name: "${rawPromptId}" → "${promptId}"`);
        }
        
        return {
          promptId: promptId,
          rawArgs: (rawArgs || '').trim(),
          format: 'simple',
          confidence: 0.98, // High confidence for enhanced parsing
          metadata: {
            originalCommand: command,
            parseStrategy: 'simple_enhanced',
            detectedFormat: `${prefix}prompt format (normalized)`,
            warnings
          }
        };
      }
    };
  }

  /**
   * JSON command strategy: {"command": ">>prompt", "args": {...}}
   */
  private createJsonCommandStrategy(): ParsingStrategy {
    return {
      name: 'json',
      confidence: 0.85,
      canHandle: (command: string) => {
        const trimmed = command.trim();
        return trimmed.startsWith('{') && trimmed.endsWith('}');
      },
      parse: (command: string): CommandParseResult | null => {
        const parseResult = safeJsonParse(command);
        if (!parseResult.success || !parseResult.data) {
          return null;
        }

        const data = parseResult.data;
        
        // Handle different JSON formats
        let actualCommand = '';
        let confidence = 0.8;
        
        if (data.command) {
          actualCommand = data.command;
          confidence = 0.9;
        } else if (data.prompt) {
          actualCommand = data.prompt;
          confidence = 0.85;
        } else {
          return null;
        }

        // Recursively parse the inner command
        const simpleStrategy = this.createSimpleCommandStrategy();
        if (!simpleStrategy.canHandle(actualCommand)) {
          return null;
        }

        const innerResult = simpleStrategy.parse(actualCommand);
        if (!innerResult) return null;

        return {
          promptId: innerResult.promptId,
          rawArgs: data.args ? JSON.stringify(data.args) : innerResult.rawArgs,
          format: 'json',
          confidence,
          metadata: {
            originalCommand: command,
            parseStrategy: 'json',
            detectedFormat: 'JSON wrapper with inner command',
            warnings: []
          }
        };
      }
    };
  }

  /**
   * Structured command strategy: prompt_name {args...}
   */
  private createStructuredCommandStrategy(): ParsingStrategy {
    return {
      name: 'structured',
      confidence: 0.7,
      canHandle: (command: string) => {
        return /^[a-zA-Z0-9_-]+\s*\{.*\}$/.test(command.trim());
      },
      parse: (command: string): CommandParseResult | null => {
        const match = command.match(/^([a-zA-Z0-9_-]+)\s*(\{.*\})$/);
        if (!match) return null;

        const [, promptId, jsonArgs] = match;
        
        return {
          promptId: promptId.trim(),
          rawArgs: jsonArgs.trim(),
          format: 'structured',
          confidence: 0.75,
          metadata: {
            originalCommand: command,
            parseStrategy: 'structured',
            detectedFormat: 'prompt_name {json_args}',
            warnings: []
          }
        };
      }
    };
  }

  /**
   * Legacy command strategy: fallback for unusual formats
   */
  private createLegacyCommandStrategy(): ParsingStrategy {
    return {
      name: 'legacy',
      confidence: 0.3,
      canHandle: (command: string) => {
        // Always can handle as last resort
        return true;
      },
      parse: (command: string): CommandParseResult | null => {
        // Try to extract anything that looks like a prompt ID
        const words = command.trim().split(/\s+/);
        if (words.length === 0) return null;

        // Look for the first word that could be a prompt ID
        let promptId = '';
        let rawArgs = '';

        for (let i = 0; i < words.length; i++) {
          const word = words[i].replace(/^(>>|\/)+/, ''); // Remove prefixes
          if (/^[a-zA-Z0-9_-]+$/.test(word)) {
            promptId = word;
            rawArgs = words.slice(i + 1).join(' ');
            break;
          }
        }

        if (!promptId) {
          // Last resort: use first word
          promptId = words[0].replace(/^(>>|\/)+/, '');
          rawArgs = words.slice(1).join(' ');
        }

        const warnings = ['Command format not recognized, using legacy parsing'];
        
        return {
          promptId,
          rawArgs,
          format: 'legacy',
          confidence: 0.4,
          metadata: {
            originalCommand: command,
            parseStrategy: 'legacy',
            detectedFormat: 'legacy fallback parsing',
            warnings
          }
        };
      }
    };
  }

  /**
   * Validate that the prompt ID exists in available prompts
   */
  private async validatePromptExists(promptId: string, availablePrompts: PromptData[]): Promise<void> {
    // Check if this is a built-in command that should be routed (handled by prompt engine)
    if (this.isBuiltinCommand(promptId)) {
      return; // Built-in commands are valid and will be routed by the prompt engine
    }

    const found = availablePrompts.find(p => p.id === promptId || p.name === promptId);
    if (!found) {
      const suggestions = this.generatePromptSuggestions(promptId, availablePrompts);
      const builtinHint = this.getBuiltinCommandHint(promptId);
      throw new PromptError(
        `Unknown prompt: "${promptId}". ${suggestions}${builtinHint}\n\nTry: >>listprompts, >>help, >>status`
      );
    }
  }

  /**
   * Check if command is a built-in system command
   */
  private isBuiltinCommand(promptId: string): boolean {
    const builtinCommands = [
      'listprompts', 'listprompt', 'list_prompts',
      'help', 'commands',
      'status', 'health',
      'analytics', 'metrics'
    ];
    return builtinCommands.includes(promptId.toLowerCase());
  }

  /**
   * Generate hint for built-in commands that might have been mistyped
   */
  private getBuiltinCommandHint(promptId: string): string {
    const lower = promptId.toLowerCase();

    // Check for common variations/typos of built-in commands
    if (lower.includes('list') && lower.includes('prompt')) {
      return '\n\nDid you mean >>listprompts?';
    }
    if (lower === 'commands' || lower === 'help') {
      return '\n\nTry >>help for available commands.';
    }
    if (lower === 'stat' || lower === 'status') {
      return '\n\nTry >>status for system status.';
    }

    return '';
  }

  /**
   * Generate helpful prompt suggestions for typos
   */
  private generatePromptSuggestions(promptId: string, availablePrompts: PromptData[]): string {
    // Simple Levenshtein distance for suggestions
    const suggestions = availablePrompts
      .map(prompt => ({
        prompt,
        distance: this.levenshteinDistance(promptId.toLowerCase(), prompt.id.toLowerCase())
      }))
      .filter(item => item.distance <= 3)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 3)
      .map(item => item.prompt.id);

    if (suggestions.length > 0) {
      return `Did you mean: ${suggestions.join(', ')}?`;
    }

    return '';
  }

  /**
   * Simple Levenshtein distance calculation
   */
  private levenshteinDistance(a: string, b: string): number {
    const matrix = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(null));

    for (let i = 0; i <= a.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= b.length; j++) matrix[j][0] = j;

    for (let j = 1; j <= b.length; j++) {
      for (let i = 1; i <= a.length; i++) {
        const indicator = a[i - 1] === b[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1,
          matrix[j - 1][i] + 1,
          matrix[j - 1][i - 1] + indicator
        );
      }
    }

    return matrix[b.length][a.length];
  }

  /**
   * Generate helpful error message for parsing failures
   */
  private generateHelpfulError(command: string, availablePrompts: PromptData[]): string {
    let message = `Could not parse command: "${command}"\n\n`;
    
    message += 'Supported command formats (STREAMLINED):\n';
    message += '• Simple: >>prompt_name arguments\n';
    message += '• Simple: /prompt_name arguments\n';
    message += '• JSON: {"command": ">>prompt_name", "args": "arguments"}\n\n';
    
    // Try to give specific suggestions
    if (command.includes('>>') || command.includes('/')) {
      message += 'Make sure the prompt name contains only letters, numbers, underscores, and hyphens.\n';
    } else if (command.startsWith('{')) {
      message += 'JSON format detected but could not parse. Check JSON syntax.\n';
    }
    
    message += '\nUse >>listprompts to see all available prompts.';
    
    return message;
  }

  /**
   * Update strategy usage statistics
   */
  private updateStrategyStats(strategyName: string): void {
    const current = this.stats.strategyUsage.get(strategyName) || 0;
    this.stats.strategyUsage.set(strategyName, current + 1);
  }

  /**
   * Update confidence statistics
   */
  private updateConfidenceStats(confidence: number): void {
    const totalSuccessful = this.stats.successfulParses;
    this.stats.averageConfidence = 
      (this.stats.averageConfidence * (totalSuccessful - 1) + confidence) / totalSuccessful;
  }

  /**
   * Get parsing statistics for monitoring
   */
  getStats(): typeof this.stats {
    return {
      ...this.stats,
      strategyUsage: new Map(this.stats.strategyUsage)
    };
  }

  /**
   * Reset statistics (useful for testing or fresh starts)
   */
  resetStats(): void {
    this.stats = {
      totalParses: 0,
      successfulParses: 0,
      failedParses: 0,
      strategyUsage: new Map(),
      averageConfidence: 0
    };
  }
}

/**
 * Factory function to create unified command parser
 */
export function createUnifiedCommandParser(logger: Logger): UnifiedCommandParser {
  return new UnifiedCommandParser(logger);
}