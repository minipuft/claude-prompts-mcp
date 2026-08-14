import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const VALIDATOR = path.resolve(process.cwd(), 'scripts/validate-readme.js');

function validateFixture(body: string): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'validate-readme-'));
  const readme = path.join(directory, 'README.md');
  writeFileSync(readme, body);

  try {
    const result = spawnSync(process.execPath, [VALIDATOR, '--mode=warn', `--path=${readme}`], {
      encoding: 'utf8',
    });

    if (result.error) throw result.error;
    return result.stderr;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const BASE_README = `# Fixture

**Fixture tagline**

<!-- diataxis: how-to -->

## Quick Start

Run the fixture.
`;

describe('validate-readme reader-facing terminology', () => {
  test('keeps Diátaxis labels valid inside maintainer comments', () => {
    expect(validateFixture(BASE_README)).not.toContain('terminology:');
  });

  test('rejects Diátaxis terminology in reader-facing prose', () => {
    const output = validateFixture(`${BASE_README}\nThe docs use the Diátaxis framework.\n`);

    expect(output).toContain('terminology:');
    expect(output).toContain('describe the reader task instead');
  });
});
