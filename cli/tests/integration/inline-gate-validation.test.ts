/**
 * The CLI's validation reports an inline gate definition the loader would drop (P6.231, R117
 * amended).
 *
 * MEASURED 2026-09-28 on `58ec70ae`: `cpm validate --prompts` answered valid for a prompt whose
 * `inline_gate_definitions` entry had no `scope`, while `findInlineGateFieldProblems` names that
 * field and the loader drops the gate on every load. The mutation commands stay differential: a
 * definition the file already carried never blocks an unrelated edit, and only a problem the
 * mutation introduced is refused.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runValidatedMutation } from '@cli-shared/resource-operations.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '../../dist/cpm.js');
const VERSIONED_WS = join(__dirname, '../fixtures/versioned-workspace');

/** One inline definition with every field the loader requires except `scope`. */
const DROPPED_DEFINITION = [
  'gateConfiguration:',
  '  inline_gate_definitions:',
  '    - name: Cites Sources',
  '      type: validation',
  '      description: Every claim names its source.',
  '      guidance: Check each claim for a named source.',
  '',
].join('\n');

function run(args: string[]): { output: string; exitCode: number } {
  const result = spawnSync('node', [CLI, ...args], { encoding: 'utf-8', timeout: 10_000 });
  return { output: (result.stdout ?? '') + (result.stderr ?? ''), exitCode: result.status ?? 1 };
}

describe('inline gate definitions the loader drops (P6.231)', () => {
  let workspace = '';
  let promptFile = '';

  beforeEach(() => {
    workspace = join(mkdtempSync(join(tmpdir(), 'cpm-inline-gate-')), 'ws');
    cpSync(VERSIONED_WS, workspace, { recursive: true });
    promptFile = join(workspace, 'resources/prompts/general/test-prompt/prompt.yaml');
  });

  afterEach(() => {
    rmSync(dirname(workspace), { recursive: true, force: true });
  });

  const carryDroppedDefinition = () =>
    writeFileSync(promptFile, `${readFileSync(promptFile, 'utf8')}${DROPPED_DEFINITION}`);

  it('(a) cpm validate fails a prompt whose inline definition omits scope, naming the field', () => {
    expect(run(['validate', '--prompts', '--workspace', workspace]).exitCode).toBe(0);
    carryDroppedDefinition();

    const { output, exitCode } = run(['validate', '--prompts', '--workspace', workspace, '--json']);

    expect(exitCode).toBe(1);
    const entry = (JSON.parse(output) as { results: { id: string; errors: string[] }[] }).results
      .find((result) => result.id.endsWith('test-prompt'));
    expect(entry?.errors).toEqual([
      expect.stringMatching(/^gateConfiguration\.inline_gate_definitions\[0\]: .*scope \(must be one of/),
    ]);
  });

  it('(b) control: cpm rename of a prompt already carrying one succeeds', () => {
    carryDroppedDefinition();

    const { output, exitCode } = run([
      'rename', 'prompt', 'test-prompt', 'renamed-prompt', '--workspace', workspace,
    ]);

    expect(output).toContain("Renamed prompt 'test-prompt' -> 'renamed-prompt'");
    expect(exitCode).toBe(0);
    expect(existsSync(join(workspace, 'resources/prompts/general/renamed-prompt/prompt.yaml'))).toBe(
      true,
    );
  });

  it('(c) a mutation that introduces one is refused and rolled back', () => {
    const before = readFileSync(promptFile, 'utf8');
    const location = {
      form: 'dir' as const,
      dir: dirname(promptFile),
      file: promptFile,
    };

    const mutation = runValidatedMutation({
      resourceType: 'prompts',
      location,
      mutate: () => {
        carryDroppedDefinition();
        return { success: true };
      },
    });

    expect(mutation.success).toBe(false);
    expect(mutation.rolledBack).toBe(true);
    expect(mutation.validation?.errors.map((issue) => issue.message)).toEqual([
      expect.stringContaining('scope (must be one of'),
    ]);
    expect(readFileSync(promptFile, 'utf8')).toBe(before);
  });
});
