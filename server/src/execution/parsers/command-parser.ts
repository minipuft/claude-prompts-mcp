// @lifecycle canonical - Parses the unified operator command format.
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

import { normalizeSymbolicPrefixes, stripStyleOperators } from './parser-utils.js';
import { SymbolicCommandParser, createSymbolicCommandParser } from './symbolic-operator-parser.js';
import { Logger } from '../../logging/index.js';
import { PromptError, ValidationError, safeJsonParse } from '../../utils/index.js';

import type { ConvertedPrompt } from '../../types/index.js';
import type { ExecutionModifier, ExecutionModifiers } from '../types.js';
import type { CommandParseResultBase } from './types/command-parse-types.js';
import type {
  OperatorDetectionResult,
  SymbolicCommandParseResult,
  SymbolicExecutionPlan,
} from './types/operator-types.js';

export type CommandParseResult = CommandParseResultBase<
  OperatorDetectionResult,
  SymbolicExecutionPlan
>;

/**
 * Maps user-facing modifier names to canonical ExecutionModifier values.
 */
const VALID_MODIFIERS: Record<string, ExecutionModifier> = {
  clean: 'clean',
  judge: 'judge',
  lean: 'lean',
  framework: 'framework',
};

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
  private symbolicParser: SymbolicCommandParser;

  // Parsing statistics for monitoring
  private stats = {
    totalParses: 0,
    successfulParses: 0,
    failedParses: 0,
    strategyUsage: new Map<string, number>(),
    averageConfidence: 0,
  };

  constructor(logger: Logger) {
    this.logger = logger;
    this.symbolicParser = createSymbolicCommandParser(logger);
    this.strategies = this.initializeStrategies();
    this.logger.debug(
      `UnifiedCommandParser initialized with ${this.strategies.length} parsing strategies`
    );
  }

  /**
   * Extracts a single execution modifier prefix (e.g., %clean) from the command.
   * Returns the command with the modifier stripped and the normalized modifier value.
   */
  private extractModifier(command: string): { command: string; modifier?: ExecutionModifier } {
    const trimmed = command.trimStart();
    const match = trimmed.match(/^%\s*([a-zA-Z_-]+)/);
    if (!match) {
      return { command };
    }

    const modifierKey = match[1]?.toLowerCase();
    if (!modifierKey) {
      return { command };
    }
    const modifier = VALID_MODIFIERS[modifierKey];

    if (!modifier) {
      throw new ValidationError(
        `Unknown execution modifier "%${modifierKey}". Supported modifiers: %clean, %judge, %lean, %framework.`
      );
    }

    const remainder = trimmed.slice(match[0].length).trimStart();
    if (/^%\s*[a-zA-Z_-]+/.test(remainder)) {
      throw new ValidationError(
        'Only one %modifier is allowed per command. Remove additional modifiers.'
      );
    }

    return { command: remainder, modifier };
  }

  private buildModifiers(modifier?: ExecutionModifier): ExecutionModifiers | undefined {
    if (!modifier) {
      return undefined;
    }
    return {
      clean: modifier === 'clean',
      judge: modifier === 'judge',
      lean: modifier === 'lean',
      framework: modifier === 'framework',
    };
  }

  /**
   * Parse command string using multi-strategy approach
   */
  async parseCommand(
    command: string,
    availablePrompts: ConvertedPrompt[]
  ): Promise<CommandParseResult> {
    this.stats.totalParses++;

    if (!command || command.trim().length === 0) {
      this.stats.failedParses++;
      throw new ValidationError('Command cannot be empty');
    }

    const trimmed = command.trim();
    const { command: commandWithoutModifier, modifier: modifierToken } =
      this.extractModifier(trimmed);
    if (!commandWithoutModifier || commandWithoutModifier.trim().length === 0) {
      throw new ValidationError('Command cannot be empty after applying modifier');
    }

    // Normalize symbolic prefixes centrally (ONE primary implementation)
    const { normalized, hadPrefixes } = normalizeSymbolicPrefixes(commandWithoutModifier);

    this.logger.debug(
      `Parsing command: "${normalized.substring(0, 100)}..."${hadPrefixes ? ' (prefixes normalized)' : ''}`
    );

    // Try each strategy in order of confidence (now operating on normalized command)
    const sortedStrategies = [...this.strategies].sort((a, b) => b.confidence - a.confidence);

    for (const strategy of sortedStrategies) {
      if (strategy.canHandle(normalized)) {
        try {
          const result = strategy.parse(normalized);
          if (result) {
            // Preserve original command in metadata for debugging/error messages
            if (!result.metadata) {
              result.metadata = {
                originalCommand: '',
                parseStrategy: '',
                detectedFormat: '',
                warnings: [],
              };
            }
            result.metadata.originalCommand = trimmed;
            if (hadPrefixes) {
              result.metadata.prefixesNormalized = true;
            }
            if (modifierToken) {
              const hasExistingModifier =
                result.modifiers?.clean === true ||
                result.modifiers?.judge === true ||
                result.modifiers?.lean === true ||
                result.modifiers?.framework === true;
              if (hasExistingModifier) {
                throw new ValidationError(
                  'Only one %modifier is allowed per command. Remove the additional modifier.'
                );
              }

              const modifiersValue = this.buildModifiers(modifierToken);
              if (modifiersValue) {
                result.modifiers = modifiersValue;
              }
              result.metadata.modifierToken = modifierToken;
            }

            // Validate that the prompt ID exists
            await this.validatePromptExists(result.promptId, availablePrompts);

            // Update statistics
            this.stats.successfulParses++;
            this.updateStrategyStats(strategy.name);
            this.updateConfidenceStats(result.confidence);

            this.logger.debug(
              `Command parsed successfully using strategy: ${strategy.name} (confidence: ${result.confidence})`
            );
            return this.applyCommandType(result, normalized);
          }
        } catch (error) {
          this.logger.debug(
            `Strategy ${strategy.name} failed: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
          continue;
        }
      }
    }

    // If no strategy succeeded, provide helpful error message
    this.stats.failedParses++;
    const errorMessage = this.generateHelpfulError(normalized, availablePrompts);
    throw new ValidationError(errorMessage);
  }

  private applyCommandType(
    result: CommandParseResult,
    originalCommand: string
  ): CommandParseResult {
    if (result.commandType) {
      return result;
    }

    const hasChainOperator =
      result.operators?.operatorTypes?.includes('chain') || /-->/i.test(originalCommand);

    result.commandType = hasChainOperator ? 'chain' : 'single';
    return result;
  }

  /**
   * Initialize parsing strategies (STREAMLINED: 2 core strategies)
   */
  private initializeStrategies(): ParsingStrategy[] {
    return [
      this.createSymbolicCommandStrategy(),
      this.createSimpleCommandStrategy(),
      this.createJsonCommandStrategy(),
    ];
  }

  private createSymbolicCommandStrategy(): ParsingStrategy {
    return {
      name: 'symbolic',
      confidence: 0.97,
      canHandle: (command: string) => {
        // Match symbolic operators:
        // - --> (chain)
        // - :: or = followed by any value (quoted or unquoted)
        // - @FRAMEWORK at start OR after whitespace
        // - + (parallel)
        // - ? (conditional)
        // - #id style selector (e.g., #analytical, #procedural)
        return (
          /-->|(::|=)\s*\S|\s@[A-Za-z0-9_-]+|^@[A-Za-z0-9_-]+|\+|\?/.test(command) ||
          /(?:^|\s)#[A-Za-z][A-Za-z0-9_-]*(?=\s|$|>>)/.test(command)
        );
      },
      parse: (command: string): SymbolicCommandParseResult | null => {
        const operators = this.symbolicParser.detectOperators(command);
        if (!operators.hasOperators) {
          return null;
        }

        // Strip framework operator from anywhere in command
        let cleanCommand = command.replace(/(?:^|\s)@[A-Za-z0-9_-]+\s*/g, ' ');
        // Strip ALL gate operators - handles both named and anonymous formats:
        // - Named colon: :: id:"criteria" or :: id:'criteria'
        // - Named paren: :: id(criteria)
        // - Anonymous quoted: :: "criteria" or :: 'criteria'
        // - Anonymous unquoted: :: criteria (canonical refs or plain text)
        cleanCommand = cleanCommand.replace(
          /\s+(::|=)\s*(?:[a-z][a-z0-9_-]*:["'][^"']+["']|[a-z][a-z0-9_-]*\([^)]+\)|["'][^"']+["']|[^\s"']+)/gi,
          ''
        );
        // Strip style selector to avoid polluting base args
        cleanCommand = stripStyleOperators(cleanCommand);

        const baseSegment = cleanCommand.split(/-->|\+|\?/)[0]?.trim() ?? '';
        const firstPromptMatch = baseSegment.match(/^(?:>>)?([A-Za-z0-9_-]+)(?:\s+([\s\S]*))?$/);
        if (!firstPromptMatch) {
          return null;
        }

        const basePromptId = firstPromptMatch[1];
        if (!basePromptId) {
          return null;
        }
        const baseArgs = (firstPromptMatch[2] ?? '').trim();

        return this.symbolicParser.buildParseResult(command, operators, basePromptId, baseArgs);
      },
    };
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
        const match = command.trim().match(/^(>>|\/)([a-zA-Z0-9_\-\s]+?)(?:\s+([\s\S]*))?$/);
        if (!match) return null;

        const [, prefix, rawPromptId, rawArgs] = match;
        if (!rawPromptId) {
          return null;
        }

        // Clean up prompt ID: convert spaces and hyphens to underscores, normalize
        const promptId = rawPromptId
          .trim()
          .toLowerCase()
          .replace(/[\s-]+/g, '_') // Spaces and hyphens to underscores
          .replace(/[^a-z0-9_]/g, '') // Remove invalid characters (except underscores)
          .replace(/_+/g, '_') // Collapse multiple underscores
          .replace(/^_|_$/g, ''); // Trim leading/trailing underscores

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
            warnings,
          },
        };
      },
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

        const { command: innerCommand, modifier: modifierToken } = this.extractModifier(
          String(actualCommand)
        );

        // Recursively parse the inner command
        const simpleStrategy = this.createSimpleCommandStrategy();
        if (!simpleStrategy.canHandle(innerCommand)) {
          return null;
        }

        const innerResult = simpleStrategy.parse(innerCommand);
        if (!innerResult) return null;

        if (modifierToken) {
          const modifiersValue = this.buildModifiers(modifierToken);
          if (modifiersValue) {
            innerResult.modifiers = modifiersValue;
          }
          if (innerResult.metadata) {
            innerResult.metadata.modifierToken = modifierToken;
            innerResult.metadata.originalCommand =
              typeof data.command === 'string' ? data.command : command;
          }
        }

        const mods = innerResult.modifiers;
        return {
          promptId: innerResult.promptId,
          rawArgs: data.args ? JSON.stringify(data.args) : innerResult.rawArgs,
          format: 'json',
          confidence,
          ...(mods !== undefined && { modifiers: mods }),
          metadata: {
            originalCommand: command,
            parseStrategy: 'json',
            detectedFormat: 'JSON wrapper with inner command',
            warnings: innerResult.metadata?.warnings ?? [],
            ...(innerResult.metadata?.modifierToken !== undefined && {
              modifierToken: innerResult.metadata.modifierToken,
            }),
          },
        };
      },
    };
  }

  /**
   * Validate that the prompt ID exists in available prompts
   */
  private async validatePromptExists(
    promptId: string,
    availablePrompts: ConvertedPrompt[]
  ): Promise<void> {
    // Check if this is a built-in command that should be routed (handled by prompt engine)
    if (this.isBuiltinCommand(promptId)) {
      return; // Built-in commands are valid and will be routed by the prompt engine
    }

    // Use case-insensitive matching to find the prompt
    const found = availablePrompts.find(
      (p) =>
        p.id.toLowerCase() === promptId.toLowerCase() ||
        p.name?.toLowerCase() === promptId.toLowerCase()
    );
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
      'listprompts',
      'listprompt',
      'list_prompts',
      'help',
      'commands',
      'status',
      'health',
      'analytics',
      'metrics',
      'gates',
      'gate',
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
  private generatePromptSuggestions(promptId: string, availablePrompts: ConvertedPrompt[]): string {
    // Simple Levenshtein distance for suggestions
    const suggestions = availablePrompts
      .map((prompt) => ({
        prompt,
        distance: this.levenshteinDistance(promptId.toLowerCase(), prompt.id.toLowerCase()),
      }))
      .filter((item) => item.distance <= 3)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 3)
      .map((item) => item.prompt.id);

    if (suggestions.length > 0) {
      return `Did you mean: ${suggestions.join(', ')}?`;
    }

    return '';
  }

  /**
   * Simple Levenshtein distance calculation
   */
  private levenshteinDistance(a: string, b: string): number {
    const matrix: number[][] = Array(b.length + 1)
      .fill(null)
      .map(() => Array<number>(a.length + 1).fill(0));

    for (let i = 0; i <= a.length; i++) {
      const row = matrix[0];
      if (row) row[i] = i;
    }
    for (let j = 0; j <= b.length; j++) {
      const row = matrix[j];
      if (row) row[0] = j;
    }

    for (let j = 1; j <= b.length; j++) {
      for (let i = 1; i <= a.length; i++) {
        const aChar = a[i - 1];
        const bChar = b[j - 1];
        const indicator = aChar === bChar ? 0 : 1;
        const currentRow = matrix[j];
        const prevRow = matrix[j - 1];
        if (currentRow && prevRow) {
          const left = currentRow[i - 1] ?? 0;
          const up = prevRow[i] ?? 0;
          const diag = prevRow[i - 1] ?? 0;
          currentRow[i] = Math.min(left + 1, up + 1, diag + indicator);
        }
      }
    }

    const finalRow = matrix[b.length];
    return finalRow?.[a.length] ?? Math.max(a.length, b.length);
  }

  /**
   * Generate helpful error message for parsing failures
   */
  private generateHelpfulError(command: string, availablePrompts: ConvertedPrompt[]): string {
    let message = `Could not parse command: "${command}"\n\n`;

    message += 'Supported command formats:\n';
    message += '• Simple: >>prompt_name arguments\n';
    message += '• Simple: /prompt_name arguments\n';
    message += '• JSON: {"command": ">>prompt_name", "args": "arguments"}\n';
    message += '• JSON: {"command": ">>prompt_name", "args": {"key": "value"}}\n\n';

    // Try to give specific suggestions based on command analysis
    if (command.includes('>>') || command.includes('/')) {
      const promptMatch = command.match(/^(>>|\/)([a-zA-Z0-9_\-]+)/);
      if (promptMatch) {
        const promptName = promptMatch[2];
        message += `Prompt name "${promptName}" not found. `;
        message += 'Prompt names are case-insensitive.\n\n';

        // Show some available prompts as examples
        const examplePrompts = availablePrompts
          .slice(0, 5)
          .map((p) => p.id)
          .join(', ');
        message += `Available prompts include: ${examplePrompts}...\n\n`;
      } else {
        message +=
          'Invalid prompt name format. Use letters, numbers, underscores, and hyphens only.\n\n';

        // Check if this is a chain command with operators on individual steps
        if (command.includes('-->') && (command.includes('%') || command.includes('@'))) {
          message += '💡 Operator Scope Guidance:\n';
          message +=
            '   Execution modifiers (%) and framework operators (@) apply to the ENTIRE chain.\n';
          message += '   Place them at the start, not on individual steps.\n';
          message +=
            '   ✅ %judge @CAGEERF >>step1 --> >>step2   ❌ >>step1 --> %lean @ReACT >>step2\n\n';
        }
      }
    } else if (command.startsWith('{')) {
      message += 'JSON format detected but could not parse. Check JSON syntax and structure.\n\n';
    } else if (command.startsWith('>')) {
      // Detect likely >> prefix that got stripped to single >
      message +=
        '⚠️  Detected single ">" prefix - this suggests the ">>" prefix was partially stripped.\n';
      message += 'This is a known limitation when calling MCP tools via XML-based clients.\n\n';
      message += 'Workarounds:\n';
      message += `• Use symbolic operators: "${command.slice(1)} --> " (makes >> optional)\n`;
      message += `• Use JSON format: {"command": "${command.slice(1).split(' ')[0]}", "args": {...}}\n`;
      message += `• Add framework operator: "@CAGEERF ${command.slice(1)}"\n\n`;
    } else {
      // Bare prompt name without >> or operators
      const barePromptMatch = command.match(/^([a-zA-Z0-9_\-]+)(?:\s|$)/);
      if (barePromptMatch) {
        const promptName = barePromptMatch[1];
        message += `⚠️  Bare prompt name detected: "${promptName}"\n`;
        message +=
          'The >> prefix is required for simple commands, but may not work via MCP tools.\n\n';
        message += 'Recommended alternatives:\n';
        message += `• Add chain operator: "${command} --> " (even for single prompts)\n`;
        message += `• Add framework operator: "@CAGEERF ${command}"\n`;
        message += `• Use JSON format: {"command": "${promptName}", "args": {...}}\n\n`;
      } else {
        message += 'Command format not recognized. Use >>prompt_name or /prompt_name format.\n\n';
      }
    }

    message += 'Use >>listprompts to see all available prompts, or >>help for assistance.';

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
      strategyUsage: new Map(this.stats.strategyUsage),
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
      averageConfidence: 0,
    };
  }
}

/**
 * Factory function to create unified command parser
 */
export function createUnifiedCommandParser(logger: Logger): UnifiedCommandParser {
  return new UnifiedCommandParser(logger);
}
