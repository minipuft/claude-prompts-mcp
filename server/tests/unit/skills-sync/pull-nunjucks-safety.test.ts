import { describe, expect, it } from '@jest/globals';

import { parseSkillMd, hasNunjucksControlFlow } from '../../../src/modules/skills-sync/service.js';

// ─── parseSkillMd: Order-aware section boundary ─────────────────────────────

describe('parseSkillMd — order-aware section boundaries', () => {
  const wrapSkillMd = (body: string) => `---\nname: Test\ndescription: Test skill\n---\n${body}`;

  it('treats ## Instructions inside ## Usage as content, not a boundary', () => {
    const content = wrapSkillMd(
      `## Arguments\n\n- \`$0\` — **target** (required): The target\n\n` +
        `## Usage\n\nReview the following:\n\n**Target**: {target}\n\n` +
        `## Instructions\n\n1. Execute the tool\n2. Report results\n\n` +
        `## Expected Workflow\n\nBefore committing, ensure:\n- [ ] Tests pass`
    );

    const parsed = parseSkillMd(content);

    // ## Instructions after ## Usage should be content of Usage, not a new section
    expect(parsed.userMessage).toContain('## Instructions');
    expect(parsed.userMessage).toContain('Execute the tool');
    expect(parsed.userMessage).toContain('Expected Workflow');
    // Instructions section should NOT be separately parsed (it's inside Usage)
    expect(parsed.systemMessage).toBeNull();
  });

  it('splits normal section order correctly', () => {
    const content = wrapSkillMd(
      `## Instructions\n\nYou are a reviewer.\n\n## Review Depth\n\n- Surface\n- Deep\n\n` +
        `## Arguments\n\n- \`$0\` — **target** (required): File path\n\n` +
        `## Usage\n\nReview: {target}`
    );

    const parsed = parseSkillMd(content);

    expect(parsed.systemMessage).toContain('You are a reviewer');
    // Sub-heading ## Review Depth is content of Instructions
    expect(parsed.systemMessage).toContain('Review Depth');
    expect(parsed.userMessage).toContain('Review: {target}');
    expect(parsed.arguments).toHaveLength(1);
    expect(parsed.arguments[0]!.name).toBe('target');
  });

  it('handles missing sections without breaking order logic', () => {
    // No Instructions section — jumps straight to Arguments then Usage
    const content = wrapSkillMd(
      `## Arguments\n\n- \`$0\` — **target** (required): File path\n\n` +
        `## Usage\n\nRun the tool with {target}`
    );

    const parsed = parseSkillMd(content);

    expect(parsed.systemMessage).toBeNull();
    expect(parsed.userMessage).toContain('Run the tool');
    expect(parsed.arguments).toHaveLength(1);
  });

  it('handles ## Quality Gates between ## Arguments and ## Usage', () => {
    const content = wrapSkillMd(
      `## Instructions\n\nBe thorough.\n\n` +
        `## Arguments\n\n- \`$0\` — **target** (required): Target\n\n` +
        `## Quality Gates\n\n### Criteria\n\n| Gate | Type |\n|------|------|\n| code-quality | validation |\n\n` +
        `## Usage\n\nReview {target}`
    );

    const parsed = parseSkillMd(content);

    expect(parsed.systemMessage).toContain('Be thorough');
    expect(parsed.userMessage).toContain('Review {target}');
    expect(parsed.qualityGates).toHaveLength(1);
  });
});

// ─── parseSkillMd: edge inputs ──────────────────────────────────────────────

describe('parseSkillMd — edge inputs', () => {
  it('parses a SKILL.md with no frontmatter as claude-code with empty identity', () => {
    const parsed = parseSkillMd('## Instructions\n\nBe brief.\n\n## Usage\n\nDo {x}');

    expect(parsed.frontmatter).toEqual({});
    expect(parsed.format).toBe('claude-code');
    expect(parsed.name).toBe('');
    expect(parsed.description).toBe('');
    // The whole text is body, so sections still parse.
    expect(parsed.systemMessage).toBe('Be brief.');
    expect(parsed.userMessage).toBe('Do {x}');
  });

  it('treats an empty frontmatter fence as no frontmatter', () => {
    const parsed = parseSkillMd('---\n---\n## Usage\n\nGo');

    expect(parsed.frontmatter).toEqual({});
    // No frontmatter is parsed and the heading after the fence is still found.
    expect(parsed.userMessage).toBe('Go');
  });

  it('reports an empty name when frontmatter omits it', () => {
    const parsed = parseSkillMd('---\ndescription: Only a description\n---\n## Usage\n\nGo');

    expect(parsed.name).toBe('');
    expect(parsed.description).toBe('Only a description');
  });

  it('detects agent-skills format from a compatibility object', () => {
    const parsed = parseSkillMd(
      '---\nname: T\ncompatibility:\n  agent-skills: "1.0"\n---\n## Usage\n\nGo'
    );

    expect(parsed.format).toBe('agent-skills');
    expect(parsed.name).toBe('T');
  });

  it('ignores a whitespace-only ## heading and keeps it as section content', () => {
    // `##   ` matches the heading pattern but trims to empty, so it opens no section.
    const parsed = parseSkillMd('## Instructions\n\nFirst\n##   \nSecond');

    expect(parsed.sections.size).toBe(1);
    expect(parsed.systemMessage).toBe('First\n##   \nSecond');
  });

  it('parses registered gates and inline criteria from the Quality Gates section', () => {
    const parsed = parseSkillMd(
      [
        '## Quality Gates',
        '',
        '### Criteria',
        '',
        '| Gate | Type |',
        '| --- | --- |',
        '| code-quality | validation |',
        '',
        '### Inline Criteria',
        '',
        '- Be concise',
        '- Cite sources',
        'not a bullet',
        '',
        '## Usage',
        '',
        'Go',
      ].join('\n')
    );

    expect(parsed.qualityGates).toEqual([
      { id: 'code-quality', source: 'registered' },
      { id: 'Be concise', source: 'inline' },
      { id: 'Cite sources', source: 'inline' },
    ]);
    expect(parsed.userMessage).toBe('Go');
  });

  it('returns no gates when the Quality Gates section has neither table rows nor inline criteria', () => {
    const parsed = parseSkillMd('## Quality Gates\n\nNothing structured here.\n\n## Usage\n\nGo');

    expect(parsed.qualityGates).toEqual([]);
  });

  it('reads agent-skills argument bullets, required or not', () => {
    const parsed = parseSkillMd(
      '## Arguments\n\n- **target** (required): File path\n- **depth**: How deep\n'
    );

    expect(parsed.arguments).toEqual([
      { index: 0, name: 'target', required: true, description: 'File path' },
      { index: 1, name: 'depth', required: false, description: 'How deep' },
    ]);
  });
});

// ─── hasNunjucksControlFlow ─────────────────────────────────────────────────

describe('hasNunjucksControlFlow', () => {
  it('detects {% if %} blocks', () => {
    expect(hasNunjucksControlFlow('{% if project_path %}content{% endif %}')).toBe(true);
  });

  it('detects {%- if %} (whitespace-trimming variant)', () => {
    expect(hasNunjucksControlFlow('{%- if skip_tests %}content{% endif %}')).toBe(true);
  });

  it('detects {% for %} loops', () => {
    expect(hasNunjucksControlFlow('{% for item in items %}{{ item }}{% endfor %}')).toBe(true);
  });

  it('detects {% macro %} definitions', () => {
    expect(hasNunjucksControlFlow('{% macro render(x) %}{{ x }}{% endmacro %}')).toBe(true);
  });

  it('detects {% set %} assignments', () => {
    expect(hasNunjucksControlFlow('{% set name = "value" %}')).toBe(true);
  });

  it('does NOT flag simple {{ variable }} references', () => {
    expect(hasNunjucksControlFlow('Hello {{ name }}, welcome to {{ place }}')).toBe(false);
  });

  it('does NOT flag plain text without any Nunjucks', () => {
    expect(hasNunjucksControlFlow('Just plain text with no templates')).toBe(false);
  });

  it('does NOT flag curly braces in code blocks', () => {
    expect(hasNunjucksControlFlow('```\nconst obj = { if: true };\n```')).toBe(false);
  });
});
