// @lifecycle canonical - Pins the script validation protocol extracted from the stage in Tier 14.
import { describe, expect, test } from '@jest/globals';

import { interpretScriptValidationOutput } from '../../../src/shared/utils/script-validation-output.js';

import type { ScriptExecutionResult } from '../../../src/shared/types/index.js';

const result = (overrides: Partial<ScriptExecutionResult> = {}): ScriptExecutionResult =>
  ({
    toolId: 'validator',
    success: true,
    exitCode: 0,
    output: null,
    durationMs: 1,
    ...overrides,
  }) as ScriptExecutionResult;

/**
 * This decides whether a tool runs without asking the operator, so the cases that matter
 * are the ones where it must refuse. Every path that cannot read a verdict returns
 * `valid: false` — absence of a "no" is not a "yes".
 */
describe('interpretScriptValidationOutput', () => {
  test('reads a passing verdict', () => {
    const outcome = interpretScriptValidationOutput(result({ output: { valid: true } }));

    expect(outcome).toEqual({ valid: true, warnings: [], errors: [] });
  });

  test('carries warnings through on a pass', () => {
    const outcome = interpretScriptValidationOutput(
      result({ output: { valid: true, warnings: ['slow'] } })
    );

    expect(outcome.valid).toBe(true);
    expect(outcome.warnings).toEqual(['slow']);
  });

  test('trusts JSON output over a non-zero exit code', () => {
    // A validation script conventionally exits 1 while printing why. Reading the exit code
    // first would replace those reasons with a generic failure — the whole diagnostic lost.
    const outcome = interpretScriptValidationOutput(
      result({
        success: false,
        exitCode: 1,
        output: { valid: false, errors: ['line 3: missing field'] },
        error: 'Script execution failed with exit code 1',
      })
    );

    expect(outcome.valid).toBe(false);
    expect(outcome.errors).toEqual(['line 3: missing field']);
  });

  test('supplies a default reason when a failure names none', () => {
    const outcome = interpretScriptValidationOutput(result({ output: { valid: false } }));

    expect(outcome.errors).toEqual(['Validation failed']);
  });

  test('refuses when execution failed with no parseable output', () => {
    const outcome = interpretScriptValidationOutput(
      result({ success: false, exitCode: 2, output: null, error: 'boom' })
    );

    expect(outcome).toEqual({ valid: false, warnings: [], errors: ['boom'] });
  });

  test('falls back to the exit code when a failure carries no error text', () => {
    const outcome = interpretScriptValidationOutput(
      result({ success: false, exitCode: 9, output: null })
    );

    expect(outcome.errors).toEqual(['Script execution failed with exit code 9']);
  });

  test('refuses a successful run that printed nothing usable', () => {
    const outcome = interpretScriptValidationOutput(result({ success: true, output: null }));

    expect(outcome.valid).toBe(false);
    expect(outcome.errors).toEqual(['Script did not return valid JSON output']);
  });

  test('treats a missing `valid` field as not approved', () => {
    const outcome = interpretScriptValidationOutput(result({ output: { warnings: [] } }));

    expect(outcome.valid).toBe(false);
  });

  test('requires `valid` to be exactly true, not merely truthy', () => {
    const outcome = interpretScriptValidationOutput(
      result({ output: { valid: 'yes' } as unknown as Record<string, unknown> })
    );

    expect(outcome.valid).toBe(false);
  });
});
