/**
 * Integration tests for gate shell_verify review feedback.
 *
 * Tests the full path: gate definition → runner → executor → formatter.
 * Uses real ShellVerifyExecutor with real shell commands (echo, exit)
 * and mock GateDefinitionProvider returning controlled gate definitions.
 *
 * These tests verify the NEW feature: shell_verify output surfaced in
 * gate review feedback (runGateShellVerifications + formatGateShellVerifySection).
 */

import { describe, test, expect, jest } from '@jest/globals';

import { runGateShellVerifications } from '../../../src/engine/gates/services/gate-shell-verify-runner.js';
import { formatGateShellVerifySection } from '../../../src/engine/gates/shell/shell-verify-message-formatter.js';
import type { GateDefinitionProvider } from '../../../src/engine/gates/core/gate-loader.js';
import type { LightweightGateDefinition } from '../../../src/engine/gates/types.js';

/**
 * Create a mock GateDefinitionProvider that returns the given gates.
 * Only `loadGates` is exercised by the runner.
 */
function createProvider(gates: Record<string, LightweightGateDefinition>): GateDefinitionProvider {
  return {
    loadGate: jest.fn(async (id: string) => gates[id] ?? null),
    loadGates: jest.fn(
      async (ids: string[]) =>
        ids.map((id) => gates[id]).filter(Boolean) as LightweightGateDefinition[]
    ),
    getActiveGates: jest.fn(),
    listAvailableGates: jest.fn(),
    listAvailableGateDefinitions: jest.fn(),
    clearCache: jest.fn(),
    isGateActive: jest.fn(),
    getStatistics: jest.fn(),
    isMethodologyGate: jest.fn(),
    isMethodologyGateCached: jest.fn(),
    getMethodologyGateIds: jest.fn(),
  } as unknown as GateDefinitionProvider;
}

describe('Gate Shell Verify Review Feedback (Integration)', () => {
  describe('runner + real executor', () => {
    test('runs passing command and returns structured result', async () => {
      const provider = createProvider({
        'echo-gate': {
          id: 'echo-gate',
          name: 'Echo Gate',
          type: 'validation',
          description: 'Gate with passing shell command',
          pass_criteria: [
            {
              type: 'shell_verify',
              shell_command: 'echo "all tests passed"',
              shell_timeout: 5000,
            },
          ],
        },
      });

      const results = await runGateShellVerifications(['echo-gate'], provider);

      expect(results).toHaveLength(1);
      expect(results[0].gateId).toBe('echo-gate');
      expect(results[0].gateName).toBe('Echo Gate');
      expect(results[0].passed).toBe(true);
      expect(results[0].exitCode).toBe(0);
      expect(results[0].stdout).toContain('all tests passed');
    });

    test('runs failing command and captures stderr', async () => {
      const provider = createProvider({
        'fail-gate': {
          id: 'fail-gate',
          name: 'Failing Gate',
          type: 'validation',
          description: 'Gate with failing command',
          pass_criteria: [
            {
              type: 'shell_verify',
              shell_command: 'echo "FAIL src/handler.test.ts" >&2 && exit 1',
              shell_timeout: 5000,
            },
          ],
        },
      });

      const results = await runGateShellVerifications(['fail-gate'], provider);

      expect(results).toHaveLength(1);
      expect(results[0].passed).toBe(false);
      expect(results[0].exitCode).toBe(1);
      expect(results[0].stderr).toContain('FAIL src/handler.test.ts');
    });

    test('handles timeout with short shell_timeout', async () => {
      const provider = createProvider({
        'timeout-gate': {
          id: 'timeout-gate',
          name: 'Timeout Gate',
          type: 'validation',
          description: 'Gate with slow command',
          pass_criteria: [
            {
              type: 'shell_verify',
              shell_command: 'sleep 10',
              shell_timeout: 1000,
            },
          ],
        },
      });

      const start = Date.now();
      const results = await runGateShellVerifications(['timeout-gate'], provider);
      const elapsed = Date.now() - start;

      expect(results).toHaveLength(1);
      expect(results[0].passed).toBe(false);
      expect(results[0].timedOut).toBe(true);
      expect(results[0].exitCode).toBe(-1);
      // Should complete near the timeout, not the full 10s
      expect(elapsed).toBeLessThan(3000);
    });

    test('applies shell_preset for timeout resolution', async () => {
      const provider = createProvider({
        'preset-gate': {
          id: 'preset-gate',
          name: 'Preset Gate',
          type: 'validation',
          description: 'Gate with fast preset',
          pass_criteria: [
            {
              type: 'shell_verify',
              shell_command: 'echo "preset ok"',
              shell_preset: 'fast',
            },
          ],
        },
      });

      const results = await runGateShellVerifications(['preset-gate'], provider);

      expect(results).toHaveLength(1);
      expect(results[0].passed).toBe(true);
      expect(results[0].command).toBe('echo "preset ok"');
    });
  });

  describe('gate filtering', () => {
    test('extracts only shell_verify criteria from mixed gate', async () => {
      const provider = createProvider({
        'mixed-gate': {
          id: 'mixed-gate',
          name: 'Mixed Gate',
          type: 'validation',
          description: 'Gate with shell + llm criteria',
          pass_criteria: [
            {
              type: 'shell_verify',
              shell_command: 'echo "shell check"',
              shell_timeout: 5000,
            },
            {
              type: 'llm_self_check',
              prompt_template: 'Code follows conventions',
            },
          ],
        },
      });

      const results = await runGateShellVerifications(['mixed-gate'], provider);

      // Only shell_verify criteria should produce results
      expect(results).toHaveLength(1);
      expect(results[0].command).toBe('echo "shell check"');
    });

    test('runs multiple shell_verify criteria on one gate', async () => {
      const provider = createProvider({
        'multi-shell': {
          id: 'multi-shell',
          name: 'Multi Shell Gate',
          type: 'validation',
          description: 'Gate with two shell commands',
          pass_criteria: [
            {
              type: 'shell_verify',
              shell_command: 'echo "test passed"',
              shell_timeout: 5000,
            },
            {
              type: 'shell_verify',
              shell_command: 'echo "lint passed"',
              shell_timeout: 5000,
            },
          ],
        },
      });

      const results = await runGateShellVerifications(['multi-shell'], provider);

      expect(results).toHaveLength(2);
      expect(results[0].stdout).toContain('test passed');
      expect(results[1].stdout).toContain('lint passed');
      // Both from same gate
      expect(results[0].gateId).toBe('multi-shell');
      expect(results[1].gateId).toBe('multi-shell');
    });

    test('processes multiple gates, only shell gates produce output', async () => {
      const provider = createProvider({
        'shell-gate': {
          id: 'shell-gate',
          name: 'Shell Gate',
          type: 'validation',
          description: 'Has shell_verify',
          pass_criteria: [
            { type: 'shell_verify', shell_command: 'echo "ok"', shell_timeout: 5000 },
          ],
        },
        'llm-gate': {
          id: 'llm-gate',
          name: 'LLM Gate',
          type: 'validation',
          description: 'No shell_verify',
          pass_criteria: [{ type: 'llm_self_check', prompt_template: 'Quality check' }],
        },
      });

      const results = await runGateShellVerifications(['shell-gate', 'llm-gate'], provider);

      expect(results).toHaveLength(1);
      expect(results[0].gateId).toBe('shell-gate');
    });

    test('skips gate with empty pass_criteria array', async () => {
      const provider = createProvider({
        'empty-gate': {
          id: 'empty-gate',
          name: 'Empty Gate',
          type: 'validation',
          description: 'No criteria',
          pass_criteria: [],
        },
      });

      const results = await runGateShellVerifications(['empty-gate'], provider);

      expect(results).toHaveLength(0);
    });

    test('skips gate with undefined pass_criteria', async () => {
      const provider = createProvider({
        'no-criteria': {
          id: 'no-criteria',
          name: 'No Criteria Gate',
          type: 'validation',
          description: 'Missing pass_criteria field',
        },
      });

      const results = await runGateShellVerifications(['no-criteria'], provider);

      expect(results).toHaveLength(0);
    });

    test('gracefully handles nonexistent gate ID', async () => {
      const provider = createProvider({});

      const results = await runGateShellVerifications(['nonexistent'], provider);

      expect(results).toHaveLength(0);
    });
  });

  describe('runner → formatter composition', () => {
    test('end-to-end: failing command produces formatted review section', async () => {
      const provider = createProvider({
        'test-suite': {
          id: 'test-suite',
          name: 'Test Suite',
          type: 'validation',
          description: 'Run tests',
          pass_criteria: [
            {
              type: 'shell_verify',
              shell_command:
                'echo "FAIL src/auth.test.ts\n  Expected: 200, Received: 401" >&2 && exit 1',
              shell_timeout: 5000,
            },
          ],
        },
      });

      const results = await runGateShellVerifications(['test-suite'], provider);
      const section = formatGateShellVerifySection(results);

      // Structural checks
      expect(section).toContain('## Shell Verification Results');
      expect(section).toContain('### Test Suite — FAILED');
      expect(section).toContain('**Command:** `');
      expect(section).toContain('**Exit Code:** 1');

      // Error output in code block
      expect(section).toContain('```');
      expect(section).toContain('Expected: 200, Received: 401');
    });

    test('end-to-end: passing command produces summary without code block', async () => {
      const provider = createProvider({
        'lint-check': {
          id: 'lint-check',
          name: 'Lint Check',
          type: 'validation',
          description: 'Run linter',
          pass_criteria: [
            {
              type: 'shell_verify',
              shell_command: 'echo "All files clean"',
              shell_timeout: 5000,
            },
          ],
        },
      });

      const results = await runGateShellVerifications(['lint-check'], provider);
      const section = formatGateShellVerifySection(results);

      expect(section).toContain('### Lint Check — PASSED');
      expect(section).toContain('**Exit Code:** 0');
      // No code block for passing gates
      expect(section).not.toContain('```');
    });

    test('end-to-end: mixed pass/fail gates in single section', async () => {
      const provider = createProvider({
        'test-suite': {
          id: 'test-suite',
          name: 'Test Suite',
          type: 'validation',
          description: 'Tests',
          pass_criteria: [
            {
              type: 'shell_verify',
              shell_command: 'echo "all 42 tests passed"',
              shell_timeout: 5000,
            },
          ],
        },
        lint: {
          id: 'lint',
          name: 'Linter',
          type: 'validation',
          description: 'Lint',
          pass_criteria: [
            {
              type: 'shell_verify',
              shell_command: 'echo "error: Unused variable" >&2 && exit 1',
              shell_timeout: 5000,
            },
          ],
        },
      });

      const results = await runGateShellVerifications(['test-suite', 'lint'], provider);
      const section = formatGateShellVerifySection(results);

      expect(section).toContain('Test Suite — PASSED');
      expect(section).toContain('Linter — FAILED');
      expect(section).toContain('Unused variable');
    });

    test('end-to-end: no shell gates produces empty string', async () => {
      const provider = createProvider({
        'llm-only': {
          id: 'llm-only',
          name: 'LLM Only',
          type: 'validation',
          description: 'Pure LLM gate',
          pass_criteria: [{ type: 'llm_self_check', prompt_template: 'Quality' }],
        },
      });

      const results = await runGateShellVerifications(['llm-only'], provider);
      const section = formatGateShellVerifySection(results);

      expect(section).toBe('');
    });

    test('formatted output is valid markdown (no broken headers or blocks)', async () => {
      const provider = createProvider({
        'md-gate': {
          id: 'md-gate',
          name: 'Markdown Integrity',
          type: 'validation',
          description: 'Test markdown output',
          pass_criteria: [
            {
              type: 'shell_verify',
              shell_command: 'echo "line1\nline2\nline3" >&2 && exit 1',
              shell_timeout: 5000,
            },
          ],
        },
      });

      const results = await runGateShellVerifications(['md-gate'], provider);
      const section = formatGateShellVerifySection(results);

      // Count code fences — should be balanced (open + close)
      const fenceCount = (section.match(/```/g) ?? []).length;
      expect(fenceCount % 2).toBe(0);

      // No consecutive blank lines that break markdown rendering
      expect(section).not.toMatch(/\n{4,}/);

      // Starts with H2, not H1 (to nest under review content)
      expect(section).toMatch(/^## /);
    });
  });

  describe('content composition with review body', () => {
    test('shell section appends cleanly to review content', async () => {
      const provider = createProvider({
        'test-gate': {
          id: 'test-gate',
          name: 'Tests',
          type: 'validation',
          description: 'Test gate',
          pass_criteria: [
            {
              type: 'shell_verify',
              shell_command: 'echo "error" >&2 && exit 1',
              shell_timeout: 5000,
            },
          ],
        },
      });

      const reviewContent = '# Gate Review\n\nPlease evaluate against criteria.';
      const results = await runGateShellVerifications(['test-gate'], provider);
      const section = formatGateShellVerifySection(results);

      // Simulate what Stage 10 does
      const combined = section !== '' ? `${reviewContent}\n\n${section}` : reviewContent;

      // Review content preserved
      expect(combined).toContain('# Gate Review');
      expect(combined).toContain('Please evaluate against criteria.');

      // Shell section appended with double newline separator
      expect(combined).toContain('\n\n## Shell Verification Results');

      // No triple+ newlines at boundary
      expect(combined).not.toMatch(/\n{3,}## Shell/);
    });

    test('no shell gates leaves review content unchanged', async () => {
      const provider = createProvider({
        'llm-only': {
          id: 'llm-only',
          name: 'LLM',
          type: 'validation',
          description: 'No shell',
          pass_criteria: [{ type: 'llm_self_check', prompt_template: 'Good' }],
        },
      });

      const reviewContent = '# Gate Review\n\nOriginal content.';
      const results = await runGateShellVerifications(['llm-only'], provider);
      const section = formatGateShellVerifySection(results);

      const combined = section !== '' ? `${reviewContent}\n\n${section}` : reviewContent;

      expect(combined).toBe(reviewContent);
    });
  });

  describe('response injection (stdin / env)', () => {
    test('pipes agent response to stdin when shell_stdin_source is agent_response', async () => {
      const provider = createProvider({
        'stdin-echo': {
          id: 'stdin-echo',
          name: 'Stdin Echo Gate',
          type: 'validation',
          description: 'Echo the piped agent response and pass',
          pass_criteria: [
            {
              type: 'shell_verify',
              shell_command: 'cat',
              shell_stdin_source: 'agent_response',
              shell_timeout: 5000,
            },
          ],
        },
      });

      const agentResponse = 'verified_paths:\n  - file: foo.ts\n    line_count: 42';

      const results = await runGateShellVerifications(['stdin-echo'], provider, {
        agentResponse,
      });

      expect(results).toHaveLength(1);
      expect(results[0]?.passed).toBe(true);
      expect(results[0]?.exitCode).toBe(0);
      expect(results[0]?.stdout).toBe(agentResponse);
    });

    test('does NOT pipe stdin when shell_stdin_source is omitted', async () => {
      const provider = createProvider({
        'no-stdin': {
          id: 'no-stdin',
          name: 'No Stdin',
          type: 'validation',
          description: 'cat with no stdin (immediate EOF)',
          pass_criteria: [
            {
              type: 'shell_verify',
              shell_command: 'cat',
              shell_timeout: 5000,
            },
          ],
        },
      });

      const results = await runGateShellVerifications(['no-stdin'], provider, {
        agentResponse: 'should-not-appear',
      });

      expect(results).toHaveLength(1);
      expect(results[0]?.stdout).toBe('');
      expect(results[0]?.stdout).not.toContain('should-not-appear');
    });

    test('exposes response via env var when shell_response_env_var is set', async () => {
      const provider = createProvider({
        'env-echo': {
          id: 'env-echo',
          name: 'Env Echo Gate',
          type: 'validation',
          description: 'Echo response from env var',
          pass_criteria: [
            {
              type: 'shell_verify',
              shell_command: 'printf "%s" "$AGENT_RESPONSE"',
              shell_stdin_source: 'agent_response',
              shell_response_env_var: 'AGENT_RESPONSE',
              shell_timeout: 5000,
            },
          ],
        },
      });

      const agentResponse = 'AGENT_RESPONSE_VIA_ENV';

      const results = await runGateShellVerifications(['env-echo'], provider, {
        agentResponse,
      });

      expect(results).toHaveLength(1);
      expect(results[0]?.passed).toBe(true);
      expect(results[0]?.stdout).toBe(agentResponse);
    });

    test('script can parse stdin claims and verify against ground truth', async () => {
      const provider = createProvider({
        'claim-verifier': {
          id: 'claim-verifier',
          name: 'Claim Verifier',
          type: 'validation',
          description: 'Verify line_count claim against actual file',
          pass_criteria: [
            {
              type: 'shell_verify',
              shell_command:
                'claim=$(grep "claimed_lines:" | awk \'{print $2}\'); actual=$(wc -l < package.json | tr -d " "); test "$claim" = "$actual"',
              shell_stdin_source: 'agent_response',
              shell_timeout: 5000,
            },
          ],
        },
      });

      const { execSync } = await import('node:child_process');
      const actualLines = execSync('wc -l < package.json', { encoding: 'utf8' }).trim();

      const truthful = `verified_paths:\n  - file: package.json\n    claimed_lines: ${actualLines}`;
      const truthfulResults = await runGateShellVerifications(['claim-verifier'], provider, {
        agentResponse: truthful,
      });
      expect(truthfulResults[0]?.passed).toBe(true);

      const fabricated = `verified_paths:\n  - file: package.json\n    claimed_lines: 99999`;
      const fabricatedResults = await runGateShellVerifications(['claim-verifier'], provider, {
        agentResponse: fabricated,
      });
      expect(fabricatedResults[0]?.passed).toBe(false);
    });

    test('truncates very large responses', async () => {
      const provider = createProvider({
        'size-check': {
          id: 'size-check',
          name: 'Size Check',
          type: 'validation',
          description: 'Verify stdin is truncated',
          pass_criteria: [
            {
              type: 'shell_verify',
              shell_command: 'wc -c',
              shell_stdin_source: 'agent_response',
              shell_timeout: 5000,
            },
          ],
        },
      });

      const largeResponse = 'x'.repeat(1024 * 1024); // 1 MB

      const results = await runGateShellVerifications(['size-check'], provider, {
        agentResponse: largeResponse,
      });

      const pipedBytes = parseInt((results[0]?.stdout ?? '0').trim(), 10);
      expect(pipedBytes).toBeGreaterThan(0);
      expect(pipedBytes).toBeLessThan(300 * 1024);
      expect(pipedBytes).toBeLessThan(largeResponse.length);
    });
  });
});
