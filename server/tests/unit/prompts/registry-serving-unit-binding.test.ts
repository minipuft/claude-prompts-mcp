import { describe, expect, jest, test } from '@jest/globals';

import { PromptRegistry } from '../../../src/modules/prompts/registry.js';

import type { ConvertedPrompt } from '../../../src/engine/execution/types.js';
import type { PromptRegistryServer } from '../../../src/modules/prompts/registry.js';

/**
 * Protocol revision 2026-07-28 removed protocol sessions, so a fresh `McpServer`
 * is built per STDIO connection and per HTTP request. These tests pin the two
 * consequences that made `prompts/list` come back empty on a live connection
 * while startup logged the prompts as registered:
 *
 *  - binding must land on the shell the caller names, once per shell;
 *  - content must resolve when the handler runs, not when it was registered.
 */

type Handler = (args: Record<string, string>) => Promise<{
  messages: { role: string; content: { type: string; text: string } }[];
}>;

/** Stand-in for one serving unit. Records what was bound to it. */
function makeShell() {
  const handlers = new Map<string, Handler>();
  return {
    registerPrompt: jest.fn((id: string, _config: unknown, handler: Handler) => {
      if (handlers.has(id)) throw new Error(`Prompt ${id} is already registered`);
      handlers.set(id, handler);
    }),
    handlers,
  };
}

function makePrompt(overrides: Partial<ConvertedPrompt> = {}): ConvertedPrompt {
  return {
    id: 'test_default',
    name: 'Test Default',
    description: 'A prompt',
    category: 'examples',
    userMessageTemplate: 'original body',
    arguments: [],
    ...overrides,
  } as ConvertedPrompt;
}

/**
 * The fake carries a `handlers` map the real shell has no notion of, and its
 * `registerPrompt` is typed against this file's simplified `Handler`. Narrowing
 * it at the boundary keeps the extra surface available to assertions without
 * claiming the fake IS an `McpServer`.
 */
function asShell(shell: ReturnType<typeof makeShell>): PromptRegistryServer {
  return shell as unknown as PromptRegistryServer;
}

const silentLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
} as never;

const conversationStore = {
  getPreviousMessage: () => '',
  addToConversationHistory: () => undefined,
} as never;

function makeRegistry(constructionShell: ReturnType<typeof makeShell>) {
  return new PromptRegistry(silentLogger, asShell(constructionShell), conversationStore);
}

async function textFrom(shell: ReturnType<typeof makeShell>, id: string): Promise<string> {
  const handler = shell.handlers.get(id);
  if (!handler) throw new Error(`no handler bound for ${id}`);
  const result = await handler({});
  return result.messages.map((m) => m.content.text).join('\n');
}

describe('PromptRegistry serving-unit binding', () => {
  test('binds to the target shell, not the one held since construction', async () => {
    const construction = makeShell();
    const serving = makeShell();
    const registry = makeRegistry(construction);

    await registry.registerAllPrompts([makePrompt()], asShell(serving));

    expect(serving.handlers.has('test_default')).toBe(true);
    expect(construction.registerPrompt).not.toHaveBeenCalled();
  });

  test('registers the same prompt on every serving unit', async () => {
    const registry = makeRegistry(makeShell());
    const first = makeShell();
    const second = makeShell();

    await registry.registerAllPrompts([makePrompt()], asShell(first));
    await registry.registerAllPrompts([makePrompt()], asShell(second));

    // A single flat dedup Set would let the first unit's ids suppress the
    // second, turning the defect into "only the first connection gets prompts".
    expect(first.handlers.has('test_default')).toBe(true);
    expect(second.handlers.has('test_default')).toBe(true);
  });

  test('registers the human-readable name as title, not the id again', async () => {
    // `title` is the display label, distinct from the registered name -- the SDK's own
    // example registers `'review-code'` with `title: 'Code Review'`. This passed the id,
    // making title byte-identical to name for 34/34 registered prompts and putting ~775
    // bytes of zero-information duplication in every `prompts/list`, which clients
    // typically fetch at connect.
    const registry = makeRegistry(makeShell());
    const serving = makeShell();

    await registry.registerAllPrompts([makePrompt()], asShell(serving));

    // The mock is typed with a 3-arity signature; only the first two are read here.
    const call = serving.registerPrompt.mock.calls[0] as unknown as [
      string,
      { title?: string; description?: string },
    ];
    const [registeredName, config] = call;
    expect(registeredName).toBe('test_default');
    expect(config.title).toBe('Test Default');
    expect(config.title).not.toBe(registeredName);
  });

  test('falls back to the id when a prompt carries no name', async () => {
    // A nameless prompt must still register; the title just stops being informative.
    const registry = makeRegistry(makeShell());
    const serving = makeShell();

    await registry.registerAllPrompts(
      [makePrompt({ name: undefined as unknown as string })],
      asShell(serving)
    );

    const [, config] = serving.registerPrompt.mock.calls[0] as unknown as [
      string,
      { title?: string },
    ];
    expect(config.title).toBe('test_default');
  });

  test('does not re-register the same prompt on one shell', async () => {
    const registry = makeRegistry(makeShell());
    const serving = makeShell();

    await registry.registerAllPrompts([makePrompt()], asShell(serving));
    await registry.registerAllPrompts([makePrompt()], asShell(serving));

    // The SDK throws on a duplicate id; the guard is what keeps a reload from
    // hitting that path.
    expect(serving.registerPrompt).toHaveBeenCalledTimes(1);
  });

  test('reports the count that actually bound, not the count offered', async () => {
    const registry = makeRegistry(makeShell());
    const serving = makeShell();

    const count = await registry.registerAllPrompts(
      [makePrompt(), makePrompt({ id: 'opted_out', registerWithMcp: false })],
      asShell(serving)
    );

    expect(count).toBe(1);
  });

  test('a handler bound before a reload serves the reloaded content', async () => {
    const registry = makeRegistry(makeShell());
    const serving = makeShell();

    await registry.registerAllPrompts([makePrompt()], asShell(serving));
    expect(await textFrom(serving, 'test_default')).toContain('original body');

    // What a hot reload does: same ids, new content, no re-binding possible
    // because the SDK rejects a duplicate registration.
    registry.setLivePrompts([makePrompt({ userMessageTemplate: 'edited body' })]);

    expect(await textFrom(serving, 'test_default')).toContain('edited body');
  });

  test('keeps serving last known content when a prompt leaves the live set', async () => {
    const registry = makeRegistry(makeShell());
    const serving = makeShell();

    await registry.registerAllPrompts([makePrompt()], asShell(serving));
    registry.setLivePrompts([]);

    // The id stays bound on the shell for the connection's lifetime, so the
    // handler must answer rather than throw at a client that still lists it.
    expect(await textFrom(serving, 'test_default')).toContain('original body');
  });
});
