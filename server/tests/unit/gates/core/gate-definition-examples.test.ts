// @lifecycle canonical - A gate's `examples` declaration is validated at load, files included.
/**
 * A gate may name example replies that ship beside its `gate.yaml`, each with the outcome the gate
 * is expected to give it. The loader refuses a declaration it cannot honour — a missing file, an
 * absolute path, a `..` segment, an expectation other than `pass`/`fail` — through the same
 * quarantine record every other refused gate file gets, naming the gate, the example's index, its
 * path and the rule it broke.
 *
 * Every refusal case carries a positive control in the same root: a valid sibling gate that is
 * absent from the quarantine and still loads, so "the broken one is quarantined" cannot be
 * satisfied by a loader that quarantines everything.
 *
 * Classification: Unit. Real loader over a temporary directory, real schema, no mocks.
 */

import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { toGateDefinition } from '../../../../src/engine/gates/core/gate-definition-converter.js';
import { GateDefinitionLoader } from '../../../../src/engine/gates/core/gate-definition-loader.js';

const HEADER = ['name: Probe', 'type: validation', 'description: examples probe'];

function writeGate(root: string, id: string, lines: readonly string[]): string {
  const dir = join(root, id);
  mkdirSync(dir, { recursive: true });
  const entry = join(dir, 'gate.yaml');
  writeFileSync(entry, [`id: ${id}`, ...HEADER, ...lines, ''].join('\n'));
  return entry;
}

function writeFile(root: string, relative: string, body: string): void {
  const path = join(root, relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
}

describe('gate examples declaration at load', () => {
  let root: string;
  let loader: GateDefinitionLoader;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'gate-examples-'));
    loader = new GateDefinitionLoader({ gatesDir: root, enableCache: false });
    // The loader also logs each refusal; the quarantine record is what these tests read.
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  test('a gate with two valid examples loads and carries them', () => {
    writeGate(root, 'with-examples', [
      'examples:',
      '  - file: examples/pass.md',
      '    expect: pass',
      '  - file: examples/fail-missing-section.md',
      '    expect: fail',
    ]);
    writeFile(root, 'with-examples/examples/pass.md', '## Summary\nok\n');
    writeFile(root, 'with-examples/examples/fail-missing-section.md', 'no summary\n');

    const definition = loader.loadGate('with-examples');

    expect(definition?.examples).toEqual([
      { file: 'examples/pass.md', expect: 'pass' },
      { file: 'examples/fail-missing-section.md', expect: 'fail' },
    ]);
    expect(loader.getQuarantine().list()).toEqual([]);
  });

  test('a gate without the key loads and converts byte-identical to the definition before examples existed', () => {
    writeGate(root, 'plain', [
      'severity: high',
      'pass_criteria:',
      '  - type: shell_verify',
      '    shell_command: [node, check.js]',
      '    shell_stdin_source: agent_response',
      'activation:',
      '  explicit_request: true',
    ]);

    const loaded = loader.loadGate('plain');
    expect(loaded).toBeDefined();
    const stable = (value: unknown): string =>
      JSON.stringify(value).split(JSON.stringify(root).slice(1, -1)).join('<root>');

    // Captured at fe0319a9, before `examples` was declared. A change to either string is a change
    // to what every gate without the key loads as.
    expect(stable(loaded)).toBe(
      '{"id":"plain","name":"Probe","type":"validation","description":"examples probe",' +
        '"severity":"high","gate_type":"custom","pass_criteria":[{"type":"shell_verify",' +
        '"shell_command":["node","check.js"],"shell_stdin_source":"agent_response"}],' +
        '"activation":{"explicit_request":true},"sourceRoot":"<root>"}'
    );
    expect(stable(toGateDefinition(loaded!))).toBe(
      '{"id":"plain","name":"Probe","type":"validation","description":"examples probe",' +
        '"severity":"high","pass_criteria":[{"type":"shell_verify",' +
        '"shell_command":["node","check.js"],"shell_stdin_source":"agent_response"}],' +
        '"activation":{"explicit_request":true},"gate_type":"custom","sourceRoot":"<root>"}'
    );
  });

  describe('a declaration the loader cannot honour is refused with the gate, index, path and rule', () => {
    const cases: ReadonlyArray<{
      name: string;
      file: string;
      expect: string;
      rule: RegExp;
    }> = [
      { name: 'missing file', file: 'examples/absent.md', expect: 'pass', rule: /does not exist/ },
      { name: 'absolute path', file: '/etc/hostname', expect: 'pass', rule: /absolute/ },
      { name: 'traversal', file: 'examples/../../secret.md', expect: 'fail', rule: /'\.\.'/ },
      { name: 'bad expect', file: 'examples/pass.md', expect: 'maybe', rule: /'pass' or 'fail'/ },
    ];

    test.each(cases)('$name', ({ file, expect: expected, rule }) => {
      writeGate(root, 'good', ['examples:', '  - file: examples/pass.md', '    expect: pass']);
      writeFile(root, 'good/examples/pass.md', 'ok\n');
      const entry = writeGate(root, 'broken', [
        'examples:',
        '  - file: examples/pass.md',
        '    expect: pass',
        `  - file: ${JSON.stringify(file)}`,
        `    expect: ${expected}`,
      ]);
      writeFile(root, 'broken/examples/pass.md', 'ok\n');

      expect(loader.loadGate('broken')).toBeUndefined();

      const records = loader.getQuarantine().list();
      expect(records).toHaveLength(1);
      const [record] = records;
      expect(record?.id).toBe('broken');
      expect(record?.path).toBe(entry);
      // The second example (index 1) is the bad one; the first is valid and named nowhere.
      expect(record?.error).toMatch(/examples(\[1\]|\.1)/);
      expect(record?.error).not.toMatch(/examples(\[0\]|\.0)/);
      expect(record?.error).toContain(expected === 'maybe' ? 'maybe' : file);
      expect(record?.error).toMatch(rule);

      // Positive control: the valid sibling in the same root loads and is not quarantined.
      expect(loader.loadGate('good')?.examples).toHaveLength(1);
      expect(
        loader
          .getQuarantine()
          .list()
          .map((r) => r.id)
      ).toEqual(['broken']);
    });
  });
});
