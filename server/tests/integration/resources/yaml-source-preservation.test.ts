/**
 * A resource edit must change the lines it names and no others.
 *
 * Every fixture below is HAND-AUTHORED, and that is the whole point. A fixture produced by
 * writing a value out and reading it back can only ever prove the writer is idempotent with
 * itself — it is already in the serializer's preferred shape, so nothing it could normalize
 * away is present to lose. These carry what a person's file carries and a serializer does not
 * reproduce: a comment above a key, a trailing comment, keys out of alphabetical order, a
 * flow-style sequence, folded and literal block scalars, a quoted string that needs no quotes,
 * and blank lines between sections.
 *
 * Each case asserts the diff is confined to the edited field's own lines AND runs a positive
 * control through the previous serializer on the same input. Without that control, "only one
 * line changed" is unfalsifiable: a writer that returned its input unchanged would pass every
 * assertion here, and so would one measured against a fixture with nothing to lose.
 */

import { describe, test, expect } from '@jest/globals';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { serializeYaml } from '../../../src/shared/utils/yaml/yaml-parser.js';
import { serializeYamlPreservingSource } from '../../../src/shared/utils/yaml/yaml-document-writer.js';
import { parseYaml } from '../../../src/shared/utils/yaml/yaml-parser.js';

/** Line numbers (1-based) at which two texts differ. */
function changedLines(before: string, after: string): number[] {
  const a = before.split('\n');
  const b = after.split('\n');
  const out: number[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (a[i] !== b[i]) out.push(i + 1);
  }
  return out;
}

const commentCount = (text: string): number => (text.match(/^\s*#/gm) ?? []).length;

/** A hand-authored file, the edit to apply to it, and where that edit is allowed to show up. */
interface Fixture {
  name: string;
  filename: string;
  source: string;
  /** Applied to the parsed value to produce what the writer is asked to write. */
  edit: (value: Record<string, unknown>) => Record<string, unknown>;
  /** The 1-based source line the edited field occupies. */
  editedLine: number;
}

const FIXTURES: Fixture[] = [
  {
    name: 'prompt',
    filename: 'prompt.yaml',
    // Key order is deliberately not alphabetical, `category` is quoted without needing to be,
    // and the description is a folded scalar wrapped wider than the serializer's 80 columns.
    source: `# Authored by hand — the ordering below is meaningful to a reader, not to a parser.
id: content_analysis
name: Content Analysis
category: "analysis"

# The description is folded so it reads as one paragraph when loaded.
description: >-
  Analyse a supplied document and report its claims, the evidence offered for each one, and the
  claims that are offered with no evidence at all.

arguments:
  - name: document # the text to analyse
    required: true
  - name: depth
    required: false

tools: [text_digest, citation_check]
`,
    edit: (value) => ({ ...value, name: 'Document Analysis' }),
    editedLine: 3,
  },
  {
    name: 'gate',
    filename: 'gate.yaml',
    source: `# A gate the operator tuned by hand; the thresholds below were measured, not guessed.
id: coverage-floor
name: Coverage Floor
type: validation
severity: high

guidanceFile: guidance.md # lives beside this file

pass_criteria:
  - type: inline_guidance

# Two attempts, because a third has never once succeeded here.
retry_config:
  max_attempts: 2
  improvement_hints: true
`,
    edit: (value) => ({ ...value, severity: 'critical' }),
    editedLine: 5,
  },
  {
    name: 'category',
    filename: 'category.yaml',
    source: `# Categories are listed in the order the menu shows them.
id: development
name: Development

description: |
  Prompts that operate on a working tree.
  Each one assumes a repository is checked out.

aliases: [dev, code]
`,
    edit: (value) => ({ ...value, name: 'Software Development' }),
    editedLine: 3,
  },
  {
    name: 'framework',
    filename: 'framework.yaml',
    source: `# CAGEERF — the phase names are load-bearing and must not be reordered.
id: cageerf
name: CAGEERF
version: 2.0.0
enabled: true

description: >-
  A six-phase framework that carries context, analysis, goals, execution, evaluation and
  refinement through a single prompt without collapsing any phase into another.

frameworkGates: [handoff-artifacts]

# Phases live in their own file so this one stays readable.
phasesFile: phases.yaml
`,
    edit: (value) => ({ ...value, version: '2.1.0' }),
    editedLine: 4,
  },
];

describe('resource writes preserve the source they did not edit', () => {
  let workdir: string;

  beforeEach(() => {
    workdir = mkdtempSync(path.join(tmpdir(), 'rt-yaml-preservation-'));
  });

  afterEach(() => {
    rmSync(workdir, { recursive: true, force: true });
  });

  test.each(FIXTURES)(
    "$name: editing one field changes only that field's line",
    ({ filename, source, edit, editedLine }) => {
      const filePath = path.join(workdir, filename);
      writeFileSync(filePath, source, 'utf8');

      const parsed = parseYaml<Record<string, unknown>>(readFileSync(filePath, 'utf8'));
      expect(parsed.success).toBe(true);

      const written = serializeYamlPreservingSource(edit(parsed.data!), source);
      writeFileSync(filePath, written.content, 'utf8');
      const onDisk = readFileSync(filePath, 'utf8');

      expect(changedLines(source, onDisk)).toEqual([editedLine]);
      expect(commentCount(onDisk)).toBe(commentCount(source));
      expect(written.fidelity).toBe('source-preserved');
    }
  );

  test.each(FIXTURES)(
    '$name: POSITIVE CONTROL — the previous serializer changes other lines',
    ({ source, edit }) => {
      const parsed = parseYaml<Record<string, unknown>>(source);
      const reserialized = serializeYaml(edit(parsed.data!), { sortKeys: false });

      // The control must FIRE: the old path has to disturb more than the one edited line and
      // drop comments, or the assertions above are measuring a fixture with nothing at stake.
      expect(changedLines(source, reserialized).length).toBeGreaterThan(1);
      expect(commentCount(source)).toBeGreaterThan(0);
      expect(commentCount(reserialized)).toBe(0);
    }
  );

  test('a write that changes nothing returns the source byte-for-byte', () => {
    for (const { source } of FIXTURES) {
      const parsed = parseYaml<Record<string, unknown>>(source);
      const written = serializeYamlPreservingSource(parsed.data!, source);
      expect(written.content).toBe(source);
      expect(written.fidelity).toBe('unchanged');
    }
  });

  test('a structural change keeps comments even though it re-renders', () => {
    const { source } = FIXTURES[1]!; // the gate fixture
    const parsed = parseYaml<Record<string, unknown>>(source);
    const written = serializeYamlPreservingSource(
      { ...parsed.data!, owner: 'platform-team' },
      source
    );

    expect(written.fidelity).toBe('reserialized');
    expect(written.content).toContain('owner: platform-team');
    // The document layer may re-wrap, but it must not silently discard the author's comments.
    expect(commentCount(written.content)).toBe(commentCount(source));
  });

  /**
   * The case the source-token path cannot express, and must not pretend to.
   *
   * `retries: "3"` is a QUOTED string. Asking for the number `3` is a scalar-for-scalar change,
   * so it reaches the source-token path — which cannot write it, because putting `3` inside those
   * quotes leaves a string on disk and the edit would report success having changed nothing. The
   * write has to come out as a real number by some other route.
   */
  test('an edit the source-token path cannot express is applied, not skipped', () => {
    const source = `# tuned by hand\nid: retry-gate\nretries: "3"\n`;
    const parsed = parseYaml<Record<string, unknown>>(source);
    const written = serializeYamlPreservingSource({ ...parsed.data!, retries: 3 }, source);

    const reloaded = parseYaml<Record<string, unknown>>(written.content);
    expect(reloaded.success).toBe(true);
    expect(reloaded.data!['retries']).toBe(3);
    expect(commentCount(written.content)).toBe(commentCount(source));
  });

  /**
   * The defect that reached the mutation transaction before it was caught.
   *
   * Replacing a folded block scalar with another multi-line value is a scalar-for-scalar change,
   * so it reached the source-token path — which wrote the new text into the block's token without
   * re-indenting its continuation lines. The block ended early and `## Method` landed at column 0,
   * so the file no longer parsed at all. Output that cannot be read back is the one failure this
   * module must never produce: a re-wrapped file is a cosmetic loss, a corrupt one is data loss.
   */
  test('replacing a block scalar with a multi-line value still parses', () => {
    const source = [
      '# authored',
      'id: probe',
      'systemPromptGuidance: >',
      '  ## Method',
      '',
      '  Work phase by phase.',
      'version: 1.0.0',
      '',
    ].join('\n');

    const parsed = parseYaml<Record<string, unknown>>(source);
    const replacement = '## Method\n\nExplain the tradeoffs in detail.\n\nName every assumption.\n';
    const written = serializeYamlPreservingSource(
      { ...parsed.data!, systemPromptGuidance: replacement },
      source
    );

    const reloaded = parseYaml<Record<string, unknown>>(written.content);
    expect(reloaded.success).toBe(true);
    expect(reloaded.data!['systemPromptGuidance']).toBe(replacement);
    expect(reloaded.data!['version']).toBe('1.0.0');
    expect(commentCount(written.content)).toBe(commentCount(source));
  });

  test('no prior file renders from scratch rather than failing', () => {
    const written = serializeYamlPreservingSource({ id: 'fresh', name: 'Fresh' }, undefined);
    expect(written.fidelity).toBe('created');
    expect(written.content).toContain('id: fresh');
  });
});
