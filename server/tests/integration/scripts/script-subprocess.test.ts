/**
 * Script Tools — Real Subprocess Characterization
 *
 * Pins the safety surface of script-tool execution by spawning real child
 * processes through ScriptExecutor. Every claim here is about an actual OS
 * process, so a mock cannot stand in: SIGKILL, an environment boundary, and
 * argv-versus-shell spawning have no observable behaviour without one.
 *
 * Why this file exists rather than extra cases in the existing suites:
 * - tests/unit/scripts/execution/script-executor.test.ts never reaches the
 *   spawn. Every case there exits on an early guard (`Tool is disabled`,
 *   `Script not found`) by pointing at a nonexistent path, so nothing it
 *   asserts can observe executeProcess at all.
 * - tests/integration/scripts/script-tools-workflow.test.ts mocks the `fs`
 *   module wholesale, which makes a real script path unresolvable by
 *   construction.
 * - Real `sleep` needs extended jest timeouts that would slow both.
 *
 * Fixtures are Node, never Python: `validate:python` is conditional on changed
 * paths and is not part of the Node test jobs, so python3 is not a guaranteed
 * suite dependency. A Python fixture would skip silently on exactly the runs
 * that matter. Node runs the tests, so it cannot be absent.
 *
 * Classification: Integration (real subprocess, real executor, no mocks)
 */

import { describe, expect, test, beforeAll, afterAll } from '@jest/globals';
import { existsSync, mkdtempSync, rmSync, copyFileSync, chmodSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { createScriptExecutor } from '../../../src/modules/automation/execution/script-executor.js';

import type {
  LoadedScriptTool,
  ScriptExecutionRequest,
} from '../../../src/modules/automation/types.js';

const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

/** Generous relative to every fixture except sleep-long, which never finishes. */
const TIMEOUT_MS = 1500;

function toolFor(fixture: string, overrides: Partial<LoadedScriptTool> = {}): LoadedScriptTool {
  return {
    id: 'subprocess_fixture',
    name: 'Subprocess Fixture',
    description: 'Real-spawn characterization fixture',
    scriptPath: fixture,
    runtime: 'node',
    inputSchema: { type: 'object', properties: {} },
    toolDir: FIXTURE_DIR,
    absoluteScriptPath: path.join(FIXTURE_DIR, fixture),
    promptId: 'subprocess_fixture_prompt',
    descriptionContent: '',
    ...overrides,
  } as LoadedScriptTool;
}

function requestFor(overrides: Partial<ScriptExecutionRequest> = {}): ScriptExecutionRequest {
  return {
    toolId: 'subprocess_fixture',
    promptId: 'subprocess_fixture_prompt',
    inputs: {},
    timeout: TIMEOUT_MS,
    ...overrides,
  };
}

describe('script tools — real subprocess', () => {
  const executor = createScriptExecutor({ maxTimeout: 60000 });

  // 1.2 — harness + happy path
  test('spawns the script for real and returns its parsed JSON stdout', async () => {
    const result = await executor.execute(
      requestFor({ inputs: { colour: 'viridian', count: 3 } }),
      toolFor('echo-inputs.cjs')
    );

    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
    // Proves the inputs crossed the stdin boundary, not merely that a process ran.
    expect(result.output).toEqual({ received: { colour: 'viridian', count: 3 }, ok: true });
  }, 20000);

  // 1.3 — timeout
  test('kills a script that outlives its timeout, within a bounded wall-clock', async () => {
    const started = Date.now();
    const result = await executor.execute(requestFor(), toolFor('sleep-long.cjs'));
    const elapsed = Date.now() - started;

    expect(result.success).toBe(false);
    expect(result.error).toContain('timed out');
    // The fixture sleeps 60s. Returning at all proves the kill landed; the bound
    // proves SIGTERM-then-SIGKILL escalated rather than waiting the script out.
    expect(elapsed).toBeLessThan(TIMEOUT_MS * 3);
  }, 20000);

  // 1.4 — environment allowlist
  test('does not hand a parent secret to the child process', async () => {
    const secretName = 'SCRIPT_SUBPROCESS_PARENT_SECRET';
    process.env[secretName] = 'super-secret-value';
    try {
      const result = await executor.execute(requestFor(), toolFor('print-env.cjs'));

      expect(result.success).toBe(true);
      const childEnv = (result.output as { env: Record<string, string> }).env;
      expect(childEnv[secretName]).toBeUndefined();
      // Asserted against the value too: a renamed key would still be a leak.
      expect(JSON.stringify(childEnv)).not.toContain('super-secret-value');
      // Control — the allowlist is a filter, not a blanket empty env.
      expect(childEnv.PATH).toBeDefined();
      // Control — the executor's own per-execution vars still arrive.
      expect(childEnv.SCRIPT_TOOL_ID).toBe('subprocess_fixture');
    } finally {
      delete process.env[secretName];
    }
  }, 20000);

  // 1.5 — argv, not shell
  describe('argv spawning', () => {
    let workDir: string;
    let sentinel: string;
    let scriptName: string;

    beforeAll(() => {
      workDir = mkdtempSync(path.join(tmpdir(), 'script-argv-'));
      // No slash may appear in a filename, so the injected command targets a
      // relative path; cwd is the tool directory, which is this temp dir.
      scriptName = 'argv-safety; touch pwned.txt;.cjs';
      sentinel = path.join(workDir, 'pwned.txt');
      copyFileSync(path.join(FIXTURE_DIR, 'echo-inputs.cjs'), path.join(workDir, scriptName));
      chmodSync(path.join(workDir, scriptName), 0o755);
    });

    afterAll(() => {
      rmSync(workDir, { recursive: true, force: true });
    });

    test('treats a script path containing shell metacharacters as one literal argument', async () => {
      const result = await executor.execute(
        requestFor(),
        toolFor(scriptName, {
          toolDir: workDir,
          absoluteScriptPath: path.join(workDir, scriptName),
        })
      );

      // The injected command did not run. Asserted FIRST and deliberately:
      // under `shell: true` the trailing `;.cjs` exits non-zero, so a
      // success-first ordering fails on the wrong line and never reaches the
      // claim this test exists to make.
      expect(existsSync(sentinel)).toBe(false);
      // And the script itself still ran — the path resolved literally, so the
      // absent sentinel is argv semantics rather than a failure to spawn.
      expect(result.success).toBe(true);
    }, 20000);
  });

  // 1.6 — output shapes
  test('wraps non-JSON stdout rather than failing', async () => {
    const result = await executor.execute(requestFor(), toolFor('print-non-json.cjs'));

    expect(result.success).toBe(true);
    expect(result.stdout).toBe('this is not json');
    expect(result.output).toEqual({ output: 'this is not json' });
  }, 20000);

  test('reports a non-zero exit as failure and keeps stderr', async () => {
    const result = await executor.execute(requestFor(), toolFor('exit-nonzero.cjs'));

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain('fixture failed on purpose');
  }, 20000);
});
