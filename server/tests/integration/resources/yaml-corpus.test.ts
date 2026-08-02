/**
 * YAML corpus integration test.
 *
 * Every bundled YAML resource is loaded through the real `parseYaml` wrapper and
 * asserted to produce a non-empty document.
 *
 * Why integration rather than unit: the thing under test is the interaction between
 * a specific js-yaml version and the actual corpus on disk. A unit test over a
 * fixture string would pass while a corpus-wide strictness change — js-yaml 5
 * dropped implicit `!!merge` resolution and now throws on an empty document —
 * silently broke real resources.
 *
 * This test is discovered by `npm run test:integration`, which CI runs as a
 * blocking step. `test:ci` only collects `tests/unit`, so a file placed there
 * would not run in the unit job.
 */

import { describe, test, expect } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseYaml } from '../../../src/shared/utils/yaml/yaml-parser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, '../../..');
const resourcesRoot = path.join(serverRoot, 'resources');

/**
 * Collect the YAML resources that actually ship — i.e. the git-tracked ones.
 *
 * A plain directory walk is wrong here: `resources/prompts/.gitignore` ignores `*`
 * with targeted un-ignores, so a developer machine carries ~100 untracked personal
 * prompts that a fresh CI checkout does not. Walking the filesystem would test a
 * different corpus on every machine, and a local-only parse failure would look like
 * a CI-passing regression.
 */
function collectTrackedYamlFiles(): string[] {
  const stdout = execFileSync('git', ['ls-files', '-z', 'resources/*.yaml', 'resources/*.yml'], {
    cwd: serverRoot,
    encoding: 'utf-8',
  });

  return stdout
    .split('\0')
    .filter(Boolean)
    .map((relative) => path.join(serverRoot, relative));
}

const yamlFiles = collectTrackedYamlFiles();

describe('bundled YAML resource corpus', () => {
  // A corpus test that silently found zero files would pass forever while
  // enforcing nothing. The floor is deliberately well below the current count so
  // it catches a broken glob, not ordinary resource churn.
  test('the corpus is populated', () => {
    expect(yamlFiles.length).toBeGreaterThanOrEqual(50);
  });

  test.each(yamlFiles.map((file) => [path.relative(resourcesRoot, file), file]))(
    'parses %s',
    (_relative, file) => {
      const content = readFileSync(file, 'utf-8');
      const result = parseYaml<unknown>(content, { filename: file });

      // Surface the parser's own message on failure — a bare `toBe(true)` would
      // report "expected true, received false" and hide which construct broke.
      if (!result.success) {
        throw new Error(
          `${path.relative(resourcesRoot, file)} failed to parse: ${result.error?.message}`
        );
      }

      expect(result.data).toBeDefined();
      expect(result.data).not.toBeNull();
    }
  );
});
