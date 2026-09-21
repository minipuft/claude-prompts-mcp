// @lifecycle test - Unit test for the sole enumerator of a resource's files (plan row O.1)
/**
 * What a checkpoint records, and what a restore may write.
 *
 * Both halves read this one function, so every claim here is load-bearing in two directions at
 * once: a path missing from the set is authored content a rollback silently drops, and a path
 * present that should not be is a file a rollback writes over having never recorded it. The two
 * failure modes are opposites, so the tests come in pairs — every "is enumerated" claim sits
 * beside an "is NOT enumerated" claim about a file in the same directory, which is the positive
 * control for the absence assertions. A test that only asserted absence would pass just as well
 * against an enumerator that returns nothing.
 *
 * Classification: Unit. Real temp directories with hand-built fixtures — the subject reads the
 * filesystem (`realpath` containment is the point of half of it), so a mocked `fs` would be
 * asserting against the mock's idea of a symlink rather than the platform's.
 */

import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { resourceFileSet } from '../../../src/shared/utils/resource-file-set.js';

import type {
  ResourceFileEntry,
  ResourceRootClassification,
  ResourceRootOrigin,
} from '../../../src/shared/utils/resource-file-set.js';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'resource-file-set-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Write a file, creating its parents. Returns the absolute path. */
async function write(relative: string, content: string): Promise<string> {
  const target = path.join(root, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, 'utf8');
  return target;
}

/** The relative paths of an enumeration, in the order it reported them. */
function paths(files: readonly ResourceFileEntry[]): string[] {
  return files.map((file) => file.relativePath);
}

describe('resourceFileSet — prompt, directory form', () => {
  it('enumerates prompt.yaml and the message files it references', async () => {
    const entry = await write(
      'prompts/general/greet/prompt.yaml',
      [
        'id: greet',
        'name: Greet',
        'systemMessageFile: system-message.md',
        'userMessageTemplateFile: user-message.md',
      ].join('\n')
    );
    await write('prompts/general/greet/system-message.md', 'sys');
    await write('prompts/general/greet/user-message.md', 'usr');

    const result = await resourceFileSet({ resourceType: 'prompt', entryPath: entry });

    expect(paths(result.files)).toEqual(['prompt.yaml', 'system-message.md', 'user-message.md']);
    expect(result.files[0]?.absolutePath).toBe(entry);
  });

  it('reports each file size and never the contents', async () => {
    const entry = await write(
      'prompts/general/greet/prompt.yaml',
      'id: greet\nuserMessageTemplateFile: user-message.md\n'
    );
    await write('prompts/general/greet/user-message.md', 'abcde');

    const result = await resourceFileSet({ resourceType: 'prompt', entryPath: entry });

    expect(result.files.find((file) => file.relativePath === 'user-message.md')?.size).toBe(5);
    expect(JSON.stringify(result)).not.toContain('abcde');
  });

  it('does NOT enumerate a stray .md or a stray dotfile, while the referenced .md beside them IS', async () => {
    const entry = await write(
      'prompts/general/greet/prompt.yaml',
      'id: greet\nuserMessageTemplateFile: user-message.md\n'
    );
    await write('prompts/general/greet/user-message.md', 'usr');
    // The positive control sits in the same directory: one `.md` is referenced and must appear,
    // the other is not and must not. Without the pair, an enumerator returning only `prompt.yaml`
    // would satisfy the absence claim.
    await write('prompts/general/greet/NOTES.md', 'an operator note');
    await write('prompts/general/greet/.DS_Store', 'junk');
    await write('prompts/general/greet/_draft.yaml', 'id: draft');

    const result = await resourceFileSet({ resourceType: 'prompt', entryPath: entry });

    expect(paths(result.files)).toContain('user-message.md');
    expect(paths(result.files)).not.toContain('NOTES.md');
    expect(paths(result.files)).not.toContain('.DS_Store');
    expect(paths(result.files)).not.toContain('_draft.yaml');
  });

  it('enumerates a chain with nested steps, including a step in the single-file form', async () => {
    const entry = await write(
      'prompts/planning/chain/prompt.yaml',
      'id: chain\nuserMessageTemplateFile: user-message.md\n'
    );
    await write('prompts/planning/chain/user-message.md', 'usr');
    await write(
      'prompts/planning/chain/step_one/prompt.yaml',
      'id: step_one\nuserMessageTemplateFile: user-message.md\n'
    );
    await write('prompts/planning/chain/step_one/user-message.md', 'step usr');
    await write('prompts/planning/chain/step_two.yaml', 'id: step_two');
    // A directory with no `prompt.yaml` is not a step — it is a stray, and strays are bounded out.
    await write('prompts/planning/chain/scratch/notes.md', 'nope');

    const result = await resourceFileSet({ resourceType: 'prompt', entryPath: entry });

    expect(paths(result.files)).toEqual([
      'prompt.yaml',
      'user-message.md',
      'step_one/prompt.yaml',
      'step_one/user-message.md',
      'step_two.yaml',
    ]);
    expect(paths(result.files)).not.toContain('scratch/notes.md');
  });

  it('enumerates a prompt-local script tool, its script, and its defaulted companions', async () => {
    const entry = await write(
      'prompts/dev/build/prompt.yaml',
      'id: build\nuserMessageTemplateFile: user-message.md\ntools:\n  - lint\n'
    );
    await write('prompts/dev/build/user-message.md', 'usr');
    // `schemaFile`/`descriptionFile` are deliberately undeclared: the loader reads `schema.json`
    // and `description.md` by default, so an enumerator keyed only on declared references would
    // drop two files the tool cannot load without.
    await write('prompts/dev/build/tools/lint/tool.yaml', 'id: lint\nname: Lint\nscript: run.js\n');
    await write('prompts/dev/build/tools/lint/run.js', 'process.exit(0)');
    await write('prompts/dev/build/tools/lint/schema.json', '{}');
    await write('prompts/dev/build/tools/lint/description.md', 'lints');
    // A tool directory the prompt's `tools:` list does not bind is still on disk and still
    // loadable — discovery is a readdir, not the binding.
    await write(
      'prompts/dev/build/tools/unbound/tool.yaml',
      'id: unbound\nname: U\nscript: u.sh\n'
    );
    await write('prompts/dev/build/tools/unbound/u.sh', 'exit 0');
    // Not a tool: no `tool.yaml`, so nothing claims it.
    await write('prompts/dev/build/tools/leftover/stale.txt', 'x');

    const result = await resourceFileSet({ resourceType: 'prompt', entryPath: entry });

    expect(paths(result.files)).toEqual([
      'prompt.yaml',
      'user-message.md',
      'tools/lint/tool.yaml',
      'tools/lint/run.js',
      'tools/lint/schema.json',
      'tools/lint/description.md',
      'tools/unbound/tool.yaml',
      'tools/unbound/u.sh',
    ]);
    expect(paths(result.files)).not.toContain('tools/leftover/stale.txt');
  });

  it('never treats a tools/ directory as a nested prompt step', async () => {
    const entry = await write('prompts/dev/build/prompt.yaml', 'id: build\nsystemMessage: hi\n');
    await write('prompts/dev/build/tools/sneaky/prompt.yaml', 'id: sneaky');

    const result = await resourceFileSet({ resourceType: 'prompt', entryPath: entry });

    expect(paths(result.files)).toEqual(['prompt.yaml']);
  });
});

describe('resourceFileSet — prompt, single-file form', () => {
  it('enumerates exactly the one file, and nothing beside it', async () => {
    const entry = await write('prompts/general/quick.yaml', 'id: quick\nsystemMessage: hi\n');
    await write('prompts/general/other.yaml', 'id: other');
    await write('prompts/general/README.md', 'docs');

    const result = await resourceFileSet({ resourceType: 'prompt', entryPath: entry });

    expect(paths(result.files)).toEqual(['quick.yaml']);
    expect(result.resourceRoot).toBe(path.join(root, 'prompts', 'general'));
  });

  it('refuses category.yaml handed in as a prompt entry', async () => {
    const entry = await write('prompts/general/category.yaml', 'id: general');

    await expect(resourceFileSet({ resourceType: 'prompt', entryPath: entry })).rejects.toThrow(
      /Not a prompt entry file/
    );
  });
});

describe('resourceFileSet — gate', () => {
  it('enumerates gate.yaml and the guidance file it references', async () => {
    const entry = await write(
      'gates/quality/gate.yaml',
      'id: quality\nguidanceFile: guidance.md\n'
    );
    await write('gates/quality/guidance.md', 'guide');

    const result = await resourceFileSet({ resourceType: 'gate', entryPath: entry });

    expect(paths(result.files)).toEqual(['gate.yaml', 'guidance.md']);
  });

  it('does NOT enumerate a guidance.md no gate.yaml points at', async () => {
    const entry = await write('gates/quality/gate.yaml', 'id: quality\ntype: validation\n');
    await write('gates/quality/guidance.md', 'unreferenced — the loader never reads it');

    const result = await resourceFileSet({ resourceType: 'gate', entryPath: entry });

    // Positive control for the same rule, one directory over: a declared reference IS claimed.
    const referenced = await write(
      'gates/other/gate.yaml',
      'id: other\nguidanceFile: guidance.md\n'
    );
    await write('gates/other/guidance.md', 'guide');
    const control = await resourceFileSet({ resourceType: 'gate', entryPath: referenced });

    expect(paths(result.files)).toEqual(['gate.yaml']);
    expect(paths(control.files)).toEqual(['gate.yaml', 'guidance.md']);
  });

  it('tolerates a declared guidance file that is not on disk', async () => {
    const entry = await write(
      'gates/quality/gate.yaml',
      'id: quality\nguidanceFile: guidance.md\n'
    );

    const result = await resourceFileSet({ resourceType: 'gate', entryPath: entry });

    expect(paths(result.files)).toEqual(['gate.yaml']);
  });
});

describe('resourceFileSet — framework', () => {
  it('enumerates the entry, its referenced companions, and the layout-named system prompt', async () => {
    const entry = await write(
      'frameworks/focus/framework.yaml',
      'id: focus\nphasesFile: phases.yaml\njudgePromptFile: judge-prompt.md\n'
    );
    await write('frameworks/focus/phases.yaml', 'phases: []');
    await write('frameworks/focus/judge-prompt.md', '## System Message');
    await write('frameworks/focus/system-prompt.md', 'system');
    await write('frameworks/focus/scratch.md', 'stray');

    const result = await resourceFileSet({ resourceType: 'framework', entryPath: entry });

    expect(paths(result.files)).toEqual([
      'framework.yaml',
      'phases.yaml',
      'judge-prompt.md',
      'system-prompt.md',
    ]);
    expect(paths(result.files)).not.toContain('scratch.md');
  });

  it('falls back to the writer default names when the entry declares none', async () => {
    const entry = await write('frameworks/plain/framework.yaml', 'id: plain\n');
    await write('frameworks/plain/phases.yaml', 'phases: []');
    await write('frameworks/plain/judge-prompt.md', 'judge');

    const result = await resourceFileSet({ resourceType: 'framework', entryPath: entry });

    expect(paths(result.files)).toEqual(['framework.yaml', 'phases.yaml', 'judge-prompt.md']);
  });

  it('follows a renamed phases reference rather than the default name', async () => {
    const entry = await write('frameworks/odd/framework.yaml', 'id: odd\nphasesFile: steps.yaml\n');
    await write('frameworks/odd/steps.yaml', 'phases: []');
    await write('frameworks/odd/phases.yaml', 'orphaned by the rename');

    const result = await resourceFileSet({ resourceType: 'framework', entryPath: entry });

    expect(paths(result.files)).toEqual(['framework.yaml', 'steps.yaml']);
  });
});

describe('resourceFileSet — category', () => {
  it('enumerates category.yaml and never the prompts around it', async () => {
    const entry = await write('prompts/general/category.yaml', 'id: general\nname: General\n');
    await write('prompts/general/greet/prompt.yaml', 'id: greet');
    await write('prompts/general/flat.yaml', 'id: flat');

    const result = await resourceFileSet({ resourceType: 'category', entryPath: entry });

    expect(paths(result.files)).toEqual(['category.yaml']);
  });
});

describe('resourceFileSet — containment', () => {
  it('refuses a symlink that escapes the resource root, naming it', async () => {
    const outside = await write('outside/secret.md', 'secret');
    const entry = await write(
      'gates/quality/gate.yaml',
      'id: quality\nguidanceFile: guidance.md\n'
    );
    const link = path.join(root, 'gates', 'quality', 'guidance.md');
    await symlink(outside, link);

    await expect(resourceFileSet({ resourceType: 'gate', entryPath: entry })).rejects.toThrow(
      /guidance\.md is a link to .*secret\.md, which is outside/
    );
  });

  it('accepts a symlink that stays inside the resource root', async () => {
    const entry = await write(
      'gates/quality/gate.yaml',
      'id: quality\nguidanceFile: guidance.md\n'
    );
    const target = await write('gates/quality/real-guidance.md', 'guide');
    await symlink(target, path.join(root, 'gates', 'quality', 'guidance.md'));

    const result = await resourceFileSet({ resourceType: 'gate', entryPath: entry });

    expect(paths(result.files)).toEqual(['gate.yaml', 'guidance.md']);
  });

  it('refuses a reference that walks out with .. segments', async () => {
    await write('outside/secret.md', 'secret');
    const entry = await write(
      'gates/quality/gate.yaml',
      'id: quality\nguidanceFile: ../../outside/secret.md\n'
    );

    await expect(resourceFileSet({ resourceType: 'gate', entryPath: entry })).rejects.toThrow(
      /resolves outside/
    );
  });

  it('refuses an absolute reference, naming it', async () => {
    const outside = await write('outside/secret.md', 'secret');
    const entry = await write('gates/quality/gate.yaml', `id: quality\nguidanceFile: ${outside}\n`);

    await expect(resourceFileSet({ resourceType: 'gate', entryPath: entry })).rejects.toThrow(
      /is an absolute path/
    );
  });

  it('refuses an entry file that does not exist', async () => {
    await expect(
      resourceFileSet({
        resourceType: 'gate',
        entryPath: path.join(root, 'gates', 'x', 'gate.yaml'),
      })
    ).rejects.toThrow(/Resource entry file does not exist/);
  });
});

describe('resourceFileSet — origin', () => {
  it('reports bundled for an entry under the bundled root', async () => {
    const entry = await write('bundled/gates/quality/gate.yaml', 'id: quality\n');

    const result = await resourceFileSet({
      resourceType: 'gate',
      entryPath: entry,
      roots: {
        primary: path.join(root, 'workspace', 'gates'),
        overlays: [],
        bundled: path.join(root, 'bundled', 'gates'),
      },
    });

    expect(result.origin).toBe('bundled');
  });

  it('reports primary and overlay for the workspace roots, and never re-roots a bundled path', async () => {
    const primaryEntry = await write('workspace/gates/a/gate.yaml', 'id: a\n');
    const overlayEntry = await write('overlay/gates/b/gate.yaml', 'id: b\n');
    const roots: ResourceRootClassification = {
      primary: path.join(root, 'workspace', 'gates'),
      overlays: [path.join(root, 'overlay', 'gates')],
      bundled: path.join(root, 'bundled', 'gates'),
    };

    const primary = await resourceFileSet({ resourceType: 'gate', entryPath: primaryEntry, roots });
    const overlay = await resourceFileSet({ resourceType: 'gate', entryPath: overlayEntry, roots });

    const expected: Record<'primary' | 'overlay', ResourceRootOrigin> = {
      primary: 'primary',
      overlay: 'overlay',
    };
    expect(primary.origin).toBe(expected.primary);
    expect(overlay.origin).toBe(expected.overlay);
    expect(overlay.files[0]?.absolutePath.startsWith(String(roots.primary))).toBe(false);
  });

  it('reports unknown rather than guessing when no root contains the entry', async () => {
    const entry = await write('elsewhere/gates/c/gate.yaml', 'id: c\n');

    const result = await resourceFileSet({
      resourceType: 'gate',
      entryPath: entry,
      roots: { primary: path.join(root, 'workspace', 'gates'), overlays: [], bundled: undefined },
    });

    expect(result.origin).toBe('unknown');
  });

  it('reports unknown when the caller supplies no roots at all', async () => {
    const entry = await write('gates/quality/gate.yaml', 'id: quality\n');

    const result = await resourceFileSet({ resourceType: 'gate', entryPath: entry });

    expect(result.origin).toBe('unknown');
  });
});
