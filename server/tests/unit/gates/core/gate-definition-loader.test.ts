import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { GateDefinitionLoader } from '../../../../src/engine/gates/core/gate-definition-loader.js';

/**
 * Root-cause coverage for the guidance.md trailing-newline defect
 * (tutorial-rework B.18): `inlineReferencedFiles` used to `.trim()` the
 * content it read from `guidance.md`, so every loaded gate's `getGuidance()` — and anything that
 * falls back to it, like an update omitting `guidance` — disagreed with the file on disk by
 * exactly its leading/trailing whitespace. The prompt loader's equivalent inlining
 * (`yaml-prompt-loader.ts`, `systemMessageFile`/`userMessageTemplateFile`) never trimmed; this
 * brings the gate loader in line with that sibling.
 */
describe('GateDefinitionLoader guidance.md inlining', () => {
  let workspaceDir: string;
  let gatesDir: string;

  beforeEach(() => {
    workspaceDir = mkdtempSync(join(tmpdir(), 'cpm-gate-def-loader-'));
    gatesDir = join(workspaceDir, 'gates');
  });

  afterEach(() => {
    rmSync(workspaceDir, { recursive: true, force: true });
  });

  function writeGate(id: string, guidanceContent: string): string {
    const gateDir = join(gatesDir, id);
    mkdirSync(gateDir, { recursive: true });
    writeFileSync(
      join(gateDir, 'gate.yaml'),
      [
        `id: ${id}`,
        'name: Newline Gate',
        'type: validation',
        'description: Exercises guidance.md inlining',
        'guidanceFile: guidance.md',
        '',
      ].join('\n'),
      'utf8'
    );
    writeFileSync(join(gateDir, 'guidance.md'), guidanceContent, 'utf8');
    return gateDir;
  }

  test('inlines guidance.md verbatim, trailing newline included', () => {
    const guidanceContent = 'Check the thing.\n';
    writeGate('newline-gate', guidanceContent);

    const loader = new GateDefinitionLoader({ gatesDir });
    const definition = loader.loadGate('newline-gate');

    expect(definition).toBeDefined();
    // MUTATION KILLED: reverting the fix (`content.trim()` instead of `content`) drops the
    // trailing `\n` and this becomes `'Check the thing.'` — confirmed by applying the mutation,
    // re-running this file (red), and reverting.
    expect(definition?.guidance).toBe(guidanceContent);
  });

  test('inlines guidance.md verbatim when the file has no trailing newline', () => {
    const guidanceContent = 'Check the thing without a trailing newline.';
    writeGate('no-newline-gate', guidanceContent);

    const loader = new GateDefinitionLoader({ gatesDir });
    const definition = loader.loadGate('no-newline-gate');

    expect(definition?.guidance).toBe(guidanceContent);
  });

  test('preserves leading whitespace too — inlining is verbatim, not just trailing-newline-safe', () => {
    const guidanceContent = '\n  Indented first line.\nSecond line.\n';
    writeGate('leading-whitespace-gate', guidanceContent);

    const loader = new GateDefinitionLoader({ gatesDir });
    const definition = loader.loadGate('leading-whitespace-gate');

    expect(definition?.guidance).toBe(guidanceContent);
  });

  test('the guidanceFile reference itself is still removed after inlining', () => {
    writeGate('cleans-up-gate', 'Guidance body.\n');

    const loader = new GateDefinitionLoader({ gatesDir });
    const definition = loader.loadGate('cleans-up-gate');

    expect(definition?.guidanceFile).toBeUndefined();
  });
});
