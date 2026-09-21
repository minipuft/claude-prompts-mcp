import { readdirSync, readFileSync } from 'node:fs';
import { appendFile, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';

import { createSimpleLogger } from '../../../src/infra/logging/index.js';
import * as fileObserverModule from '../../../src/modules/hot-reload/file-observer.js';
import {
  createFileObserver,
  type FileChangeEvent,
} from '../../../src/modules/hot-reload/file-observer.js';
import { HotReloadObserver } from '../../../src/modules/hot-reload/hot-reload-observer.js';

import type { EventEmitter } from 'node:events';

const SRC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../src');
const FILE_OBSERVER_SOURCE = path.join(SRC_ROOT, 'modules/hot-reload/file-observer.ts');

function waitForFileEvent(
  observer: ReturnType<typeof createFileObserver>,
  expectedType: FileChangeEvent['type'],
  expectedFilename: string
): Promise<FileChangeEvent> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      observer.off('fileChange', handleEvent);
      reject(new Error(`Timed out waiting for ${expectedType}:${expectedFilename}`));
    }, 5000);

    const handleEvent = (event: FileChangeEvent) => {
      if (event.type !== expectedType || event.filename !== expectedFilename) {
        return;
      }

      clearTimeout(timeout);
      observer.off('fileChange', handleEvent);
      resolve(event);
    };

    observer.on('fileChange', handleEvent);
  });
}

describe('FileObserver', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'file-observer-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test('emits added, modified, and removed events for watched files', async () => {
    const observer = createFileObserver(createSimpleLogger('stdio'), {
      debounceMs: 25,
      retryDelayMs: 25,
      usePolling: true,
      pollingInterval: 25,
    });

    await observer.start();

    try {
      await observer.watchDirectory(tempDir);
      await new Promise((resolve) => setTimeout(resolve, 100));

      const filePath = path.join(tempDir, 'prompt.md');

      const addedEvent = waitForFileEvent(observer, 'added', 'prompt.md');
      await writeFile(filePath, '# hello\n', 'utf8');
      await expect(addedEvent).resolves.toMatchObject({
        type: 'added',
        filename: 'prompt.md',
        isPromptFile: true,
      });

      const modifiedEvent = waitForFileEvent(observer, 'modified', 'prompt.md');
      await appendFile(filePath, 'updated\n', 'utf8');
      await expect(modifiedEvent).resolves.toMatchObject({
        type: 'modified',
        filename: 'prompt.md',
        isPromptFile: true,
      });

      const removedEvent = waitForFileEvent(observer, 'removed', 'prompt.md');
      await unlink(filePath);
      await expect(removedEvent).resolves.toMatchObject({
        type: 'removed',
        filename: 'prompt.md',
        isPromptFile: true,
      });
    } finally {
      await observer.stop();
    }
  });
});

/**
 * Every event `FileObserver` emits has a production listener.
 *
 * `promptFileChange`, `configFileChange`, `frameworkFileChange` and the `file:<type>` family were
 * emitted on every file change for as long as they existed and nothing ever subscribed to one
 * (B.77) — the same shape as the unwired framework reload callback B.57 deleted. A name-keyed
 * search for a listener is not the probe here: the check walks the edge instead. `FileObserver`'s
 * only production constructor is `HotReloadObserver`, which keeps it private, so the listeners that
 * exist are exactly the ones a fresh `HotReloadObserver` has registered on it.
 */
describe('every event FileObserver emits has a listener', () => {
  /** Each `this.emit(<name>` in the source, resolved to the event name it emits. */
  function emittedEventNames(): string[] {
    const source = readFileSync(FILE_OBSERVER_SOURCE, 'utf8');
    const args = [...source.matchAll(/this\.emit\(\s*([^,)]+)/g)].map((match) => match[1]!.trim());
    return args.map((arg) => {
      const literal = /^'([^']+)'$/.exec(arg);
      if (literal !== null) return literal[1]!;
      const exported: unknown = (fileObserverModule as Record<string, unknown>)[arg];
      if (typeof exported === 'string') return exported;
      // A computed name (a template literal, a variable) cannot be matched to a listener.
      throw new Error(`FileObserver emits a name this check cannot resolve: ${arg}`);
    });
  }

  test('only HotReloadObserver constructs a FileObserver', () => {
    const constructing = readdirSync(SRC_ROOT, { recursive: true, encoding: 'utf8' })
      .filter((file) => file.endsWith('.ts'))
      .filter((file) =>
        /\b(createFileObserver|new FileObserver)\(/.test(
          readFileSync(path.join(SRC_ROOT, file), 'utf8')
        )
      )
      .map((file) => file.split(path.sep).join('/'));

    expect(constructing.sort()).toEqual([
      'modules/hot-reload/file-observer.ts',
      'modules/hot-reload/hot-reload-observer.ts',
    ]);
  });

  test('each emitted event is one HotReloadObserver listens to', () => {
    const emitted = emittedEventNames();
    // Positive control for the enumeration: it finds the emits that are known to exist.
    expect(emitted).toEqual(
      expect.arrayContaining([
        'fileChange',
        'watcherError',
        fileObserverModule.LATE_DIRECTORY_ARMED,
      ])
    );

    const observer = new HotReloadObserver(createSimpleLogger('stdio'), {});
    const listened = (
      observer as unknown as { fileObserver: EventEmitter }
    ).fileObserver.eventNames();

    expect(emitted.filter((name) => !listened.includes(name))).toEqual([]);
  });
});

/**
 * `isConfigFile` used to recognize only `config.json` by name — a workspace running the 5.0
 * `config.jsonc` dialect had its own config file classified as an ordinary, unwatched change.
 * Reflection onto the private method rather than a real filesystem watch: the negative cases
 * (a near-miss name) never emit a `fileChange` event at all, which a behavior-level test could
 * only observe as a timeout — slow and indistinguishable from a debounce that has not fired yet.
 */
describe('isConfigFile recognizes both workspace config dialects', () => {
  test('config.jsonc and config.json are config files; a near-miss name is not', () => {
    const observer = createFileObserver(createSimpleLogger('stdio'));
    const isConfigFile = (filename: string): boolean =>
      (observer as unknown as { isConfigFile: (name: string) => boolean }).isConfigFile(filename);

    expect(isConfigFile('config.jsonc')).toBe(true);
    expect(isConfigFile('config.json')).toBe(true);
    expect(isConfigFile('config.jsonc.bak')).toBe(false);
    expect(isConfigFile('myconfig.json')).toBe(false);
  });
});
