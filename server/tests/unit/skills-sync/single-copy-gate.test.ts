// @lifecycle canonical - R0C3.2: the skills-sync target walk and the skill emitters exist once across the module.
/**
 * MEASURED 2026-10-13 on `eefe1c59`: `export`, `sync`, `diff` and `pull` each carried their own
 * copy of the client-target walk (four "no registrations" skip lines, three symlink-collision
 * guards, four duplicate-id counts), and the Claude Code and Agent Skills adapters each carried
 * their own copy of every SKILL.md section and the tool-file emission. Copies drift: the two
 * adapters' bodies were byte-identical only by care. R0C3.2 moved each to one definition; this
 * test holds the class by counting, across every `.ts` file in the module, a literal each copy
 * would necessarily carry. The planted controls prove a second copy is reported.
 */
import { describe, expect, test } from '@jest/globals';

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../src/modules/skills-sync'
);

/** Every `.ts` file under the module, recursively, so a new file is counted without editing this. */
function moduleSources(dir: string = MODULE_DIR): Map<string, string> {
  const sources = new Map<string, string>();
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      for (const [file, text] of moduleSources(full)) sources.set(file, text);
    } else if (entry.name.endsWith('.ts')) {
      sources.set(path.relative(MODULE_DIR, full), readFileSync(full, 'utf-8'));
    }
  }
  return sources;
}

/**
 * Literals that occur once, as source text (a `\n` here is the two characters in a template
 * literal). Grouped by the copy each one would expose.
 */
const SINGLE_COPY_LITERALS: Record<string, readonly string[]> = {
  'client-target walk': [
    'Unknown client:',
    'no registrations in skills-sync.yaml',
    'symlink collision',
    'same directory as',
    'function* clientScopeTargets',
    'function loadClientRunInputs',
    'idCounts.set(',
  ],
  'instruction sections': ['function buildInstructionSections', '## Instructions\\n\\n'],
  'arguments section': ['function buildArgumentsSection', '## Arguments\\n\\n'],
  'usage section': ['function buildUsageSection', '## Usage\\n\\n'],
  'phases section': ['function buildPhasesSection', '## Phases\\n\\n'],
  'style section': ['function buildStyleConfigSection', '## Style Configuration\\n\\n'],
  'skill body order': ['function buildSkillBody', 'buildQualityGatesSection(gatePartition'],
  'tool files': ['function emitScriptToolFiles', '`${toolSubDir}/tool.json`'],
  'bundled files': ['function emitBundledResourceFiles', 'emitGateFiles(gateRefsForEmit('],
};

/** `literal → [file:count, ...]` for every literal that does not occur exactly once. */
function extraCopies(sources: ReadonlyMap<string, string>): Record<string, string[]> {
  const offenders: Record<string, string[]> = {};
  for (const literal of Object.values(SINGLE_COPY_LITERALS).flat()) {
    const hits: string[] = [];
    let total = 0;
    for (const [file, text] of sources) {
      const count = text.split(literal).length - 1;
      if (count > 0) hits.push(`${file}:${count}`);
      total += count;
    }
    if (total !== 1) offenders[literal] = hits;
  }
  return offenders;
}

describe('skills-sync single-copy gate (R0C3.2)', () => {
  test('the module is read from its directory, not a hard-coded file list', () => {
    const files = [...moduleSources().keys()];
    expect(files).toEqual(expect.arrayContaining(['service.ts', 'client-targets.ts']));
  });

  test('each target-walk and emitter literal occurs exactly once across the module', () => {
    expect(extraCopies(moduleSources())).toEqual({});
  });

  test('a planted second copy of the skip line is reported (control)', () => {
    const sources = moduleSources();
    sources.set(
      'planted.ts',
      'output.log(`\\n── ${clientId}: skipped — no registrations in skills-sync.yaml`);'
    );
    expect(Object.keys(extraCopies(sources))).toEqual(['no registrations in skills-sync.yaml']);
  });

  test('a planted second copy of an emitter body is reported (control)', () => {
    const sources = moduleSources();
    sources.set('planted.ts', 'if (ir.styleData) { body += `## Style Configuration\\n\\n`; }');
    expect(Object.keys(extraCopies(sources))).toEqual(['## Style Configuration\\n\\n']);
  });
});
