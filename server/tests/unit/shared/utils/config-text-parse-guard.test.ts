// @lifecycle canonical - Closes the class `resolveHarnessCovers` (row 7.9) was one instance of.
/**
 * Config Text Parse Guard
 *
 * `resolveHarnessCovers` held its own path in a variable (`paths.serverConfigPath`) and never
 * named `config.json`/`config.jsonc` directly, so the earlier sweep that switched every config
 * reader to `parseConfigText` (row 7.1 owns that function) missed it — a commented `config.jsonc`
 * threw inside a catch that silently returned `[]`, and exports stopped honouring
 * `gates.harnessCovers` with no error anywhere. A fix at that one site closes the instance, not
 * the shape: this file is the enumeration that closes the shape.
 *
 * PREDICATE (stated in plain words): every `.ts` file under `server/src` and `cli/src`
 * (excluding any `_generated/` directory) whose text matches BOTH a config-path-ish token
 * (`serverConfigPath`, `getConfigPath(`, `configPath`, `resolveConfigPath`, or
 * `MCP_CONFIG_PATH`) AND a bare `JSON.parse(` call. A file holding only one of the two signals
 * is not reported: a config-path token with no `JSON.parse` cannot bypass `parseConfigText`, and
 * a bare `JSON.parse` with no config-path token in sight is reading something other than the
 * user's config file (a DB row, a schema file, an in-memory clone).
 *
 * The found set is compared, as ONE sorted value, against `PINNED_MAP` below — a file → what its
 * `JSON.parse` actually reads instead of config text. Every entry was opened and verified true
 * (see the reasons); none of the five parses config-file text strictly.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from '@jest/globals';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const SERVER_SRC_ROOT = path.resolve(TEST_DIR, '../../../../src');
const CLI_SRC_ROOT = path.resolve(TEST_DIR, '../../../../../cli/src');

const CONFIG_PATH_PATTERN =
  /serverConfigPath|getConfigPath\(|configPath|resolveConfigPath|MCP_CONFIG_PATH/;
const JSON_PARSE_PATTERN = /JSON\.parse\(/;

/** The predicate, callable directly on text so the positive control can drive it without disk I/O. */
function matchesPredicate(content: string): boolean {
  return CONFIG_PATH_PATTERN.test(content) && JSON_PARSE_PATTERN.test(content);
}

/** Every `.ts` file under `root` matching {@link matchesPredicate}, labelled `<label>/<relative path>`. */
function findMatches(root: string, label: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(root, { recursive: true, encoding: 'utf8' });
  } catch {
    return [];
  }
  return entries
    .map((file) => file.split(path.sep).join('/'))
    .filter((file) => file.endsWith('.ts'))
    .filter((file) => !file.split('/').includes('_generated'))
    .filter((file) => matchesPredicate(readFileSync(path.join(root, file), 'utf8')))
    .map((file) => `${label}/${file}`);
}

/**
 * File -> what its `JSON.parse` reads instead of config text. Re-measured 2026-09-19 against the
 * predicate above; open each file and re-check the reason still holds before trusting it.
 */
const PINNED_MAP: Record<string, string> = {
  'server/src/cli-shared/config-operations.ts':
    "applyConfigChange's JSON.parse(JSON.stringify(config)) is a deep clone of an already-parsed " +
    'in-memory config object (the candidate document a caller validates before the text-level ' +
    'write in writeConfigKeyAtomic), not a file read — see the "key order" comment a few lines up.',
  // `server/src/cli-shared/version-history.ts` was pinned here until 2026-09-21 and no longer needs
  // to be: this predicate fires on a file holding BOTH a config-path token AND a bare JSON.parse,
  // and that file held both only because one module did two jobs. Splitting it along its
  // responsibilities put the workspace-config read in `version-history-scope.ts` (which parses
  // through parseConfigText and never calls JSON.parse) and the `snapshot`-column decode in
  // `version-history-rows.ts` (which never sees a config path). Neither matches, so the exemption
  // is satisfied rather than relocated — deleted here in the same commit that made it untrue.
  'server/src/infra/config/config-schema-validator.ts':
    "getOrLoadSchemaEntry's JSON.parse(schemaContent) reads config.schema.json, the generated JSON " +
    'Schema file itself — strict JSON by definition, never a `.jsonc` user config.',
  'server/src/mcp/tools/resource-manager/prompt/services/prompt-mutation-receipt-service.ts':
    "normalizeReloadShape's JSON.parse(JSON.stringify(snapshot)) is a deep clone of an in-memory " +
    'prompt snapshot object used for a post-write comparison, not a read of config file text.',
  'server/src/modules/skills-sync/service.ts':
    'the three remaining JSON.parse calls (toolIndex output_files/source_snapshot rows, prompt ' +
    'mutation metadata_json) all decode SQLite row columns; resolveHarnessCovers itself now reads ' +
    'paths.serverConfigPath through parseConfigText(raw, configFileFormat(...)) (row 7.9).',
};

describe('every config-path reader parses through parseConfigText, not a bare JSON.parse', () => {
  test('the pinned set is exactly what the predicate finds today', () => {
    const found = new Set([
      ...findMatches(SERVER_SRC_ROOT, 'server/src'),
      ...findMatches(CLI_SRC_ROOT, 'cli/src'),
    ]);
    const pinned = new Set(Object.keys(PINNED_MAP));

    const unpinned = [...found].filter((file) => !pinned.has(file)).sort();
    const stale = [...pinned].filter((file) => !found.has(file)).sort();

    if (unpinned.length > 0 || stale.length > 0) {
      const lines: string[] = [];
      if (unpinned.length > 0) {
        lines.push(
          `${unpinned.length} file(s) hold a config-path token and a bare JSON.parse(: ${unpinned.join(', ')}.`,
          'A new file holding a config path and a JSON.parse either parses config text through ' +
            'parseConfigText(text, configFileFormat(path)) from #shared/utils/config-file-format.js, ' +
            'or is added to PINNED_MAP in this test with what it parses instead.'
        );
      }
      if (stale.length > 0) {
        lines.push(
          `${stale.length} pinned entry(ies) no longer match the predicate: ${stale.join(', ')}.`,
          'Remove the stale entry from PINNED_MAP, or restore whatever made the file stop matching.'
        );
      }
      throw new Error(lines.join('\n'));
    }
  });
});

describe('predicate positive control', () => {
  test('a sample holding both a config-path token and JSON.parse( is reported', () => {
    // So the scan is shown able to fire, not merely never triggered on this repo's current tree.
    const sample: Record<string, string> = {
      'x.ts': "const p = cfg.getConfigPath(); JSON.parse(readFileSync(p,'utf8'))",
    };
    const matched = Object.keys(sample).filter((file) => matchesPredicate(sample[file] as string));
    expect(matched).toEqual(['x.ts']);
  });

  test('a sample holding only one of the two signals is not reported', () => {
    const onlyConfigPath: Record<string, string> = {
      'y.ts': 'const p = cfg.getConfigPath(); return readFileSync(p, "utf8");',
    };
    const onlyJsonParse: Record<string, string> = {
      'z.ts': 'const meta = JSON.parse(row.metadata_json);',
    };
    expect(
      Object.keys(onlyConfigPath).filter((file) => matchesPredicate(onlyConfigPath[file] as string))
    ).toEqual([]);
    expect(
      Object.keys(onlyJsonParse).filter((file) => matchesPredicate(onlyJsonParse[file] as string))
    ).toEqual([]);
  });
});
