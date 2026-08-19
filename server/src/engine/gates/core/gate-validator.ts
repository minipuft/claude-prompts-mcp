// @lifecycle canonical - Validates gate definitions before execution.
/**
 * Core Gate Validator
 *
 * Provides the validation infrastructure for gate-based quality control.
 *
 * DESIGN DECISION: String-based validation removed
 * ------------------------------------------------
 * Naive checks like length validation, substring matching, and regex patterns
 * have been intentionally removed. These don't provide meaningful signal for
 * LLM-generated content - an output can pass all string checks while being
 * semantically incorrect, or fail them while being excellent.
 *
 * Model-graded evaluation of gate content is delivered by the `%judge` modifier
 * (`src/engine/gates/judge/`), which routes a verdict back through `gate_verdict`.
 * This validator owns the deterministic criteria types only.
 *
 * What's preserved:
 * - Validation framework and gate loading
 * - Statistics tracking
 * - `llm_self_check` acceptance (reserved type, unconditional skip — see runLLMSelfCheck)
 * - Retry hint GENERATION — hints ship inside each failing `ValidationResult`. The public
 *   `shouldRetry` re-entry API is gone; it had no callers, and the decision of whether to retry
 *   belongs to the caller holding the attempt count, not to the validator.
 */

import { getShellPreset } from '../config/index.js';
import { getDefaultShellVerifyExecutor } from '../shell/shell-verify-executor.js';

import type { ScriptExecutionResult, ScriptExecutorPort } from '#shared/types/index.js';
import type { GateDefinitionProvider } from './gate-loader.js';
import type { ScriptLoader } from '../../execution/reference/script-reference-resolver.js';
import type { ValidationResult } from '../../execution/types.js';
import type { ShellVerifyGate } from '../shell/types.js';
import type {
  LightweightGateDefinition,
  ValidationCheck,
  ValidationContext,
  GatePassCriteria,
} from '../types.js';

import { Logger } from '#infra/logging/index.js';

/**
 * Gate validation statistics
 */
export interface GateValidationStatistics {
  totalValidations: number;
  successfulValidations: number;
  failedValidations: number;
  averageValidationTime: number;
}

/**
 * What a `script_tool` gate needs in order to run a registered tool rather than
 * a shell string: the same registry and executor the inline `{{script:id}}` path
 * already uses. Both are injected as ports because `engine/` may not
 * value-import `modules/`.
 */
export interface ScriptToolRuntime {
  loader: ScriptLoader;
  executor: ScriptExecutorPort;
}

/**
 * Read lazily, not captured. The workspace loader is rebuilt whenever prompts
 * reload, and holding the instance from construction time would serve tool
 * definitions from before the last refresh.
 */
export type ScriptToolRuntimeProvider = () => ScriptToolRuntime | undefined;

/**
 * Core gate validator with pass/fail logic
 */
export class GateValidator {
  private logger: Logger;
  private gateLoader: GateDefinitionProvider;
  private scriptToolRuntime: ScriptToolRuntimeProvider | undefined;
  private validationStats: GateValidationStatistics = {
    totalValidations: 0,
    successfulValidations: 0,
    failedValidations: 0,
    averageValidationTime: 0,
  };
  private validationTimes: number[] = [];

  constructor(
    logger: Logger,
    gateLoader: GateDefinitionProvider,
    scriptToolRuntime?: ScriptToolRuntimeProvider
  ) {
    this.logger = logger;
    this.gateLoader = gateLoader;
    this.scriptToolRuntime = scriptToolRuntime;
  }

  /**
   * Validate content against a gate
   */
  async validateGate(gateId: string, context: ValidationContext): Promise<ValidationResult | null> {
    const startTime = Date.now();

    try {
      const gate = await this.gateLoader.loadGate(gateId);
      if (gate === null) {
        this.logger.warn(`Gate not found for validation: ${gateId}`);
        return null;
      }

      if (gate.type !== 'validation') {
        this.logger.debug(`Gate ${gateId} is guidance-only, skipping validation`);
        return {
          valid: true,
          passed: true,
          gateId,
          checks: [],
          retryHints: [],
          metadata: {
            validationTime: Date.now() - startTime,
            checksPerformed: 0,
            llmValidationUsed: false,
          },
        };
      }

      this.logger.debug(`Validating content against gate: ${gateId}`);

      // Run validation checks
      const checks: ValidationCheck[] = [];
      let llmValidationUsed = false;

      if (gate.pass_criteria) {
        for (const criteria of gate.pass_criteria) {
          const check = await this.runValidationCheck(criteria, context);
          checks.push(check);

          if (criteria.type === 'llm_self_check') {
            llmValidationUsed = true;
          }
        }
      }

      // Determine overall pass/fail
      const passed = checks.length === 0 || checks.every((check) => check.passed);

      // Generate retry hints for failures
      const retryHints = passed ? [] : this.generateRetryHints(gate, checks);

      const result: ValidationResult = {
        valid: passed,
        passed,
        gateId,
        checks,
        retryHints,
        metadata: {
          validationTime: Date.now() - startTime,
          checksPerformed: checks.length,
          llmValidationUsed,
        },
      };

      this.logger.debug(
        `Gate validation complete: ${gateId} - ${passed ? 'PASSED' : 'FAILED'} (${checks.length} checks)`
      );

      return result;
    } catch (error) {
      this.logger.error(`Gate validation failed for ${gateId}:`, error);
      return {
        valid: false,
        passed: false,
        gateId,
        checks: [
          {
            type: 'system_error',
            passed: false,
            message: `Validation error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        retryHints: [`Gate validation encountered an error. Please try again.`],
        metadata: {
          validationTime: Date.now() - startTime,
          checksPerformed: 0,
          llmValidationUsed: false,
        },
      };
    }
  }

  /**
   * Validate content against multiple gates
   */
  async validateGates(gateIds: string[], context: ValidationContext): Promise<ValidationResult[]> {
    const startTime = Date.now();
    const results: ValidationResult[] = [];

    for (const gateId of gateIds) {
      const result = await this.validateGate(gateId, context);
      if (result) {
        results.push(result);

        // Update statistics based on result
        if (result.passed) {
          this.validationStats.successfulValidations++;
        } else {
          this.validationStats.failedValidations++;
        }
      }
    }

    // Update overall statistics
    const executionTime = Date.now() - startTime;
    this.validationTimes.push(executionTime);
    this.validationStats.totalValidations++;
    this.updateAverageValidationTime();

    return results;
  }

  /**
   * Run a single validation check
   *
   * NOTE: `inline_guidance` criteria are intentionally not validated here.
   * They render as agent-facing guidance text (self-assessment checklists)
   * rather than enforcing patterns against output — naive string-based checks
   * (length validation, substring matching, regex patterns) don't provide
   * meaningful signal for LLM-generated content.
   *
   * The validations this class actually performs are:
   * - Shell verification (shell_verify) - ground truth via exit codes
   * - Script tool verification (script_tool) - structured JSON pass/fail
   * - Framework phase guards - section presence + min_length
   *   + forbidden_terms per active framework's phases.yaml
   *
   * `llm_self_check` is accepted but reserved — it has no runner and always skips. Model-graded
   * evaluation lives outside this class, in the `%judge` path.
   */
  private async runValidationCheck(
    criteria: GatePassCriteria,
    _context: ValidationContext
  ): Promise<ValidationCheck> {
    try {
      // Shell verification provides ground-truth validation via exit codes
      if (criteria.type === 'shell_verify') {
        return await this.runShellVerify(criteria);
      }

      // Script tool verification provides structured JSON pass/fail
      if (criteria.type === 'script_tool') {
        return await this.runScriptToolVerify(criteria);
      }

      // LLM self-check provides semantic validation for LLM content
      if (criteria.type === 'llm_self_check') {
        return await this.runLLMSelfCheck(criteria);
      }

      // Other check types auto-pass with explanation
      // These were removed because string-based checks don't validate LLM output quality
      this.logger.debug(
        `[GATE VALIDATOR] Check type '${criteria.type}' auto-passed (string-based validation removed)`
      );

      return {
        type: criteria.type,
        passed: true,
        score: 1.0,
        message: `Check type '${criteria.type}' skipped - string-based validation removed (use shell_verify for ground truth, or the %judge modifier for model-graded review)`,
        details: {
          skipped: true,
          reason:
            'String-based checks removed as they do not provide meaningful signal for LLM content',
          // Deliberately does not name `llm_self_check`: it is reserved with no runner, so
          // recommending it would send a reader to a type that skips exactly like this one.
          recommendation:
            'Use shell_verify or script_tool for ground truth, or the %judge modifier for model-graded review',
        },
      };
    } catch (error) {
      this.logger.error(`Validation check failed for ${criteria.type}:`, error);
      return {
        type: criteria.type,
        passed: false,
        message: `Check failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Run shell verification - ground-truth validation via exit codes.
   *
   * Unlike LLM self-evaluation, shell verification provides deterministic
   * pass/fail results based on actual command execution (test suites, linters, etc.)
   *
   * @param criteria - Shell verification criteria from gate definition
   * @returns Validation check result with exit code details
   */
  private async runShellVerify(criteria: GatePassCriteria): Promise<ValidationCheck> {
    const command = criteria.shell_command;

    if (command == null || command.trim() === '') {
      this.logger.warn('[SHELL GATE] Shell verification skipped - no command specified');
      return {
        type: 'shell_verify',
        passed: true, // Auto-pass when misconfigured (non-blocking)
        score: 1.0,
        message: 'Shell verification skipped (no shell_command specified in gate definition)',
        details: {
          skipped: true,
          reason: 'No shell_command provided in pass_criteria',
          recommendation: 'Add shell_command field to the shell_verify criteria',
        },
      };
    }

    // Resolve preset values if specified (loaded from YAML config)
    const presetValues =
      criteria.shell_preset != null ? getShellPreset(criteria.shell_preset) : undefined;

    // Build shell verification gate config
    const gateConfig: ShellVerifyGate = {
      command,
      timeout: criteria.shell_timeout ?? presetValues?.timeout,
      workingDir: criteria.shell_working_dir,
      env: criteria.shell_env,
      maxIterations: criteria.shell_max_attempts ?? presetValues?.maxIterations,
      preset: criteria.shell_preset,
    };

    this.logger.debug(`[SHELL GATE] Executing shell verification: ${command}`);

    try {
      const executor = getDefaultShellVerifyExecutor();
      const result = await executor.execute(gateConfig);

      if (result.passed) {
        this.logger.debug(`[SHELL GATE] Verification passed (exit code ${result.exitCode})`);
        return {
          type: 'shell_verify',
          passed: true,
          score: 1.0,
          message: `Shell verification passed: '${command}' exited with code ${result.exitCode}`,
          details: {
            exitCode: result.exitCode,
            durationMs: result.durationMs,
            stdout:
              result.stdout.slice(0, 500) !== '' ? result.stdout.slice(0, 500) : '(no output)',
          },
        };
      } else {
        this.logger.debug(`[SHELL GATE] Verification failed (exit code ${result.exitCode})`);
        return {
          type: 'shell_verify',
          passed: false,
          score: 0,
          message: `Shell verification failed: '${command}' exited with code ${result.exitCode}`,
          details: {
            exitCode: result.exitCode,
            durationMs: result.durationMs,
            stderr:
              result.stderr.slice(0, 1000) !== ''
                ? result.stderr.slice(0, 1000)
                : result.stdout.slice(0, 1000) !== ''
                  ? result.stdout.slice(0, 1000)
                  : '(no output)',
            timedOut: result.timedOut,
          },
        };
      }
    } catch (error) {
      this.logger.error(`[SHELL GATE] Shell verification error:`, error);
      return {
        type: 'shell_verify',
        passed: false,
        score: 0,
        message: `Shell verification error: ${error instanceof Error ? error.message : String(error)}`,
        details: {
          error: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  /**
   * Run script tool verification — structured JSON pass/fail.
   *
   * Unlike shell_verify (binary exit code), script_tool returns structured output:
   * { passed: boolean, reason?: string, details?: Record<string, unknown> }
   *
   * This enables richer gate feedback — the script can explain WHY it passed or failed,
   * and provide structured details for the LLM to act on during bounce-back.
   */
  private async runScriptToolVerify(criteria: GatePassCriteria): Promise<ValidationCheck> {
    const toolId = criteria.script_tool_id;

    if (toolId == null || toolId.trim() === '') {
      return this.unrunnableScriptTool(
        undefined,
        'no script_tool_id specified in the script_tool criteria'
      );
    }

    const runtime = this.scriptToolRuntime?.();
    if (runtime === undefined) {
      return this.unrunnableScriptTool(
        toolId,
        'no script tool registry is wired into this validator'
      );
    }

    const tool = runtime.loader.loadScript(toolId);
    if (tool === undefined) {
      return this.unrunnableScriptTool(
        toolId,
        `no registered script tool has that id. script_tool_id names a tool, not a shell command`
      );
    }

    // A gate runs on the server's initiative, so there is no invocation through
    // which a caller could name the tool and approve it. Same rule the inline
    // `{{script:id}}` path enforces, and the same default: an unset `confirm`
    // means true.
    if (tool.execution?.confirm !== false) {
      return this.unrunnableScriptTool(
        toolId,
        'the tool requires confirmation, which a gate has no channel to obtain'
      );
    }

    this.logger.debug(`[SCRIPT GATE] Executing script tool verification: ${toolId}`);

    try {
      const result = await runtime.executor.execute(
        {
          toolId,
          promptId: tool.promptId,
          inputs: criteria.script_tool_input ?? {},
          ...(criteria.script_tool_timeout != null
            ? { timeout: criteria.script_tool_timeout }
            : {}),
        },
        // `script_tool_working_dir` stays relative to the tool's own directory,
        // matching `tool.workingDir`, so a gate cannot relocate a tool outside
        // the directory that registered it.
        criteria.script_tool_working_dir != null
          ? { ...tool, workingDir: criteria.script_tool_working_dir }
          : tool
      );

      return this.scriptToolCheck(toolId, result);
    } catch (error) {
      this.logger.error(`[SCRIPT GATE] Script tool verification error:`, error);
      return {
        type: 'script_tool',
        passed: false,
        score: 0,
        message: `Script tool error: ${error instanceof Error ? error.message : String(error)}`,
        details: {
          toolId,
          error: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  /**
   * Read a structured verdict out of a completed script-tool run.
   *
   * The script owns the verdict: `{ passed, reason?, details? }`. A run that
   * failed to produce one is a failed check, not a passed one — the same
   * reading as an unrunnable tool, one step later.
   */
  private scriptToolCheck(toolId: string, result: ScriptExecutionResult): ValidationCheck {
    const scriptOutput =
      typeof result.output === 'object' && result.output !== null
        ? (result.output as Record<string, unknown>)
        : null;
    const passed = result.success && scriptOutput?.['passed'] === true;
    const reason =
      (scriptOutput?.['reason'] as string | undefined) ??
      result.error ??
      (passed ? 'Script tool passed' : 'Script tool did not report passed: true');

    return {
      type: 'script_tool',
      passed,
      score: passed ? 1.0 : 0,
      message: `Script tool '${toolId}': ${reason}`,
      details: {
        toolId,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        scriptOutput,
        ...(result.stderr !== '' ? { stderr: result.stderr.slice(0, 500) } : {}),
      },
    };
  }

  /**
   * A `script_tool` check that could not run.
   *
   * Fails closed. A verification that did not happen is not a verification, and
   * scoring it 1.0 — which this branch used to do for a missing id — reports the
   * strongest possible evidence for the one outcome that carries none.
   */
  private unrunnableScriptTool(toolId: string | undefined, reason: string): ValidationCheck {
    const subject = toolId != null && toolId !== '' ? `'${toolId}'` : 'script_tool check';
    this.logger.warn(`[SCRIPT GATE] Cannot run ${subject}: ${reason}`);
    return {
      type: 'script_tool',
      passed: false,
      score: 0,
      message: `Script tool verification could not run for ${subject}: ${reason}`,
      details: {
        ...(toolId != null ? { toolId } : {}),
        unrunnable: true,
        reason,
      },
    };
  }

  /**
   * Handle the reserved `llm_self_check` criteria type.
   *
   * The type stays accepted by the gate schema — it is declared in gate YAML, which
   * `CLAUDE.md` §Public API Contract names as contract surface, and it is documented as
   * _Reserved — runner not yet implemented_ in `docs/guides/gates.md`. Removing the type would
   * break existing gate files for no gain; this method is what keeps that promise cheap.
   *
   * It used to branch on the deprecated `analysis.semanticAnalysis` config section, and all three
   * branches returned the same skip verdict. The config it consulted is deprecated and no longer
   * settable from either tool surface, so the branches could only ever differ in their message —
   * one of which instructed the reader to set a key that no longer exists. One skip, stated once.
   *
   * Model-graded evaluation is delivered by `%judge` (`src/engine/gates/judge/`), whose verdict
   * arrives through `gate_verdict` rather than through this validator. A future in-process runner
   * would replace this body; it would not restore the config branch.
   */
  private async runLLMSelfCheck(criteria: GatePassCriteria): Promise<ValidationCheck> {
    this.logger.debug(
      `[GATE VALIDATOR] llm_self_check skipped (reserved type, no runner); template: ${
        criteria.prompt_template ?? 'default'
      }`
    );

    return {
      type: 'llm_self_check',
      // Auto-pass: a reserved type must not fail gates that declare it.
      passed: true,
      score: 1.0,
      message:
        'llm_self_check skipped - reserved type with no runner. Use the %judge modifier for model-graded evaluation, or shell_verify for ground truth.',
      details: {
        skipped: true,
        reason: 'Reserved criteria type - runner not implemented',
        replacement: '%judge modifier (gates.evaluation.defaultMode) or shell_verify',
        templateRequested: criteria.prompt_template || 'default',
      },
    };
  }

  /**
   * Generate retry hints based on failed checks
   *
   * With string-based validation removed, hints now focus on:
   * 1. Gate-specific guidance (from gate definition)
   * 2. LLM self-check feedback (when implemented)
   * 3. Generic quality improvement suggestions
   */
  private generateRetryHints(gate: LightweightGateDefinition, checks: ValidationCheck[]): string[] {
    const hints: string[] = [];
    const failedChecks = checks.filter((check) => !check.passed);

    if (failedChecks.length === 0) {
      return hints;
    }

    // Add gate-specific guidance as a hint
    // Skip for inline gates - criteria already displayed prominently in "Inline Quality Criteria" section
    const isInlineGate = gate.name?.includes('Inline Quality') || gate.id?.startsWith('temp_');
    if (gate.guidance && !isInlineGate) {
      hints.push(`Remember the ${gate.name} guidelines:\n${gate.guidance}`);
    }

    // Add LLM self-check specific hints (the only meaningful validation)
    for (const check of failedChecks) {
      if (check.type === 'llm_self_check') {
        hints.push('Review the quality criteria and improve content structure and depth');
        // When LLM validation is implemented, this would include specific feedback
        if (check.details?.['feedback'] !== undefined) {
          hints.push(check.details['feedback'] as string);
        }
      }
    }

    // Ensure we have at least one helpful hint
    if (hints.length === 0) {
      hints.push(`${gate.name} validation failed. Please review the requirements and try again.`);
    }

    return hints;
  }

  /**
   * Update average validation time
   */
  private updateAverageValidationTime(): void {
    if (this.validationTimes.length > 0) {
      const sum = this.validationTimes.reduce((a, b) => a + b, 0);
      this.validationStats.averageValidationTime = sum / this.validationTimes.length;
    }

    // Keep only last 100 measurements for rolling average
    if (this.validationTimes.length > 100) {
      this.validationTimes = this.validationTimes.slice(-100);
    }
  }

  /**
   * Get validation statistics
   */
  getStatistics(): GateValidationStatistics {
    return { ...this.validationStats };
  }

  /**
   * Reset validation statistics
   */
  resetStatistics(): void {
    this.validationStats = {
      totalValidations: 0,
      successfulValidations: 0,
      failedValidations: 0,
      averageValidationTime: 0,
    };
    this.validationTimes = [];
    this.logger.debug('[GATE VALIDATOR] Statistics reset');
  }
}

/**
 * Create a gate validator instance
 */
export function createGateValidator(
  logger: Logger,
  gateLoader: GateDefinitionProvider,
  scriptToolRuntime?: ScriptToolRuntimeProvider
): GateValidator {
  return new GateValidator(logger, gateLoader, scriptToolRuntime);
}
