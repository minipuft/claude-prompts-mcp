import { describe, expect, test } from '@jest/globals';

import {
  ARTIFACT_KINDS,
  classifyArtifactPath,
  classifyArtifactPaths,
  resolveDeclaredArtifacts,
} from '../../../../src/engine/gates/utils/artifact-kinds.js';

/**
 * B13's path table, one case per branch. The table is first-match-wins, so each case below is
 * also an ordering assertion: `README.md` proves readme beats docs, `x.test.ts` proves test
 * beats source, and the `resources/` cases prove prompt/gate beat config.
 */
describe('classifyArtifactPath — the B13 table, first match wins', () => {
  test('readme: basename starting README, any extension or case', () => {
    expect(classifyArtifactPath('README.md')).toBe('readme');
    expect(classifyArtifactPath('server/readme.txt')).toBe('readme');
    // Beats the `.md` docs branch below it.
    expect(classifyArtifactPath('docs/README.md')).toBe('readme');
  });

  test('changelog: basename starting CHANGELOG', () => {
    expect(classifyArtifactPath('CHANGELOG.md')).toBe('changelog');
    expect(classifyArtifactPath('server/changelog.md')).toBe('changelog');
  });

  test('plan: a /plans/ directory anywhere, or a .plan.md basename', () => {
    expect(classifyArtifactPath('plans/x.md')).toBe('plan');
    expect(classifyArtifactPath('~/.claude/plans/gate-checks.md')).toBe('plan');
    expect(classifyArtifactPath('notes/rework.plan.md')).toBe('plan');
  });

  test('prompt: anything under resources/prompts/', () => {
    expect(classifyArtifactPath('server/resources/prompts/development/x/prompt.yaml')).toBe(
      'prompt'
    );
    // Beats the config branch, which would otherwise claim every .yaml.
    expect(classifyArtifactPath('resources/prompts/a/config.yaml')).toBe('prompt');
  });

  test('gate: anything under resources/gates/', () => {
    expect(classifyArtifactPath('server/resources/gates/test-coverage/gate.yaml')).toBe('gate');
    expect(classifyArtifactPath('resources/gates/x/guidance.md')).toBe('gate');
  });

  test('test: the four basename shapes plus tests/ and __tests__/ directories', () => {
    expect(classifyArtifactPath('x.test.ts')).toBe('test');
    expect(classifyArtifactPath('src/thing.spec.tsx')).toBe('test');
    expect(classifyArtifactPath('suite/test_activation.py')).toBe('test');
    expect(classifyArtifactPath('suite/activation_test.py')).toBe('test');
    expect(classifyArtifactPath('server/tests/unit/plain.ts')).toBe('test');
    expect(classifyArtifactPath('src/__tests__/plain.ts')).toBe('test');
  });

  test('docs: a .md basename, or anything under docs/', () => {
    expect(classifyArtifactPath('docs/a.md')).toBe('docs');
    expect(classifyArtifactPath('notes/design.md')).toBe('docs');
    expect(classifyArtifactPath('docs/reference/gate-configuration.json')).toBe('docs');
  });

  test('config: the two config.json names, .config.<js|ts|mjs|cjs>, and yaml outside prompts/gates', () => {
    expect(classifyArtifactPath('server/config.json')).toBe('config');
    expect(classifyArtifactPath('server/config.schema.json')).toBe('config');
    expect(classifyArtifactPath('jest.config.mjs')).toBe('config');
    expect(classifyArtifactPath('vite.config.ts')).toBe('config');
    expect(classifyArtifactPath('.github/workflows/ci.yml')).toBe('config');
  });

  test('source: everything the table does not recognise', () => {
    expect(classifyArtifactPath('server/src/engine/gates/gate-manager.ts')).toBe('source');
    expect(classifyArtifactPath('Makefile')).toBe('source');
    // A plain .json that is not one of the two config names stays source.
    expect(classifyArtifactPath('server/package.json')).toBe('source');
  });

  test('backslash paths normalize, and a bare filename is not read as a directory match', () => {
    expect(classifyArtifactPath('server\\tests\\unit\\x.ts')).toBe('test');
    // `plans.md` is not `/plans/` — the separators are required.
    expect(classifyArtifactPath('plans.md')).toBe('docs');
  });
});

describe('classifyArtifactPaths — deduped, in ARTIFACT_KINDS order', () => {
  test('duplicate kinds collapse to one entry', () => {
    expect(classifyArtifactPaths(['a.test.ts', 'b.test.ts', 'tests/c.ts'])).toEqual(['test']);
  });

  test('results come back in ARTIFACT_KINDS order, not input order', () => {
    const kinds = classifyArtifactPaths(['README.md', 'server/tests/x.test.ts', 'src/a.ts']);
    expect(kinds).toEqual(['source', 'test', 'readme']);
    // Same set, reversed input — same output order.
    expect(classifyArtifactPaths(['src/a.ts', 'server/tests/x.test.ts', 'README.md'])).toEqual(
      kinds
    );
    for (let i = 1; i < kinds.length; i += 1) {
      expect(ARTIFACT_KINDS.indexOf(kinds[i]!)).toBeGreaterThan(
        ARTIFACT_KINDS.indexOf(kinds[i - 1]!)
      );
    }
  });

  test('empty and whitespace-only entries are ignored, not classified as source', () => {
    expect(classifyArtifactPaths(['', '   ', 'README.md'])).toEqual(['readme']);
  });
});

describe('resolveDeclaredArtifacts — produces ∪ classified argument paths', () => {
  test('no declaration yields nothing', () => {
    expect(resolveDeclaredArtifacts(undefined, { files: 'a.test.ts' })).toEqual([]);
  });

  test('produces alone needs no arguments', () => {
    expect(resolveDeclaredArtifacts({ produces: ['plan'] }, undefined)).toEqual(['plan']);
  });

  test('fromArgument splits on newlines, commas, and whitespace', () => {
    expect(
      resolveDeclaredArtifacts(
        { fromArgument: 'files' },
        { files: 'server/tests/x.test.ts, README.md\nCHANGELOG.md  docs/a.md' }
      )
    ).toEqual(['test', 'docs', 'readme', 'changelog']);
  });

  test('the two sources union and dedupe', () => {
    expect(
      resolveDeclaredArtifacts(
        { produces: ['plan', 'test'], fromArgument: 'files' },
        {
          files: 'a.test.ts README.md',
        }
      )
    ).toEqual(['test', 'readme', 'plan']);
  });

  test('a named argument that is absent or non-string contributes nothing, and never throws', () => {
    expect(resolveDeclaredArtifacts({ produces: ['plan'], fromArgument: 'files' }, {})).toEqual([
      'plan',
    ]);
    expect(
      resolveDeclaredArtifacts({ produces: ['plan'], fromArgument: 'files' }, { files: 42 })
    ).toEqual(['plan']);
  });
});
