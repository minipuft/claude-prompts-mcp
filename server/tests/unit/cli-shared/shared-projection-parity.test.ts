/**
 * The two surfaces project one resource onto one snapshot.
 *
 * `cpm` and `resource_manager` both write `version_history.snapshot`, and the bridge decision is
 * equality against the newest recorded row — so a CLI-shaped projection and a server-shaped one can
 * never compare equal, and every `cpm rollback` of a server-written resource records a bridge row
 * describing a change nobody made. Measured on one gate before this was closed: `cpm` wrote
 * `{id,name,description,type,severity,guidanceFile}` where the server wrote
 * `{id,name,type,description,guidance}` with the markdown body inline.
 *
 * The assertion is equality of the two projections built from the SAME bytes on disk, through the
 * two surfaces' own entry points — not equality of two calls to the shared function, which would
 * hold however the callers were wired.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { GateDefinitionLoader } from '../../../src/engine/gates/core/gate-definition-loader.js';
import { PromptConverter } from '../../../src/modules/prompts/converter.js';
import { PromptLoader } from '../../../src/modules/prompts/loader.js';
import { promptSnapshotContract } from '../../../src/mcp/tools/resource-manager/prompt/services/prompt-versioning-processor.js';
import { GenericGateGuide } from '../../../src/engine/gates/registry/generic-gate-guide.js';
import { gateSnapshotContract } from '../../../src/mcp/tools/gate-manager/services/gate-snapshot-contract.js';
import { frameworkSnapshotContract } from '../../../src/mcp/tools/framework-manager/services/framework-snapshot-contract.js';
import {
  projectResourceSnapshot,
  sharesServerSnapshotProjection,
} from '../../../src/cli-shared/resource-snapshot.js';
import { loadYamlFileSync } from '../../../src/shared/utils/yaml/index.js';
import { testScratchPath } from '../../helpers/scratch-path.js';

/** Hand-authored, with a comment and a key order no writer would produce. */
const GATE_YAML = `# hand-authored
id: alpha
name: Alpha            # trailing comment
description: A gate
type: validation
severity: medium
guidanceFile: guidance.md
`;
const GUIDANCE = '# guidance\n\nbody text\n';

const FRAMEWORK_YAML = `id: beta
name: Beta
version: 1.0.0
type: BETA
description: A framework
enabled: true
`;
const SYSTEM_PROMPT = 'system prompt body\n';

/**
 * Three prompt layouts, hand-authored, because the entry-file-to-root mapping differs in each.
 *
 * `inline_demo` is a single file with its template inline. `chain_demo` is a directory holding a
 * chain, and `chain_demo/step_one` is a nested step served under its own composite id — with its
 * template in a COMPANION file, which is the value only a loader-resolved projection can carry.
 */
const STEP_TEMPLATE = 'Do the step with {{input}}.\n';
const INLINE_PROMPT_YAML = `# hand-authored, key order deliberate
id: inline_demo
name: Inline Demo
description: a single-file prompt
category: demo
userMessageTemplate: Summarise {{input}}.
arguments:
  - name: input
    required: true
`;
const CHAIN_PROMPT_YAML = `id: chain_demo
name: Chain Demo
description: a chain
category: demo
chainSteps:
  - promptId: chain_demo/step_one
    stepName: One
`;
const STEP_PROMPT_YAML = `id: step_one
name: Step One
description: the nested step
category: demo
userMessageTemplateFile: user-message.md
arguments:
  - name: input
    required: true
`;

const STEP_ENTRY = 'prompts/demo/chain_demo/step_one/prompt.yaml';
const PROMPT_ENTRIES: Array<[string, string]> = [
  ['inline_demo', 'prompts/demo/inline_demo.yaml'],
  ['chain_demo', 'prompts/demo/chain_demo/prompt.yaml'],
  ['chain_demo/step_one', STEP_ENTRY],
];

/** The loader and converter log on every load; a test's output is not the place for it. */
const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

describe('one projection per resource type, read by both surfaces', () => {
  let root: string;

  beforeEach(() => {
    root = testScratchPath('shared-projection-parity');
    mkdirSync(join(root, 'gates', 'alpha'), { recursive: true });
    writeFileSync(join(root, 'gates', 'alpha', 'gate.yaml'), GATE_YAML, 'utf8');
    writeFileSync(join(root, 'gates', 'alpha', 'guidance.md'), GUIDANCE, 'utf8');
    mkdirSync(join(root, 'frameworks', 'beta'), { recursive: true });
    writeFileSync(join(root, 'frameworks', 'beta', 'framework.yaml'), FRAMEWORK_YAML, 'utf8');
    writeFileSync(join(root, 'frameworks', 'beta', 'system-prompt.md'), SYSTEM_PROMPT, 'utf8');
    mkdirSync(join(root, 'prompts', 'demo', 'chain_demo', 'step_one'), { recursive: true });
    writeFileSync(join(root, 'prompts', 'demo', 'inline_demo.yaml'), INLINE_PROMPT_YAML, 'utf8');
    writeFileSync(
      join(root, 'prompts', 'demo', 'chain_demo', 'prompt.yaml'),
      CHAIN_PROMPT_YAML,
      'utf8'
    );
    writeFileSync(
      join(root, 'prompts', 'demo', 'chain_demo', 'step_one', 'prompt.yaml'),
      STEP_PROMPT_YAML,
      'utf8'
    );
    writeFileSync(
      join(root, 'prompts', 'demo', 'chain_demo', 'step_one', 'user-message.md'),
      STEP_TEMPLATE,
      'utf8'
    );
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('projects a gate identically from the loaded guide and from the files on disk', async () => {
    const entryPath = join(root, 'gates', 'alpha', 'gate.yaml');
    const definition = new GateDefinitionLoader({ gatesDir: join(root, 'gates') }).loadGate(
      'alpha'
    );
    expect(definition).toBeDefined();

    const server = gateSnapshotContract.project('alpha', new GenericGateGuide(definition!));
    const cli = await projectResourceSnapshot(
      'gate',
      'alpha',
      entryPath,
      loadYamlFileSync<Record<string, unknown>>(entryPath)!
    );

    expect(cli.shared).toBe(true);
    // Key ORDER too, not just contents: the bridge check is `JSON.stringify` equality, so two
    // records holding the same data in different orders bridge on every edit (F18).
    expect(JSON.stringify(cli.snapshot)).toBe(JSON.stringify(server));
    // And the value that could not survive a raw-YAML projection is the one that matters: the
    // guidance BODY, not the file name.
    expect(server['guidance']).toBe(GUIDANCE);
    expect(cli.snapshot['guidanceFile']).toBeUndefined();
  });

  it('projects a framework identically from the loaded data and from the files on disk', async () => {
    const entryPath = join(root, 'frameworks', 'beta', 'framework.yaml');
    const framework = loadYamlFileSync<Record<string, unknown>>(entryPath)!;

    const server = frameworkSnapshotContract.project('beta', {
      framework,
      phases: null,
      systemPrompt: SYSTEM_PROMPT,
      judgePrompt: null,
      frameworkPath: entryPath,
      phasesPath: null,
      systemPromptPath: join(root, 'frameworks', 'beta', 'system-prompt.md'),
      judgePromptPath: null,
    });
    const cli = await projectResourceSnapshot('framework', 'beta', entryPath, framework);

    expect(cli.shared).toBe(true);
    expect(JSON.stringify(cli.snapshot)).toBe(JSON.stringify(server));
    expect(server['system_prompt_guidance']).toBe(SYSTEM_PROMPT);
  });

  it('records a gate with no guidance.md the way the server does — an empty string, not an absent key', async () => {
    const bare = join(root, 'gates', 'bare');
    mkdirSync(bare, { recursive: true });
    const yaml = 'id: bare\nname: Bare\ndescription: no guidance file\ntype: validation\n';
    writeFileSync(join(bare, 'gate.yaml'), yaml, 'utf8');

    const cli = await projectResourceSnapshot(
      'gate',
      'bare',
      join(bare, 'gate.yaml'),
      loadYamlFileSync<Record<string, unknown>>(join(bare, 'gate.yaml'))!
    );

    expect(cli.snapshot['guidance']).toBe('');
  });

  it("projects every prompt layout identically from the server's walk and from cpm", async () => {
    /**
     * The claim, through the two surfaces' own entry points on the same bytes.
     *
     * The SERVER holds a `ConvertedPrompt` produced by walking the prompts ROOT
     * (`PromptLoader.loadFromDirectories` → `PromptConverter`, what `PromptAssetManager
     * .loadAndConvertPrompts` runs) and projects it through `promptSnapshotContract`. `cpm` is
     * handed one ENTRY FILE and an id and has to reach the same value from there. Those are
     * different questions — the walk decides a prompt's `category` from its FOLDER and prefixes
     * `file` with it, both of which a per-file call would have to re-derive — so this is a
     * comparison of two entry points, not of two calls to one function.
     *
     * Three layouts, because the entry-file-to-root mapping is exactly where a per-file caller
     * goes wrong: a directory prompt, a single-file prompt, and a nested chain step whose id
     * carries its own `/`.
     */
    const promptsRoot = join(root, 'prompts');
    const loader = new PromptLoader(silentLogger);
    const { promptsData } = await loader.loadFromDirectories(promptsRoot);
    const converted = await new PromptConverter(silentLogger, loader).convertMarkdownPromptsToJson(
      promptsData,
      promptsRoot
    );

    // The control for the enumeration: the walk must actually have found all three, or every
    // comparison below is vacuous.
    expect(converted.map((prompt) => prompt.id).sort()).toEqual([
      'chain_demo',
      'chain_demo/step_one',
      'inline_demo',
    ]);

    for (const [id, entryPath] of PROMPT_ENTRIES) {
      const server = promptSnapshotContract.project(
        id,
        converted.find((p) => p.id === id)!
      );
      const cli = await projectResourceSnapshot(
        'prompt',
        id,
        join(root, entryPath),
        loadYamlFileSync<Record<string, unknown>>(join(root, entryPath))!
      );

      expect(cli.shared).toBe(true);
      // ONE value, key order included: the bridge check is `JSON.stringify` equality.
      expect(JSON.stringify(cli.snapshot)).toBe(JSON.stringify(server));
    }

    // And the value a raw-YAML projection could not have produced: the RESOLVED body, not the
    // `userMessageTemplateFile` pointer the entry file actually carries.
    const dir = await projectResourceSnapshot(
      'prompt',
      'chain_demo/step_one',
      join(root, STEP_ENTRY),
      loadYamlFileSync<Record<string, unknown>>(join(root, STEP_ENTRY))!
    );
    expect(dir.snapshot['userMessageTemplate']).toBe(STEP_TEMPLATE);
    expect(dir.snapshot['userMessageTemplateFile']).toBeUndefined();
  });

  it('says so, and keeps the shape, when the loader serves no such prompt', async () => {
    // The negative half. A prompt the walk cannot serve must not be recorded as if it had been
    // projected — but the snapshot still has to carry the server's key SET and ORDER, or the row
    // bridges on a difference that is only structural.
    const cli = await projectResourceSnapshot(
      'prompt',
      'not_there',
      join(root, 'prompts', 'demo', 'not_there.yaml'),
      { id: 'not_there', name: 'Absent', userMessageTemplateFile: 'user-message.md' }
    );

    expect(cli.shared).toBe(false);
    if (cli.shared) throw new Error('unreachable');
    expect(cli.reason).toContain("served no prompt 'not_there'");
    expect(Object.keys(cli.snapshot)).toEqual(
      Object.keys(promptSnapshotContract.project('not_there', { name: 'Absent' }))
    );
  });

  it('answers the discriminant the same way in advance as it does with the files', async () => {
    // A caller that must DECIDE before it writes (a create has no file to project yet) reads
    // `sharesServerSnapshotProjection`. The two answers come from one table by construction; this
    // is what fails if someone reintroduces a hand-written type list beside it.
    const cases: Array<['prompt' | 'gate' | 'framework', string]> = [
      ['gate', join(root, 'gates', 'alpha', 'gate.yaml')],
      ['framework', join(root, 'frameworks', 'beta', 'framework.yaml')],
      ['prompt', join(root, 'prompts', 'demo', 'inline_demo.yaml')],
    ];
    for (const [type, entry] of cases) {
      const declared = loadYamlFileSync<Record<string, unknown>>(entry) ?? {};
      expect(sharesServerSnapshotProjection(type)).toBe(
        (
          await projectResourceSnapshot(
            type,
            type === 'prompt' ? 'inline_demo' : 'x',
            entry,
            declared
          )
        ).shared
      );
    }
    // The control that the table is being read and not a constant: a type it does NOT carry
    // answers false on both halves.
    expect(sharesServerSnapshotProjection('prompt')).toBe(true);
    expect(sharesServerSnapshotProjection('style' as 'prompt')).toBe(false);
    expect(
      (await projectResourceSnapshot('style' as 'prompt', 'x', join(root, 'nope.yaml'), {})).shared
    ).toBe(false);
  });
});
