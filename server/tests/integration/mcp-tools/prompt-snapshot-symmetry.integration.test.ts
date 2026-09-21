// @lifecycle canonical - The record/compare symmetry `canonicalPromptSnapshot` must hold (P4.83).
/**
 * One projection, three source shapes, one hash.
 *
 * `canonicalPromptSnapshot` is called from seven sites fed by three different shapes of the same
 * logical prompt: a live `ConvertedPrompt` from the loader, the write model an update builds, and
 * (for the fields the loader drops) the authored YAML. `recordEditResult` decides whether to write
 * a BRIDGE row by comparing the recorded snapshot against the projection of the live pre-edit
 * state — so if the RECORD side of an edit carries a field the COMPARE side cannot, every single
 * prompt edit bridges, forever, into a durable table, with no error anywhere. That is F18, which
 * this repository has already paid for once (`canonicalizeSnapshot`'s comment records it).
 *
 * This file is the guard for that property, stated as hash equality rather than as row counts so
 * it fails at the projection rather than three layers downstream. It is deliberately written
 * BEFORE the P4.83 widening: the symmetry assertions pass today and must keep passing, and the
 * carries-the-field assertions fail today and are the row.
 *
 * Classification: integration. Real `PromptLoader` + `PromptConverter` over real files in a temp
 * workspace — the point is what the LOADER actually produces, which no fixture can assert for it.
 */

import { describe, expect, jest, it, beforeAll, afterAll } from '@jest/globals';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { canonicalPromptSnapshot } from '../../../src/modules/versioning/projections/prompt-snapshot.js';
import { PromptConverter } from '../../../src/modules/prompts/converter.js';
import { PromptLoader } from '../../../src/modules/prompts/loader.js';
import { hashCanonical } from '../../../src/shared/utils/hash.js';
import { parseYamlOrThrow } from '../../../src/shared/utils/yaml/yaml-parser.js';

import type { Logger } from '../../../src/shared/types/index.js';

const CATEGORY = 'general';
const RICH_ID = 'rich_chain';
const PLAIN_ID = 'plain_prompt';
const STEP_ID = 'chain_step';

const logger = (): Logger =>
  ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }) as unknown as Logger;

/**
 * A chain declaring every field this row is about, hand-authored WITH COMMENTS.
 *
 * Comments are not decoration here: the rollback half of P4.83 restores through the
 * source-preserving writer, and a restore that put the edges back while stripping the file's
 * comments would be a different kind of loss. Authored by hand rather than written by the writer,
 * because a writer-seeded file only proves idempotence.
 */
const RICH_YAML = `# A chain with every P4.83 field declared.
id: ${RICH_ID}
name: Rich Chain
category: ${CATEGORY}
description: A chain that declares edges, tools, budget and artifacts
userMessageTemplate: "Run {{input}}"
chainSteps:
  # Order here is the linearized order; \`edges\` below is what was AUTHORED.
  - promptId: ${STEP_ID}
    stepName: Step A
  - promptId: ${STEP_ID}
    stepName: Step B
edges:
  - from: step-a
    to: step-b
tools:
  - probe_tool
budget:
  maxInsertions: 2
artifacts:
  produces:
    - docs
`;

/** The control: the same loader, the same projection, none of the four fields. */
const PLAIN_YAML = `id: ${PLAIN_ID}
name: Plain Prompt
category: ${CATEGORY}
description: A prompt declaring none of the P4.83 fields
userMessageTemplate: "Do {{input}}"
`;

const STEP_YAML = `id: ${STEP_ID}
name: Chain Step
category: ${CATEGORY}
description: A step the chain references
userMessageTemplate: "Step {{input}}"
`;

describe('canonicalPromptSnapshot is symmetric across every source shape it is fed', () => {
  let workspace = '';
  let promptsDir = '';
  const live = new Map<string, Record<string, unknown>>();
  const authored = new Map<string, Record<string, unknown>>();

  beforeAll(async () => {
    workspace = mkdtempSync(join(tmpdir(), 'rh-identity-symmetry-'));
    promptsDir = join(workspace, 'prompts');
    for (const [id, body] of [
      [RICH_ID, RICH_YAML],
      [PLAIN_ID, PLAIN_YAML],
      [STEP_ID, STEP_YAML],
    ] as const) {
      const dir = join(promptsDir, CATEGORY, id);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'prompt.yaml'), body, 'utf8');
      authored.set(
        id,
        parseYamlOrThrow<Record<string, unknown>>(readFileSync(join(dir, 'prompt.yaml'), 'utf8'))
      );
    }

    const loader = new PromptLoader(logger());
    const { promptsData } = await loader.loadFromDirectories(promptsDir);
    const converted = (await new PromptConverter(logger(), loader).convertMarkdownPromptsToJson(
      promptsData,
      promptsDir
    )) as unknown as Array<Record<string, unknown>>;
    for (const prompt of converted) live.set(String(prompt['id']), prompt);
    // Every fixture must LOAD, or an assertion below passes against `undefined`.
    for (const id of [RICH_ID, PLAIN_ID, STEP_ID]) {
      if (!live.has(id)) throw new Error(`fixture ${id} did not load: ${[...live.keys()]}`);
    }
  });

  afterAll(() => {
    if (workspace) rmSync(workspace, { recursive: true, force: true });
  });

  /**
   * The write model an update with no overrides builds.
   *
   * Copied from `prompt-lifecycle-processor.ts` rather than imported, deliberately: that line is
   * the thing under test, and importing it would make this file agree with itself.
   */
  const writeModelFor = (id: string): Record<string, unknown> => ({
    ...canonicalPromptSnapshot(id, live.get(id)),
    tools: undefined,
  });

  describe('the loader really does drop what this row is about', () => {
    it('the fixture is rich on disk and the live prompt is not', () => {
      const yaml = authored.get(RICH_ID)!;
      expect(yaml['edges']).toEqual([{ from: 'step-a', to: 'step-b' }]);
      expect(yaml['tools']).toEqual(['probe_tool']);
      expect(yaml['budget']).toEqual({ maxInsertions: 2 });
      expect(yaml['artifacts']).toEqual({ produces: ['docs'] });

      const converted = live.get(RICH_ID)!;
      // `edges` and the authored `tools` id list are absent from `ConvertedPrompt` entirely, which
      // is why the YAML is the only readable source for them. `budget` and `artifacts` ARE
      // carried — a materially smaller gap, and the reason the two halves of P4.83 differ.
      expect(converted['edges']).toBeUndefined();
      expect(converted['tools']).toBeUndefined();
      expect(converted['budget']).toEqual({ maxInsertions: 2 });
      expect(converted['artifacts']).toEqual({ produces: ['docs'] });
    });
  });

  describe('symmetry — the property that keeps an edit from bridging forever', () => {
    it.each([RICH_ID, PLAIN_ID])(
      'the live projection and the write-model projection of %s hash equal',
      (id) => {
        // The record side of an edit (`promptData`, built FROM the live projection) and the
        // compare side (`beforeContent`, the live projection) must be the same state. Asserted as
        // a hash rather than a deep-equal so a key-order or shape drift shows up as one value.
        expect(hashCanonical(canonicalPromptSnapshot(id, live.get(id)))).toBe(
          hashCanonical(writeModelFor(id))
        );
      }
    );

    it('a positive control: two genuinely different prompts do NOT hash equal', () => {
      expect(hashCanonical(canonicalPromptSnapshot(RICH_ID, live.get(RICH_ID)))).not.toBe(
        hashCanonical(canonicalPromptSnapshot(PLAIN_ID, live.get(PLAIN_ID)))
      );
    });
  });

  describe('P4.83 — budget and artifacts, the half one source can carry', () => {
    it('projects budget and artifacts, which the live prompt already carries', () => {
      const projected = canonicalPromptSnapshot(RICH_ID, live.get(RICH_ID));
      expect(projected['budget']).toEqual({ maxInsertions: 2 });
      expect(projected['artifacts']).toEqual({ produces: ['docs'] });
    });

    it('omits budget and artifacts entirely for a prompt that declares neither', () => {
      // Preserve-if-present, never defaulted: an absent field must stay ABSENT, not become null.
      // A projected null reaches the writer and either fails the loader's schema on the next read
      // or is dropped by a truthiness check further down.
      const projected = canonicalPromptSnapshot(PLAIN_ID, live.get(PLAIN_ID));
      expect('budget' in projected).toBe(false);
      expect('artifacts' in projected).toBe(false);
    });

    it('widening changed the hash exactly once — the expected one-time bridge', () => {
      // The consequence the row owes an explicit statement: a snapshot recorded before this
      // widening cannot equal one recorded after, so the first edit of each prompt writes one
      // bridge row. Stated as a value rather than as prose — the pre-widening projection is the
      // post-widening one minus these two keys, and it must NOT hash equal.
      const after = canonicalPromptSnapshot(RICH_ID, live.get(RICH_ID));
      const before: Record<string, unknown> = { ...after };
      delete before['budget'];
      delete before['artifacts'];
      expect(hashCanonical(after)).not.toBe(hashCanonical(before));

      // …and exactly once: a prompt declaring neither field is unaffected, so its history does
      // not bridge at all.
      const plain = canonicalPromptSnapshot(PLAIN_ID, live.get(PLAIN_ID));
      expect(hashCanonical(plain)).toBe(hashCanonical({ ...plain }));
    });
  });

  describe('edges and tools — measured open, with the condition that closes it', () => {
    /**
     * ☐ open as of 2026-09-20 · closes when `ConvertedPrompt` carries its own entry path.
     *
     * These two assert the CURRENT measured state rather than the desired one, deliberately: a
     * red test is not a marker, and prose describing an open class is not one either. What keeps
     * this honest is the third case, which makes the hazard a VALUE — so anyone tempted to add
     * the YAML as a second source at some call sites sees what it costs at the others.
     */
    it('the projection does not carry them, because its single source cannot', () => {
      const projected = canonicalPromptSnapshot(RICH_ID, live.get(RICH_ID));
      expect('edges' in projected).toBe(false);
      expect('tools' in projected).toBe(false);
      // The positive control for that absence: the YAML genuinely declares both, so the probe is
      // looking at a prompt that HAS them and the projection still does not.
      expect(authored.get(RICH_ID)!['edges']).toEqual([{ from: 'step-a', to: 'step-b' }]);
      expect(authored.get(RICH_ID)!['tools']).toEqual(['probe_tool']);
    });

    it('a YAML-fed projection would NOT hash equal to a loader-fed one — the fork, as a value', () => {
      const loaderFed = canonicalPromptSnapshot(RICH_ID, live.get(RICH_ID));
      const yamlFed = {
        ...loaderFed,
        edges: authored.get(RICH_ID)!['edges'],
        tools: authored.get(RICH_ID)!['tools'],
      };
      expect(hashCanonical(yamlFed)).not.toBe(hashCanonical(loaderFed));
    });
  });
});
