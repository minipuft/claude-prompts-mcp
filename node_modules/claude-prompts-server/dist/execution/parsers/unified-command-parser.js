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
import { createSymbolicCommandParser } from './symbolic-command-parser.js';
import { ValidationError, PromptError, safeJsonParse } from '../../utils/index.js';
const VALID_MODIFIERS = {
    clean: 'clean',
    guided: 'guided',
    judge: 'guided', // alias for guided judge menu
    lean: 'lean',
    framework: 'framework',
};
/**
 * Unified Command Parser Class
 */
export class UnifiedCommandParser {
    constructor(logger) {
        // Parsing statistics for monitoring
        this.stats = {
            totalParses: 0,
            successfulParses: 0,
            failedParses: 0,
            strategyUsage: new Map(),
            averageConfidence: 0,
        };
        this.logger = logger;
        this.symbolicParser = createSymbolicCommandParser(logger);
        this.strategies = this.initializeStrategies();
        this.logger.debug(`UnifiedCommandParser initialized with ${this.strategies.length} parsing strategies`);
    }
    /**
     * Normalize >> prefixes in symbolic commands for consistent parsing.
     *
     * The >> prefix serves as a hint to LLMs that this is an MCP tool command,
     * but it should not interfere with symbolic operator detection.
     *
     * Normalization rules:
     * - Strips >> after chain operators: `--> >>prompt` → `--> prompt`
     * - Strips >> after parallel operators: `+ >>prompt` → `+ prompt`
     * - Strips >> after conditional operators: `: >>branch` → `: branch`
     * - Strips >> before @ framework operator: `>> @framework` → `@framework`
     *
     * Note: >> at the start of simple commands is handled by individual strategies.
     *
     * @param command - The raw command string
     * @returns Normalized command, original command, and normalization flag
     */
    normalizeSymbolicPrefixes(command) {
        const original = command;
        let normalized = command;
        let hadPrefixes = false;
        // Normalize >> prefix after chain steps: "prompt1 --> >>prompt2" → "prompt1 --> prompt2"
        const chainStepPattern = /-->\s*>>\s*/g;
        if (chainStepPattern.test(normalized)) {
            normalized = normalized.replace(chainStepPattern, '--> ');
            hadPrefixes = true;
        }
        // Normalize >> prefix after parallel prompts: "prompt1 + >>prompt2" → "prompt1 + prompt2"
        const parallelPattern = /\+\s*>>\s*/g;
        if (parallelPattern.test(normalized)) {
            normalized = normalized.replace(parallelPattern, '+ ');
            hadPrefixes = true;
        }
        // Normalize >> prefix in conditional branches: "? 'condition' : >>trueBranch" → "? 'condition' : trueBranch"
        const conditionalPattern = /:\s*>>\s*/g;
        if (conditionalPattern.test(normalized)) {
            normalized = normalized.replace(conditionalPattern, ': ');
            hadPrefixes = true;
        }
        // Normalize >> prefix before framework operator: ">> @framework" → "@framework"
        // This allows "@framework" patterns to be detected even with >> prefix
        const frameworkPrefixPattern = /^>>\s*@/;
        if (frameworkPrefixPattern.test(normalized)) {
            normalized = normalized.replace(/^>>\s*/, '');
            hadPrefixes = true;
        }
        return { normalized, hadPrefixes, originalCommand: original };
    }
    /**
     * Extracts a single execution modifier prefix (e.g., %clean) from the command.
     * Returns the command with the modifier stripped and the normalized modifier value.
     */
    extractModifier(command) {
        const trimmed = command.trimStart();
        const match = trimmed.match(/^%\s*([a-zA-Z_-]+)/);
        if (!match) {
            return { command };
        }
        const modifierKey = match[1].toLowerCase();
        const modifier = VALID_MODIFIERS[modifierKey];
        if (!modifier) {
            throw new ValidationError(`Unknown execution modifier "%${modifierKey}". Supported modifiers: %clean, %judge (alias %guided), %lean, %framework.`);
        }
        const remainder = trimmed.slice(match[0].length).trimStart();
        if (/^%\s*[a-zA-Z_-]+/.test(remainder)) {
            throw new ValidationError('Only one %modifier is allowed per command. Remove additional modifiers.');
        }
        return { command: remainder, modifier };
    }
    buildModifiers(modifier) {
        if (!modifier) {
            return undefined;
        }
        return {
            clean: modifier === 'clean',
            guided: modifier === 'guided',
            lean: modifier === 'lean',
            framework: modifier === 'framework',
        };
    }
    /**
     * Parse command string using multi-strategy approach
     */
    async parseCommand(command, availablePrompts) {
        this.stats.totalParses++;
        if (!command || command.trim().length === 0) {
            this.stats.failedParses++;
            throw new ValidationError('Command cannot be empty');
        }
        const trimmed = command.trim();
        const { command: commandWithoutModifier, modifier } = this.extractModifier(trimmed);
        if (!commandWithoutModifier || commandWithoutModifier.trim().length === 0) {
            throw new ValidationError('Command cannot be empty after applying modifier');
        }
        // Normalize symbolic prefixes centrally (ONE primary implementation)
        const { normalized, hadPrefixes } = this.normalizeSymbolicPrefixes(commandWithoutModifier);
        this.logger.debug(`Parsing command: "${normalized.substring(0, 100)}..."${hadPrefixes ? ' (prefixes normalized)' : ''}`);
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
                        if (modifier) {
                            if (result.modifier && result.modifier !== modifier) {
                                throw new ValidationError(`Only one %modifier is allowed per command. Found "${result.modifier}" and "${modifier}".`);
                            }
                            if (!result.modifier) {
                                result.modifier = modifier;
                                result.modifiers = this.buildModifiers(modifier);
                                result.metadata.modifier = modifier;
                            }
                        }
                        // Validate that the prompt ID exists
                        await this.validatePromptExists(result.promptId, availablePrompts);
                        // Update statistics
                        this.stats.successfulParses++;
                        this.updateStrategyStats(strategy.name);
                        this.updateConfidenceStats(result.confidence);
                        this.logger.debug(`Command parsed successfully using strategy: ${strategy.name} (confidence: ${result.confidence})`);
                        return this.applyCommandType(result, normalized);
                    }
                }
                catch (error) {
                    this.logger.debug(`Strategy ${strategy.name} failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
                    continue;
                }
            }
        }
        // If no strategy succeeded, provide helpful error message
        this.stats.failedParses++;
        const errorMessage = this.generateHelpfulError(normalized, availablePrompts);
        throw new ValidationError(errorMessage);
    }
    applyCommandType(result, originalCommand) {
        if (result.commandType) {
            return result;
        }
        const hasChainOperator = result.operators?.operatorTypes?.includes('chain') || /-->/i.test(originalCommand);
        result.commandType = hasChainOperator ? 'chain' : 'single';
        return result;
    }
    /**
     * Initialize parsing strategies (STREAMLINED: 2 core strategies)
     */
    initializeStrategies() {
        return [
            this.createSymbolicCommandStrategy(),
            this.createSimpleCommandStrategy(),
            this.createJsonCommandStrategy(),
        ];
    }
    createSymbolicCommandStrategy() {
        return {
            name: 'symbolic',
            confidence: 0.97,
            canHandle: (command) => {
                // Match symbolic operators:
                // - --> (chain)
                // - :: or = followed by any value (quoted or unquoted)
                // - @FRAMEWORK at start OR after whitespace
                // - + (parallel)
                // - ? (conditional)
                // - #style:<id> or #style(<id>) selector
                return (/-->|(::|=)\s*\S|\s@[A-Za-z0-9_-]+|^@[A-Za-z0-9_-]+|\+|\?/.test(command) ||
                    /#style(?:[:=(])/i.test(command));
            },
            parse: (command) => {
                const operators = this.symbolicParser.detectOperators(command);
                if (!operators.hasOperators) {
                    return null;
                }
                // Strip framework operator from anywhere in command
                let cleanCommand = command.replace(/(?:^|\s)@[A-Za-z0-9_-]+\s*/g, ' ');
                // Strip ALL gate operators (quoted or unquoted) - uses /g flag to handle multiple :: operators
                cleanCommand = cleanCommand.replace(/\s+(::|=)\s*(?:["']([^"']+)["']|([^\s"']+))/g, '');
                // Strip style selector to avoid polluting base args
                cleanCommand = this.symbolicParser.stripStyleOperators(cleanCommand);
                const baseSegment = cleanCommand.split(/-->|\+|\?/)[0]?.trim() ?? '';
                const firstPromptMatch = baseSegment.match(/^(?:>>)?([A-Za-z0-9_-]+)(?:\s+([\s\S]*))?$/);
                if (!firstPromptMatch) {
                    return null;
                }
                const basePromptId = firstPromptMatch[1];
                const baseArgs = (firstPromptMatch[2] ?? '').trim();
                return this.symbolicParser.buildParseResult(command, operators, basePromptId, baseArgs);
            },
        };
    }
    /**
     * Simple command strategy: >>prompt_name arguments (ENHANCED: More AI-friendly)
     */
    createSimpleCommandStrategy() {
        return {
            name: 'simple',
            confidence: 0.95, // Increased confidence for primary strategy
            canHandle: (command) => {
                // More flexible pattern - handles spaces in prompt names via underscore conversion
                return /^(>>|\/)[a-zA-Z0-9_\-\s]+(\s|$)/.test(command.trim());
            },
            parse: (command) => {
                // Enhanced regex to handle more natural command formats
                const match = command.trim().match(/^(>>|\/)([a-zA-Z0-9_\-\s]+?)(?:\s+([\s\S]*))?$/);
                if (!match)
                    return null;
                const [, prefix, rawPromptId, rawArgs] = match;
                // Clean up prompt ID: convert spaces and hyphens to underscores, normalize
                const promptId = rawPromptId
                    .trim()
                    .toLowerCase()
                    .replace(/[\s-]+/g, '_') // Spaces and hyphens to underscores
                    .replace(/[^a-z0-9_]/g, '') // Remove invalid characters (except underscores)
                    .replace(/_+/g, '_') // Collapse multiple underscores
                    .replace(/^_|_$/g, ''); // Trim leading/trailing underscores
                const warnings = [];
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
    createJsonCommandStrategy() {
        return {
            name: 'json',
            confidence: 0.85,
            canHandle: (command) => {
                const trimmed = command.trim();
                return trimmed.startsWith('{') && trimmed.endsWith('}');
            },
            parse: (command) => {
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
                }
                else if (data.prompt) {
                    actualCommand = data.prompt;
                    confidence = 0.85;
                }
                else {
                    return null;
                }
                const { command: innerCommand, modifier } = this.extractModifier(String(actualCommand));
                // Recursively parse the inner command
                const simpleStrategy = this.createSimpleCommandStrategy();
                if (!simpleStrategy.canHandle(innerCommand)) {
                    return null;
                }
                const innerResult = simpleStrategy.parse(innerCommand);
                if (!innerResult)
                    return null;
                if (modifier) {
                    innerResult.modifier = modifier;
                    innerResult.modifiers = this.buildModifiers(modifier);
                    innerResult.metadata.modifier = modifier;
                    innerResult.metadata.originalCommand =
                        typeof data.command === 'string' ? data.command : command;
                }
                return {
                    promptId: innerResult.promptId,
                    rawArgs: data.args ? JSON.stringify(data.args) : innerResult.rawArgs,
                    format: 'json',
                    confidence,
                    modifier: innerResult.modifier,
                    modifiers: innerResult.modifiers,
                    metadata: {
                        originalCommand: command,
                        parseStrategy: 'json',
                        detectedFormat: 'JSON wrapper with inner command',
                        warnings: innerResult.metadata?.warnings ?? [],
                        modifier: innerResult.metadata?.modifier,
                    },
                };
            },
        };
    }
    /**
     * Validate that the prompt ID exists in available prompts
     */
    async validatePromptExists(promptId, availablePrompts) {
        // Check if this is a built-in command that should be routed (handled by prompt engine)
        if (this.isBuiltinCommand(promptId)) {
            return; // Built-in commands are valid and will be routed by the prompt engine
        }
        // Use case-insensitive matching to find the prompt
        const found = availablePrompts.find((p) => p.id.toLowerCase() === promptId.toLowerCase() ||
            p.name?.toLowerCase() === promptId.toLowerCase());
        if (!found) {
            const suggestions = this.generatePromptSuggestions(promptId, availablePrompts);
            const builtinHint = this.getBuiltinCommandHint(promptId);
            throw new PromptError(`Unknown prompt: "${promptId}". ${suggestions}${builtinHint}\n\nTry: >>listprompts, >>help, >>status`);
        }
    }
    /**
     * Check if command is a built-in system command
     */
    isBuiltinCommand(promptId) {
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
        ];
        return builtinCommands.includes(promptId.toLowerCase());
    }
    /**
     * Generate hint for built-in commands that might have been mistyped
     */
    getBuiltinCommandHint(promptId) {
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
    generatePromptSuggestions(promptId, availablePrompts) {
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
    levenshteinDistance(a, b) {
        const matrix = Array(b.length + 1)
            .fill(null)
            .map(() => Array(a.length + 1).fill(null));
        for (let i = 0; i <= a.length; i++)
            matrix[0][i] = i;
        for (let j = 0; j <= b.length; j++)
            matrix[j][0] = j;
        for (let j = 1; j <= b.length; j++) {
            for (let i = 1; i <= a.length; i++) {
                const indicator = a[i - 1] === b[j - 1] ? 0 : 1;
                matrix[j][i] = Math.min(matrix[j][i - 1] + 1, matrix[j - 1][i] + 1, matrix[j - 1][i - 1] + indicator);
            }
        }
        return matrix[b.length][a.length];
    }
    /**
     * Generate helpful error message for parsing failures
     */
    generateHelpfulError(command, availablePrompts) {
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
            }
            else {
                message +=
                    'Invalid prompt name format. Use letters, numbers, underscores, and hyphens only.\n\n';
                // Check if this is a chain command with operators on individual steps
                if (command.includes('-->') && (command.includes('%') || command.includes('@'))) {
                    message += '💡 Operator Scope Guidance:\n';
                    message +=
                        '   Execution modifiers (%) and framework operators (@) apply to the ENTIRE chain.\n';
                    message += '   Place them at the start, not on individual steps.\n';
                    message += '   ✅ %judge @CAGEERF >>step1 --> >>step2   ❌ >>step1 --> %lean @ReACT >>step2\n\n';
                }
            }
        }
        else if (command.startsWith('{')) {
            message += 'JSON format detected but could not parse. Check JSON syntax and structure.\n\n';
        }
        else if (command.startsWith('>')) {
            // Detect likely >> prefix that got stripped to single >
            message +=
                '⚠️  Detected single ">" prefix - this suggests the ">>" prefix was partially stripped.\n';
            message += 'This is a known limitation when calling MCP tools via XML-based clients.\n\n';
            message += 'Workarounds:\n';
            message += `• Use symbolic operators: "${command.slice(1)} --> " (makes >> optional)\n`;
            message += `• Use JSON format: {"command": "${command.slice(1).split(' ')[0]}", "args": {...}}\n`;
            message += `• Add framework operator: "@CAGEERF ${command.slice(1)}"\n\n`;
        }
        else {
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
            }
            else {
                message += 'Command format not recognized. Use >>prompt_name or /prompt_name format.\n\n';
            }
        }
        message += 'Use >>listprompts to see all available prompts, or >>help for assistance.';
        return message;
    }
    /**
     * Update strategy usage statistics
     */
    updateStrategyStats(strategyName) {
        const current = this.stats.strategyUsage.get(strategyName) || 0;
        this.stats.strategyUsage.set(strategyName, current + 1);
    }
    /**
     * Update confidence statistics
     */
    updateConfidenceStats(confidence) {
        const totalSuccessful = this.stats.successfulParses;
        this.stats.averageConfidence =
            (this.stats.averageConfidence * (totalSuccessful - 1) + confidence) / totalSuccessful;
    }
    /**
     * Get parsing statistics for monitoring
     */
    getStats() {
        return {
            ...this.stats,
            strategyUsage: new Map(this.stats.strategyUsage),
        };
    }
    /**
     * Reset statistics (useful for testing or fresh starts)
     */
    resetStats() {
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
export function createUnifiedCommandParser(logger) {
    return new UnifiedCommandParser(logger);
}
//# sourceMappingURL=unified-command-parser.js.map