// @lifecycle canonical - Parses symbolic command expressions into operators.
import { OPERATOR_PATTERNS } from './operator-patterns.js';
import {
  stripStyleOperators,
  findFrameworkOperatorOutsideQuotes,
  isPositionInsideQuotes,
} from './parser-utils.js';
import {
  type ChainOperator,
  type ChainStep,
  type ExecutionStep,
  type FrameworkOperator,
  type GateOperator,
  type OperatorDetectionResult,
  type ParallelOperator,
  type RepetitionOperator,
  type StyleOperator,
  type SymbolicCommandParseResult,
  type SymbolicExecutionPlan,
  type SymbolicOperator,
} from './types/operator-types.js';
import { SHELL_VERIFY_DEFAULT_TIMEOUT } from '../../gates/constants.js';

import { Logger } from '#infra/logging/index.js';
import { ValidationError } from '#shared/utils/index.js';
import { mintSequentialIds } from '#shared/utils/node-order.js';

/**
 * Parser responsible for detecting and structuring symbolic command operators.
 *
 * The parser keeps regex-based detection isolated from the unified parser so that
 * the higher-level parsing flow only needs to reason about parsed operator metadata.
 */
export class SymbolicCommandParser {
  private readonly logger: Logger;
  /**
   * Set of registered framework IDs (normalized to uppercase).
   * Used to validate @framework operators - unregistered IDs are skipped.
   */
  private readonly registeredFrameworkIds: Set<string>;

  /**
   * Operator patterns derived from SSOT registry.
   * Pattern documentation and examples: see mcp-contracts/schemas/operators.json
   *
   * Gate pattern groups: 1=operator, 2=namedColonId, 3=namedColonText, 4=anonQuoted, 5=canonicalOrUnquoted
   */
  private readonly OPERATOR_REGEX = {
    chain: OPERATOR_PATTERNS.chain.pattern,
    gate: OPERATOR_PATTERNS.gate.pattern,
    framework: OPERATOR_PATTERNS.framework.pattern,
    style: OPERATOR_PATTERNS.style.pattern,
    repetition: OPERATOR_PATTERNS.repetition.pattern,
    parallel: OPERATOR_PATTERNS.parallel.pattern,
    conditional: OPERATOR_PATTERNS.conditional.pattern,
  } as const;

  /**
   * @param logger - Logger instance
   * @param registeredFrameworkIds - Optional set of registered framework IDs (uppercase).
   *   When provided, only @framework operators matching registered IDs are detected.
   *   Unregistered @word patterns are silently skipped (treated as literal text).
   */
  constructor(logger: Logger, registeredFrameworkIds?: Set<string>) {
    this.logger = logger;
    this.registeredFrameworkIds = registeredFrameworkIds ?? new Set();
  }

  /**
   * Preprocess command to expand repetition operator.
   * Call this before strategy selection so all strategies see the expanded form.
   *
   * @example ">>prompt *3" → ">>prompt --> >>prompt --> >>prompt"
   */
  preprocessRepetition(command: string): string {
    return this.expandRepetition(command).expandedCommand;
  }

  /**
   * Expand repetition operator into chain syntax.
   *
   * Transforms `>>prompt * 3` into `>>prompt --> >>prompt --> >>prompt`
   * before other operator detection runs.
   *
   * Handles combinations like:
   * - `>>prompt * 3` → `>>prompt --> >>prompt --> >>prompt`
   * - `>>prompt topic:"AI" * 2` → `>>prompt topic:"AI" --> >>prompt topic:"AI"`
   * - `>>step1 * 2 --> >>step2` → `>>step1 --> >>step1 --> >>step2`
   *
   * @returns Object with expandedCommand and optional RepetitionOperator
   */
  private expandRepetition(command: string): {
    expandedCommand: string;
    repetitionOp: RepetitionOperator | null;
  } {
    const match = command.match(this.OPERATOR_REGEX.repetition);
    const countStr = match?.[1];
    if (match === null || countStr === undefined) {
      return { expandedCommand: command, repetitionOp: null };
    }

    const count = parseInt(countStr, 10);
    if (count < 1 || isNaN(count)) {
      throw new ValidationError('Repetition count must be at least 1');
    }

    this.logger.debug(`[expandRepetition] Detected * ${count} in: ${command}`);

    // Find the segment to repeat (everything before * N, after last -->)
    const matchIndex = match.index ?? 0;
    const beforeRepetition = command.slice(0, matchIndex);
    const afterRepetition = command.slice(matchIndex + match[0].length);

    // Split by --> to find the last segment to repeat
    // Handle: ">>step1 --> >>step2 * 3" → repeat step2
    // Handle: ">>prompt * 3 --> >>final" → repeat prompt, then final
    // Handle: ">>prompt * 3 arg:'x'" → repeat prompt with args
    const segments = this.splitByChainDelimiter(beforeRepetition);
    let segmentToRepeat = segments.pop() ?? beforeRepetition;
    const precedingSegments = segments;

    // Check if afterRepetition contains arguments to attach to the repeated segment
    // Arguments pattern: key:"value" or key:'value' (not starting with --> or >>)
    const trimmedAfter = afterRepetition.trim();
    let chainContinuation = '';

    if (trimmedAfter !== '') {
      // Pattern for arguments: starts with identifier followed by colon and quoted value
      const argPattern = /^[a-zA-Z_][a-zA-Z0-9_]*:["'][^"']*["']/;

      if (argPattern.test(trimmedAfter)) {
        // afterRepetition starts with arguments - attach them to each repeated segment
        // Find where chain operators start (if any): look for --> not inside quotes
        const chainStart = this.findChainDelimiterOutsideQuotes(trimmedAfter);

        if (chainStart === -1) {
          // All arguments, no chain continuation
          segmentToRepeat = segmentToRepeat.trim() + ' ' + trimmedAfter;
        } else {
          // Arguments before -->, chain after
          const args = trimmedAfter.slice(0, chainStart).trim();
          chainContinuation = trimmedAfter.slice(chainStart).trim();
          segmentToRepeat = segmentToRepeat.trim() + ' ' + args;
        }
      } else if (trimmedAfter.startsWith('-->')) {
        // Chain continuation (e.g., "* 3 --> >>final")
        chainContinuation = trimmedAfter;
      } else {
        // Legacy: treat as chain step (e.g., bare prompt name)
        chainContinuation = '--> ' + trimmedAfter;
      }
    }

    this.logger.debug(`[expandRepetition] Segment to repeat: "${segmentToRepeat}"`);

    // Build expanded command
    const repeatedSegments = Array(count).fill(segmentToRepeat.trim());
    const expandedRepetition = repeatedSegments.join(' --> ');

    // Reconstruct: preceding --> repeated --> chainContinuation
    let expandedCommand = '';
    if (precedingSegments.length > 0) {
      expandedCommand = precedingSegments.join(' --> ') + ' --> ';
    }
    expandedCommand += expandedRepetition;
    if (chainContinuation !== '') {
      expandedCommand += ' ' + chainContinuation;
    }

    this.logger.debug(`[expandRepetition] Expanded to: ${expandedCommand}`);

    return {
      expandedCommand,
      repetitionOp: { type: 'repetition', count },
    };
  }

  /**
   * Split command by --> delimiter while respecting quoted strings.
   * Used for repetition expansion to find the segment to repeat.
   */
  private splitByChainDelimiter(command: string): string[] {
    const segments: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < command.length; i++) {
      const char = command[i];

      // Toggle quote state
      if (char === '"' && (i === 0 || command[i - 1] !== '\\')) {
        inQuotes = !inQuotes;
        current += char;
        continue;
      }

      // Check for --> outside quotes
      if (!inQuotes && command.slice(i, i + 3) === '-->') {
        if (current.trim()) {
          segments.push(current.trim());
        }
        current = '';
        i += 2; // Skip past -->
        continue;
      }

      current += char;
    }

    if (current.trim()) {
      segments.push(current.trim());
    }

    return segments;
  }

  /**
   * Find the position of --> delimiter outside of quoted strings.
   * Returns -1 if no delimiter found outside quotes.
   * Used to separate arguments from chain continuation in repetition expansion.
   */
  private findChainDelimiterOutsideQuotes(str: string): number {
    let inQuotes = false;
    let quoteChar = '';

    for (let i = 0; i < str.length; i++) {
      const char = str[i];

      // Toggle quote state (handle both ' and ")
      if ((char === '"' || char === "'") && (i === 0 || str[i - 1] !== '\\')) {
        if (!inQuotes) {
          inQuotes = true;
          quoteChar = char;
        } else if (char === quoteChar) {
          inQuotes = false;
          quoteChar = '';
        }
        continue;
      }

      // Check for --> outside quotes
      if (!inQuotes && str.slice(i, i + 3) === '-->') {
        return i;
      }
    }

    return -1;
  }

  detectOperators(command: string): OperatorDetectionResult {
    const operators: SymbolicOperator[] = [];
    const operatorTypes: string[] = [];

    // Expand repetition BEFORE other detection (transforms * N to chain syntax)
    const { expandedCommand, repetitionOp } = this.expandRepetition(command);
    if (repetitionOp) {
      operatorTypes.push('repetition');
      operators.push(repetitionOp);
      command = expandedCommand;
    }

    // Use quote-aware framework detection to avoid matching @word inside quoted strings
    const frameworkResult = findFrameworkOperatorOutsideQuotes(command);
    if (frameworkResult) {
      const normalizedId = frameworkResult.frameworkId.toUpperCase();

      // Only treat as framework operator if it's a registered framework
      // This allows @docs/, @mention, etc. to pass through as literal text
      if (this.registeredFrameworkIds.size === 0 || this.registeredFrameworkIds.has(normalizedId)) {
        operatorTypes.push('framework');
        operators.push({
          type: 'framework',
          frameworkId: frameworkResult.frameworkId,
          normalizedId,
          temporary: true,
          scopeType: 'execution',
        });
      } else {
        this.logger.debug(
          `[detectOperators] Skipping unregistered framework operator: @${frameworkResult.frameworkId}`
        );
      }
    }

    const styleMatch = command.match(this.OPERATOR_REGEX.style);
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

    const chainMatches = command.match(this.OPERATOR_REGEX.chain);
    const delegationMatches = command.match(/==>/g);
    if (
      (chainMatches != null && chainMatches.length > 0) ||
      (delegationMatches != null && delegationMatches.length > 0)
    ) {
      operatorTypes.push('chain');
      operators.push(this.parseChainOperator(command));
    }

    // Collect ALL gate matches using matchAll() for multiple :: operators
    const gateMatches = [...command.matchAll(this.OPERATOR_REGEX.gate)];
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
          // Shell verification gate: :: verify:"npm test" [:fast|:full|:extended] [loop:true] [max:N] [timeout:N]
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
                // Left UNDEFINED when the user gave no explicit `timeout:N`, exactly as
                // `maxIterations` already is. Defaulting it here made the preset timeouts dead
                // code: `setupShellVerification` resolves `config.timeout ?? preset.timeout`, so a
                // non-null default upstream always won and `:fast` ran with 300s instead of the 30s
                // the README claims. `maxIterations` was left undefined and therefore worked —
                // that asymmetry is what hid this. The default now lives at the single place that
                // resolves presets (measured 2026-08-11, plan row 0.5.22).
                ...(verifyOptions.timeout != null ? { timeout: verifyOptions.timeout } : {}),
                loop: verifyOptions.loop,
                maxIterations: verifyOptions.maxIterations,
                preset: verifyOptions.preset,
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

    const parallelMatches = command.match(this.OPERATOR_REGEX.parallel);
    if (
      parallelMatches &&
      parallelMatches.length > 0 &&
      !(chainMatches && chainMatches.length > 0)
    ) {
      operatorTypes.push('parallel');
      operators.push(this.parseParallelOperator(command));
    }

    const conditionalMatch = command.match(this.OPERATOR_REGEX.conditional);
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
    let cleanCommand = command.replace(this.OPERATOR_REGEX.framework, '');
    cleanCommand = stripStyleOperators(cleanCommand);
    // NOTE: Only `::`-form gate tokens are stripped, and only per-segment (see
    // extractInlineGateTokens below). The deprecated `=` form is deliberately left in the
    // segment text — it is indistinguishable from a regular argument like input = "value",
    // which is why gate stripping was historically skipped here entirely.

    this.logger.debug(`[parseChainOperator] Original command: ${command}`);
    this.logger.debug(`[parseChainOperator] Clean command: ${cleanCommand}`);

    // Use argument-aware splitting that respects quoted strings and detects ==> delegation
    const splitResults = this.splitChainSteps(cleanCommand);

    this.logger.debug(
      `[parseChainOperator] Split into ${splitResults.length} steps:`,
      splitResults.map((r) => `${r.delegated ? '==> ' : ''}${r.text}`)
    );

    const steps: ChainStep[] = splitResults.map((result, index) => {
      // Clean operators from individual steps before validation
      // This allows syntax like: @CAGEERF >>step1 --> %lean @ReACT >>step2
      // Note: Operators still apply at execution-level, not per-step
      const cleanedStep = this.cleanStepOperators(result.text);

      // S9: pull `::`-form gate tokens out of THIS segment before the promptId/args regex
      // runs, so a token like `:: code-quality` neither pollutes the step's positional args
      // nor evaporates — anonymous/canonical criteria attach to this step.
      const { text: gateFreeStep, criteria: stepGateCriteria } =
        this.extractInlineGateTokens(cleanedStep);

      const stepMatch = gateFreeStep.match(/^(?:>>)?([A-Za-z0-9_-]+)(?:\s+([\s\S]*))?$/);
      if (!stepMatch) {
        this.logger.error(
          `[parseChainOperator] Failed to match step: "${result.text}" (cleaned: "${gateFreeStep}")`
        );
        throw new ValidationError(`Invalid chain step format: ${result.text}`);
      }

      const promptId = stepMatch[1];
      if (!promptId) {
        throw new ValidationError(`Invalid chain step format: missing prompt ID in ${result.text}`);
      }

      this.logger.debug(
        `[parseChainOperator] Step ${index + 1}: promptId="${promptId}", args="${stepMatch[2]?.trim() ?? ''}"${result.delegated ? ' [DELEGATED]' : ''}`
      );

      return {
        promptId,
        args: stepMatch[2]?.trim() ?? '',
        position: index,
        variableName: `step${index + 1}_result`,
        ...(result.delegated === true ? { delegated: true } : {}),
        ...(stepGateCriteria.length > 0 ? { inlineGateCriteria: stepGateCriteria } : {}),
      };
    });

    this.logger.debug(
      `[parseChainOperator] Final steps array length: ${steps.length}${steps.some((s) => s.delegated === true) ? ' (has delegation)' : ''}`
    );

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
   * Extract `::`-form inline gate tokens from a single chain-step segment (S9).
   *
   * Strips every matched token from the segment text so it cannot pollute the step's
   * positional args. Anonymous quoted (`:: "criteria text"`) and canonical/unquoted
   * (`:: code-quality`) forms return their parsed criteria so the step itself carries
   * them; named forms (`:: id:"criteria"`, including `verify:`) are stripped only —
   * named-gate registration stays on the existing global namedInlineGates path.
   *
   * Deliberately matches ONLY the `::` operator token. The deprecated `=` form is left
   * untouched because it is indistinguishable from a regular `key = "value"` argument —
   * the reason gate stripping was historically skipped in parseChainOperator entirely.
   * Quote-aware: tokens inside quoted argument values are never matched.
   */
  private extractInlineGateTokens(segment: string): { text: string; criteria: string[] } {
    const criteria: string[] = [];
    const removals: Array<{ start: number; end: number }> = [];

    for (const match of segment.matchAll(this.OPERATOR_REGEX.gate)) {
      const index = match.index;
      if (match[1] !== '::') {
        continue; // never touch the deprecated `=` form
      }
      if (isPositionInsideQuotes(segment, index)) {
        continue;
      }

      const namedColonId = match[2];
      const namedColonText = match[3];
      const anonQuoted = match[4];
      const canonicalOrUnquoted = match[5];

      if (namedColonId != null && namedColonText != null) {
        // Named gate: strip the token; registration stays global.
        removals.push({ start: index, end: index + match[0].length });
        continue;
      }
      if (anonQuoted != null) {
        criteria.push(...this.parseCriteria(anonQuoted));
        removals.push({ start: index, end: index + match[0].length });
        continue;
      }
      if (canonicalOrUnquoted != null) {
        criteria.push(...this.parseCriteria(canonicalOrUnquoted));
        removals.push({ start: index, end: index + match[0].length });
      }
    }

    if (removals.length === 0) {
      return { text: segment, criteria };
    }

    let text = '';
    let cursor = 0;
    for (const { start, end } of removals) {
      text += segment.slice(cursor, start);
      cursor = end;
    }
    text += segment.slice(cursor);

    return { text: text.trim(), criteria };
  }

  /**
   * Split chain steps by --> and ==> delimiters while respecting quoted string boundaries.
   * Returns metadata about which delimiter preceded each step.
   *
   * - `-->` produces a normal step (delegated: false)
   * - `==>` produces a delegated step (delegated: true) — executed via Task tool sub-agent
   *
   * Handles: >>prompt1 input="test --> quoted" --> prompt2 ==> prompt3
   */
  private splitChainSteps(command: string): { text: string; delegated: boolean }[] {
    const steps: { text: string; delegated: boolean }[] = [];
    let current = '';
    let inQuotes = false;
    let nextDelegated = false;
    let i = 0;

    while (i < command.length) {
      const char = command[i];

      // Toggle quote state (handle escaped quotes)
      if (char === '"' && (i === 0 || command[i - 1] !== '\\')) {
        inQuotes = !inQuotes;
        current += char;
        i++;
        continue;
      }

      // Check for chain delimiters outside quotes
      if (!inQuotes) {
        const delimiter = this.detectChainDelimiter(command, i);
        if (delimiter != null) {
          if (current.trim().length > 0) {
            steps.push({ text: current.trim(), delegated: nextDelegated });
          }
          nextDelegated = delimiter === 'delegation';
          current = '';
          i += 3;
          continue;
        }
      }

      current += char;
      i++;
    }

    // Add final step
    if (current.trim().length > 0) {
      steps.push({ text: current.trim(), delegated: nextDelegated });
    }

    return steps.filter((s) => s.text.length > 0);
  }

  /**
   * Detect a chain delimiter at position i in the command string.
   * Returns 'delegation' for ==>, 'chain' for -->, or null if no delimiter.
   * Checks ==> before --> to prevent gate operator pattern conflict.
   */
  private detectChainDelimiter(command: string, i: number): 'delegation' | 'chain' | null {
    const c0 = command[i];
    const c1 = command[i + 1];
    const c2 = command[i + 2];
    if (c0 === '=' && c1 === '=' && c2 === '>') return 'delegation';
    if (c0 === '-' && c1 === '-' && c2 === '>') return 'chain';
    return null;
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
   * Options:
   * - loop:true/false - Enable Stop hook integration for autonomous loops
   * - max:N - Maximum iterations (default 5)
   * - timeout:N - Timeout in seconds (converted to ms internally)
   *
   * Presets (shorthand for common configurations):
   * - :fast     → max:1, timeout:30   (quick feedback during development)
   * - :full     → max:5, timeout:300  (CI-style validation)
   * - :extended → max:10, timeout:600 (long-running test suites)
   *
   * @example :: verify:"npm test" :fast
   * @example :: verify:"npm test" max:3 timeout:60
   * @example :: verify:"npm test" loop:true :full
   */
  private parseVerifyOptions(
    command: string,
    matchStart: number
  ): {
    loop?: boolean;
    maxIterations?: number;
    timeout?: number;
    preset?: 'fast' | 'full' | 'extended';
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
      preset?: 'fast' | 'full' | 'extended';
    } = {};

    // Parse presets (:fast, :full, :extended)
    const presetMatch = optionsStr.match(/:(fast|full|extended)\b/i);
    if (presetMatch?.[1]) {
      options.preset = presetMatch[1].toLowerCase() as 'fast' | 'full' | 'extended';
    }

    // Parse loop:true/false
    const loopMatch = optionsStr.match(/\bloop:(true|false)\b/i);
    if (loopMatch?.[1]) {
      options.loop = loopMatch[1].toLowerCase() === 'true';
    }

    // Parse max:N (maxIterations) - explicit value overrides preset
    const maxMatch = optionsStr.match(/\bmax:(\d+)\b/i);
    if (maxMatch?.[1]) {
      options.maxIterations = parseInt(maxMatch[1], 10);
    }

    // Parse timeout:N (in seconds, convert to ms) - explicit value overrides preset
    const timeoutMatch = optionsStr.match(/\btimeout:(\d+)\b/i);
    if (timeoutMatch?.[1]) {
      options.timeout = parseInt(timeoutMatch[1], 10) * 1000; // seconds → ms
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
      // Frozen at mint — symbolic chains have no stable step names, so `n1..nK` (positional at
      // mint time) is the only available identity source. Never re-minted after creation.
      const nodeIds = mintSequentialIds(chainOp.steps.length);
      chainOp.steps.forEach((step, index) => {
        steps.push({
          stepNumber: index + 1,
          nodeId: nodeIds[index],
          type: 'prompt',
          promptId: step.promptId,
          args: step.args,
          dependencies: index > 0 ? [index] : [],
          outputVariable: step.variableName,
          ...(step.delegated === true ? { delegated: true } : {}),
          ...(step.inlineGateCriteria != null && step.inlineGateCriteria.length > 0
            ? { inlineGateCriteria: step.inlineGateCriteria }
            : {}),
        });
      });
    } else {
      const [nodeId] = mintSequentialIds(1);
      steps.push({
        stepNumber: 1,
        nodeId,
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

export function createSymbolicCommandParser(
  logger: Logger,
  registeredFrameworkIds?: Set<string>
): SymbolicCommandParser {
  return new SymbolicCommandParser(logger, registeredFrameworkIds);
}
