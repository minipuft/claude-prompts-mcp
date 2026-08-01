// @lifecycle canonical - Message formatting for shell verification feedback.
/**
 * Shell Verify Message Formatter
 *
 * Pure functions for formatting shell verification feedback messages.
 * Handles bounce-back messages (retry prompts) and escalation messages
 * (max attempts reached, user decision required).
 *
 * Extracted from ShellVerificationStage to maintain orchestration layer limits.
 */

import type { ShellVerifyResult, PendingShellVerification } from './types.js';

import { resolveSignalName, resolveSignalDescription } from '#shared/utils/process.js';

/**
 * Gate-level shell verification result.
 * Wraps ShellVerifyResult with gate metadata for gate review feedback.
 */
export interface GateShellVerifyResult {
  gateId: string;
  gateName: string;
  command: string;
  passed: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut?: boolean;
}

/**
 * Shell verification feedback types.
 */
export type ShellVerifyFeedbackType = 'bounce_back' | 'escalation';

/**
 * Formatted feedback ready for display.
 */
export interface ShellVerifyFeedback {
  type: ShellVerifyFeedbackType;
  message: string;
}

/**
 * Default max characters for error output display.
 */
const DEFAULT_DISPLAY_MAX_LENGTH = 2000;

/**
 * Format an exit code with POSIX signal interpretation when applicable.
 * e.g., 137 → "137 (SIGKILL — Killed (likely OOM))"
 */
function formatExitCode(exitCode: number): string {
  const signalName = resolveSignalName(exitCode);
  if (signalName == null) return String(exitCode);
  const description = resolveSignalDescription(exitCode);
  return description != null
    ? `${exitCode} (${signalName} — ${description})`
    : `${exitCode} (${signalName})`;
}

/**
 * Truncate output for display, keeping the end (most relevant for errors).
 */
export function truncateForDisplay(
  output: string,
  maxLength: number = DEFAULT_DISPLAY_MAX_LENGTH
): string {
  if (output.length <= maxLength) {
    return output.trim();
  }
  const truncated = output.slice(-maxLength);
  return `[...truncated...]\n${truncated}`.trim();
}

/**
 * Extract the most relevant error output from a verification result.
 * Prefers stderr, falls back to stdout, then default message.
 */
export function extractErrorOutput(result: ShellVerifyResult): string {
  return (
    (result.stderr !== '' ? result.stderr : null) ??
    (result.stdout !== '' ? result.stdout : null) ??
    'No output captured'
  );
}

/**
 * Format bounce-back message for retry attempts.
 *
 * Displayed when verification fails but attempts remain.
 * Encourages Claude to fix issues and try again.
 */
export function formatBounceBackMessage(
  result: ShellVerifyResult,
  pending: PendingShellVerification,
  errorOutput: string
): string {
  const lines = [
    `## Shell Verification FAILED (Attempt ${pending.attemptCount}/${pending.maxAttempts})`,
    '',
    `**Command:** \`${result.command}\``,
    `**Exit Code:** ${formatExitCode(result.exitCode)}`,
  ];

  if (result.timedOut === true) {
    lines.push(`**Status:** Timed out after ${result.durationMs}ms`);
  }

  lines.push(
    '',
    '### Error Output',
    '```',
    errorOutput,
    '```',
    '',
    'Please fix the issues and submit again.'
  );

  return lines.join('\n');
}

/**
 * Format escalation message after max attempts reached.
 *
 * Displayed when all attempts exhausted. Prompts user for
 * gate_action decision (retry/skip/abort).
 */
export function formatEscalationMessage(
  result: ShellVerifyResult,
  pending: PendingShellVerification,
  errorOutput: string
): string {
  const lines = [
    '## Shell Verification FAILED - Maximum Attempts Reached',
    '',
    `**Command:** \`${result.command}\``,
    `**Attempts:** ${pending.attemptCount}/${pending.maxAttempts}`,
    `**Exit Code:** ${formatExitCode(result.exitCode)}`,
  ];

  if (result.timedOut === true) {
    lines.push(`**Status:** Timed out`);
  }

  lines.push(
    '',
    '### Recent Error Output',
    '```',
    errorOutput,
    '```',
    '',
    'Use `gate_action` parameter to decide:',
    '',
    '- **retry**: Reset attempt count and try again',
    '- **skip**: Bypass verification and continue',
    '- **abort**: Stop execution'
  );

  return lines.join('\n');
}

/**
 * Create bounce-back feedback for a failed verification.
 */
export function createBounceBackFeedback(
  result: ShellVerifyResult,
  pending: PendingShellVerification
): ShellVerifyFeedback {
  const errorOutput = extractErrorOutput(result);
  const truncatedOutput = truncateForDisplay(errorOutput);

  return {
    type: 'bounce_back',
    message: formatBounceBackMessage(result, pending, truncatedOutput),
  };
}

/**
 * Create escalation feedback after max attempts reached.
 */
export function createEscalationFeedback(
  result: ShellVerifyResult,
  pending: PendingShellVerification
): ShellVerifyFeedback {
  const errorOutput = extractErrorOutput(result);
  const truncatedOutput = truncateForDisplay(errorOutput);

  return {
    type: 'escalation',
    message: formatEscalationMessage(result, pending, truncatedOutput),
  };
}

/**
 * Format a markdown section summarizing gate-level shell verification results.
 *
 * Used by GateReviewStage to enrich gate review feedback with actual command
 * output (test failures, lint errors) instead of generic "review your work".
 *
 * @returns Markdown string, or empty string when no results to display.
 */
export function formatGateShellVerifySection(results: GateShellVerifyResult[]): string {
  if (results.length === 0) {
    return '';
  }

  const lines = ['## Shell Verification Results', ''];

  for (const result of results) {
    const status = result.passed ? 'PASSED' : 'FAILED';
    lines.push(`### ${result.gateName} — ${status}`);
    lines.push('');
    lines.push(`**Command:** \`${result.command}\``);
    lines.push(`**Exit Code:** ${formatExitCode(result.exitCode)}`);
    lines.push(`**Duration:** ${result.durationMs}ms`);

    if (result.timedOut === true) {
      lines.push(`**Status:** Timed out after ${result.durationMs}ms`);
    }

    if (!result.passed) {
      const errorOutput = result.stderr !== '' ? result.stderr : result.stdout;
      if (errorOutput) {
        const truncated = truncateForDisplay(errorOutput);
        lines.push('');
        lines.push('```');
        lines.push(truncated);
        lines.push('```');
      }
    }

    lines.push('');
  }

  return lines.join('\n').trimEnd();
}
