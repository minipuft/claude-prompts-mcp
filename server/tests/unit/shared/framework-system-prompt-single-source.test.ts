// @lifecycle test - Keeps a framework's system prompt to one source (R91, row P4.122)
/**
 * A framework's system prompt has ONE source: `systemPromptGuidance` in `framework.yaml`, the
 * only text the runtime serves (owner ruling R91).
 *
 * Before R91 a second one existed in name only. The scaffold, `resource_manager framework
 * create`/`update` and the version snapshot all wrote or read a `system-prompt.md` beside the
 * YAML, and `skills-sync` read a `systemPromptFile` key — while the runtime loader read neither.
 * Every one of those sites answered "what is this framework's system prompt?" differently from
 * the server. Fixing the sites found is not closing the class, so this enumerates every source
 * file of both workspaces that can read or write a framework and fails when a new site names the
 * file or the key again. The bundled tree's half is `resource-file-set-bundled.test.ts`: a
 * `system-prompt.md` under a bundled framework is an unclaimed file there.
 *
 * What it matches: the file name as a QUOTED string literal ('…' or "…"), which is how a path is
 * built, and the key name anywhere. Not matched, on purpose: backticked prose in comments (which
 * is how this and other comments explain the history) and `skills-sync`'s export OUTPUT path
 * `${subDir}/references/system-prompt.md`, a file the exporter writes for a client, from the
 * inline text.
 *
 * Classification: Unit. Reads `server/src/**` and `cli/src/**`; writes nothing.
 */

import { readFile, readdir } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from '@jest/globals';

const SERVER_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SOURCE_ROOTS = [path.join(SERVER_ROOT, 'src'), path.join(SERVER_ROOT, '..', 'cli', 'src')];

/** A path to the file, built as a quoted string literal. */
const FILE_LITERAL = /(['"])system-prompt\.md\1/;
/** The YAML key that pointed at a system prompt file. */
const FILE_KEY = /\bsystemPromptFile\b/;

function findSecondSource(source: string): string[] {
  return source
    .split('\n')
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => FILE_LITERAL.test(line) || FILE_KEY.test(line))
    .map(({ line, number }) => `${number}: ${line.trim()}`);
}

async function walkTypeScript(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await walkTypeScript(full)));
    } else if (entry.name.endsWith('.ts')) {
      found.push(full);
    }
  }
  return found;
}

describe("a framework's system prompt has one source (R91)", () => {
  it('matches each shape a second source was written in, and not the prose or export path', () => {
    // Positive controls: the matcher fires on both shapes the removed sites used.
    expect(findSecondSource("const p = join(frameworkDir, 'system-prompt.md');")).toHaveLength(1);
    expect(findSecondSource('  const sysPromptFile = data.systemPromptFile;')).toHaveLength(1);
    // And stays quiet on what is allowed.
    expect(findSecondSource('// the file `system-prompt.md` is not read')).toEqual([]);
    expect(findSecondSource('relativePath: `${subDir}/references/system-prompt.md`,')).toEqual([]);
  });

  it('no source file in server/src or cli/src names a system prompt file', async () => {
    const files = (await Promise.all(SOURCE_ROOTS.map(walkTypeScript))).flat();
    // The walk reached both workspaces: a zero from an empty walk is not evidence.
    expect(files.some((file) => file.includes(`${path.sep}cli${path.sep}src${path.sep}`))).toBe(
      true
    );
    expect(files.length).toBeGreaterThan(500);

    const offenders: string[] = [];
    for (const file of files) {
      for (const hit of findSecondSource(await readFile(file, 'utf8'))) {
        offenders.push(`${path.relative(path.join(SERVER_ROOT, '..'), file)}:${hit}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
