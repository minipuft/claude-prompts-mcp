// @lifecycle canonical - Closes the class `GateManager.stateManager` (row B.95) was one instance of.
/**
 * Gate Master Switch Seam
 *
 * `GateManager` declared `private stateManager: GateStateStore | null = null`, read it in three
 * places, and nothing in `src/` ever assigned it. Its `isSystemEnabled()` override therefore took
 * the "no state manager, assume enabled" branch on every call and answered `true` however the gate
 * master switch was set, while `getStatus().stateManagerConnected` answered `false` forever. Two
 * doc comments named that method as the switch the `prompt_engine` surface reads. Deleting the
 * field closes the instance; this file closes the shape.
 *
 * PREDICATE (plain words): a `private`/`protected` class field in `server/src` whose declaration
 * initializes it to `null` or `undefined` (or declares it optional with no initializer), which is
 * READ through `this.<name>` somewhere else in its file, and which is never ASSIGNED through
 * `this.<name> = ...` anywhere in its file. Private and protected members are file-local by
 * construction, so a per-file scan is exhaustive for them — a cross-file search is not needed and
 * would not help.
 *
 * WHY THIS SHAPE AND NOT "ANY UNASSIGNED FIELD": a `Map`/`Set`/array field built at its
 * declaration and mutated through its own methods is never reassigned either, and is correct. The
 * initializer is what separates the two — a field that can only ever hold `null` and is never
 * assigned has exactly one reachable value, so every consumer takes one branch forever.
 *
 * FAMILY. `validate-state-field-writers.js` owns the same failure at the INTERFACE-field layer and
 * its charter says to add a member when no member owns a layer. This is the class-field layer. It
 * lives as a test rather than a `validate:*` script only because row B.95's file bounds stop at
 * tests; promoting it into that family is a follow-up, not a behaviour change.
 *
 * Classification: Unit (source text scan plus one in-memory `GateManager`, no I/O).
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from '@jest/globals';

import { GateManager } from '../../../src/engine/gates/gate-manager.js';

import type { Logger } from '../../../src/infra/logging/index.js';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const SERVER_SRC_ROOT = path.resolve(TEST_DIR, '../../../src');

/** A `private`/`protected` field declared with a null-ish or absent initializer. */
const NULLISH_FIELD_DECLARATION =
  /^\s*(?:private|protected)\s+(?!readonly\b|static\b|abstract\b)([A-Za-z_$][\w$]*)\s*\??\s*(?::[^=]*)?=\s*(?:null|undefined)\s*;\s*$/;

/** The same, in the `private name?: T;` form — also only ever `undefined` until assigned. */
const OPTIONAL_FIELD_DECLARATION =
  /^\s*(?:private|protected)\s+(?!readonly\b|static\b|abstract\b)([A-Za-z_$][\w$]*)\s*\?\s*:[^=]*;\s*$/;

export interface UnwrittenField {
  readonly name: string;
  readonly line: number;
  readonly reads: number;
}

/**
 * Every field in `source` matching the predicate.
 *
 * Exported shape kept plain so the positive control can drive it on a string literal without
 * touching disk — the control must exercise THIS function, not a copy of its regexes.
 */
export function findUnwrittenNullishFields(source: string): UnwrittenField[] {
  const lines = source.split('\n');
  const found: UnwrittenField[] = [];

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? '';
    const match = NULLISH_FIELD_DECLARATION.exec(line) ?? OPTIONAL_FIELD_DECLARATION.exec(line);
    if (!match) continue;

    const name = match[1];
    if (name === undefined) continue;

    // `this.x =` but not `this.x ==`/`this.x ===`; `??=` counts as a write too.
    const write = new RegExp(`this\\.${name}\\s*(?:=(?!=)|\\?\\?=)`);
    const read = new RegExp(`this\\.${name}\\b`);

    let writes = 0;
    let reads = 0;
    for (let other = 0; other < lines.length; other++) {
      if (other === index) continue;
      const text = lines[other] ?? '';
      if (write.test(text)) writes++;
      else if (read.test(text)) reads++;
    }

    if (writes === 0 && reads > 0) {
      found.push({ name, line: index + 1, reads });
    }
  }

  return found;
}

function everyTypeScriptFile(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '_generated' || entry.name === 'node_modules') continue;
      out.push(...everyTypeScriptFile(full));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('a private field that can only ever be null is never left with readers', () => {
  const files = everyTypeScriptFile(SERVER_SRC_ROOT);

  test('the scan reaches the tree it claims to (positive control)', () => {
    expect(files.length).toBeGreaterThan(200);
    expect(files.some((f) => f.endsWith(path.join('engine', 'gates', 'gate-manager.ts')))).toBe(
      true
    );
  });

  test('the predicate fires on the shape it names (positive control)', () => {
    const planted = [
      'class Planted {',
      '  private seam: Thing | null = null;',
      '  use(): boolean {',
      '    if (!this.seam) return true;',
      '    return this.seam.ask();',
      '  }',
      '}',
    ].join('\n');

    expect(findUnwrittenNullishFields(planted).map((f) => f.name)).toEqual(['seam']);
  });

  test('a twin differing only in having a writer is not reported (negative control)', () => {
    // Same declaration, same reads, one assignment — and the assignment's value is on the NEXT
    // line, the form that made a first cut of this predicate miss it.
    const planted = [
      'class Planted {',
      '  private seam: Thing | null = null;',
      '  build(): void {',
      '    this.seam =',
      '      makeThing();',
      '  }',
      '  use(): boolean {',
      '    if (!this.seam) return true;',
      '    return this.seam.ask();',
      '  }',
      '}',
    ].join('\n');

    expect(findUnwrittenNullishFields(planted)).toEqual([]);
  });

  test('no file under server/src holds one', () => {
    const findings: string[] = [];
    for (const file of files) {
      for (const field of findUnwrittenNullishFields(readFileSync(file, 'utf8'))) {
        findings.push(
          `${path.relative(SERVER_SRC_ROOT, file)}:${field.line} ${field.name} (${field.reads} reads, 0 writes)`
        );
      }
    }

    expect(findings.sort()).toEqual([]);
  });
});

describe('GateManager does not answer the gate master switch', () => {
  const logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  } as unknown as Logger;

  test('its status reports no state-store connection it could never have had', () => {
    const status = new GateManager(logger).getStatus();

    expect(status).toEqual({ enabled: true, initialized: false, registryStats: null });
    expect(Object.keys(status)).not.toContain('stateManagerConnected');
  });

  test('no comment in server/src still cites the deleted seam', () => {
    const stale = ['setStateManager', 'stateManagerConnected', 'GateManager.isGateSystemEnabled'];
    const hits: string[] = [];

    for (const file of everyTypeScriptFile(SERVER_SRC_ROOT)) {
      const content = readFileSync(file, 'utf8');
      for (const symbol of stale) {
        if (content.includes(symbol)) {
          hits.push(`${path.relative(SERVER_SRC_ROOT, file)} cites ${symbol}`);
        }
      }
    }

    expect(hits.sort()).toEqual([]);

    // Positive control: the same scan finds the symbol that DID survive the deletion, so an
    // empty result above is an absence rather than a scan that read nothing.
    const survivor = everyTypeScriptFile(SERVER_SRC_ROOT).filter((file) =>
      readFileSync(file, 'utf8').includes('isGateSystemEnabled')
    );
    expect(survivor.length).toBeGreaterThan(0);
  });
});
