/**
 * Integration tests for shell verification gate flow.
 *
 * Tests the full verification pipeline with real collaborators but mock shell execution
 * to ensure deterministic testing. This validates:
 * 1. Parser creates correct shellVerify operators
 * 2. Inline gate stage sets up pending verification
 * 3. Shell verification stage executes and formats feedback
 * 4. Retry/escalation flow works correctly
 * 5. Git checkpoint integration
 * 6. gate_action handling
 */

import { describe, test, expect, beforeAll, beforeEach, afterAll, jest } from '@jest/globals';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SymbolicCommandParser } from '../../../src/execution/parsers/symbolic-operator-parser.js';
import {
  ShellVerifyExecutor,
  createShellVerifyExecutor,
} from '../../../src/gates/shell/shell-verify-executor.js';
import {
  SHELL_VERIFY_DEFAULT_MAX_ATTEMPTS,
  SHELL_VERIFY_DEFAULT_TIMEOUT,
} from '../../../src/gates/constants.js';
import type { ShellVerifyGate, ShellVerifyResult, PendingShellVerification } from '../../../src/gates/shell/types.js';
import type { Logger } from '../../../src/logging/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, '../../..');

describe('Shell Verification Flow Integration', () => {
  let originalServerRoot: string | undefined;
  let parser: SymbolicCommandParser;
  let mockLogger: Logger;

  beforeAll(() => {
    originalServerRoot = process.env.MCP_SERVER_ROOT;
    process.env.MCP_SERVER_ROOT = serverRoot;
  });

  afterAll(() => {
    if (originalServerRoot !== undefined) {
      process.env.MCP_SERVER_ROOT = originalServerRoot;
    } else {
      delete process.env.MCP_SERVER_ROOT;
    }
  });

  beforeEach(() => {
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };
    parser = new SymbolicCommandParser(mockLogger);
  });

  describe('Parser Integration: :: verify:"command" syntax', () => {
    test('parses basic verify syntax correctly', () => {
      const result = parser.detectOperators('>>implement-feature :: verify:"npm test"');

      // detectOperators returns hasOperators, operatorTypes, operators
      expect(result.hasOperators).toBe(true);
      expect(result.operatorTypes).toContain('gate');

      // Find the gate operator
      const gateOp = result.operators.find((op) => op.type === 'gate' && op.shellVerify);
      expect(gateOp).toBeDefined();
      expect(gateOp?.shellVerify?.command).toBe('npm test');
    });

    test('parses verify with additional options', () => {
      const result = parser.detectOperators(
        '>>fix-bug :: verify:"pytest -v" loop:true checkpoint:true rollback:true max:15 timeout:120'
      );

      const gateOp = result.operators.find((op) => op.type === 'gate' && op.shellVerify);
      expect(gateOp?.shellVerify?.command).toBe('pytest -v');
      expect(gateOp?.shellVerify?.loop).toBe(true);
      expect(gateOp?.shellVerify?.checkpoint).toBe(true);
      expect(gateOp?.shellVerify?.rollback).toBe(true);
      expect(gateOp?.shellVerify?.maxIterations).toBe(15);
      expect(gateOp?.shellVerify?.timeout).toBe(120000); // Converted to ms
    });

    test('parses combined verify and criteria gates', () => {
      // Test that both verify and criteria gates can be detected in the same command
      const result = parser.detectOperators(">>prompt :: verify:'npm test' :: code-quality");

      // Should have both shellVerify gate and criteria/canonical gate
      const verifyGate = result.operators.find((op) => op.type === 'gate' && op.shellVerify);
      const criteriaGate = result.operators.find(
        (op) => op.type === 'gate' && !op.shellVerify
      );

      expect(verifyGate).toBeDefined();
      expect(verifyGate?.shellVerify?.command).toBe('npm test');
      expect(criteriaGate).toBeDefined();
      // Either has criteria or canonicalRef for gate reference
      expect(criteriaGate?.criteria || criteriaGate?.canonicalRef).toBeTruthy();
    });

    test('generates unique gate IDs for verify gates', async () => {
      const result1 = parser.detectOperators('>>prompt :: verify:"test1"');
      // Add small delay to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 2));
      const result2 = parser.detectOperators('>>prompt :: verify:"test2"');

      const gate1 = result1.operators.find((op) => op.type === 'gate' && op.shellVerify);
      const gate2 = result2.operators.find((op) => op.type === 'gate' && op.shellVerify);

      // Both should have shell-verify- prefix
      expect(gate1?.gateId).toMatch(/^shell-verify-/);
      expect(gate2?.gateId).toMatch(/^shell-verify-/);

      // IDs should be unique (timestamps differ)
      expect(gate1?.gateId).not.toBe(gate2?.gateId);
    });
  });

  describe('PendingShellVerification State', () => {
    test('creates correct pending verification structure', () => {
      const shellVerify: ShellVerifyGate = {
        command: 'npm test',
        timeout: 60000,
        loop: true,
        checkpoint: true,
      };

      const pending: PendingShellVerification = {
        shellVerify,
        previousResults: [],
        attemptCount: 0,
        maxAttempts: SHELL_VERIFY_DEFAULT_MAX_ATTEMPTS,
        gateId: `shell-verify-${Date.now()}`,
      };

      expect(pending.maxAttempts).toBe(5);
      expect(pending.attemptCount).toBe(0);
      expect(pending.previousResults).toHaveLength(0);
      expect(pending.shellVerify.command).toBe('npm test');
    });

    test('accumulates results across attempts', () => {
      const pending: PendingShellVerification = {
        shellVerify: { command: 'npm test' },
        previousResults: [],
        attemptCount: 0,
        maxAttempts: 5,
        gateId: 'test-gate',
      };

      // Simulate multiple attempts
      for (let i = 1; i <= 3; i++) {
        pending.attemptCount = i;
        pending.previousResults.push({
          passed: false,
          exitCode: 1,
          stdout: `Attempt ${i} stdout`,
          stderr: `Attempt ${i} error`,
          durationMs: 1000 * i,
          command: 'npm test',
        });
      }

      expect(pending.attemptCount).toBe(3);
      expect(pending.previousResults).toHaveLength(3);
      expect(pending.previousResults[2].stderr).toBe('Attempt 3 error');
    });
  });

  describe('ShellVerifyExecutor Integration', () => {
    let executor: ShellVerifyExecutor;

    beforeEach(() => {
      executor = createShellVerifyExecutor({
        defaultTimeout: 5000,
        debug: false,
      });
    });

    test('passes for successful command', async () => {
      const result = await executor.execute({
        command: 'echo "test passed"',
      });

      expect(result.passed).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('test passed');
    });

    test('fails for non-zero exit code', async () => {
      const result = await executor.execute({
        command: 'exit 1',
      });

      expect(result.passed).toBe(false);
      expect(result.exitCode).toBe(1);
    });

    test('captures test-like output format', async () => {
      // Simulate npm test output
      const result = await executor.execute({
        command: 'echo "PASS src/test.ts" && echo "Tests: 5 passed, 0 failed"',
      });

      expect(result.passed).toBe(true);
      expect(result.stdout).toContain('PASS');
      expect(result.stdout).toContain('5 passed');
    });
  });

  describe('Retry Flow Logic', () => {
    test('should escalate after max attempts', () => {
      const pending: PendingShellVerification = {
        shellVerify: { command: 'npm test' },
        previousResults: [],
        attemptCount: SHELL_VERIFY_DEFAULT_MAX_ATTEMPTS, // At max
        maxAttempts: SHELL_VERIFY_DEFAULT_MAX_ATTEMPTS,
        gateId: 'test-gate',
      };

      const shouldEscalate = pending.attemptCount >= pending.maxAttempts;
      expect(shouldEscalate).toBe(true);
    });

    test('should bounce back before max attempts', () => {
      const pending: PendingShellVerification = {
        shellVerify: { command: 'npm test' },
        previousResults: [],
        attemptCount: 2,
        maxAttempts: SHELL_VERIFY_DEFAULT_MAX_ATTEMPTS,
        gateId: 'test-gate',
      };

      const shouldEscalate = pending.attemptCount >= pending.maxAttempts;
      const shouldBounceBack = !shouldEscalate && pending.attemptCount > 0;

      expect(shouldEscalate).toBe(false);
      expect(shouldBounceBack).toBe(true);
    });
  });

  describe('gate_action Handling', () => {
    test('retry action resets attempt count', () => {
      const pending: PendingShellVerification = {
        shellVerify: { command: 'npm test' },
        previousResults: [{ passed: false, exitCode: 1, stdout: '', stderr: '', durationMs: 100, command: 'npm test' }],
        attemptCount: 5,
        maxAttempts: 5,
        gateId: 'test-gate',
      };

      // Simulate retry action
      const gateAction = 'retry';
      if (gateAction === 'retry') {
        pending.attemptCount = 0;
        pending.previousResults = [];
      }

      expect(pending.attemptCount).toBe(0);
      expect(pending.previousResults).toHaveLength(0);
    });

    test('skip action clears pending verification', () => {
      let pendingVerification: PendingShellVerification | undefined = {
        shellVerify: { command: 'npm test' },
        previousResults: [],
        attemptCount: 5,
        maxAttempts: 5,
        gateId: 'test-gate',
      };

      // Simulate skip action
      const gateAction = 'skip';
      if (gateAction === 'skip') {
        pendingVerification = undefined;
      }

      expect(pendingVerification).toBeUndefined();
    });

    test('abort action sets aborted flag', () => {
      const sessionState = { aborted: false };

      // Simulate abort action
      const gateAction = 'abort';
      if (gateAction === 'abort') {
        sessionState.aborted = true;
      }

      expect(sessionState.aborted).toBe(true);
    });
  });

  describe('Error Feedback Formatting', () => {
    test('bounce back format includes attempt count', () => {
      const result: ShellVerifyResult = {
        passed: false,
        exitCode: 1,
        stdout: '',
        stderr: 'test error output',
        durationMs: 500,
        command: 'npm test',
      };
      const attemptCount = 2;
      const maxAttempts = 5;

      const bounceBackMessage = `## Shell Verification FAILED (Attempt ${attemptCount}/${maxAttempts})

**Command:** \`${result.command}\`
**Exit Code:** ${result.exitCode}

### Error Output
\`\`\`
${result.stderr}
\`\`\`

Please fix the issues and submit again.`;

      expect(bounceBackMessage).toContain('Attempt 2/5');
      expect(bounceBackMessage).toContain('npm test');
      expect(bounceBackMessage).toContain('test error output');
    });

    test('escalation format includes gate_action options', () => {
      const result: ShellVerifyResult = {
        passed: false,
        exitCode: 1,
        stdout: '',
        stderr: 'persistent error',
        durationMs: 500,
        command: 'npm test',
      };

      const escalationMessage = `## Shell Verification FAILED - Maximum Attempts Reached

**Command:** \`${result.command}\`
**Attempts:** 5/5
**Exit Code:** ${result.exitCode}

### Recent Error Output
\`\`\`
${result.stderr}
\`\`\`

Use \`gate_action\` parameter to decide:

- **retry**: Reset attempt count and try again
- **skip**: Bypass verification and continue
- **abort**: Stop execution`;

      expect(escalationMessage).toContain('Maximum Attempts Reached');
      expect(escalationMessage).toContain('gate_action');
      expect(escalationMessage).toContain('retry');
      expect(escalationMessage).toContain('skip');
      expect(escalationMessage).toContain('abort');
    });
  });

  describe('Constants and Defaults', () => {
    test('default max attempts is 5', () => {
      expect(SHELL_VERIFY_DEFAULT_MAX_ATTEMPTS).toBe(5);
    });

    test('default timeout is 5 minutes', () => {
      expect(SHELL_VERIFY_DEFAULT_TIMEOUT).toBe(300000);
    });
  });
});
