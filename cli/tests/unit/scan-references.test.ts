/**
 * `scanReferences` reaches every file the loader would read for a prompt, not just its
 * `prompt.yaml` (plan row P4.58).
 *
 * Before this fix it read only each resource's entry YAML, so a reference living in a `.md`
 * template (`systemMessageFile`/`userMessageTemplateFile`) was invisible — during a real rename
 * it reported 1 remaining reference where there were 4. The fixture below plants one reference in
 * each of the three places `cpm rename` must see: a top-level chain's own `chainSteps`, a nested
 * step's `.md` template, and a top-level prompt's `.md` template — plus a decoy id (`foo_bar`)
 * that must NOT be reported when renaming `foo`, since a substring scan would match it.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { scanReferences } from '../../src/lib/workspace.js';

describe('scanReferences', () => {
  let workspace = '';
  const at = (...segments: string[]): string => join(workspace, 'resources/prompts/general', ...segments);

  const writeFile = (path: string, content: string): void => {
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, content, 'utf8');
  };

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'cpm-scan-references-'));

    writeFile(at('foo', 'prompt.yaml'), 'id: foo\nname: foo prompt\ncategory: general\ndescription: The rename target.\nuserMessageTemplate: "Do the thing."\n');

    // Decoy: an id that starts with the target id, and a chain step naming the decoy — neither
    // must be reported when scanning for 'foo'.
    writeFile(at('foo_bar', 'prompt.yaml'), 'id: foo_bar\nname: decoy\ncategory: general\ndescription: Not the rename target.\nuserMessageTemplate: "Decoy."\n');
    writeFile(
      at('decoy_chain', 'prompt.yaml'),
      'id: decoy_chain\nname: Decoy Chain\ncategory: general\ndescription: References the decoy, not the target.\nchainSteps:\n  - promptId: foo_bar\n    stepName: Step One\n',
    );

    // Reference 1: a top-level chain's own chainSteps (`promptId: id` in yaml).
    writeFile(
      at('mychain', 'prompt.yaml'),
      'id: mychain\nname: My Chain\ncategory: general\ndescription: Chain with a top-level reference to foo.\nchainSteps:\n  - promptId: foo\n    stepName: Step One\n',
    );

    // Reference 2: a nested chain step's own `.md` template (`>>id`).
    writeFile(
      at('otherchain', 'prompt.yaml'),
      'id: otherchain\nname: Other Chain\ncategory: general\ndescription: A chain whose nested step references foo.\nchainSteps:\n  - promptId: otherchain/step1\n    stepName: Step One\n',
    );
    writeFile(
      at('otherchain', 'step1', 'prompt.yaml'),
      'id: step1\nname: Step One\ncategory: general\ndescription: Nested step with a template reference to foo.\nuserMessageTemplateFile: user-message.md\n',
    );
    writeFile(at('otherchain', 'step1', 'user-message.md'), 'Invoke >>foo when unsure.\n');

    // Reference 3: a top-level prompt's own `.md` template (`>>id`).
    writeFile(
      at('tmplref', 'prompt.yaml'),
      'id: tmplref\nname: Template Ref\ncategory: general\ndescription: References foo only from its md template.\nuserMessageTemplateFile: user-message.md\n',
    );
    writeFile(at('tmplref', 'user-message.md'), 'Invoke >>foo to continue.\n');
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it('reports the top-level yaml, nested-step template and top-level template references, and nothing else', () => {
    const hits = scanReferences(workspace, 'foo');
    const byFile = hits.map((hit) => ({ file: hit.file, content: hit.content })).sort((a, b) => a.file.localeCompare(b.file));

    expect(byFile).toEqual([
      { file: at('mychain', 'prompt.yaml'), content: '- promptId: foo' },
      { file: at('otherchain', 'step1', 'user-message.md'), content: 'Invoke >>foo when unsure.' },
      { file: at('tmplref', 'user-message.md'), content: 'Invoke >>foo to continue.' },
    ]);
  });

  it('does not report the foo_bar decoy id or its chain-step reference', () => {
    const hits = scanReferences(workspace, 'foo');
    expect(hits.some((hit) => hit.content.includes('foo_bar'))).toBe(false);
    expect(hits.some((hit) => hit.file.includes('foo_bar'))).toBe(false);
    expect(hits.some((hit) => hit.file.includes('decoy_chain'))).toBe(false);
  });

  it('does not report the renamed resource’s own name/description prose as a reference', () => {
    const hits = scanReferences(workspace, 'foo');
    expect(hits.some((hit) => hit.file === at('foo', 'prompt.yaml'))).toBe(false);
  });
});
