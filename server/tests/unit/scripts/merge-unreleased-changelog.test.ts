/**
 * `scripts/merge-unreleased-changelog.js`, the release workflow's post-step, driven on
 * hand-written changelog fixtures in a temp directory.
 *
 * WHY THIS EXISTS. Release Please inserts each new `## [X.Y.Z]` section at the top of the file,
 * above `## [Unreleased]`. The script merged the Unreleased bullets into the new version but never
 * moved the header, so every release pushed it one section further down (it sat below 5.1.1 and
 * 5.1.0 on `main`, measured 2026-10-06). The empty-Unreleased case is the one that recurs, and the
 * script used to exit before doing anything on it.
 *
 * Classification: Unit (child process on a temp file; no network, no repo writes)
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const SCRIPT = path.join(REPO_ROOT, 'scripts/merge-unreleased-changelog.js');

const PREAMBLE = `# Changelog

Notes   about   the format.
  Odd  indentation stays.

`;

const V_NEW = `## [2.0.0](https://example.test/compare/v1.1.0...v2.0.0) (2026-02-02)

### Added

* new auto entry (#2)

### Fixed

* auto fix (#3)

`;

const V_MID = `## [1.1.0](https://example.test/compare/v1.0.0...v1.1.0) (2026-01-02)

### Changed

* middle entry   with  odd   spacing


`;

const V_OLD = `## [1.0.0] (2026-01-01)

### Added

* first entry
`;

let dir: string;
let file: string;

function run(content: string): { output: string; after: string } {
  writeFileSync(file, content, 'utf-8');
  const output = execFileSync('node', [SCRIPT, file], { encoding: 'utf-8' });
  return { output: output.trim(), after: readFileSync(file, 'utf-8') };
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'merge-unreleased-'));
  file = path.join(dir, 'CHANGELOG.md');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('merge-unreleased-changelog', () => {
  it('a: merges bullets from an Unreleased block below the newest version and moves the header to the top', () => {
    const unreleased = `## [Unreleased]

### Added

* manual entry with detail

### Documentation

* manual docs entry

`;
    const { output, after } = run(`${PREAMBLE}${V_NEW}${unreleased}${V_MID}${V_OLD}`);

    const expectedNewest = `## [2.0.0](https://example.test/compare/v1.1.0...v2.0.0) (2026-02-02)

### Added

* manual entry with detail
* new auto entry (#2)

### Fixed

* auto fix (#3)

### Documentation

* manual docs entry

`;
    expect(after).toBe(`${PREAMBLE}## [Unreleased]\n\n${expectedNewest}${V_MID}${V_OLD}`);
    expect(after.match(/^## \[Unreleased\]/gm)).toHaveLength(1);
    expect(after.endsWith(`${V_MID}${V_OLD}`)).toBe(true);
    expect(output).toContain('Merged 2 manual entries');
    expect(output).toContain('moved [Unreleased]');
  });

  it('b: relocates an empty Unreleased from two releases down to the top and changes nothing else', () => {
    const { output, after } = run(`${PREAMBLE}${V_NEW}${V_MID}## [Unreleased]\n\n\n\n${V_OLD}`);

    expect(after).toBe(`${PREAMBLE}## [Unreleased]\n\n${V_NEW}${V_MID}${V_OLD}`);
    expect(output).toContain('moved [Unreleased]');
  });

  it('c: leaves a file with an empty Unreleased already at the top byte-identical', () => {
    const input = `${PREAMBLE}## [Unreleased]\n\n${V_NEW}${V_MID}${V_OLD}`;
    const { output, after } = run(input);

    expect(after).toBe(input);
    expect(output).toMatch(/nothing to (merge|do)/i);
  });

  // A changelog with no Unreleased header has chosen not to keep one. Inventing one would add a
  // section the maintainers never asked for and a diff on every release, so the file is left alone.
  it('d: leaves a file with no Unreleased header byte-identical', () => {
    const input = `${PREAMBLE}${V_NEW}${V_MID}${V_OLD}`;
    const { output, after } = run(input);

    expect(after).toBe(input);
    expect(output).toMatch(/no \[Unreleased\] section/i);
  });
});
