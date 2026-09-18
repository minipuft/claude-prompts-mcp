/**
 * The change tracker records every operator-owned root — primary and overlays — one file per id.
 *
 * WHY THIS TEST EXISTS
 * Hot reload came to watch bundled, primary and overlay roots while the tracker still recorded the
 * primary alone, so an overlay edit changed what the server serves and left no `resource_changes`
 * row. Spanning roots has a consequence the tracker's storage makes sharp: its hash cache is keyed
 * `type/id`, and the overlay contract lets an id live in two roots. Recording both copies would
 * make every comparison alternate between them. So the rule is the loaders' own — the
 * highest-precedence copy is the one tracked — and it must hold in all three places the tracker
 * reads the disk: the baseline walk, the per-file watcher handler, and the reconciliation sweep a
 * late-created folder triggers. The bundled tree stays out (`trackedResourceRoots` records why).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { SqliteEngine } from '../../../src/infra/database/index.js';
import { PathResolver } from '../../../src/runtime/paths.js';
import {
  buildResourceChangeTrackerAuxiliaryReloadConfig,
  compareResourceBaseline,
  initializeResourceChangeTracker,
  trackedResourceRoots,
} from '../../../src/runtime/resource-change-tracking.js';
import { testScratchPath } from '../../helpers/scratch-path.js';

import type { ConfigLoader } from '../../../src/infra/config/index.js';
import type { ResourceChangeTracker } from '../../../src/infra/observability/tracking/index.js';
import type { AuxiliaryReloadConfig } from '../../../src/modules/hot-reload/hot-reload-observer.js';
import type { FileChangeOperation, Logger } from '../../../src/shared/types/index.js';

const logger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

const TEST_DIR = testScratchPath('tracked-roots');
const PACKAGE_ROOT = path.join(TEST_DIR, 'package');
const WORKSPACE = path.join(TEST_DIR, 'workspace');
const PRIMARY = path.join(WORKSPACE, 'resources', 'prompts');
const OVERLAY = path.join(WORKSPACE, 'prompts');
const GATES = path.join(WORKSPACE, 'resources', 'gates');
const BUNDLED = path.join(PACKAGE_ROOT, 'resources', 'prompts');

const configManager = {
  getResolvedPromptsDirectory: () => PRIMARY,
  getGatesDirectory: () => GATES,
} as unknown as ConfigLoader;

async function writePrompt(root: string, relativeDir: string, body: string): Promise<string> {
  const dir = path.join(root, relativeDir);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, 'prompt.yaml');
  await writeFile(
    file,
    [`id: ${path.basename(dir)}`, `name: ${body}`, `userMessageTemplate: "${body}"`, ''].join('\n'),
    'utf-8'
  );
  return file;
}

describe('the change tracker spans operator roots, one file per id', () => {
  let dbManager: SqliteEngine;
  let tracker: ResourceChangeTracker;
  let registration: AuxiliaryReloadConfig;
  const previousWorkspace = process.env['MCP_WORKSPACE'];
  const previousResources = process.env['MCP_RESOURCES_PATH'];

  beforeAll(async () => {
    await mkdir(BUNDLED, { recursive: true });
    await mkdir(GATES, { recursive: true });
    process.env['MCP_WORKSPACE'] = WORKSPACE;
    delete process.env['MCP_RESOURCES_PATH'];
    dbManager = await SqliteEngine.getInstance(TEST_DIR, logger);
    await dbManager.initialize();
    tracker = await initializeResourceChangeTracker(logger, TEST_DIR);
    const built = buildResourceChangeTrackerAuxiliaryReloadConfig(
      logger,
      configManager,
      new PathResolver({ cli: {}, packageRoot: PACKAGE_ROOT })
    );
    if (built === undefined) throw new Error('tracker registration was not built');
    registration = built;
  });

  afterAll(async () => {
    if (previousWorkspace === undefined) delete process.env['MCP_WORKSPACE'];
    else process.env['MCP_WORKSPACE'] = previousWorkspace;
    if (previousResources !== undefined) process.env['MCP_RESOURCES_PATH'] = previousResources;
    await dbManager.shutdown();
    await rm(TEST_DIR, { recursive: true, force: true, maxRetries: 5 });
  });

  beforeEach(async () => {
    await rm(PRIMARY, { recursive: true, force: true });
    await rm(OVERLAY, { recursive: true, force: true });
    await mkdir(PRIMARY, { recursive: true });
    // Empty the cache and the log for every case: sweeping against nothing present removes every
    // cached key, and the rows that sweep wrote are cleared with the rest.
    await tracker.sweepRemovals([]);
    dbManager.run(`DELETE FROM resource_changes`);
  });

  const roots = () =>
    trackedResourceRoots(configManager, new PathResolver({ cli: {}, packageRoot: PACKAGE_ROOT }));

  /** Every `resource_changes` row for one id, oldest first. */
  const rowsFor = (resourceId: string): Array<{ operation: string; file_path: string }> =>
    dbManager.query<{ operation: string; file_path: string }>(
      `SELECT operation, file_path FROM resource_changes WHERE resource_id = ? ORDER BY id ASC`,
      [resourceId]
    );

  const fileEvent = (file: string, changeType: FileChangeOperation) =>
    registration.handler({
      type: 'prompt_changed',
      reason: 'test',
      affectedFiles: [file],
      changeType,
      timestamp: Date.now(),
      requiresFullReload: false,
    });

  it('watches the primary and the overlay, whether or not the overlay exists, and never the bundled tree', () => {
    expect(roots().prompt).toEqual([OVERLAY, PRIMARY]);
    expect(registration.directories).toEqual(expect.arrayContaining([OVERLAY, PRIMARY, GATES]));
    expect(registration.directories).not.toContain(BUNDLED);
  });

  it('tracks the serving copy of a duplicated id, so repeated baselines stay quiet', async () => {
    await writePrompt(PRIMARY, 'general/dup', 'PRIMARY-COPY');
    const overlayFile = await writePrompt(OVERLAY, 'general/dup', 'OVERLAY-COPY');
    await writePrompt(OVERLAY, 'general/solo', 'OVERLAY-ONLY');

    const first = await compareResourceBaseline(tracker, roots(), logger);
    const second = await compareResourceBaseline(tracker, roots(), logger);

    expect(first.added).toBe(2);
    expect(rowsFor('dup')).toEqual([{ operation: 'added', file_path: overlayFile }]);
    expect(rowsFor('solo').map((row) => row.operation)).toEqual(['added']);
    // Two copies, two runs, and no alternation between them.
    expect(second).toEqual({ added: 0, modified: 0, removed: 0, refused: 0 });

    // Positive control for that silence: an edit to the serving copy IS a change.
    await writePrompt(OVERLAY, 'general/dup', 'OVERLAY-COPY-EDITED');
    const third = await compareResourceBaseline(tracker, roots(), logger);
    expect(third.modified).toBe(1);
  });

  it('logs a served change from a file event, and ignores an edit to a shadowed copy', async () => {
    const primaryFile = await writePrompt(PRIMARY, 'general/dup', 'PRIMARY-COPY');
    const overlayFile = await writePrompt(OVERLAY, 'general/dup', 'OVERLAY-COPY');
    await compareResourceBaseline(tracker, roots(), logger);

    // Shadowed: the overlay serves, so the primary copy's edit changes nothing served.
    await writePrompt(PRIMARY, 'general/dup', 'PRIMARY-COPY-EDITED');
    await fileEvent(primaryFile, 'modified');
    expect(rowsFor('dup').map((row) => row.operation)).toEqual(['added']);

    // Removing the serving copy hands the id to the primary: a content change, not a removal.
    await rm(path.dirname(overlayFile), { recursive: true });
    await fileEvent(overlayFile, 'removed');
    expect(rowsFor('dup').slice(1)).toEqual([{ operation: 'modified', file_path: primaryFile }]);

    // A nested step is keyed as the walk keys it, not by its folder name alone.
    const stepFile = await writePrompt(PRIMARY, 'examples/chain/step_one', 'STEP');
    await fileEvent(stepFile, 'added');
    expect(rowsFor('chain/step_one').map((row) => row.operation)).toEqual(['added']);
    expect(rowsFor('step_one')).toEqual([]);
  });

  it('reconciles a removal that no file event reported', async () => {
    const soloFile = await writePrompt(OVERLAY, 'general/solo', 'OVERLAY-ONLY');
    await writePrompt(PRIMARY, 'general/kept', 'KEPT');
    await compareResourceBaseline(tracker, roots(), logger);

    await rm(path.dirname(soloFile), { recursive: true });
    await registration.reconcile(OVERLAY);

    expect(rowsFor('solo').map((row) => row.operation)).toEqual(['added', 'removed']);
    // The control: an id still on disk is not swept.
    expect(rowsFor('kept').map((row) => row.operation)).toEqual(['added']);
  });
});
