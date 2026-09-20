/**
 * A cli test can import cli source that imports `@shared/*` (plan row P4.56).
 *
 * `workspace.ts` imports `@shared/utils/prompt-layout.js`. The `.js` specifier names a `.ts` file
 * on disk, so jest resolves it only when `moduleNameMapper` drops the extension, as the server's
 * own config does for its `#alias` imports.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { discoverResourcePaths } from '../../src/lib/workspace.js';

describe('discoverResourcePaths imported from source', () => {
  let root = '';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'cpm-source-import-'));
    mkdirSync(join(root, 'general', 'greet'), { recursive: true });
    writeFileSync(join(root, 'general', 'greet', 'prompt.yaml'), 'id: greet\n');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('lists a grouped prompt', () => {
    expect(discoverResourcePaths(root, 'prompt.yaml', true)).toEqual([
      {
        id: 'greet',
        form: 'dir',
        dir: join(root, 'general', 'greet'),
        file: join(root, 'general', 'greet', 'prompt.yaml'),
      },
    ]);
  });
});
