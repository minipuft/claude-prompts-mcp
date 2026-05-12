/**
 * Integration tests for the path-verification gate.
 *
 * Exercises the full path: agent response (synthetic YAML) → response injection
 * via shell_stdin_source → verify-path-claims.mjs script → exit code → gate result.
 *
 * Validates the FIRST real consumer of the response-injection feature (commit
 * c1fb8ebe). Tests cover all three exit code paths:
 *  - 0: truthful claims match filesystem
 *  - 1: fabricated claims (wrong line_count, missing file) caught by exit code
 *  - 2: malformed input (no verified_paths block)
 */

import { execSync } from 'node:child_process';
import { describe, test, expect, jest } from '@jest/globals';

import { runGateShellVerifications } from '../../../src/engine/gates/services/gate-shell-verify-runner.js';

import type { GateDefinitionProvider } from '../../../src/engine/gates/core/gate-loader.js';
import type { LightweightGateDefinition } from '../../../src/engine/gates/types.js';

/**
 * Provider returning the actual path-verification gate definition with the
 * shell_command pointed at the in-repo script.
 *
 * Mirrors the structure of resources/gates/path-verification/gate.yaml so the
 * test exercises the same wiring an agent would hit in production.
 */
function createPathVerificationProvider(): GateDefinitionProvider {
  const gate: LightweightGateDefinition = {
    id: 'path-verification',
    name: 'Path Claims Verification',
    type: 'validation',
    description: 'Verifies plan-author claims against filesystem ground truth',
    pass_criteria: [
      {
        type: 'shell_verify',
        shell_command: 'node scripts/verify-path-claims.mjs',
        shell_stdin_source: 'agent_response',
        shell_timeout: 10000,
      },
    ],
  };

  return {
    loadGate: jest.fn(async (id: string) => (id === gate.id ? gate : null)),
    loadGates: jest.fn(async (ids: string[]) => ids.filter((id) => id === gate.id).map(() => gate)),
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

describe('Path Verification Gate (Integration)', () => {
  test('truthful claim about a real file → exit 0 (pass)', async () => {
    const provider = createPathVerificationProvider();

    // Use package.json as a stable in-repo reference. Compute the actual line
    // count so the claim is honest.
    const actualLines = parseInt(execSync('wc -l < package.json', { encoding: 'utf8' }).trim(), 10);

    const agentResponse = `## systematic_analysis

\`\`\`bash
$ wc -l package.json
${actualLines} package.json
\`\`\`

verified_paths:
  - file: package.json
    exists: yes
    line_count: ${actualLines}
`;

    const results = await runGateShellVerifications(['path-verification'], provider, {
      agentResponse,
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.passed).toBe(true);
    expect(results[0]?.exitCode).toBe(0);
    expect(results[0]?.stdout).toContain('package.json');
    expect(results[0]?.stdout).toContain('verified clean');
  });

  test('fabricated line_count → exit 1 (mismatch caught)', async () => {
    const provider = createPathVerificationProvider();

    const agentResponse = `verified_paths:
  - file: package.json
    exists: yes
    line_count: 99999
`;

    const results = await runGateShellVerifications(['path-verification'], provider, {
      agentResponse,
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.passed).toBe(false);
    expect(results[0]?.exitCode).toBe(1);
    expect(results[0]?.stderr).toContain('line_count=99999');
    expect(results[0]?.stderr).toContain('actual=');
  });

  test('claimed-existent missing file → exit 1 (caught)', async () => {
    const provider = createPathVerificationProvider();

    const agentResponse = `verified_paths:
  - file: src/modules/chains/store/chain-session-store.ts
    exists: yes
    line_count: 200
`;

    const results = await runGateShellVerifications(['path-verification'], provider, {
      agentResponse,
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.passed).toBe(false);
    expect(results[0]?.exitCode).toBe(1);
    expect(results[0]?.stderr).toContain('exists=yes');
    expect(results[0]?.stderr).toContain('exists=false');
  });

  test('malformed input (no verified_paths block) → exit 2', async () => {
    const provider = createPathVerificationProvider();

    const agentResponse = `Just some prose without any structured verification block.
No verified_paths key anywhere here.`;

    const results = await runGateShellVerifications(['path-verification'], provider, {
      agentResponse,
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.passed).toBe(false);
    expect(results[0]?.exitCode).toBe(2);
    expect(results[0]?.stderr).toContain('no `verified_paths:` block found');
  });

  test('honestly-claimed-missing file → exit 0 (claim and reality agree)', async () => {
    const provider = createPathVerificationProvider();

    const agentResponse = `verified_paths:
  - file: src/modules/chains/store/chain-session-store.ts
    exists: no
`;

    const results = await runGateShellVerifications(['path-verification'], provider, {
      agentResponse,
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.passed).toBe(true);
    expect(results[0]?.exitCode).toBe(0);
  });

  test('symbol claim with wrong line → exit 1', async () => {
    const provider = createPathVerificationProvider();

    const agentResponse = `verified_paths:
  - file: package.json
    exists: yes
    target_symbols:
      - symbol: "claude-prompts"
        actual_line: 99999
`;

    const results = await runGateShellVerifications(['path-verification'], provider, {
      agentResponse,
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.passed).toBe(false);
    expect(results[0]?.exitCode).toBe(1);
    expect(results[0]?.stderr).toContain('symbol="claude-prompts"');
  });

  // ==========================================================================
  // Tier 4a fixes — repo-root resolution, optional exists, symbol existence
  // ==========================================================================

  test('repo-root path (server/...) resolves from server/ cwd → exit 0 (FP-1)', async () => {
    const provider = createPathVerificationProvider();

    // Agents naturally use repo-root paths from conversation context.
    // Pre-fix: this would fail because the script's cwd is server/ and
    //          statSync("server/package.json") doesn't resolve.
    // Post-fix: script walks up to .git and retries — should resolve.
    const agentResponse = `verified_paths:
  - file: server/package.json
    exists: yes
`;

    const results = await runGateShellVerifications(['path-verification'], provider, {
      agentResponse,
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.passed).toBe(true);
    expect(results[0]?.exitCode).toBe(0);
  });

  test('entry with only `file` field (no exists claim) → exit 0 (FP-2)', async () => {
    const provider = createPathVerificationProvider();

    // A minimal claim ("file is in scope") should not fail just because
    // the agent didn't explicitly state `exists: yes`. The check is skipped
    // when the field is undefined.
    const agentResponse = `verified_paths:
  - file: package.json
`;

    const results = await runGateShellVerifications(['path-verification'], provider, {
      agentResponse,
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.passed).toBe(true);
    expect(results[0]?.exitCode).toBe(0);
  });

  test('symbol cited without actual_line — exists check still runs (FN-1)', async () => {
    const provider = createPathVerificationProvider();

    // Without the fix: this scenario would silently pass (symbol entry
    // without actual_line was skipped entirely).
    // With the fix: rg --quiet verifies symbol exists; fabricated symbols
    // without line claims are now caught.
    const agentResponse = `verified_paths:
  - file: package.json
    exists: yes
    target_symbols:
      - symbol: "ThisSymbolDoesNotExistAnywhere_${Date.now()}"
`;

    const results = await runGateShellVerifications(['path-verification'], provider, {
      agentResponse,
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.passed).toBe(false);
    expect(results[0]?.exitCode).toBe(1);
    expect(results[0]?.stderr).toContain('claimed without actual_line');
  });

  test('symbol cited without actual_line — passes when symbol exists (FN-1 positive case)', async () => {
    const provider = createPathVerificationProvider();

    const agentResponse = `verified_paths:
  - file: package.json
    exists: yes
    target_symbols:
      - symbol: "claude-prompts"
`;

    const results = await runGateShellVerifications(['path-verification'], provider, {
      agentResponse,
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.passed).toBe(true);
    expect(results[0]?.exitCode).toBe(0);
  });
});
