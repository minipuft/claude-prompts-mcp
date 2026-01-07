// @lifecycle canonical - Parses symbolic command expressions into operators.
import { stripStyleOperators } from './parser-utils.js';
import {
  type ChainOperator,
  type ChainStep,
  type ExecutionStep,
  type FrameworkOperator,
  type GateOperator,
  type OperatorDetectionResult,
  type ParallelOperator,
  type StyleOperator,
  type SymbolicCommandParseResult,
  type SymbolicExecutionPlan,
  type SymbolicOperator,
} from './types/operator-types.js';
import { SHELL_VERIFY_DEFAULT_TIMEOUT } from '../../gates/constants.js';
import { Logger } from '../../logging/index.js';
import { ValidationError } from '../../utils/index.js';

/**
 * Parser responsible for detecting and structuring symbolic command operators.
 *
 * The parser keeps regex-based detection isolated from the unified parser so that
 * the higher-level parsing flow only needs to reason about parsed operator metadata.
 */
export class SymbolicCommandParser {
  private readonly logger: Logger;

  private readonly OPERATOR_PATTERNS = {
    chain: /-->/g,
    /**
     * Enhanced gate pattern supporting named inline gates.
     * Formats supported:
     * - `:: id:"criteria"` - Named gate with colon separator (Group 2=id, 3=text)
     * - `:: "criteria"` - Anonymous inline criteria (Group 4=text)
     * - `:: code-quality` - Canonical gate reference (Group 5=ref)
     * - `= value` - Deprecated syntax (Group 1 detects =)
     *
     * Groups: 1=operator, 2=namedColonId, 3=namedColonText, 4=anonQuoted, 5=canonicalOrUnquoted
     */
    gate: /\s+(::|=)\s*(?:([a-z][a-z0-9_-]*):["']([^"']+)["']|["']([^"']+)["']|([^\s"']+))/gi,
    // Framework pattern: matches @FRAMEWORK at start OR after whitespace
    // Uses non-capturing group for word boundary at start or after space
    framework: /(?:^|\s)@([A-Za-z0-9_-]+)(?=\s|$)/,
    // Style pattern: matches #styleid (e.g., #analytical, #procedural)
    // Must start with letter to avoid matching things like #123
    style: /(?:^|\s)#([A-Za-z][A-Za-z0-9_-]*)(?=\s|$)/,
    parallel: /\s*\+\s*/g,
    conditional: /\s*\?\s*["'](.+?)["']\s*:\s*(?:>>)?\s*([A-Za-z0-9_-]+)/,
  } as const;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  detectOperators(command: string): OperatorDetectionResult {
    const operators: SymbolicOperator[] = [];
    const operatorTypes: string[] = [];

    const frameworkMatch = command.match(this.OPERATOR_PATTERNS.framework);
    if (frameworkMatch) {
      const matchedId = frameworkMatch[1];
      if (matchedId) {
        operatorTypes.push('framework');
        operators.push({
          type: 'framework',
          frameworkId: matchedId,
          normalizedId: matchedId.toUpperCase(),
          temporary: true,
          scopeType: 'execution',
        });
      }
    }

    const styleMatch = command.match(this.OPERATOR_PATTERNS.style);
    if (styleMatch) {
      const matchedId = styleMatch[1];
      if (matchedId) {
        operatorTypes.push('style');
        operators.push({
          type: 'style',
          styleId: matchedId,
          normalizedId: matchedId.toLowerCase(),
          scope: 'execution',
        });
      }
    }

    const chainMatches = command.match(this.OPERATOR_PATTERNS.chain);
    if (chainMatches && chainMatches.length > 0) {
      operatorTypes.push('chain');
      operators.push(this.parseChainOperator(command));
    }

    // Collect ALL gate matches using matchAll() for multiple :: operators
    const gateMatches = [...command.matchAll(this.OPERATOR_PATTERNS.gate)];
    if (gateMatches.length > 0) {
      operatorTypes.push('gate');

      // Track anonymous criteria separately for merging
      const anonymousCriteria: string[] = [];

      for (const match of gateMatches) {
        const operatorToken = match[1];
        const namedColonId = match[2];
        const namedColonText = match[3];
        const anonQuoted = match[4];
        const canonicalOrUnquoted = match[5];

        if (operatorToken === '=') {
          this.logger.warn('[SymbolicParser] Gate operator "=" is deprecated. Use "::" instead.');
        }

        // Named gate with colon syntax: :: id:"criteria"
        if (namedColonId && namedColonText) {
          // Shell verification gate: :: verify:"npm test" [loop:true] [max:N] [timeout:N] [checkpoint:true] [rollback:true]
          if (namedColonId === 'verify') {
            // Parse additional verify options from the remaining command
            const verifyOptions = this.parseVerifyOptions(command, match.index ?? 0);

            operators.push({
              type: 'gate',
              gateId: `shell-verify-${Date.now()}`,
              criteria: `Shell verification: ${namedColonText}`,
              parsedCriteria: [`Shell verification: ${namedColonText}`],
              scope: 'execution',
              retryOnFailure: true,
              maxRetries: 5,
              shellVerify: {
                command: namedColonText,
                timeout: verifyOptions.timeout ?? SHELL_VERIFY_DEFAULT_TIMEOUT,
                loop: verifyOptions.loop,
                maxIterations: verifyOptions.maxIterations,
                checkpoint: verifyOptions.checkpoint,
                rollback: verifyOptions.rollback,
              },
            });
            continue;
          }

          const parsedCriteria = this.parseCriteria(namedColonText);
          operators.push({
            type: 'gate',
            gateId: namedColonId,
            criteria: namedColonText,
            parsedCriteria,
            scope: 'execution',
            retryOnFailure: true,
            maxRetries: 1,
          });
          continue;
        }

        // Anonymous quoted criteria: :: "criteria text"
        if (anonQuoted) {
          anonymousCriteria.push(...this.parseCriteria(anonQuoted));
          continue;
        }

        // Canonical reference or unquoted criteria: :: code-quality
        if (canonicalOrUnquoted) {
          anonymousCriteria.push(...this.parseCriteria(canonicalOrUnquoted));
        }
      }

      // Merge anonymous/canonical criteria into single GateOperator (preserves backward compat)
      if (anonymousCriteria.length > 0) {
        operators.push({
          type: 'gate',
          criteria: anonymousCriteria.join(', '),
          parsedCriteria: anonymousCriteria,
          scope: 'execution',
          retryOnFailure: true,
          maxRetries: 1,
        });
      }
    }

    const parallelMatches = command.match(this.OPERATOR_PATTERNS.parallel);
    if (
      parallelMatches &&
      parallelMatches.length > 0 &&
      !(chainMatches && chainMatches.length > 0)
    ) {
      operatorTypes.push('parallel');
      operators.push(this.parseParallelOperator(command));
    }

    const conditionalMatch = command.match(this.OPERATOR_PATTERNS.conditional);
    if (conditionalMatch) {
      const condition = conditionalMatch[1];
      const rawTrueBranch = conditionalMatch[2];
      if (condition && rawTrueBranch) {
        operatorTypes.push('conditional');

        // Defense-in-depth: Strip optional >> prefix from branch prompts
        // Centralized normalization strips ": >>" patterns, but this handles edge cases
        const trueBranch = rawTrueBranch.replace(/^>>\s*/, '');

        operators.push({
          type: 'conditional',
          condition,
          conditionType: 'presence',
          trueBranch,
        } as const);
      }
    }

    const complexity = this.calculateComplexity(operators);

    return {
      hasOperators: operators.length > 0,
      operatorTypes,
      operators,
      parseComplexity: complexity,
    };
  }

  private parseChainOperator(command: string): ChainOperator {
    // Remove framework operator prefix if present
    let cleanCommand = command.replace(this.OPERATOR_PATTERNS.framework, '');
    cleanCommand = stripStyleOperators(cleanCommand);
    // NOTE: Do NOT strip gate patterns here - they conflict with regular arguments like input="value"
    // Gate operators should be detected and handled separately by the gate operator executor

    this.logger.debug(`[parseChainOperator] Original command: ${command}`);
    this.logger.debug(`[parseChainOperator] Clean command: ${cleanCommand}`);

    // Use argument-aware splitting that respects quoted strings
    const stepStrings = this.splitChainSteps(cleanCommand);

    this.logger.debug(`[parseChainOperator] Split into ${stepStrings.length} steps:`, stepStrings);

    const steps: ChainStep[] = stepStrings.map((stepStr, index) => {
      // Clean operators from individual steps before validation
      // This allows syntax like: @CAGEERF >>step1 --> %lean @ReACT >>step2
      // Note: Operators still apply at execution-level, not per-step
      const cleanedStep = this.cleanStepOperators(stepStr);

      const stepMatch = cleanedStep.match(/^(?:>>)?([A-Za-z0-9_-]+)(?:\s+([\s\S]*))?$/);
      if (!stepMatch) {
        this.logger.error(
          `[parseChainOperator] Failed to match step: "${stepStr}" (cleaned: "${cleanedStep}")`
        );
        throw new ValidationError(`Invalid chain step format: ${stepStr}`);
      }

      const promptId = stepMatch[1];
      if (!promptId) {
        throw new ValidationError(`Invalid chain step format: missing prompt ID in ${stepStr}`);
      }

      this.logger.debug(
        `[parseChainOperator] Step ${index + 1}: promptId="${promptId}", args="${stepMatch[2]?.trim() ?? ''}"`
      );

      return {
        promptId,
        args: stepMatch[2]?.trim() ?? '',
        position: index,
        variableName: `step${index + 1}_result`,
      };
    });

    this.logger.debug(`[parseChainOperator] Final steps array length: ${steps.length}`);

    return {
      type: 'chain',
      steps,
      contextPropagation: 'automatic',
    };
  }

  /**
   * Clean operators from a chain step string before validation.
   * Strips %modifiers and @framework operators that may appear on individual steps.
   * This allows syntax like: %judge @CAGEERF >>step1 --> %lean @ReACT >>step2
   * Note: Operators apply at execution-level, not per-step. This method only
   * removes them for parsing validation purposes.
   */
  private cleanStepOperators(stepStr: string): string {
    let cleaned = stepStr.trim();

    // Strip modifier prefix (e.g., %clean, %judge, %lean, %framework)
    cleaned = cleaned.replace(/^%\s*[a-zA-Z_-]+\s*/, '');

    // Strip framework operator prefix (e.g., @CAGEERF, @ReACT)
    cleaned = cleaned.replace(/^@[A-Za-z0-9_-]+\s+/, '');

    // Strip inline style selector (e.g., #style(analytical))
    cleaned = stripStyleOperators(cleaned);

    return cleaned.trim();
  }

  /**
   * Split chain steps by --> delimiter while respecting quoted string boundaries
   * Handles: >>prompt1 input="test --> quoted" --> prompt2
   */
  private splitChainSteps(command: string): string[] {
    const steps: string[] = [];
    let current = '';
    let inQuotes = false;
    let i = 0;

    while (i < command.length) {
      const char = command[i];
      const next = command[i + 1];
      const next2 = command[i + 2];

      // Toggle quote state (handle escaped quotes)
      if (char === '"' && (i === 0 || command[i - 1] !== '\\')) {
        inQuotes = !inQuotes;
        current += char;
        i++;
        continue;
      }

      // Check for --> delimiter (only outside quotes)
      if (!inQuotes && char === '-' && next === '-' && next2 === '>') {
        if (current.trim()) {
          steps.push(current.trim());
        }
        current = '';
        i += 3; // Skip -->
        continue;
      }

      current += char;
      i++;
    }

    // Add final step
    if (current.trim()) {
      steps.push(current.trim());
    }

    return steps.filter(Boolean);
  }

  private parseParallelOperator(command: string): ParallelOperator {
    // Strip framework operator if present (e.g., "@cageerf >>p1 + >>p2" → ">>p1 + >>p2")
    const cleanCommand = command.replace(/^(?:>>)?\s*@[A-Za-z0-9_-]+\s+/, '');

    const promptStrings = cleanCommand
      .split('+')
      .map((segment) => segment.trim())
      .filter(Boolean);

    const prompts = promptStrings.map((promptStr, index) => {
      // Defense-in-depth: Handle optional >> prefix in parallel prompts
      // Centralized normalization strips "+ >>" patterns, but this handles edge cases
      const promptMatch = promptStr.match(/^(?:>>)?\s*([A-Za-z0-9_-]+)(?:\s+([\s\S]*))?$/);
      if (!promptMatch) {
        throw new ValidationError(`Invalid parallel prompt format: ${promptStr}`);
      }

      const promptId = promptMatch[1];
      if (!promptId) {
        throw new ValidationError(
          `Invalid parallel prompt format: missing prompt ID in ${promptStr}`
        );
      }

      return {
        promptId,
        args: promptMatch[2]?.trim() ?? '',
        position: index,
      };
    });

    return {
      type: 'parallel',
      prompts,
      aggregationStrategy: 'merge',
    };
  }

  private parseCriteria(criteriaString: string): string[] {
    return criteriaString
      .split(/,|and|\||;/i)
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
  }

  /**
   * Parse verify-specific options from command string.
   *
   * Supports:
   * - loop:true/false - Enable Stop hook integration for autonomous loops
   * - max:N - Maximum iterations (default 10)
   * - timeout:N - Timeout in seconds (converted to ms internally)
   * - checkpoint:true/false - Git stash before execution
   * - rollback:true/false - Git restore on failure
   *
   * @example :: verify:"npm test" loop:true max:15 checkpoint:true
   */
  private parseVerifyOptions(
    command: string,
    matchStart: number
  ): {
    loop?: boolean;
    maxIterations?: number;
    timeout?: number;
    checkpoint?: boolean;
    rollback?: boolean;
  } {
    // Get the portion of command after the verify:"..." match
    const afterVerify = command.slice(matchStart);

    // Skip past the verify:"..." part to find trailing options
    const verifyMatch = afterVerify.match(/verify:["'][^"']+["']/i);
    if (!verifyMatch) {
      return {};
    }

    const optionsStart = verifyMatch.index! + verifyMatch[0].length;
    const optionsStr = afterVerify.slice(optionsStart);

    const options: {
      loop?: boolean;
      maxIterations?: number;
      timeout?: number;
      checkpoint?: boolean;
      rollback?: boolean;
    } = {};

    // Parse loop:true/false
    const loopMatch = optionsStr.match(/\bloop:(true|false)\b/i);
    if (loopMatch?.[1]) {
      options.loop = loopMatch[1].toLowerCase() === 'true';
    }

    // Parse max:N (maxIterations)
    const maxMatch = optionsStr.match(/\bmax:(\d+)\b/i);
    if (maxMatch?.[1]) {
      options.maxIterations = parseInt(maxMatch[1], 10);
    }

    // Parse timeout:N (in seconds, convert to ms)
    const timeoutMatch = optionsStr.match(/\btimeout:(\d+)\b/i);
    if (timeoutMatch?.[1]) {
      options.timeout = parseInt(timeoutMatch[1], 10) * 1000; // seconds → ms
    }

    // Parse checkpoint:true/false
    const checkpointMatch = optionsStr.match(/\bcheckpoint:(true|false)\b/i);
    if (checkpointMatch?.[1]) {
      options.checkpoint = checkpointMatch[1].toLowerCase() === 'true';
    }

    // Parse rollback:true/false
    const rollbackMatch = optionsStr.match(/\brollback:(true|false)\b/i);
    if (rollbackMatch?.[1]) {
      options.rollback = rollbackMatch[1].toLowerCase() === 'true';
    }

    if (Object.keys(options).length > 0) {
      this.logger.debug('[SymbolicParser] Parsed verify options:', options);
    }

    return options;
  }

  private calculateComplexity(operators: SymbolicOperator[]): 'simple' | 'moderate' | 'complex' {
    if (operators.length <= 1) {
      return operators.length === 0 ? 'simple' : 'simple';
    }
    if (operators.length === 2) {
      return 'moderate';
    }
    return 'complex';
  }

  generateExecutionPlan(
    detection: OperatorDetectionResult,
    basePromptId: string,
    baseArgs: string
  ): SymbolicExecutionPlan {
    const steps: ExecutionStep[] = [];
    let frameworkOverride: string | undefined;
    let finalValidation: GateOperator | undefined;
    let styleSelection: string | undefined;

    const frameworkOp = detection.operators.find(
      (op): op is FrameworkOperator => op.type === 'framework'
    );
    if (frameworkOp) {
      frameworkOverride = frameworkOp.normalizedId;
    }

    const gateOp = detection.operators.find((op): op is GateOperator => op.type === 'gate');
    if (gateOp) {
      finalValidation = gateOp;
    }

    const styleOp = detection.operators.find((op): op is StyleOperator => op.type === 'style');
    if (styleOp) {
      styleSelection = styleOp.normalizedId;
    }

    const chainOp = detection.operators.find((op): op is ChainOperator => op.type === 'chain');
    if (chainOp) {
      chainOp.steps.forEach((step, index) => {
        steps.push({
          stepNumber: index + 1,
          type: 'prompt',
          promptId: step.promptId,
          args: step.args,
          dependencies: index > 0 ? [index] : [],
          outputVariable: step.variableName,
        });
      });
    } else {
      steps.push({
        stepNumber: 1,
        type: 'prompt',
        promptId: basePromptId,
        args: baseArgs,
        dependencies: [],
        outputVariable: 'result',
      });
    }

    return {
      steps,
      ...(frameworkOverride !== undefined && { frameworkOverride }),
      ...(finalValidation !== undefined && { finalValidation }),
      ...(styleSelection !== undefined && { styleSelection }),
      estimatedComplexity: detection.operators.length,
      requiresSessionState: steps.length > 1,
    };
  }

  buildParseResult(
    command: string,
    operators: OperatorDetectionResult,
    basePromptId: string,
    baseArgs: string
  ): SymbolicCommandParseResult {
    const executionPlan = this.generateExecutionPlan(operators, basePromptId, baseArgs);

    return {
      promptId: basePromptId,
      rawArgs: baseArgs,
      format: 'symbolic',
      confidence: 0.95,
      operators,
      executionPlan,
      metadata: {
        originalCommand: command,
        parseStrategy: 'symbolic',
        detectedFormat: `Symbolic (${operators.operatorTypes.join(', ')})`,
        warnings: [],
      },
    };
  }
}

export function createSymbolicCommandParser(logger: Logger): SymbolicCommandParser {
  return new SymbolicCommandParser(logger);
}
