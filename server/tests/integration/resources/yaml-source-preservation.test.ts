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
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { parseDocument } from 'yaml';

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

  /**
   * The blank lines around the rewritten key survive — asserted as a DIGEST, not as a diff.
   *
   * P4.107 recorded that this writer "drops one blank line after the key it rewrites", measured
   * 2026-09-21 on the line after a framework's `enabled:`. Re-measured 2026-09-21 on this tree,
   * across every scalar shape a `cpm toggle` can land on, it does not reproduce: the CST path
   * replaces the scalar token and leaves every surrounding token, blank lines included, byte for
   * byte. The claim is therefore pinned rather than fixed, and pinned where it is cheapest to
   * falsify — one hash of the whole file, so a lost blank line anywhere fails, not only after the
   * edited key.
   *
   * The fixture is hand-authored and carries what a serializer does not reproduce: a leading
   * comment, keys out of alphabetical order, a flow-style sequence, a trailing comment, and blank
   * lines BEFORE and AFTER `enabled`. The CRLF twin is here because a line ending is exactly the
   * kind of byte a token-level writer normalizes silently.
   *
   * `expectedDigest` is computed from a string built independently of the writer — the fixture
   * text with one substring replaced — so the assertion cannot be satisfied by a writer that
   * returned its own output.
   */
  describe('a toggled scalar leaves every blank line around it', () => {
    const FIXTURE = [
      '# hand-authored: the ordering below is meaningful to a reader',
      'id: round_trip',
      'name: Round Trip',
      '',
      'enabled: false # flip me',
      '',
      'tags: [alpha, beta]',
      'description: >-',
      '  A framework whose description is folded wider than the serializer would wrap it, so a',
      '  re-render would be visible.',
      '',
    ].join('\n');

    const digest = (text: string): string =>
      createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');

    test.each([
      ['LF', FIXTURE],
      ['CRLF', FIXTURE.split('\n').join('\r\n')],
    ])('%s: flipping enabled changes that value and nothing else', (_name, source) => {
      const parsed = parseYaml<Record<string, unknown>>(source);
      expect(parsed.success).toBe(true);

      const written = serializeYamlPreservingSource({ ...parsed.data!, enabled: true }, source);

      // Built from the fixture, not from the writer: the only difference this write may make.
      const expected = source.replace('enabled: false', 'enabled: true');
      expect(digest(written.content)).toBe(digest(expected));
      expect(written.fidelity).toBe('source-preserved');
      // Named explicitly as well, because a digest match reports nothing about WHICH bytes moved
      // when it fails.
      expect(written.content).toContain('# flip me');
      expect(written.content).toContain('tags: [alpha, beta]');
    });

    test('POSITIVE CONTROL — the digest assertion sees a dropped blank line', () => {
      // The probe has to be shown to fire. Same comparison, against a string differing from the
      // expected output in exactly one blank line, and it must FAIL.
      const expected = FIXTURE.replace('enabled: false', 'enabled: true');
      const oneBlankLineShort = expected.replace(
        'enabled: true # flip me\n\n',
        'enabled: true # flip me\n'
      );

      expect(oneBlankLineShort).not.toBe(expected);
      expect(oneBlankLineShort.length).toBe(expected.length - 1);
      expect(digest(oneBlankLineShort)).not.toBe(digest(expected));
    });

    test('POSITIVE CONTROL — the previous serializer loses the layout this asserts', () => {
      // And the other half: the fixture must have something at stake. `serializeYaml` rewrites it
      // wholesale, so the digest of its output differs and the comments are gone.
      const parsed = parseYaml<Record<string, unknown>>(FIXTURE);
      const reserialized = serializeYaml({ ...parsed.data!, enabled: true }, { sortKeys: false });

      expect(digest(reserialized)).not.toBe(
        digest(FIXTURE.replace('enabled: false', 'enabled: true'))
      );
      // `commentCount` counts whole-line comments, so the fixture's leading one; the trailing
      // `# flip me` is checked by name because it is the harder of the two to preserve.
      expect(commentCount(FIXTURE)).toBe(1);
      expect(commentCount(reserialized)).toBe(0);
      expect(FIXTURE).toContain('# flip me');
      expect(reserialized).not.toContain('# flip me');
    });
  });
});

/**
 * A list that gains or loses items changes those items' lines and no others.
 *
 * Measured before this held, on the bundled `reference_demo` prompt that `DEMO` copies: a length
 * change replaced the whole list through the document layer, which kept 1 of the 5 comments (the
 * four inside `tools:` went with the old list) and folded the untouched 133-column `description`
 * onto two lines. The positive control below re-measures that against the same fixture.
 *
 * Every fixture is hand-authored, with comments inside and around its lists, keys out of
 * alphabetical order and at least one line longer than the serializer's 80 columns. Every expected
 * text is the fixture with named lines dropped or inserted, built without the writer.
 */
describe('a list that changes length keeps the lines the edit did not name', () => {
  type Value = Record<string, unknown>;

  const write = (source: string, edit: (value: Value) => Value) => {
    const parsed = parseYaml<Value>(source);
    expect(parsed.success).toBe(true);
    return serializeYamlPreservingSource(edit(parsed.data!), source);
  };

  /** `lines` without each named line, every one of which must be present. */
  const without = (lines: readonly string[], ...dropped: string[]): string[] => {
    for (const line of dropped) expect(lines).toContain(line);
    return lines.filter((line) => !dropped.includes(line));
  };

  /** `lines` with `added` placed right after the line `anchor`. */
  const after = (lines: readonly string[], anchor: string, ...added: string[]): string[] => {
    const at = lines.indexOf(anchor);
    expect(at).toBeGreaterThanOrEqual(0);
    return [...lines.slice(0, at + 1), ...added, ...lines.slice(at + 1)];
  };

  const reloads = (content: string): Value => {
    const reloaded = parseYaml<Value>(content);
    expect(reloaded.success).toBe(true);
    return reloaded.data!;
  };

  describe('a block list of plain values, with the list header comments of reference_demo', () => {
    const LINES = [
      'id: reference_demo',
      'name: Reference Syntax Demo',
      'description: Demonstrates template reference features - {{ref:id}} for prompt inclusion and {{script:id}} for inline script execution',
      'userMessageTemplateFile: user-message.md',
      '# Declare script tools available to this prompt',
      'tools:',
      '  # Two tools in one resource, deliberately: `word_count` runs automatically and',
      '  # `text_digest` requires approval, so the pair proves `confirm` is per-tool and',
      '  # behaves the same whether the tool is reached from this list or from a',
      '  # {{script:id}} reference in the template.',
      '  - word_count',
      '  - text_digest',
      'arguments:',
      '  - name: text',
      '    description: The text to analyze with the word_count script tool',
      '    required: true',
      '    type: string',
      '  - name: topic',
      '    description: Optional topic name for the introduction (demonstrates reference feature)',
      '    required: false',
      '    type: string',
      '',
    ];
    const DEMO = LINES.join('\n');
    const DESCRIPTION = LINES[2]!;

    test('shrinking the list removes the dropped item line and nothing else', () => {
      const written = write(DEMO, (value) => ({ ...value, tools: ['word_count'] }));

      expect(written.content).toBe(without(LINES, '  - text_digest').join('\n'));
      expect(commentCount(DEMO)).toBe(5);
      expect(commentCount(written.content)).toBe(5);
      expect(written.content.split('\n')).toContain(DESCRIPTION);
      expect(written.fidelity).toBe('source-preserved');
    });

    test('growing the list inserts the added item line and nothing else', () => {
      const written = write(DEMO, (value) => ({
        ...value,
        tools: ['word_count', 'text_digest', 'char_count'],
      }));

      expect(written.content).toBe(after(LINES, '  - text_digest', '  - char_count').join('\n'));
      expect(commentCount(written.content)).toBe(5);
      expect(written.content.split('\n')).toContain(DESCRIPTION);
      expect(written.fidelity).toBe('source-preserved');
    });

    test('removing the first item keeps the comments above it, which belong to the list', () => {
      const written = write(DEMO, (value) => ({ ...value, tools: ['text_digest'] }));

      expect(written.content).toBe(without(LINES, '  - word_count').join('\n'));
      expect(commentCount(written.content)).toBe(5);
      expect(written.fidelity).toBe('source-preserved');
    });

    test('inserting before the first item puts it under those comments', () => {
      const written = write(DEMO, (value) => ({
        ...value,
        tools: ['char_count', 'word_count', 'text_digest'],
      }));

      expect(written.content).toBe(
        after(LINES, '  # {{script:id}} reference in the template.', '  - char_count').join('\n')
      );
      expect(written.fidelity).toBe('source-preserved');
    });

    test('removing every item leaves `[]` under the comments, which still load as an empty list', () => {
      const written = write(DEMO, (value) => ({ ...value, tools: [] }));

      const expected = after(
        without(LINES, '  - word_count', '  - text_digest'),
        '  # {{script:id}} reference in the template.',
        '  []'
      );
      expect(written.content).toBe(expected.join('\n'));
      expect(commentCount(written.content)).toBe(5);
      expect(reloads(written.content)['tools']).toEqual([]);
      expect(written.fidelity).toBe('source-preserved');
    });

    test('a list with no comment above it empties to `key: []` on the key line', () => {
      const source = ['severity: high', 'tools:', '  - a', '  - b', 'id: plain', ''].join('\n');
      const written = write(source, (value) => ({ ...value, tools: [] }));

      expect(written.content).toBe(['severity: high', 'tools: []', 'id: plain', ''].join('\n'));
      expect(written.fidelity).toBe('source-preserved');
    });

    test('POSITIVE CONTROL — replacing the list wholesale, as before, loses 4 comments and folds the description', () => {
      // The previous path, reproduced on the same fixture: `setIn` swaps in a fresh list and
      // `toString` re-renders the document at the library's 80 columns. Without this, the
      // assertions above could be passing on a fixture with nothing at stake.
      const doc = parseDocument(DEMO);
      doc.setIn(['tools'], ['word_count']);
      const replaced = doc.toString();

      expect(commentCount(replaced)).toBe(1);
      expect(replaced.split('\n')).not.toContain(DESCRIPTION);
    });

    test('a CRLF file gets its added line with CRLF too', () => {
      const crlf = DEMO.split('\n').join('\r\n');
      const written = write(crlf, (value) => ({
        ...value,
        tools: ['word_count', 'text_digest', 'char_count'],
      }));

      expect(written.content).toBe(after(LINES, '  - text_digest', '  - char_count').join('\r\n'));
      expect(written.fidelity).toBe('source-preserved');
    });
  });

  describe('comments between the items of a block list', () => {
    const LINES = [
      '# Gates run in the order listed; a reviewer reads them top to bottom.',
      'severity: high',
      'gates:',
      '  - alpha',
      '  # beta is retired once gamma covers the same ground',
      '  - beta',
      '  # gamma checks the whole tree',
      '  - gamma',
      '  - delta # the slowest, so it runs last',
      'id: review-gates',
      'description: A gate set whose description runs well past eighty columns, so a re-render would fold it.',
      '',
    ];
    const SOURCE = LINES.join('\n');

    test.each([
      ['the first item', ['beta', 'gamma', 'delta'], ['  - alpha']],
      [
        'a middle item, with the comment directly above it',
        ['alpha', 'gamma', 'delta'],
        ['  # beta is retired once gamma covers the same ground', '  - beta'],
      ],
      [
        'the last item, with the comment on its line',
        ['alpha', 'beta', 'gamma'],
        ['  - delta # the slowest, so it runs last'],
      ],
    ])('removing %s drops exactly its lines', (_name, gates, dropped) => {
      const written = write(SOURCE, (value) => ({ ...value, gates }));

      expect(written.content).toBe(without(LINES, ...dropped).join('\n'));
      // The comment above a KEPT item (gamma) survives every removal.
      expect(written.content).toContain('  # gamma checks the whole tree\n  - gamma');
      expect(written.fidelity).toBe('source-preserved');
    });

    test('a list that kept its length is compared by position: the comments stay where they were', () => {
      const written = write(SOURCE, (value) => ({
        ...value,
        gates: ['delta', 'gamma', 'beta', 'alpha'],
      }));

      expect(written.content).toBe(
        SOURCE.replace('  - alpha', '  - delta')
          .replace('  - beta', '  - gamma')
          .replace('  - gamma\n  - delta #', '  - beta\n  - alpha #')
      );
      expect(written.fidelity).toBe('source-preserved');
    });

    test('a reorder that also changes length re-adds a moved item without its comments', () => {
      const written = write(SOURCE, (value) => ({ ...value, gates: ['gamma', 'alpha'] }));

      // gamma is the item both lists share; alpha and beta before it and delta after it are
      // removed, and alpha comes back after gamma as a new line. gamma's comment stays with it.
      const expected = after(
        without(
          LINES,
          '  - alpha',
          '  # beta is retired once gamma covers the same ground',
          '  - beta',
          '  - delta # the slowest, so it runs last'
        ),
        '  - gamma',
        '  - alpha'
      );
      expect(written.content).toBe(expected.join('\n'));
      expect(reloads(written.content)['gates']).toEqual(['gamma', 'alpha']);
      expect(written.fidelity).toBe('source-preserved');
    });

    test('with a key added in the same write it re-renders, and kept items keep their comments', () => {
      const written = write(SOURCE, (value) => ({
        ...value,
        gates: ['alpha', 'gamma', 'delta'],
        owner: 'platform-team',
      }));

      expect(written.fidelity).toBe('reserialized');
      expect(reloads(written.content)['gates']).toEqual(['alpha', 'gamma', 'delta']);
      expect(written.content).toContain('# gamma checks the whole tree');
      expect(written.content).toContain('# the slowest, so it runs last');
      expect(written.content).not.toContain('# beta is retired');
      expect(commentCount(written.content)).toBe(commentCount(SOURCE) - 1);
    });
  });

  describe('block lists of mappings', () => {
    const LINES = [
      '# A three-step chain; the steps were ordered by hand.',
      'name: Review Chain',
      'id: review_chain',
      'arguments:',
      '  - name: target # what to review',
      '    required: true',
      'chain_steps:',
      '  # Step 1 gathers context before anything is judged.',
      '  - promptId: gather',
      '    stepName: Gather',
      '    gates: [evidence]',
      '  # Step 2 is the review itself.',
      '  - promptId: review',
      '    stepName: Review',
      '  - promptId: summarize',
      '    stepName: Summarize',
      'description: A chain whose description is deliberately longer than eighty columns so a re-render folds it.',
      '',
    ];
    const SOURCE = LINES.join('\n');

    test('removing a middle step drops its lines and the comment above it', () => {
      const written = write(SOURCE, (value) => {
        const steps = value['chain_steps'] as Value[];
        return { ...value, chain_steps: [steps[0], steps[2]] };
      });

      expect(written.content).toBe(
        without(
          LINES,
          '  # Step 2 is the review itself.',
          '  - promptId: review',
          '    stepName: Review'
        ).join('\n')
      );
      expect(written.fidelity).toBe('source-preserved');
    });

    test('adding an argument inserts it at the list indentation', () => {
      const written = write(SOURCE, (value) => ({
        ...value,
        arguments: [...(value['arguments'] as Value[]), { name: 'depth', required: false }],
      }));

      expect(written.content).toBe(
        after(LINES, '    required: true', '  - name: depth', '    required: false').join('\n')
      );
      expect(written.fidelity).toBe('source-preserved');
    });

    test('a step edited in place and a step added in one write change only those lines', () => {
      const written = write(SOURCE, (value) => {
        const steps = value['chain_steps'] as Value[];
        return {
          ...value,
          chain_steps: [
            { ...steps[0], stepName: 'Collect' },
            steps[1],
            steps[2],
            { promptId: 'publish', stepName: 'Publish' },
          ],
        };
      });

      const expected = after(
        LINES.map((line) => (line === '    stepName: Gather' ? '    stepName: Collect' : line)),
        '    stepName: Summarize',
        '  - promptId: publish',
        '    stepName: Publish'
      );
      expect(written.content).toBe(expected.join('\n'));
      expect(written.fidelity).toBe('source-preserved');
    });

    test('a nested list and its parent list both change length in one write', () => {
      const written = write(SOURCE, (value) => {
        const steps = value['chain_steps'] as Value[];
        return {
          ...value,
          chain_steps: [{ ...steps[0], gates: ['evidence', 'scope'] }, steps[1]],
        };
      });

      const expected = without(LINES, '  - promptId: summarize', '    stepName: Summarize').map(
        (line) => (line === '    gates: [evidence]' ? '    gates: [evidence, scope]' : line)
      );
      expect(written.content).toBe(expected.join('\n'));
      expect(written.fidelity).toBe('source-preserved');
    });
  });

  describe('flow lists', () => {
    const LINES = [
      '# Aliases as the menu shows them.',
      'id: development',
      'aliases: [ dev, code, src ] # padded on purpose',
      'tags: [alpha, beta]',
      'name: Development',
      'description: A category whose description is deliberately longer than eighty columns, to see a fold.',
      '',
    ];
    const SOURCE = LINES.join('\n');
    const ALIASES = LINES[2]!;
    const TAGS = LINES[3]!;

    test.each([
      ['the last item', ['dev', 'code'], 'aliases: [ dev, code ] # padded on purpose'],
      ['the first item', ['code', 'src'], 'aliases: [ code, src ] # padded on purpose'],
      ['a middle item', ['dev', 'src'], 'aliases: [ dev, src ] # padded on purpose'],
      ['every item', [], 'aliases: [] # padded on purpose'],
    ])('removing %s keeps the padding and the comment', (_name, aliases, line) => {
      const written = write(SOURCE, (value) => ({ ...value, aliases }));

      expect(written.content).toBe(SOURCE.replace(ALIASES, line));
      expect(written.fidelity).toBe('source-preserved');
    });

    test('adding at both ends, with a value that must be quoted to stay a string', () => {
      const written = write(SOURCE, (value) => ({
        ...value,
        tags: ['omega', 'alpha', 'beta', 'true'],
      }));

      expect(written.content).toBe(SOURCE.replace(TAGS, 'tags: [omega, alpha, beta, "true"]'));
      expect(reloads(written.content)['tags']).toEqual(['omega', 'alpha', 'beta', 'true']);
      expect(written.fidelity).toBe('source-preserved');
    });
  });

  /**
   * A token edit that would load as a different type is refused, not written.
   *
   * `CST.setScalarValue` writes the string `'5'` into a plain token as the text `5`, which loads as
   * a number: the write would report success and change the field's type. The output is now
   * reloaded and compared with what was asked for, and a mismatch goes to the document layer,
   * which quotes it. The check exists for the list splices, and it catches this older case too.
   */
  test('a string that reads as a number stays a string', () => {
    const source = '# hand-authored\nname: Draft\nid: numeric_name\n';
    const written = write(source, (value) => ({ ...value, name: '5' }));

    expect(reloads(written.content)['name']).toBe('5');
    expect(commentCount(written.content)).toBe(1);
    // POSITIVE CONTROL: the unquoted text the token edit produces does load as a number.
    expect(reloads(source.replace('name: Draft', 'name: 5'))['name']).toBe(5);
  });
});
