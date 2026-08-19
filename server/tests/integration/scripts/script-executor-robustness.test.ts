/**
 * Script Tools — Runtime Fallback and the Output Cap (Tier 4)
 *
 * Two independent defects, both in ScriptExecutor, both invisible to a mocked
 * spawn:
 *
 * 4.1 — `RUNTIME_COMMANDS` declares alternates (`python3` then `python`, `bash`
 *       then `sh`) and `findRuntimeCommand` returned `commands[0]` regardless,
 *       so on a host carrying only the second name every tool of that runtime
 *       failed with ENOENT while the table claimed a fallback existed.
 *
 * 4.2 — script stdout was uncapped (`truncateOutput: 0`). The cap alone is not
 *       the fix: `tryParseJson` never throws, it wraps unparseable text as
 *       `{ output: '<text>' }`, so a capped JSON payload would arrive looking
 *       like a valid object whose every expected field had gone missing.
 *       Truncation therefore has to be reported as a failure.
 *
 * The 4.1 cases build a throwaway PATH holding fake interpreters rather than
 * mocking the lookup: the property under test is "does the interpreter the
 * child receives get resolved", and only a real spawn against a real PATH can
 * observe it. Which fake ran is read back from its own stdout marker, so the
 * assertion cannot pass by the executor merely reporting success.
 *
 * Classification: Integration (real subprocess, real executor, real PATH)
 */

import { describe, expect, test, beforeAll, afterAll } from '@jest/globals';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { createScriptExecutor } from '../../../src/modules/automation/execution/script-executor.js';
import { resolveExecutable } from '../../../src/shared/utils/process.js';

import type {
  LoadedScriptTool,
  ScriptExecutionRequest,
} from '../../../src/modules/automation/types.js';

const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const TIMEOUT_MS = 5000;

function toolFor(fixture: string, overrides: Partial<LoadedScriptTool> = {}): LoadedScriptTool {
  return {
    id: 'robustness_fixture',
    name: 'Robustness Fixture',
    description: 'Runtime fallback and output cap fixture',
    scriptPath: fixture,
    runtime: 'node',
    inputSchema: { type: 'object', properties: {} },
    toolDir: FIXTURE_DIR,
    absoluteScriptPath: path.join(FIXTURE_DIR, fixture),
    promptId: 'robustness_fixture_prompt',
    descriptionContent: '',
    ...overrides,
  } as LoadedScriptTool;
}

function requestFor(overrides: Partial<ScriptExecutionRequest> = {}): ScriptExecutionRequest {
  return {
    toolId: 'robustness_fixture',
    promptId: 'robustness_fixture_prompt',
    inputs: {},
    timeout: TIMEOUT_MS,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 4.1 — runtime fallback
// ---------------------------------------------------------------------------

describe('4.1 — findRuntimeCommand honors the declared fallbacks', () => {
  let binDir: string;

  /** A stand-in interpreter that ignores the script and announces its own name. */
  function installFakeInterpreter(name: string): void {
    const file = path.join(binDir, name);
    writeFileSync(file, `#!/bin/sh\ncat > /dev/null\nprintf '{"ranAs":"%s"}' "${name}"\n`);
    chmodSync(file, 0o755);
  }

  /** A python tool is the case that matters: python is the runtime with alternates. */
  function pythonTool(): LoadedScriptTool {
    return toolFor('emit-large.cjs', { runtime: 'python' });
  }

  beforeAll(() => {
    binDir = mkdtempSync(path.join(tmpdir(), 'script-runtime-bin-'));
  });

  afterAll(() => {
    rmSync(binDir, { recursive: true, force: true });
  });

  test('falls back to the second candidate when the first is not on PATH', async () => {
    rmSync(binDir, { recursive: true, force: true });
    binDir = mkdtempSync(path.join(tmpdir(), 'script-runtime-bin-'));
    installFakeInterpreter('python'); // deliberately NOT python3

    const executor = createScriptExecutor({ baseEnv: { PATH: binDir } });
    const result = await executor.execute(requestFor(), pythonTool());

    // Read back from the interpreter's own stdout — the executor reporting
    // success would be satisfied by either candidate running.
    expect(result.success).toBe(true);
    expect(result.output).toEqual({ ranAs: 'python' });
  });

  test('still prefers the first candidate when both are on PATH', async () => {
    rmSync(binDir, { recursive: true, force: true });
    binDir = mkdtempSync(path.join(tmpdir(), 'script-runtime-bin-'));
    installFakeInterpreter('python3');
    installFakeInterpreter('python');

    const executor = createScriptExecutor({ baseEnv: { PATH: binDir } });
    const result = await executor.execute(requestFor(), pythonTool());

    // Ordering is the whole content of the table; a probe that returned any
    // present candidate would pass the previous test and fail here.
    expect(result.output).toEqual({ ranAs: 'python3' });
  });

  test('when no candidate resolves it still attempts the first, as before', async () => {
    rmSync(binDir, { recursive: true, force: true });
    binDir = mkdtempSync(path.join(tmpdir(), 'script-runtime-bin-'));

    const executor = createScriptExecutor({ baseEnv: { PATH: binDir } });
    const result = await executor.execute(requestFor(), pythonTool());

    // The probe may only widen what runs. An unresolvable name reaches spawn and
    // fails there exactly as it did before this row — it must NOT become an
    // early "No interpreter found", which would be a new failure mode on any
    // host whose PATH this scan cannot read.
    expect(result.success).toBe(false);
    expect(result.error).not.toContain('No interpreter found');
  });

  test('resolveExecutable reports absence rather than guessing', () => {
    // The caller owns the fallback; the probe itself must not invent one.
    expect(resolveExecutable(['definitely-not-a-real-binary-xyz'], binDir)).toBeUndefined();
    expect(resolveExecutable([], process.env['PATH'])).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 4.2 — the output cap, and truncation as a failure
// ---------------------------------------------------------------------------

describe('4.2 — script output is capped and truncation is loud', () => {
  test('output under the cap is returned intact and parsed', async () => {
    const executor = createScriptExecutor({ maxOutputChars: 4000 });
    const result = await executor.execute(
      requestFor({ env: { OUTPUT_CHARS: '100' } }),
      toolFor('emit-large.cjs')
    );

    // The cap must not cost anything to a script that stays inside it.
    expect(result.success).toBe(true);
    expect((result.output as { payload: string }).payload).toHaveLength(100);
  });

  test('output over the configured cap fails, and the error names the cap', async () => {
    const executor = createScriptExecutor({ maxOutputChars: 500 });
    const result = await executor.execute(
      requestFor({ env: { OUTPUT_CHARS: '4000' } }),
      toolFor('emit-large.cjs')
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('500');
    // The script itself succeeded — this failure is the executor's own policy,
    // which is exactly the case a plain exit-code check cannot express.
    expect(result.exitCode).toBe(0);
  });

  test('a truncated result is not offered for field access', async () => {
    const executor = createScriptExecutor({ maxOutputChars: 500 });
    const result = await executor.execute(
      requestFor({ env: { OUTPUT_CHARS: '4000' } }),
      toolFor('emit-large.cjs')
    );

    // The specific harm being blocked: `{ output: '<truncated text>' }` from
    // tryParseJson is a well-formed object, so `{{script:id.marker}}` would
    // render empty and nothing would report the value had been cut.
    expect(result.output).toBeNull();
    expect(result.stdout).toContain('truncated');
  });

  test('the default cap is enforced without any configuration', async () => {
    const executor = createScriptExecutor();
    const result = await executor.execute(
      requestFor({ env: { OUTPUT_CHARS: '60000' } }),
      toolFor('emit-large.cjs')
    );

    // Pins that `truncateOutput` is no longer passed as 0. A test that only used
    // a configured cap would still pass with the default left uncapped.
    expect(result.success).toBe(false);
    expect(result.error).toContain('50000');
  });

  test('the truncation notice counts what the script wrote, not what survived', async () => {
    const executor = createScriptExecutor({ maxOutputChars: 500 });
    const result = await executor.execute(
      requestFor({ env: { OUTPUT_CHARS: '20000' } }),
      toolFor('emit-large.cjs')
    );

    // The streaming slice keeps the last 2x the cap, so a count derived only
    // from the surviving buffer can never exceed the cap itself — it would read
    // "500 chars" for a 20k overrun. Anything above that bound proves the
    // pre-slice losses are included.
    const reported = Number(/truncated (\d+) chars/.exec(result.stdout)?.[1] ?? '0');
    expect(reported).toBeGreaterThan(15000);
  });
});
