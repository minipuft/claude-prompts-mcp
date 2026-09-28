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

import { seedVersionHistory } from '../helpers/seed-version-history.js';

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

  /**
   * P6.237 (R124). MEASURED 2026-09-28 on `46b4568a`: `cpm rename`, `cpm move` and
   * `cpm link-gate` of a prompt already carrying a dropped definition exited 0 and printed nothing
   * about it: the differential demoted the error to a warning, and no success path printed
   * warnings. Each now prints them the way `cpm validate` prints an entry's issues.
   */
  const STRUCTURAL_COMMANDS: { name: string; args: string[] }[] = [
    { name: 'rename', args: ['rename', 'prompt', 'test-prompt', 'renamed-prompt'] },
    { name: 'move', args: ['move', 'prompt', 'test-prompt', '--category', 'moved'] },
    { name: 'link-gate', args: ['link-gate', 'test-prompt', 'test-gate'] },
  ];
  const SCOPE_WARNING = /^gateConfiguration\.inline_gate_definitions\[0\]: .*scope \(must be one of/;
  // The fixture prompt also carries an unrelated advisory (no arguments), which every success
  // path prints too; the twins read only the inline-gate warnings.
  const inlineGateWarnings = (jsonOutput: string): string[] =>
    (JSON.parse(jsonOutput) as { warnings: string[] }).warnings.filter((warning) =>
      warning.includes('inline_gate_definitions'),
    );

  it.each(STRUCTURAL_COMMANDS)(
    'P6.237 (a) cpm $name prints the pre-existing definition as a warning on success',
    ({ args }) => {
      carryDroppedDefinition();

      const { output, exitCode } = run([...args, '--workspace', workspace]);

      expect(exitCode).toBe(0);
      const warningLines = output.split('\n').filter((line) => line.includes('inline_gate_definitions'));
      expect(warningLines).toHaveLength(1);
      expect(warningLines[0]?.trim()).toMatch(/scope \(must be one of/);
    },
  );

  it.each(STRUCTURAL_COMMANDS)(
    'P6.237 (a) cpm $name --json carries the warning in `warnings`',
    ({ args }) => {
      carryDroppedDefinition();

      const { output, exitCode } = run([...args, '--workspace', workspace, '--json']);

      expect(exitCode).toBe(0);
      expect(inlineGateWarnings(output)).toEqual([expect.stringMatching(SCOPE_WARNING)]);
    },
  );

  it.each(STRUCTURAL_COMMANDS)(
    'P6.237 (b) control: cpm $name of a clean prompt prints no warning',
    ({ args }) => {
      const text = run([...args, '--workspace', workspace]);
      expect(text.exitCode).toBe(0);
      expect(text.output).not.toContain('inline_gate_definitions');

      rmSync(workspace, { recursive: true, force: true });
      cpSync(VERSIONED_WS, workspace, { recursive: true });
      const json = run([...args, '--workspace', workspace, '--json']);
      expect(json.exitCode).toBe(0);
      expect(inlineGateWarnings(json.output)).toEqual([]);
      // Positive control: the channel is live on this path — it carries the unrelated advisory.
      expect((JSON.parse(json.output) as { warnings: string[] }).warnings).toEqual([
        expect.stringContaining('no arguments defined'),
      ]);
    },
  );

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

  /**
   * P6.238 (R125). MEASURED 2026-09-28 on `f38340a1`: `cpm rollback` to a version whose snapshot
   * carried a definition the loader drops wrote it with no check and exited 0, because the restore
   * wrote the file itself and never validated. A restore is a write: it now runs the same
   * validator and the same differential against the CURRENT file as every other CLI write.
   */
  describe('P6.238 cpm rollback', () => {
    const DROPPED_GATE_CONFIGURATION = {
      inline_gate_definitions: [
        {
          name: 'Cites Sources',
          type: 'validation',
          description: 'Every claim names its source.',
          guidance: 'Check each claim for a named source.',
        },
      ],
    };
    const baseSnapshot = { id: 'test-prompt', name: 'Test Prompt', description: 'Restored text.' };
    const rollbackRows = (): string[] => {
      const history = run(['history', 'prompt', 'test-prompt', '--workspace', workspace, '--json']);
      return (JSON.parse(history.output) as { versions: { description: string }[] }).versions
        .map((version) => version.description)
        .filter((description) => description.startsWith('Rollback to'));
    };

    it('(a) a restore that brings back a dropped definition is refused and the file is untouched', () => {
      seedVersionHistory(workspace, 'prompt', 'test-prompt', [
        {
          version: 1,
          snapshot: { ...baseSnapshot, gateConfiguration: DROPPED_GATE_CONFIGURATION },
          description: 'Version 1',
        },
      ]);
      const before = readFileSync(promptFile);

      const { output, exitCode } = run([
        'rollback', 'prompt', 'test-prompt', '1', '--workspace', workspace, '--json',
      ]);

      expect(exitCode).toBe(1);
      const refusal = JSON.parse(output) as {
        validation: { errors: { path: string; message: string }[] };
        rollback: { performed: boolean };
      };
      expect(refusal.validation.errors).toEqual([
        expect.objectContaining({
          path: 'gateConfiguration.inline_gate_definitions[0]',
          message: expect.stringMatching(/scope \(must be one of/),
        }),
      ]);
      expect(refusal.rollback.performed).toBe(true);
      expect(readFileSync(promptFile).equals(before)).toBe(true);
      expect(rollbackRows()).toEqual([]);
    });

    it('(b) a restore over a file that already carries one warns and succeeds', () => {
      carryDroppedDefinition();
      seedVersionHistory(workspace, 'prompt', 'test-prompt', [
        { version: 1, snapshot: baseSnapshot, description: 'Version 1' },
      ]);

      const text = run(['rollback', 'prompt', 'test-prompt', '1', '--workspace', workspace]);

      expect(text.exitCode).toBe(0);
      expect(readFileSync(promptFile, 'utf8')).toContain('Restored text.');
      const warningLines = text.output
        .split('\n')
        .filter((line) => line.includes('inline_gate_definitions'));
      expect(warningLines).toHaveLength(1);
      expect(warningLines[0]?.trim()).toMatch(/scope \(must be one of/);
      expect(rollbackRows()).toEqual(['Rollback to v1']);
    });

    it('(b) --json carries the warning in `warnings`', () => {
      carryDroppedDefinition();
      seedVersionHistory(workspace, 'prompt', 'test-prompt', [
        { version: 1, snapshot: baseSnapshot, description: 'Version 1' },
      ]);

      const json = run([
        'rollback', 'prompt', 'test-prompt', '1', '--workspace', workspace, '--json',
      ]);

      expect(json.exitCode).toBe(0);
      expect(inlineGateWarnings(json.output)).toEqual([expect.stringMatching(SCOPE_WARNING)]);
    });

    it('(c) control: a clean rollback restores, records and prints no inline-gate warning', () => {
      seedVersionHistory(workspace, 'prompt', 'test-prompt', [
        { version: 1, snapshot: baseSnapshot, description: 'Version 1' },
      ]);

      const json = run([
        'rollback', 'prompt', 'test-prompt', '1', '--workspace', workspace, '--json',
      ]);

      expect(json.exitCode).toBe(0);
      expect(readFileSync(promptFile, 'utf8')).toContain('Restored text.');
      expect(inlineGateWarnings(json.output)).toEqual([]);
      // Positive control: the channel is live on this path — it carries the unrelated advisories.
      expect((JSON.parse(json.output) as { warnings: string[] }).warnings).toEqual(
        expect.arrayContaining([expect.stringContaining('no arguments defined')]),
      );
      expect(rollbackRows()).toEqual(['Rollback to v1']);
    });

    /**
     * P6.250 (R128). MEASURED 2026-09-28 on `9a6383f08`: `cpm rollback` accepted no `--no-validate`
     * (the flag parsed and was never passed on), so a restore blocked by an error the differential
     * does not exempt had no way through, unlike `rename`, `move` and `link-gate`.
     */
    it('P6.250 --no-validate writes the restore the check refuses, and records it', () => {
      seedVersionHistory(workspace, 'prompt', 'test-prompt', [
        {
          version: 1,
          snapshot: { ...baseSnapshot, gateConfiguration: DROPPED_GATE_CONFIGURATION },
          description: 'Version 1',
        },
      ]);
      const before = readFileSync(promptFile);

      // Control: without the flag the P6.238 refusal stands.
      const refused = run(['rollback', 'prompt', 'test-prompt', '1', '--workspace', workspace]);
      expect(refused.exitCode).toBe(1);
      expect(readFileSync(promptFile).equals(before)).toBe(true);
      expect(rollbackRows()).toEqual([]);

      const json = run([
        'rollback', 'prompt', 'test-prompt', '1', '--workspace', workspace, '--json', '--no-validate',
      ]);

      expect(json.exitCode).toBe(0);
      const restored = readFileSync(promptFile, 'utf8');
      expect(restored).toContain('Restored text.');
      expect(restored).toContain('Cites Sources');
      expect((JSON.parse(json.output) as { warnings: string[] }).warnings).toEqual([]);
      expect(rollbackRows()).toEqual(['Rollback to v1']);
      expect(run(['rollback', '--help']).output).toMatch(
        /--no-validate\s+Skip post-rollback schema validation/,
      );
    });
  });
});
