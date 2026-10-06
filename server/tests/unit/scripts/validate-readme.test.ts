import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

describe('validate-readme prompt operands', () => {
  // Resolution runs against the repo's real shipped prompt set, so the ids below are ones that
  // shipped before the operand check existed; `ghost_*` ids ship nowhere.
  const operandFindings = (body: string): string[] =>
    validateFixture(`${BASE_README}\n${body}`)
      .split('\n')
      .filter((line) => line.includes('prompt-operand:'));

  test('accepts a prompt the package ships', () => {
    expect(operandFindings('Run `>>minimal_prompt`.\n')).toEqual([]);
  });

  test('rejects a prompt nothing ships, naming it', () => {
    const findings = operandFindings('Run `>>ghost_prompt`.\n');
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('ghost_prompt');
  });

  test('resolves a nested chain step by its parent/step id', () => {
    expect(operandFindings('Run `>>deep_analysis/initial_scan`.\n')).toEqual([]);
  });

  test('normalises hyphens the way the parser does', () => {
    expect(operandFindings('Run `>>minimal-prompt`.\n')).toEqual([]);
  });

  test('checks chain and delegation operands inside a fence', () => {
    const findings = operandFindings(
      '```\n>>minimal_prompt --> ghost_step ==> >>ghost_handoff\n```\n'
    );
    expect(findings).toHaveLength(2);
    expect(findings.join('\n')).toContain('ghost_step');
    expect(findings.join('\n')).toContain('ghost_handoff');
  });

  test('matches each inline span on its own, so adjacent table cells never join', () => {
    expect(operandFindings('| `>>` | `ghost_prompt` |\n')).toEqual([]);
  });

  test('accepts a placeholder declared in its own section', () => {
    const body = '## Compose\n\n<!-- illustrative-prompts: ghost_step -->\n\n`--> ghost_step`\n';
    expect(operandFindings(body)).toEqual([]);
  });

  test('a declaration stops at the next heading', () => {
    const body =
      '## One\n\n<!-- illustrative-prompts: ghost_step -->\n\n`>>ghost_step`\n\n## Two\n\n`>>ghost_step`\n';
    expect(operandFindings(body)).toHaveLength(1);
  });

  test('a heading-shaped line inside a fence does not end the section', () => {
    const body =
      '## One\n\n<!-- illustrative-prompts: ghost_step -->\n\n```bash\n# Try it\n>>ghost_step\n```\n';
    expect(operandFindings(body)).toEqual([]);
  });

  test('reports a declaration its section no longer names', () => {
    const findings = operandFindings(
      '## One\n\n<!-- illustrative-prompts: ghost_step -->\n\nNo commands.\n'
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('no longer names it');
  });

  test('skips the words the parser lists as built-in commands', () => {
    const parserSource = readFileSync(
      path.resolve(process.cwd(), 'src/engine/execution/parsers/command-parser.ts'),
      'utf8'
    );
    const listed = [
      ...(parserSource.match(/const builtinCommands = \[([^\]]*)\]/)?.[1] ?? '').matchAll(
        /'([^']+)'/g
      ),
    ].map((m) => m[1]);
    expect(listed.length).toBeGreaterThan(0);
    expect(operandFindings(`${listed.map((word) => `\`>>${word}\``).join(' ')}\n`)).toEqual([]);
  });

  test('skips the words the routing patterns answer, including the optional-letter spellings', () => {
    const words = [
      'listprompt',
      'listprompts',
      'help',
      'status',
      'framework',
      'analytic',
      'guide',
      'gate',
    ];
    expect(operandFindings(`${words.map((word) => `\`>>${word}\``).join(' ')}\n`)).toEqual([]);
  });

  test('still rejects a word that is not built in', () => {
    expect(operandFindings('Run `>>helpful_ghost`.\n')).toHaveLength(1);
  });

  test('reports a built-in word declared illustrative', () => {
    const findings = operandFindings('## One\n\n<!-- illustrative-prompts: help -->\n\n`>>help`\n');
    expect(findings).toHaveLength(1);
  });

  test('reports a declared placeholder that actually ships', () => {
    const body = '## One\n\n<!-- illustrative-prompts: minimal_prompt -->\n\n`>>minimal_prompt`\n';
    const findings = operandFindings(body);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('but ships');
  });
});

describe('validate-readme operand pages', () => {
  test('the default run reads the README, every tutorial and the tools reference', () => {
    const result = spawnSync(process.execPath, [VALIDATOR, '--mode=block'], {
      encoding: 'utf8',
    });

    if (result.error) throw result.error;
    expect(result.status).toBe(0);
    const pages = Number(result.stdout.match(/(\d+) page\(s\)/)?.[1]);
    // README.md + at least one tutorial + docs/reference/mcp-tools.md
    expect(pages).toBeGreaterThanOrEqual(3);
  });
});
