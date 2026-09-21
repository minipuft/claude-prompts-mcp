// @lifecycle canonical - Gate: every VersionHistoryService built in src/ receives a file locator.
/**
 * A checkpoint can only record the files a resource is made of if its service was handed a
 * locator. The locator is OPTIONAL on the constructor — the unit suites build the service without
 * one and a missing locator degrades a row to projection-only rather than failing the save — so
 * nothing in the type system stops a fifth construction site from being added without it, and the
 * symptom of that omission is not an error: it is one resource type quietly recording no files.
 *
 * This is the enumeration that closes the class (`dev-workflow.md`: a fix at the sites you found
 * is not a fix of the class). It reads the SOURCE rather than importing the class, for the reason
 * design-object-store.md C6 records: a test that enumerates from the declaration under test drops
 * a site instead of failing on it. A construction site that stops matching the literal
 * `new VersionHistoryService(` is a site this gate cannot see, which is why the count is asserted
 * too — a site that disappears is as much a finding as one that arrives unwired.
 */

import { describe, it, expect } from '@jest/globals';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../src');
const CONSTRUCTION = 'new VersionHistoryService(';

/** Every `.ts` file under `src/`, found by walking the tree — not by any list a source declares. */
async function everySourceFile(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await everySourceFile(full)));
    else if (entry.name.endsWith('.ts')) found.push(full);
  }
  return found;
}

/**
 * The constructor argument text at each construction site in one file.
 *
 * Brace-balanced from the opening paren rather than regex-matched to the first `}`: the argument
 * is an object literal that may hold nested ones, and a first-`}` match would truncate before
 * reaching a field declared after a nested object — reading as "absent" for a site that has it.
 */
function constructorArguments(source: string): string[] {
  const args: string[] = [];
  let from = 0;
  for (;;) {
    const at = source.indexOf(CONSTRUCTION, from);
    if (at === -1) return args;
    let depth = 0;
    let index = at + CONSTRUCTION.length - 1;
    const start = index;
    do {
      const ch = source[index];
      if (ch === '(' || ch === '{') depth += 1;
      else if (ch === ')' || ch === '}') depth -= 1;
      index += 1;
    } while (depth > 0 && index < source.length);
    args.push(source.slice(start, index));
    from = index;
  }
}

describe('VersionHistoryService locator wiring (source scan)', () => {
  it('passes resourceFileLocator at every construction site in src/', async () => {
    const files = await everySourceFile(SRC_ROOT);
    const unwired: string[] = [];
    let sites = 0;

    for (const file of files) {
      const source = await readFile(file, 'utf8');
      if (!source.includes(CONSTRUCTION)) continue;
      for (const args of constructorArguments(source)) {
        sites += 1;
        if (!args.includes('resourceFileLocator')) {
          unwired.push(path.relative(SRC_ROOT, file));
        }
      }
    }

    expect(unwired).toEqual([]);
    // Four resource types, four tool handlers, four services. A different number means a site was
    // added or removed and this gate's coverage claim needs re-reading, not adjusting.
    expect(sites).toBe(4);
  });

  it('observes an unwired site (positive control)', () => {
    // The same brace-balanced reader, over a source that HAS the defect. Without this the
    // assertion above passes equally well against a scanner that finds nothing at all.
    const planted = [
      'const a = new VersionHistoryService({ logger, configManager, resourceFileLocator });',
      'const b = new VersionHistoryService({ logger, configManager: { nested: {} } });',
    ].join('\n');

    const args = constructorArguments(planted);
    expect(args).toHaveLength(2);
    expect(args.filter((text) => !text.includes('resourceFileLocator'))).toHaveLength(1);
    // And the nested literal did not truncate the second argument early.
    expect(args[1]).toContain('nested');
  });
});
