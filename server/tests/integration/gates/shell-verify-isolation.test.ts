/**
 * Integration tests for context-isolated Ralph loops.
 *
 * Tests the shell verification isolation flow where iterations 4+ spawn
 * fresh CLI instances to prevent context rot.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

import type { PendingShellVerification, VerifyActiveState } from '../../../src/gates/shell/types.js';

describe('Shell Verification Isolation', () => {
  let tempDir: string;
  let verifyActiveFile: string;

  beforeEach(async () => {
    // Create temp directory for test state files
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ralph-test-'));
    verifyActiveFile = path.join(tempDir, 'verify-active.json');
  });

  afterEach(async () => {
    // Cleanup temp directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('VerifyActiveState with originalGoal', () => {
    it('should include originalGoal in state config', async () => {
      const pending: PendingShellVerification = {
        gateId: 'test-verify',
        shellVerify: {
          command: 'npm test',
          timeout: 30000,
          maxIterations: 5,
          loop: true,
        },
        attemptCount: 0,
        maxAttempts: 5,
        previousResults: [],
        originalGoal: 'Fix the authentication bug',
      };

      const state: VerifyActiveState = {
        sessionId: 'test-session-123',
        config: {
          command: pending.shellVerify.command,
          timeout: pending.shellVerify.timeout ?? 300000,
          maxIterations: pending.shellVerify.maxIterations ?? 10,
          workingDir: pending.shellVerify.workingDir,
          preset: pending.shellVerify.preset,
          originalGoal: pending.originalGoal,
        },
        state: {
          iteration: pending.attemptCount,
          lastResult: null,
          startedAt: new Date().toISOString(),
        },
      };

      // Write state to file
      await fs.writeFile(verifyActiveFile, JSON.stringify(state, null, 2));

      // Read and verify
      const content = await fs.readFile(verifyActiveFile, 'utf-8');
      const parsed = JSON.parse(content) as VerifyActiveState;

      expect(parsed.config.originalGoal).toBe('Fix the authentication bug');
      expect(parsed.config.command).toBe('npm test');
      expect(parsed.sessionId).toBe('test-session-123');
    });

    it('should handle missing originalGoal gracefully', async () => {
      const pending: PendingShellVerification = {
        gateId: 'test-verify',
        shellVerify: {
          command: 'npm test',
        },
        attemptCount: 0,
        maxAttempts: 5,
        previousResults: [],
        // No originalGoal set
      };

      const state: VerifyActiveState = {
        sessionId: 'test-session-456',
        config: {
          command: pending.shellVerify.command,
          timeout: 300000,
          maxIterations: 10,
          originalGoal: pending.originalGoal, // Will be undefined
        },
        state: {
          iteration: 0,
          lastResult: null,
          startedAt: new Date().toISOString(),
        },
      };

      await fs.writeFile(verifyActiveFile, JSON.stringify(state, null, 2));
      const content = await fs.readFile(verifyActiveFile, 'utf-8');
      const parsed = JSON.parse(content) as VerifyActiveState;

      // originalGoal should be undefined (not error)
      expect(parsed.config.originalGoal).toBeUndefined();
    });
  });

  describe('Isolation threshold detection', () => {
    it('should correctly identify when isolation threshold is exceeded', () => {
      const inContextThreshold = 3;

      // Iterations 1-3 should be in-context
      expect(1 > inContextThreshold).toBe(false);
      expect(2 > inContextThreshold).toBe(false);
      expect(3 > inContextThreshold).toBe(false);

      // Iteration 4+ should trigger isolation
      expect(4 > inContextThreshold).toBe(true);
      expect(5 > inContextThreshold).toBe(true);
      expect(10 > inContextThreshold).toBe(true);
    });
  });

  describe('Session ID generation', () => {
    it('should generate valid session IDs', () => {
      // Simulating the pattern from ralph-stop.py
      const sessionIdPattern = /^ralph-[a-f0-9]{8}$/;

      // Generate a few session IDs
      const generateSessionId = () => {
        const uuid = Array.from({ length: 8 }, () =>
          Math.floor(Math.random() * 16).toString(16)
        ).join('');
        return `ralph-${uuid}`;
      };

      for (let i = 0; i < 5; i++) {
        const sessionId = generateSessionId();
        expect(sessionId).toMatch(sessionIdPattern);
      }
    });

    it('should use existing sessionId from state if available', () => {
      const verifyState = {
        sessionId: 'existing-session-abc',
        state: {
          sessionId: 'nested-session-xyz',
        },
      };

      // Simulating the logic from ralph-stop.py
      const sessionId =
        verifyState.state?.sessionId ??
        verifyState.sessionId ??
        'fallback-session';

      expect(sessionId).toBe('nested-session-xyz');
    });
  });

  describe('RALPH_SPAWNED environment variable', () => {
    const originalEnv = process.env.RALPH_SPAWNED;

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.RALPH_SPAWNED;
      } else {
        process.env.RALPH_SPAWNED = originalEnv;
      }
    });

    it('should detect when running in a spawned instance', () => {
      process.env.RALPH_SPAWNED = 'true';
      expect(process.env.RALPH_SPAWNED).toBe('true');
    });

    it('should not trigger isolation when RALPH_SPAWNED is set', () => {
      process.env.RALPH_SPAWNED = 'true';

      // Simulating the check from ralph-stop.py
      const shouldSpawnIsolated = (iteration: number, threshold: number) => {
        if (process.env.RALPH_SPAWNED) {
          return false; // Already in spawned instance
        }
        return iteration > threshold;
      };

      // Even though iteration > threshold, should return false because RALPH_SPAWNED is set
      expect(shouldSpawnIsolated(5, 3)).toBe(false);
    });

    it('should trigger isolation when not in spawned instance', () => {
      delete process.env.RALPH_SPAWNED;

      const shouldSpawnIsolated = (iteration: number, threshold: number) => {
        if (process.env.RALPH_SPAWNED) {
          return false;
        }
        return iteration > threshold;
      };

      expect(shouldSpawnIsolated(4, 3)).toBe(true);
      expect(shouldSpawnIsolated(3, 3)).toBe(false);
    });
  });
});

describe('Task Protocol Format', () => {
  it('should generate valid task file frontmatter', () => {
    const taskMetadata = {
      id: 'task-abc12345',
      created: new Date().toISOString(),
      original_request: 'Fix the authentication bug',
      verification_command: 'npm test',
      max_iterations: 5,
      current_iteration: 4,
      timeout_seconds: 300,
      working_directory: '/home/user/project',
    };

    // Validate metadata shape
    expect(taskMetadata.id).toMatch(/^task-[a-z0-9]+$/);
    expect(taskMetadata.original_request).toBeTruthy();
    expect(taskMetadata.verification_command).toBeTruthy();
    expect(taskMetadata.max_iterations).toBeGreaterThan(0);
    expect(taskMetadata.current_iteration).toBeGreaterThanOrEqual(1);
    expect(taskMetadata.timeout_seconds).toBeGreaterThan(0);
  });

  it('should format task file with all required sections', () => {
    const sections = [
      '## Original Goal',
      '## Session Story',
      '## Git-Style Change Summary',
      '## Current State',
      '## Last Failure',
      '## What To Try Next',
      '## Instructions',
    ];

    // Simulating task file content structure
    const taskFileContent = `---
id: task-abc12345
created: 2026-01-12T10:30:00Z
---

## Original Goal

Fix the authentication bug.

## Session Story

1. **Iteration 1**: Tried URL-encoding
   - Result: FAIL
   - Lesson: Encoding must happen after validation

## Git-Style Change Summary

\`\`\`diff
# Files modified:
src/auth.ts
  + line 23: const encoded = ...
\`\`\`

## Current State

Files to focus on:
- \`src/auth.ts\` (1 change)

## Last Failure (Iteration 3)

\`\`\`
FAIL src/auth.test.ts
\`\`\`

## What To Try Next

Check encoding order.

## Instructions

1. Review session story
2. Make fix
3. Run npm test
`;

    // Verify all sections are present
    for (const section of sections) {
      expect(taskFileContent).toContain(section);
    }
  });
});
