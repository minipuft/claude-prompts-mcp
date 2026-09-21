// @lifecycle test - Integration test for style refusals reaching the index (plan row P4.16)
/**
 * Styles were the fourth kind `ResourceIndexer` walks and the only one with no refusal record.
 *
 * P4.14 taught the indexer to withhold a file its loader refused, and P4.15 filled the gate and
 * framework collections, so the "absent from `resource_index` when the catalog dropped it" property
 * held for three of the four directory-form kinds. It silently did not hold for `style`:
 * `StyleDefinitionLoader` drops a malformed `style.yaml` and returns `undefined`, while the indexer
 * — which parses the same YAML itself and only ever checked that it PARSES — indexed it anyway. A
 * Python hook reading `resource_index` was therefore offered a style the server cannot load.
 *
 * WHY THE REAL LOADER. `QuarantineView.isRefused` is keyed by PATH, so the whole mechanism rests on
 * the string the loader records equalling the string the indexer walks, and those are produced by
 * different code. A hand-built view would assert a match this file also constructed.
 *
 * WHY THE FIXTURE IS SCHEMA-INVALID AND NOT MALFORMED YAML. The indexer's own walk already skips a
 * file it cannot parse, so malformed YAML never distinguishes the fix. A declared `id` that
 * disagrees with its directory parses perfectly and fails `validateStyleSchema` — exactly the case
 * the old indexer indexed and the catalog dropped.
 *
 * Classification: Integration (real SQLite engine, real filesystem, real StyleDefinitionLoader).
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { ResourceIndexer, SqliteEngine } from '../../../src/infra/database/index.js';
import { StyleDefinitionLoader } from '../../../src/modules/formatting/core/style-definition-loader.js';

import type { QuarantineView } from '../../../src/shared/utils/resource-quarantine.js';
import { testScratchPath } from '../../helpers/scratch-path.js';

const mockLogger = {
  info: jest.fn() as jest.Mock,
  warn: jest.fn() as jest.Mock,
  error: jest.fn() as jest.Mock,
  debug: jest.fn() as jest.Mock,
};

const TEST_DIR = testScratchPath('style-quarantine-indexing');
const RESOURCES_DIR = path.join(TEST_DIR, 'resources');
/** Must be exactly what `ResourceIndexer.rootsFor('style', 'styles')` derives. */
const STYLES_DIR = path.join(RESOURCES_DIR, 'styles');

const validStyle = (id: string): string =>
  [
    `id: ${id}`,
    `name: ${id} style`,
    'description: A style that loads cleanly and should reach the index.',
    'guidance: Write it plainly.',
    '',
  ].join('\n');

/**
 * A style file the loader REFUSES: `description` is required and absent.
 *
 * Chosen over the obvious id-mismatch fixture on purpose. The indexer derives a FLAT-layout id from
 * the file's declared `id` field (`identityOf`), while the loader derives it from the directory, so
 * a mismatch fixture makes the two sides name the resource differently and the assertions stop
 * being about refusal at all. A missing required field leaves both derivations agreeing on
 * `dirName`, which is what lets the row-deletion case below match a refusal to the row it deletes.
 */
const refusedStyle = (dirName: string): string =>
  [`id: ${dirName}`, `name: ${dirName} style`, 'guidance: Write it plainly.', ''].join('\n');

async function writeStyle(id: string, body: string): Promise<void> {
  const dir = path.join(STYLES_DIR, id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'style.yaml'), body, 'utf-8');
}

const indexedStyleIds = (dbManager: SqliteEngine): string[] =>
  dbManager
    .query<{ id: string }>("SELECT id FROM resource_index WHERE type = 'style' ORDER BY id")
    .map((row) => row.id);

describe('a style its loader refused is absent from resource_index', () => {
  let dbManager: SqliteEngine;

  beforeAll(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    await fs.mkdir(TEST_DIR, { recursive: true });
    dbManager = await SqliteEngine.getInstance(mockLogger as never, {
      dbPath: path.join(TEST_DIR, 'runtime-state', 'state.db'),
    });
    await dbManager.initialize();
  });

  afterAll(async () => {
    if (dbManager) {
      await dbManager.shutdown();
    }
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await fs.rm(RESOURCES_DIR, { recursive: true, force: true });
    await fs.mkdir(STYLES_DIR, { recursive: true });
    dbManager.run('DELETE FROM resource_index');
    jest.clearAllMocks();
  });

  /**
   * Drive the real loader over the temp tree and hand back its live collection.
   *
   * `loadAllStyles()` rather than `discoverStyles()` deliberately: discovery lists directories and
   * never opens a file, so nothing is refused until something is READ. This is the same reason the
   * composition root reports the LOADED style count — a wiring that only discovered would hand the
   * indexer a permanently empty view and every assertion below would pass for the wrong reason.
   */
  function loadStylesAndQuarantine(): { quarantine: QuarantineView; refusedIds: string[] } {
    const loader = new StyleDefinitionLoader({ stylesDir: STYLES_DIR, enableCache: false });
    loader.loadAllStyles();
    const quarantine = loader.getQuarantine();
    return { quarantine, refusedIds: quarantine.list().map((record) => record.id) };
  }

  const indexerWith = (quarantine: QuarantineView | undefined): ResourceIndexer =>
    new ResourceIndexer(dbManager, mockLogger as never, {
      resourcesDir: RESOURCES_DIR,
      trackTools: false,
      ...(quarantine !== undefined ? { quarantine } : {}),
    });

  it('withholds a refused style while indexing its valid sibling', async () => {
    await writeStyle('healthy_style', validStyle('healthy_style'));
    await writeStyle('broken_style', refusedStyle('broken_style'));

    const { quarantine, refusedIds } = loadStylesAndQuarantine();

    // Positive control on the FIXTURE, before anything is asserted about the index: the style
    // loader really did refuse one file and accept the other. A tree where nothing was refused
    // would satisfy the absence below for free.
    expect(refusedIds).toEqual(['broken_style']);

    const result = await indexerWith(quarantine).syncAll();

    // The absence...
    expect(indexedStyleIds(dbManager)).not.toContain('broken_style');
    // ...and the positive control for it, from the same probe over the same table.
    expect(indexedStyleIds(dbManager)).toContain('healthy_style');

    // Reported as refused, not as removed — a file still on disk is not a deleted one.
    expect(result.refused).toEqual([
      {
        type: 'style',
        id: 'broken_style',
        filePath: path.join(STYLES_DIR, 'broken_style', 'style.yaml'),
        rowDeleted: false,
      },
    ]);
    expect(result.removed).toBe(0);
  });

  it('indexes the refused style when no quarantine is supplied, which is the defect', async () => {
    // The pre-change control, kept live. Without the style view the indexer falls back to
    // "anything that parses", and a broken style reaches the table the Python hooks read. This
    // case FAILING is how we know the case above passes for the right reason.
    await writeStyle('healthy_style', validStyle('healthy_style'));
    await writeStyle('broken_style', refusedStyle('broken_style'));

    await indexerWith(undefined).syncAll();

    expect(indexedStyleIds(dbManager)).toContain('broken_style');
  });

  it('deletes a stale row when a style that used to load has been broken', async () => {
    // The other half of "absent": R2's disposition for a row that already exists. It is deleted,
    // and reported as `refused` with `rowDeleted`, never counted as `removed`.
    await writeStyle('healthy_style', validStyle('healthy_style'));
    await writeStyle('was_valid', validStyle('was_valid'));

    const warm = loadStylesAndQuarantine();
    expect(warm.refusedIds).toEqual([]);
    await indexerWith(warm.quarantine).syncAll();
    expect(indexedStyleIds(dbManager)).toEqual(['healthy_style', 'was_valid']);

    await writeStyle('was_valid', refusedStyle('was_valid'));
    const cold = loadStylesAndQuarantine();
    expect(cold.refusedIds).toEqual(['was_valid']);

    const result = await indexerWith(cold.quarantine).syncAll();

    expect(indexedStyleIds(dbManager)).toEqual(['healthy_style']);
    expect(result.refused).toEqual([
      {
        type: 'style',
        id: 'was_valid',
        filePath: path.join(STYLES_DIR, 'was_valid', 'style.yaml'),
        rowDeleted: true,
      },
    ]);
    expect(result.removed).toBe(0);
  });

  it('forgets the record once the same file loads, so a repair re-indexes', async () => {
    // `StyleDefinitionLoader` resolves one id at a time behind a cache, so it has no walk boundary
    // at which a root could be cleared and rebuilt — it records on refusal and forgets on success.
    // Without the `forget`, a repaired style would report as refused forever and never come back.
    await writeStyle('repairable', refusedStyle('repairable'));

    const loader = new StyleDefinitionLoader({ stylesDir: STYLES_DIR, enableCache: false });
    loader.loadAllStyles();
    expect(loader.getQuarantine().size).toBe(1);

    await writeStyle('repairable', validStyle('repairable'));
    loader.loadAllStyles();
    expect(loader.getQuarantine().size).toBe(0);

    await indexerWith(loader.getQuarantine()).syncAll();
    expect(indexedStyleIds(dbManager)).toEqual(['repairable']);
  });

  it('leaves a style that exists in no root unrecorded, because nothing was read', () => {
    // An absent entry point is not a refusal. Recording it would put a file that does not exist in
    // front of a repair surface, and `byId` would answer for an id nobody ever wrote.
    const loader = new StyleDefinitionLoader({ stylesDir: STYLES_DIR, enableCache: false });
    expect(loader.loadStyle('never_existed')).toBeUndefined();
    expect(loader.getQuarantine().size).toBe(0);
  });
});
