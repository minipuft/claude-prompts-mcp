/**
 * A hot-reload event that arrives while a prompt reload runs is reloaded afterwards, not dropped.
 *
 * WHY THIS TEST EXISTS
 * `Application.handlePromptHotReload` used to guard itself with "a reload is already running, skip
 * this event". A late-folder reconcile or a prompt edit that landed inside a running reload's
 * window was logged and discarded, and the change it announced stayed unserved until some
 * unrelated later change happened to trigger another reload. The guard stood exactly where the
 * defect was: at most one reload at a time is right, dropping the event is not.
 *
 * The ruling this holds (OQ-9): at most one reload runs at a time, and every event that arrives
 * while it runs collapses into EXACTLY ONE reload afterwards, carrying every reason.
 *
 * HOW THE WINDOW IS HELD
 * Racing a live watcher would trade a deterministic assertion for a flaky one, so the first reload
 * is held open instead: the real loader reads the disk, then waits on a gate before returning. That
 * is precisely the state a slow reload is in — the disk has been read, nothing is published yet —
 * and the two changes are written to disk while it is held, so the first reload cannot see them.
 *
 * Everything on the reload path is real — `Application`'s handler, `reloadPromptData`, the prompt
 * loader reading a real directory, the registry, a real `McpServer` shell — except the four config
 * accessors naming the root, and a recorder standing in for the MCP tool router.
 * Assertions read served CONTENT, never a count alone: the count of reloads is asserted too, but
 * "both changes are served" is what a user would observe.
 */

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { McpServer } from '@modelcontextprotocol/server';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { PromptAssetManager } from '../../../src/modules/prompts/index.js';
import { ConversationStore } from '../../../src/modules/text-refs/conversation.js';
import { TextReferenceStore } from '../../../src/modules/text-refs/index.js';
import { Application } from '../../../src/runtime/application.js';
import { testScratchPath } from '../../helpers/scratch-path.js';

import type { RuntimeLaunchOptions } from '../../../src/runtime/options.js';
import type { ConfigManager, HotReloadEvent, Logger } from '../../../src/shared/types/index.js';

async function writePrompt(
  root: string,
  category: string,
  id: string,
  body: string
): Promise<void> {
  const dir = path.join(root, category, id);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, 'prompt.yaml'),
    [
      `id: ${id}`,
      `name: ${id}`,
      `category: ${category}`,
      `description: Fixture prompt ${id}.`,
      'userMessageTemplateFile: user-message.md',
      '',
    ].join('\n'),
    'utf8'
  );
  await writeFile(path.join(dir, 'user-message.md'), `${body}\n`, 'utf8');
}

/** Only the accessors the reload path reads; a fuller double could hide a signature change. */
function configFor(primary: string): ConfigManager {
  return {
    getResolvedPromptsDirectory: () => primary,
    getBundledResourceDirectory: () => undefined,
    getOverlayResourceDirectories: () => [],
    getPromptsRegisterWithMcp: () => true,
  } as unknown as ConfigManager;
}

function event(reason: string, file: string, type: HotReloadEvent['type']): HotReloadEvent {
  return { type, reason, affectedFiles: [file], timestamp: Date.now(), requiresFullReload: true };
}

interface Gate {
  /** Resolves once the held load has read the disk and is waiting. */
  entered: Promise<void>;
  release: () => void;
}

interface Harness {
  app: Application;
  /** The exact callback `Application` hands the prompt hot-reload observer. */
  onReload: (event: HotReloadEvent) => Promise<void>;
  /** One entry per reload that read the disk. */
  loads: number;
  /** Every message `Application` logged at info, in order. */
  info: string[];
  /** Hold the NEXT load open after it has read the disk; `fail` makes it throw once released. */
  holdNextLoad: (options?: { fail?: boolean }) => Gate;
  body: (id: string) => string | undefined;
}

describe('a hot-reload event that lands during a running prompt reload', () => {
  let primary: string;
  let harness: Harness;

  beforeEach(async () => {
    primary = testScratchPath('prompt-reload-coalescing');
    await writePrompt(primary, 'general', 'edited_prompt', 'BODY BEFORE');

    const info: string[] = [];
    const logger = {
      info: (message: string) => info.push(message),
      warn: () => {},
      error: () => {},
      debug: () => {},
    } as unknown as Logger;

    const runtimeOptions: Partial<RuntimeLaunchOptions> = {
      serverRoot: primary,
      args: [],
      verbose: false,
      quiet: true,
      startupTest: false,
      testEnvironment: true,
      paths: {},
    };
    const app = new Application(logger, runtimeOptions as RuntimeLaunchOptions);
    const mcpServer = new McpServer(
      { name: 'coalescing-test', version: '1.0.0' },
      { capabilities: { prompts: { listChanged: true } } }
    );
    const promptManager = new PromptAssetManager(
      logger,
      new TextReferenceStore(logger),
      new ConversationStore(logger),
      configFor(primary),
      mcpServer
    );

    let pendingHold: { gate: Promise<void>; entered: () => void; fail: boolean } | undefined;
    const realLoad = promptManager.loadAndConvertPrompts.bind(promptManager);
    const state = { loads: 0 };
    jest.spyOn(promptManager, 'loadAndConvertPrompts').mockImplementation(async (...args) => {
      const result = await realLoad(...args);
      state.loads += 1;
      const hold = pendingHold;
      pendingHold = undefined;
      if (hold !== undefined) {
        hold.entered();
        await hold.gate;
        if (hold.fail) throw new Error('held reload failed');
      }
      return result;
    });

    // The composition root's private collaborators, set through one cast: a real `startup()`
    // would bring up transports, SQLite and every module, none of which this path reads.
    Object.assign(app as unknown as Record<string, unknown>, {
      promptManager,
      mcpServer,
      configManager: configFor(primary),
      mcpToolsManager: { updateData: () => {} },
    });

    harness = {
      app,
      onReload: (app as unknown as { promptHotReloadHandler: Harness['onReload'] })
        .promptHotReloadHandler,
      get loads() {
        return state.loads;
      },
      info,
      holdNextLoad: ({ fail = false } = {}) => {
        let release!: () => void;
        let entered!: () => void;
        const gate = new Promise<void>((resolve) => (release = resolve));
        const enteredPromise = new Promise<void>((resolve) => (entered = resolve));
        pendingHold = { gate, entered, fail };
        return { entered: enteredPromise, release };
      },
      body: (id) => app.convertedPrompts.find((prompt) => prompt.id === id)?.userMessageTemplate,
    };
  });

  afterEach(async () => {
    await rm(primary, { recursive: true, force: true, maxRetries: 5 });
  });

  /**
   * Two changes written while the first reload is held, each announced by its own event. Returns
   * how each caller's promise settled: the one that started the held reload, then the two after.
   */
  async function landTwoEventsInsideOneReload(options?: {
    fail?: boolean;
  }): Promise<Array<PromiseSettledResult<void>>> {
    const gate = harness.holdNextLoad(options);
    const first = harness.onReload(
      event('1 prompt file(s) changed', path.join(primary, 'general'), 'prompt_changed')
    );
    await gate.entered;

    // Both changes land after the held reload read the disk, so it cannot reflect either.
    await writePrompt(primary, 'general', 'edited_prompt', 'BODY AFTER EDIT');
    const lateFolder = path.join(primary, 'late');
    await writePrompt(primary, 'late', 'late_prompt', 'LATE FOLDER BODY');

    const reconcile = harness.onReload(
      event(`reconciling ${lateFolder}, created after startup`, lateFolder, 'reload_required')
    );
    const edit = harness.onReload(
      event('1 prompt file(s) changed: edited_prompt', primary, 'prompt_changed')
    );

    gate.release();
    return Promise.allSettled([first, reconcile, edit]);
  }

  it('serves both changes afterwards, with exactly one extra reload carrying both reasons', async () => {
    const settled = await landTwoEventsInsideOneReload();

    expect(settled.map((outcome) => outcome.status)).toEqual([
      'fulfilled',
      'fulfilled',
      'fulfilled',
    ]);
    expect(harness.body('edited_prompt')).toContain('BODY AFTER EDIT');
    expect(harness.body('late_prompt')).toContain('LATE FOLDER BODY');
    expect(harness.loads).toBe(2);

    const received = harness.info.filter((line) => line.startsWith('🔥 Hot reload event received'));
    expect(received).toHaveLength(2);
    expect(received[1]).toContain('created after startup');
    expect(received[1]).toContain('edited_prompt');
  });

  it('still runs the queued reload when the one it waited behind fails', async () => {
    const settled = await landTwoEventsInsideOneReload({ fail: true });

    // The failure reaches only the caller whose reload failed; the two queued behind it succeed.
    expect(settled.map((outcome) => outcome.status)).toEqual([
      'rejected',
      'fulfilled',
      'fulfilled',
    ]);
    expect(harness.loads).toBe(2);
    expect(harness.body('edited_prompt')).toContain('BODY AFTER EDIT');
    expect(harness.body('late_prompt')).toContain('LATE FOLDER BODY');
  });

  it('reloads once per event when events do not overlap — the positive control', async () => {
    // Coalescing must only merge events that arrive DURING a reload. Two events apart are two
    // reloads, each serving what the disk held when it ran.
    await harness.onReload(event('first', primary, 'prompt_changed'));
    expect(harness.loads).toBe(1);
    expect(harness.body('edited_prompt')).toContain('BODY BEFORE');

    await writePrompt(primary, 'general', 'edited_prompt', 'BODY SECOND');
    await harness.onReload(event('second', primary, 'prompt_changed'));
    expect(harness.loads).toBe(2);
    expect(harness.body('edited_prompt')).toContain('BODY SECOND');
  });
});
