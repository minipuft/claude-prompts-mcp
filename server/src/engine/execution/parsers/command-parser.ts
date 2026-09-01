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

import { tokenizeCommand } from './command-tokenizer.js';
import { RESERVED_OPERATORS } from './operator-patterns.js';
import { normalizeSymbolicPrefixes } from './parser-utils.js';
import { SymbolicCommandParser, createSymbolicCommandParser } from './symbolic-operator-parser.js';
import scoringContract from '../../../../tooling/contracts/registries/suggestion-scoring.json' with { type: 'json' };

import type { TokenizedCommand } from './command-tokenizer.js';
import type { ConvertedPrompt, ExecutionModifier, ExecutionModifiers } from '../types.js';
import type { CommandParseResultBase } from './types/command-parse-types.js';
import type {
  OperatorDetectionResult,
  SymbolicCommandParseResult,
  SymbolicExecutionPlan,
} from './types/operator-types.js';

import { Logger } from '#infra/logging/index.js';
import { PromptError, ValidationError, safeJsonParse } from '#shared/utils/index.js';
import { normalizePromptId } from '#shared/utils/resource-ids.js';

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
 * Reject any operator the registry declares `reserved`.
 *
 * `status: reserved` in operators.json is a published claim — documented symbol, deliberately
 * not executable. Neither reserved operator was actually enforced before this check: `+` and the
 * conditional form both tokenized, every parsing strategy then ignored the token, and the command
 * ran its leading prompt and returned SUCCESS with the operator silently dropped. A user typing a
 * documented-as-reserved operator got the wrong semantics with no signal (measured 2026-08-11).
 *
 * `+` previously looked enforced only because the conformance fixture it was probed with failed
 * for an unrelated missing argument — the rejection had nothing to do with the operator.
 *
 * Detection reuses the tokenizer instead of re-matching the registry patterns, so this rejects
 * exactly when the operator was genuinely recognized. That inherits the tokenizer's existing
 * exclusions: `+` inside a quoted argument ("R3F + Visx"), `+` where a chain takes precedence,
 * and a bare `?` in natural language ("is there a bug?") are all untouched.
 */
function rejectReservedOperators(tokens: TokenizedCommand): void {
  for (const token of tokens.operators) {
    const symbol = RESERVED_OPERATORS.get(token.type);
    if (symbol !== undefined) {
      throw new ValidationError(
        `Operator "${symbol}" is reserved and not implemented. It is documented for a future release and cannot be executed yet.`
      );
    }
  }
}

/**
 * Parsing strategy interface
 */
interface ParsingStrategy {
  name: string;
  canHandle: (command: string, tokens: TokenizedCommand) => boolean;
  parse: (command: string, tokens: TokenizedCommand) => CommandParseResult | null;
  confidence: number;
}

/**
 * Unified Command Parser Class
 */
export class UnifiedCommandParser {
  private logger: Logger;
  private strategies: ParsingStrategy[];
  private symbolicParser: SymbolicCommandParser;
  private registeredFrameworkIds: Set<string>;

  // Parsing statistics for monitoring
  // TODO: Wire stats to MetricsCollector for telemetry dashboard
  // These are tracked but not yet exposed via system_control analytics
  private stats = {
    totalParses: 0,
    successfulParses: 0,
    failedParses: 0,
    strategyUsage: new Map<string, number>(),
    averageConfidence: 0,
  };

  /**
   * @param logger - Logger instance
   * @param registeredFrameworkIds - Optional set of registered framework IDs (uppercase).
   *   When provided, only @framework operators matching registered IDs are detected.
   *   Unregistered @word patterns are silently skipped (treated as literal text).
   */
  constructor(logger: Logger, registeredFrameworkIds?: Set<string>) {
    this.logger = logger;
    this.registeredFrameworkIds = registeredFrameworkIds ?? new Set();
    this.symbolicParser = createSymbolicCommandParser(logger, this.registeredFrameworkIds);
    this.strategies = this.initializeStrategies();
    this.logger.debug(
      `UnifiedCommandParser initialized with ${this.strategies.length} parsing strategies`
    );
  }

  /**
   * Update the set of registered framework IDs.
   * This allows late binding when FrameworkManager becomes available after construction.
   * @param frameworkIds Set of framework IDs (will be normalized to uppercase)
   */
  updateRegisteredFrameworkIds(frameworkIds: Set<string>): void {
    // Normalize to uppercase for consistent matching
    this.registeredFrameworkIds = new Set(Array.from(frameworkIds).map((id) => id.toUpperCase()));
    // Recreate symbolic parser with updated framework IDs
    this.symbolicParser = createSymbolicCommandParser(this.logger, this.registeredFrameworkIds);
    this.logger.debug(
      `[UnifiedCommandParser] Updated registered framework IDs: ${Array.from(this.registeredFrameworkIds).join(', ')}`
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

    // Expand repetition operator before strategy selection (e.g., ">>p *3" → ">>p --> >>p --> >>p")
    const preprocessed = this.symbolicParser.preprocessRepetition(normalized);
    const hadRepetition = preprocessed !== normalized;

    this.logger.debug(
      `Parsing command: "${preprocessed.substring(0, 100)}..."${hadPrefixes ? ' (prefixes normalized)' : ''}${hadRepetition ? ' (repetition expanded)' : ''}`
    );

    // Tokenize once — strategies consume tokens instead of re-detecting operators
    const tokens = tokenizeCommand(preprocessed);

    // Reserved operators are documented but not executable — fail loudly rather than drop them
    rejectReservedOperators(tokens);

    // Try each strategy in order of confidence (now operating on preprocessed command)
    const sortedStrategies = [...this.strategies].sort((a, b) => b.confidence - a.confidence);

    for (const strategy of sortedStrategies) {
      if (strategy.canHandle(preprocessed, tokens)) {
        try {
          const result = strategy.parse(preprocessed, tokens);
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
            if (hadRepetition) {
              result.metadata.repetitionExpanded = true;
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

            // Validate that the prompt ID exists and resolve to canonical ID
            result.promptId = await this.validatePromptExists(result.promptId, availablePrompts);

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
   * Initialize parsing strategies (symbolic, simple, JSON)
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
      canHandle: (_command: string, tokens: TokenizedCommand) => tokens.hasSymbolicOperators,
      parse: (command: string, tokens: TokenizedCommand): SymbolicCommandParseResult | null => {
        // Full operator detection still needed for execution plan building
        // (tokenizer detects presence; symbolic parser produces ChainOperator, GateOperator, etc.)
        const operators = this.symbolicParser.detectOperators(command);
        if (!operators.hasOperators) {
          return null;
        }

        // Use tokenizer's pre-extracted prompt info instead of manual stripping
        // (replaces ~20 lines of framework/gate/style/verify regex removal)
        const basePromptId = tokens.promptId;
        if (basePromptId === null) {
          return null;
        }

        return this.symbolicParser.buildParseResult(
          command,
          operators,
          basePromptId,
          tokens.rawArgs
        );
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
      canHandle: (_command: string, tokens: TokenizedCommand) => {
        if (tokens.format !== 'simple') return false;
        // Validate prompt name pattern (format check alone doesn't guarantee valid prompt name)
        return /^(?:>>|\/)?[a-zA-Z][a-zA-Z0-9_-]*(?:\s|$)/.test(tokens.raw.trim());
      },
      parse: (command: string, _tokens: TokenizedCommand): CommandParseResult | null => {
        // Enhanced regex to handle more natural command formats
        // Prefix (>> or /) is now optional to support bare prompt names
        // Prompt name: starts with letter, contains letters/numbers/underscores/hyphens (no spaces)
        const match = command.trim().match(/^(?:>>|\/)?([a-zA-Z][a-zA-Z0-9_-]*)(?:\s+([\s\S]*))?$/);
        if (!match) return null;

        const [, rawPromptId, rawArgs] = match;
        if (!rawPromptId) {
          return null;
        }

        // One owner for the canonical form — see shared/utils/resource-ids.ts. This site used to
        // inline its own copy carrying an extra `.replace(/[^a-z0-9_]/g, '')`, which the capture
        // group above (`[a-zA-Z][a-zA-Z0-9_-]*`) already made unreachable: it could never remove a
        // character. Its only effect was to make the two implementations disagree on inputs
        // neither could receive.
        const promptId = normalizePromptId(rawPromptId);

        const warnings: string[] = [];
        if (rawPromptId.trim() !== promptId) {
          warnings.push(`Normalized prompt name: "${rawPromptId.trim()}" → "${promptId}"`);
        }

        // Detect if original had prefix for metadata
        const hadPrefix = /^(>>|\/)/.test(command.trim());
        const detectedFormat = hadPrefix ? 'prefixed prompt format' : 'bare prompt name';

        return {
          promptId: promptId,
          rawArgs: (rawArgs || '').trim(),
          format: 'simple',
          confidence: 0.98, // High confidence for enhanced parsing
          metadata: {
            originalCommand: command,
            parseStrategy: 'simple_enhanced',
            detectedFormat,
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
      canHandle: (_command: string, tokens: TokenizedCommand) => tokens.format === 'json',
      parse: (command: string, _tokens: TokenizedCommand): CommandParseResult | null => {
        const parseResult = safeJsonParse(command);
        if (!parseResult.success || !parseResult.data) {
          return null;
        }

        let data = parseResult.data;

        // Handle different JSON formats
        // No initializers: every branch below assigns both, and the final `else` returns.
        // Dead initializers hid that invariant; definite-assignment analysis now enforces it.
        let actualCommand: string;
        let confidence: number;

        if (data.command) {
          actualCommand = data.command;
          confidence = 0.9;
        } else if (data.prompt) {
          actualCommand = data.prompt;
          confidence = 0.85;
        } else {
          return null;
        }

        // Handle double-encoded JSON (command field is itself a JSON string)
        // This can happen when clients double-escape JSON payloads
        if (typeof actualCommand === 'string' && actualCommand.trim().startsWith('{')) {
          const innerParse = safeJsonParse(actualCommand);
          if (
            innerParse.success === true &&
            innerParse.data !== null &&
            typeof innerParse.data === 'object'
          ) {
            // Extract command from the inner JSON object with proper type guards
            const innerData = innerParse.data as Record<string, unknown>;
            const innerCommand = innerData['command'];
            const innerPrompt = innerData['prompt'];
            const innerArgs = innerData['args'];

            if (typeof innerCommand === 'string') {
              actualCommand = innerCommand;
              // Merge args if present in inner object and not in outer
              // Use bracket notation with type assertion for data.args access
              const outerData = data as Record<string, unknown>;
              if (innerArgs !== undefined && outerData['args'] === undefined) {
                data = { ...outerData, args: innerArgs };
              }
            } else if (typeof innerPrompt === 'string') {
              actualCommand = innerPrompt;
            }
          }
        }

        const { command: innerCommand, modifier: modifierToken } = this.extractModifier(
          String(actualCommand)
        );

        // Recursively parse the inner command - tokenize and try both strategies
        const symbolicStrategy = this.createSymbolicCommandStrategy();
        const simpleStrategy = this.createSimpleCommandStrategy();
        const innerTokens = tokenizeCommand(innerCommand);

        let innerResult: CommandParseResult | null = null;

        // Try symbolic strategy first (for chains and operators)
        if (symbolicStrategy.canHandle(innerCommand, innerTokens)) {
          innerResult = symbolicStrategy.parse(innerCommand, innerTokens);
        }

        // Fall back to simple strategy (for plain prompt names)
        if (!innerResult && simpleStrategy.canHandle(innerCommand, innerTokens)) {
          innerResult = simpleStrategy.parse(innerCommand, innerTokens);
        }

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
  ): Promise<string> {
    // Check if this is a built-in command that should be routed (handled by prompt engine)
    if (this.isBuiltinCommand(promptId)) {
      return promptId;
    }

    // Use case-insensitive matching to find the prompt
    const found = availablePrompts.find(
      (p) =>
        p.id.toLowerCase() === promptId.toLowerCase() ||
        p.name?.toLowerCase() === promptId.toLowerCase()
    );
    if (found) {
      return found.id;
    }

    // Hyphen-agnostic fallback: normalize hyphens/underscores before comparing
    // Handles mismatch between parser normalization (hyphens→underscores) and stored IDs
    const normalizeDelimiters = (s: string): string => s.toLowerCase().replace(/[-_]+/g, '_');
    const normalizedQuery = normalizeDelimiters(promptId);
    const normalizedFound = availablePrompts.find(
      (p) =>
        normalizeDelimiters(p.id) === normalizedQuery ||
        (p.name != null && normalizeDelimiters(p.name) === normalizedQuery)
    );
    if (normalizedFound) {
      return normalizedFound.id;
    }

    const suggestions = this.generatePromptSuggestions(promptId, availablePrompts);
    const msg =
      suggestions !== ''
        ? `Unknown prompt "${promptId}". ${suggestions}`
        : `Unknown prompt "${promptId}"`;
    throw new PromptError(msg);
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
   * Generate helpful prompt suggestions using multi-factor scoring
   * Considers: prefix matches, word overlap, and Levenshtein distance
   */
  private generatePromptSuggestions(promptId: string, availablePrompts: ConvertedPrompt[]): string {
    const query = promptId.toLowerCase();
    const s = scoringContract.scoring;

    const scored = availablePrompts
      .map((prompt) => {
        const id = prompt.id.toLowerCase();
        let score = 0;

        // Exact prefix match (highest value - user typing partial name)
        if (id.startsWith(query) || query.startsWith(id)) {
          score += s.prefixMatchScore;
        }

        // Word overlap (medium value - related prompts).
        // Words shorter than the floor are skipped: this term matches on
        // unbounded substring containment, so a two-letter word like "no"
        // matches "notes" and every query would score. See the contract's
        // rationale for the measurement that set the floor.
        const queryWords = query.split(/[_-]/);
        const idWords = id.split(/[_-]/);
        const wordOverlap = queryWords.filter(
          (w) =>
            w.length >= s.minOverlapWordLength &&
            idWords.some((iw) => iw.includes(w) || w.includes(iw))
        ).length;
        score += wordOverlap * s.wordOverlapScore;

        // Levenshtein distance (inverse - lower distance = higher score)
        const distance = this.levenshteinDistance(query, id);
        // Dynamic threshold based on query length (longer queries allow more edits)
        const threshold = Math.max(
          s.levenshteinMinThreshold,
          Math.floor(query.length / s.levenshteinLengthDivisor)
        );
        if (distance <= threshold) {
          score += Math.max(0, s.levenshteinBaseScore - distance * s.levenshteinPenaltyPerEdit);
        }

        return { prompt, score };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, s.maxResults);

    if (scored.length > 0) {
      return `Did you mean: ${scored.map((s) => s.prompt.id).join(', ')}?`;
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
   * Generate concise error message for parsing failures
   */
  private generateHelpfulError(command: string, availablePrompts: ConvertedPrompt[]): string {
    // Extract prompt name for suggestions
    const promptMatch = command.match(/^(?:>>|\/)?([a-zA-Z][a-zA-Z0-9_-]*)/);
    const promptName = promptMatch?.[1];

    if (promptName) {
      const suggestions = this.generatePromptSuggestions(promptName, availablePrompts);
      return suggestions !== ''
        ? `Unknown prompt "${promptName}". ${suggestions}`
        : `Unknown prompt "${promptName}"`;
    }

    // Specific parse errors
    if (command.startsWith('{')) {
      return `Invalid JSON: "${command.slice(0, 50)}${command.length > 50 ? '...' : ''}"`;
    }
    if (command.startsWith('>') && !command.startsWith('>>')) {
      return `Single ">" detected (XML encoding issue). Use: ${command.slice(1).split(' ')[0]}`;
    }

    return `Parse error: "${command.slice(0, 50)}${command.length > 50 ? '...' : ''}"`;
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
 * @param logger - Logger instance
 * @param registeredFrameworkIds - Optional set of registered framework IDs (uppercase).
 *   When provided, only @framework operators matching registered IDs are detected.
 */
export function createUnifiedCommandParser(
  logger: Logger,
  registeredFrameworkIds?: Set<string>
): UnifiedCommandParser {
  return new UnifiedCommandParser(logger, registeredFrameworkIds);
}
