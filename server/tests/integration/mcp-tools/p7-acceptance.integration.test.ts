/**
 * P7 row 6.1 — the three acceptance clauses in one driven run against a REAL engine.
 *
 * Classification: integration. Real `PromptLifecycleProcessor`, real `PromptVersioningProcessor`,
 * real `FileOperations` writing a temp workspace, and — unlike `prompt-patch-update.test.ts`,
 * which doubles the version seam — a REAL `VersionHistoryService` over a REAL `SqliteEngine`, so
 * every assertion about a version is an assertion about a durable `version_history` row.
 *
 * Clauses (plan §Charter):
 *   (a) a one-section prompt edit is expressible without transmitting the untouched sections;
 *   (b) it is rejected cleanly on template-syntax error, without writing and without consuming a
 *       version;
 *   (c) it produces the same `version_history` entry a full update would.
 * Plus the Tier 2 exact-restore leg: rollback lands on the target snapshot exactly, recorded
 * go-forward as a new "Rollback to vN" row — never a "Pre-rollback snapshot" row.
 *
 * Each test performs the WHOLE driven sequence (seed → full update → patch → rejection →
 * rollback) so every clause is proven inside one continuous run, not against an isolated fixture.
 */

import { describe, expect, jest, test, beforeEach, afterEach } from '@jest/globals';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ContentAnalyzer } from '../../../src/modules/semantic/content-analyzer.js';
import { ComparisonEngine } from '../../../src/mcp/tools/resource-manager/prompt/analysis/comparison-engine.js';
import { GateAnalyzer } from '../../../src/mcp/tools/resource-manager/prompt/analysis/gate-analyzer.js';
import { ObjectDiffGenerator } from '../../../src/mcp/tools/resource-manager/prompt/analysis/object-diff-generator.js';
import { PromptAnalyzer } from '../../../src/mcp/tools/resource-manager/prompt/analysis/prompt-analyzer.js';
import { FileOperations } from '../../../src/mcp/tools/resource-manager/prompt/operations/file-operations.js';
import { PromptLifecycleProcessor } from '../../../src/mcp/tools/resource-manager/prompt/services/prompt-lifecycle-processor.js';
import { PromptVersioningProcessor } from '../../../src/mcp/tools/resource-manager/prompt/services/prompt-versioning-processor.js';
import { VersionHistoryService } from '../../../src/modules/versioning/version-history-service.js';
import { SqliteEngine } from '../../../src/infra/database/index.js';

import type { PromptResourceContext } from '../../../src/mcp/tools/resource-manager/prompt/core/context.js';
import type { ConfigManager, Logger } from '../../../src/shared/types/index.js';

const PROMPT_ID = 'acceptance_target';
const CATEGORY = 'general';

const SEED_TEMPLATE = [
  '## Context',
  '{{input}}',
  '',
  '## Output',
  'Answer in prose.',
  '',
  '## Notes',
  'Leave this section alone.',
].join('\n');

const EDITED_TEMPLATE = SEED_TEMPLATE.replace('Answer in prose.', 'Answer in paragraphs.');
const PATCHED_TEMPLATE = EDITED_TEMPLATE.replace('Answer in paragraphs.', 'Answer in bullets.');

const createLogger = () =>
  ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }) as unknown as Logger;

interface Harness {
  lifecycle: PromptLifecycleProcessor;
  versioning: PromptVersioningProcessor;
  history: VersionHistoryService;
  fileOperations: FileOperations;
  engine: SqliteEngine;
  livePrompt: Record<string, unknown>;
  /** Apply produced state to the live view — stands in for the registry reload the real server does. */
  syncLive: (produced: Record<string, unknown>) => void;
  readFiles: () => Record<string, string>;
  dispose: () => Promise<void>;
}

async function createHarness(workspaceDir: string): Promise<Harness> {
  const promptsDir = join(workspaceDir, 'prompts');
  const logger = createLogger();
  const dependencies = {
    logger,
    semanticAnalyzer: new ContentAnalyzer(createLogger()),
    onRefresh: jest.fn(async () => {}),
    onRestart: jest.fn(async () => {}),
  };
  const fileOperations = new FileOperations({
    logger,
    configManager: { getResolvedPromptsDirectory: () => promptsDir } as unknown as ConfigManager,
  });

  // `SqliteEngine.getInstance` is a process-wide singleton: a later caller's `serverRoot` is
  // silently ignored once one instance exists (only an explicit `dbPath` mismatch is checked —
  // see sqlite-engine.ts `getInstance`). Clause (c) drives TWO harnesses inside one test, so
  // without forcing a fresh singleton here the second harness's `VersionHistoryService` would
  // read and write the FIRST harness's rows for this workspace's `PROMPT_ID`, aliasing what
  // should be two independent `version_history` tables.
  await SqliteEngine.shutdownInstance();
  const engine = await SqliteEngine.getInstance(workspaceDir, logger);
  await engine.initialize();
  const history = new VersionHistoryService({
    logger,
    configManager: {
      getVersioningConfig: () => ({ enabled: true, max_versions: 25, auto_version: true }),
      getServerRoot: () => workspaceDir,
    } as never,
    dbManager: engine,
  });

  // Deliberately loader-shaped, not snapshot-shaped: resolved runtime keys the recorded snapshot
  // never carries, and a key order that differs from the canonical construction. This is what a
  // real post-reload ConvertedPrompt looks like — if the processors stop projecting it through
  // canonicalPromptSnapshot, every edit here bridges and the row-count assertions fail.
  const livePrompt: Record<string, unknown> = {
    id: PROMPT_ID,
    name: 'Acceptance Target',
    category: CATEGORY,
    description: 'A prompt used to exercise the P7 acceptance clauses',
    userMessageTemplate: SEED_TEMPLATE,
    systemMessage: 'Be precise.',
    arguments: [{ name: 'input', type: 'string', required: true }],
    composer: { inputArgument: 'input' },
    chainSteps: [],
    registerWithMcp: true,
    mcpPromptMode: 'expand',
    promptDir: join(promptsDir, CATEGORY, PROMPT_ID),
  };

  const context = {
    dependencies,
    promptAnalyzer: new PromptAnalyzer(dependencies),
    gateAnalyzer: new GateAnalyzer(dependencies as never),
    fileOperations,
    getData: () => ({ convertedPrompts: [livePrompt] }),
    versionHistoryService: history,
    textDiffService: new ObjectDiffGenerator(),
    comparisonEngine: new ComparisonEngine(logger),
  } as unknown as PromptResourceContext;

  return {
    lifecycle: new PromptLifecycleProcessor(context),
    versioning: new PromptVersioningProcessor(context),
    history,
    fileOperations,
    engine,
    livePrompt,
    syncLive: (produced) => {
      for (const key of Object.keys(livePrompt)) delete livePrompt[key];
      Object.assign(livePrompt, produced);
    },
    readFiles: () => {
      const dir = join(promptsDir, CATEGORY, PROMPT_ID);
      const files: Record<string, string> = {};
      for (const name of readdirSync(dir).sort()) {
        files[name] = readFileSync(join(dir, name), 'utf8');
      }
      return files;
    },
    dispose: async () => {
      await engine.shutdown();
    },
  };
}

interface DriveObservations {
  filesAfterPatch: Record<string, string>;
  filesAfterRejection: Record<string, string>;
  filesBeforeRejection: Record<string, string>;
  filesAfterRollback: Record<string, string>;
  latestAfterEdit: number;
  latestAfterPatch: number;
  latestAfterRejection: number;
  latestAfterRollback: number;
  rejectionResponseIsError: boolean;
  rowsByVersion: Map<number, { snapshot: Record<string, unknown>; description: string }>;
}

/**
 * The one driven run: seed (out-of-band, so the first edit must bridge) → full update →
 * one-section patch → syntax-error rejection → rollback to the pre-patch version.
 */
async function runDrive(harness: Harness): Promise<DriveObservations> {
  await harness.fileOperations.updatePromptImplementation({ ...harness.livePrompt });

  // Full update — the first recorded edit; seed state must arrive as a bridge row.
  const editResponse = await harness.lifecycle.updatePrompt({
    id: PROMPT_ID,
    user_message_template: EDITED_TEMPLATE,
  } as never);
  expect(editResponse.isError).toBe(false);
  harness.syncLive({ ...harness.livePrompt, userMessageTemplate: EDITED_TEMPLATE });
  const latestAfterEdit = await harness.history.getLatestVersion('prompt', PROMPT_ID);

  // Clause (a): the wire carries only the anchor, never the untouched sections.
  const patchResponse = await harness.lifecycle.updatePrompt({
    id: PROMPT_ID,
    patch: [
      {
        field: 'user_message_template',
        old_string: 'Answer in paragraphs.',
        new_string: 'Answer in bullets.',
      },
    ],
  } as never);
  expect(patchResponse.isError).toBe(false);
  harness.syncLive({ ...harness.livePrompt, userMessageTemplate: PATCHED_TEMPLATE });
  const filesAfterPatch = harness.readFiles();
  const latestAfterPatch = await harness.history.getLatestVersion('prompt', PROMPT_ID);

  // Clause (b): syntax error — no write, no version.
  const filesBeforeRejection = harness.readFiles();
  const rejectionResponse = await harness.lifecycle.updatePrompt({
    id: PROMPT_ID,
    patch: [
      {
        field: 'user_message_template',
        old_string: 'Answer in bullets.',
        new_string: '{% for x in %}Answer in bullets.',
      },
    ],
  } as never);
  const filesAfterRejection = harness.readFiles();
  const latestAfterRejection = await harness.history.getLatestVersion('prompt', PROMPT_ID);

  // Exact-restore leg: roll back to the pre-patch state through the real write path.
  const rollbackResponse = await harness.versioning.handleRollback({
    id: PROMPT_ID,
    version: latestAfterEdit,
    confirm: true,
  } as never);
  expect(rollbackResponse.isError).toBe(false);
  const filesAfterRollback = harness.readFiles();
  const latestAfterRollback = await harness.history.getLatestVersion('prompt', PROMPT_ID);

  const rowsByVersion = new Map<
    number,
    { snapshot: Record<string, unknown>; description: string }
  >();
  for (let v = 1; v <= latestAfterRollback; v++) {
    const entry = await harness.history.getVersion('prompt', PROMPT_ID, v);
    if (entry) rowsByVersion.set(v, { snapshot: entry.snapshot, description: entry.description });
  }

  return {
    filesAfterPatch,
    filesAfterRejection,
    filesBeforeRejection,
    filesAfterRollback,
    latestAfterEdit,
    latestAfterPatch,
    latestAfterRejection,
    latestAfterRollback,
    rejectionResponseIsError: rejectionResponse.isError === true,
    rowsByVersion,
  };
}

describe('P7 acceptance — driven run against a real engine', () => {
  let workspaces: string[] = [];
  let harnesses: Harness[] = [];

  async function drivenHarness(): Promise<Harness> {
    const dir = mkdtempSync(join(tmpdir(), 'cpm-p7-acceptance-'));
    workspaces.push(dir);
    const harness = await createHarness(dir);
    harnesses.push(harness);
    return harness;
  }

  beforeEach(() => {
    workspaces = [];
    harnesses = [];
  });

  afterEach(async () => {
    for (const harness of harnesses) await harness.dispose();
    for (const dir of workspaces) rmSync(dir, { recursive: true, force: true });
  });

  test('clause (a): a one-section patch lands without transmitting untouched sections, and is recorded as a durable row', async () => {
    const harness = await drivenHarness();
    const run = await runDrive(harness);

    expect(run.filesAfterPatch['user-message.md']).toContain('Answer in bullets.');
    expect(run.filesAfterPatch['user-message.md']).toContain('Leave this section alone.');

    // The row is the state the patch PRODUCED — go-forward numbering over the full body,
    // even though the wire carried only the anchor.
    expect(run.latestAfterPatch).toBe(run.latestAfterEdit + 1);
    const patchRow = run.rowsByVersion.get(run.latestAfterPatch);
    expect(patchRow?.snapshot['userMessageTemplate']).toBe(PATCHED_TEMPLATE);

    // Seed state arrived out-of-band (no version recorded), so the first edit bridged it.
    const bridgeRow = run.rowsByVersion.get(1);
    expect(bridgeRow?.snapshot['userMessageTemplate']).toBe(SEED_TEMPLATE);
    expect(bridgeRow?.description).toContain('Bridge');
  });

  test('clause (b): a template-syntax error is rejected without writing and without consuming a version', async () => {
    const harness = await drivenHarness();
    const run = await runDrive(harness);

    expect(run.rejectionResponseIsError).toBe(true);
    expect(run.filesAfterRejection).toEqual(run.filesBeforeRejection);
    expect(run.latestAfterRejection).toBe(run.latestAfterPatch);
  });

  test('clause (c): the patch records the same version_history entry the equivalent full update records', async () => {
    const patched = await drivenHarness();
    const patchedRun = await runDrive(patched);

    // Twin drive: identical sequence, except the patch step is the equivalent full-body update.
    const full = await drivenHarness();
    await full.fileOperations.updatePromptImplementation({ ...full.livePrompt });
    const editResponse = await full.lifecycle.updatePrompt({
      id: PROMPT_ID,
      user_message_template: EDITED_TEMPLATE,
    } as never);
    expect(editResponse.isError).toBe(false);
    full.syncLive({ ...full.livePrompt, userMessageTemplate: EDITED_TEMPLATE });
    const fullUpdateResponse = await full.lifecycle.updatePrompt({
      id: PROMPT_ID,
      user_message_template: PATCHED_TEMPLATE,
    } as never);
    expect(fullUpdateResponse.isError).toBe(false);

    const version = patchedRun.latestAfterPatch;
    const patchRow = patchedRun.rowsByVersion.get(version);
    const fullRow = await full.history.getVersion('prompt', PROMPT_ID, version);
    expect(fullRow).not.toBeNull();

    // Content anchor BEFORE the parity compare: `version` is a version NUMBER, and
    // `VersionHistoryService` sits over a process-wide `SqliteEngine` singleton
    // (`SqliteEngine.getInstance` keeps the first caller's db regardless of a later caller's
    // `serverRoot` — see sqlite-engine.ts). Without `createHarness` forcing a fresh singleton per
    // harness (below), `full.history` and `patched.history` alias the SAME underlying rows for
    // this PROMPT_ID, so comparing "version 3 vs version 3" compares a row to itself and passes
    // regardless of what either harness actually wrote. Anchoring on content first makes that
    // failure mode loud (wrong template, not just a snapshot diff) instead of silently trivial.
    expect(patchRow?.snapshot['userMessageTemplate']).toBe(PATCHED_TEMPLATE);
    expect(
      (fullRow?.snapshot as Record<string, unknown> | undefined)?.['userMessageTemplate']
    ).toBe(PATCHED_TEMPLATE);

    expect(patchRow?.snapshot).toEqual(fullRow?.snapshot);
    expect(patchRow?.description).toBe(fullRow?.description);
  });

  test('rollback restores the target snapshot exactly, recorded go-forward with no pre-rollback row', async () => {
    const harness = await drivenHarness();
    const run = await runDrive(harness);

    // The restored files carry the pre-patch template exactly.
    expect(run.filesAfterRollback['user-message.md']).toContain('Answer in paragraphs.');
    expect(run.filesAfterRollback['user-message.md']).not.toContain('Answer in bullets.');
    expect(run.filesAfterRollback['user-message.md']).toContain('Leave this section alone.');
    expect(run.filesAfterRollback['prompt.yaml']).toContain('inputArgument: input');

    // Go-forward: the rollback is one new row holding the restored state; the target row is
    // untouched, and nothing anywhere is a "Pre-rollback snapshot".
    expect(run.latestAfterRollback).toBe(run.latestAfterPatch + 1);
    const rollbackRow = run.rowsByVersion.get(run.latestAfterRollback);
    expect(rollbackRow?.description).toBe(`Rollback to v${run.latestAfterEdit}`);
    expect(rollbackRow?.snapshot).toEqual(run.rowsByVersion.get(run.latestAfterEdit)?.snapshot);
    expect(rollbackRow?.snapshot['composer']).toEqual({ inputArgument: 'input' });
    for (const { description } of run.rowsByVersion.values()) {
      expect(description).not.toContain('Pre-rollback snapshot');
    }
  });
});
