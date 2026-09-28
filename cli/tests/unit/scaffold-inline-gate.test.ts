/**
 * The `cpm create prompt` scaffold's commented inline gate example loads once uncommented
 * (P6.221, R117).
 *
 * MEASURED 2026-09-28 on `6d442cb5`: the example carried `name`, `type`, `description` and
 * `pass_criteria` but no `scope` or `guidance`, so `findInlineGateFieldProblems` reported both and
 * the loader dropped the gate — an author who uncommented it got a prompt with no gate. The test
 * reads the example out of a real scaffold, so it follows whatever the template writes.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createResourceDir } from '@cli-shared/resource-scaffold.js';
import {
  findInlineGateFieldProblems,
  normalizeInlineGateDefinitions,
} from '@modules/prompts/yaml-prompt-loader.js';
import { parseYamlOrThrow } from '@shared/utils/yaml/index.js';

/** Uncomment the scaffold's `gateConfiguration` block: the lines from its key to the next blank. */
function uncommentGateConfiguration(promptYaml: string): string {
  const lines = promptYaml.split('\n');
  const start = lines.indexOf('# gateConfiguration:');
  if (start === -1) throw new Error('the scaffold no longer carries a gateConfiguration example');
  const end = lines.indexOf('', start);
  return lines
    .slice(start, end)
    .map((line) => line.replace(/^# /, ''))
    .join('\n');
}

describe('cpm create prompt: the inline gate example', () => {
  let root = '';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'cpm-scaffold-gate-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('(a) loads through normalizeInlineGateDefinitions with zero problems once uncommented', () => {
    const created = createResourceDir(root, 'prompts', 'scaffold_gate', { category: 'general' });
    expect(created.success).toBe(true);

    const scaffold = readFileSync(join(created.path!, 'prompt.yaml'), 'utf8');
    const parsed = parseYamlOrThrow<{
      gateConfiguration: { inline_gate_definitions: Record<string, unknown>[] };
    }>(uncommentGateConfiguration(scaffold));
    const definitions = parsed.gateConfiguration.inline_gate_definitions;

    expect(definitions).toHaveLength(1);
    expect(definitions.map((definition) => findInlineGateFieldProblems(definition))).toEqual([[]]);
    expect(normalizeInlineGateDefinitions(definitions)).toHaveLength(definitions.length);
  });

  it('(b) control: the example as it was before (no scope, no guidance) is dropped', () => {
    const before = {
      name: 'Custom Check',
      type: 'validation',
      description: 'Verify response meets criteria',
      pass_criteria: ['Criterion one', 'Criterion two'],
    };

    expect(findInlineGateFieldProblems(before)).toEqual([
      'scope (must be one of: execution, session, chain, step)',
      'guidance (must be a string)',
    ]);
    expect(normalizeInlineGateDefinitions([before])).toBeUndefined();
  });
});
