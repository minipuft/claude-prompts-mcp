/**
 * Multi-Tool Resource — two tools in one prompt, each keeping its own `confirm`
 *
 * `reference_demo` is the only shipped prompt declaring more than one script
 * tool. Measured 2026-08-19: every other prompt in the corpus declares at most
 * one, and no test exercised two tools for a single prompt end to end, so the
 * capability shipped uncovered.
 *
 * The pair is also the regression test for the confirm contract. `word_count`
 * sets `confirm: false` and `text_digest` sets `confirm: true`, so a single
 * fixture answers two questions a one-tool prompt cannot: does `confirm` belong
 * to the tool rather than the prompt, and does it mean the same thing on the
 * declarative `tools:` route as on an inline `{{script:id}}` reference.
 *
 * These assertions read the REAL resource files rather than fixtures — the point
 * is that the shipped demo is wired correctly, which a fixture cannot show.
 * They stop at the confirm DECISION and never spawn, so the suite stays free of
 * a python3 dependency the Node test jobs do not guarantee.
 *
 * Classification: Integration (real loader, real detection, real filter, real
 * resolver guard, real resource definitions)
 */

import { describe, expect, test } from '@jest/globals';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { ScriptReferenceResolver } from '../../../src/engine/execution/reference/script-reference-resolver.js';
import { ScriptToolDefinitionLoader } from '../../../src/modules/automation/core/script-definition-loader.js';
import { ToolDetectionService } from '../../../src/modules/automation/detection/tool-detection-service.js';
import { ToolTriggerFilter } from '../../../src/modules/automation/execution/tool-trigger-filter.js';

import type { Logger } from '../../../src/infra/logging/index.js';
import type { LoadedScriptTool } from '../../../src/modules/automation/types.js';
import type { ScriptExecutorPort } from '../../../src/shared/types/index.js';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const PROMPT_DIR = path.join(SERVER_ROOT, 'resources/prompts/examples/reference_demo');
const PROMPT_ID = 'reference_demo';

const silentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
} as unknown as Logger;

function loadDemoTools(): LoadedScriptTool[] {
  // Takes a ScriptToolLoaderConfig, not a Logger — the same mismatch DEV-T1-4
  // records for ToolDetectionService. Passing a stub logger here typechecks only
  // behind a cast, and then silently sets `debug`.
  return new ScriptToolDefinitionLoader().loadAllToolsForPrompt(PROMPT_DIR, PROMPT_ID);
}

/** Records whether execution was reached, without spawning anything. */
function recordingExecutor(): { port: ScriptExecutorPort; ran: string[] } {
  const ran: string[] = [];
  return {
    ran,
    port: {
      execute: async (request) => {
        ran.push(request.toolId);
        return {
          success: true,
          output: { ok: true },
          stdout: '{"ok":true}',
          stderr: '',
          exitCode: 0,
          durationMs: 0,
        };
      },
    },
  };
}

function loaderFor(tools: LoadedScriptTool[]) {
  const byId = new Map(tools.map((t) => [t.id, t]));
  return {
    scriptExists: (id: string) => byId.has(id),
    loadScript: (id: string) => byId.get(id),
    getSearchedPaths: () => [PROMPT_DIR],
  };
}

describe('reference_demo — two tools in one resource', () => {
  test('loads both declared tools for a single prompt', () => {
    const tools = loadDemoTools();

    expect(tools.map((t) => t.id).sort()).toEqual(['text_digest', 'word_count']);
    // The settings the rest of this file depends on, read from disk rather than
    // assumed — if the demo is retuned, these fail here first and say why.
    expect(tools.find((t) => t.id === 'word_count')?.execution?.confirm).toBe(false);
    expect(tools.find((t) => t.id === 'text_digest')?.execution?.confirm).toBe(true);
  });

  test('declarative route: the auto tool is ready, the gated tool waits', () => {
    const tools = loadDemoTools();
    const matches = new ToolDetectionService().detectTools(
      'analyze this',
      { text: 'hello' },
      tools
    );
    const result = new ToolTriggerFilter().filterByTrigger(matches, tools, PROMPT_ID);

    expect(result.readyForExecution.map((m) => m.toolId)).toEqual(['word_count']);
    expect(result.pendingConfirmation.map((p) => p.toolId)).toEqual(['text_digest']);
    expect(result.requiresConfirmation).toBe(true);
  });

  test('inline route: the auto tool runs, the gated tool refuses', async () => {
    const tools = loadDemoTools();
    const auto = recordingExecutor();
    const gated = recordingExecutor();

    // Same template shape, same arguments, different tool — so the only thing
    // that can explain the difference in outcome is the tool's own `confirm`.
    await new ScriptReferenceResolver(silentLogger, loaderFor(tools), auto.port).preResolve(
      'x {{script:word_count}}',
      { text: 'hello' },
      PROMPT_DIR
    );
    expect(auto.ran).toEqual(['word_count']);

    await expect(
      new ScriptReferenceResolver(silentLogger, loaderFor(tools), gated.port).preResolve(
        'x {{script:text_digest}}',
        { text: 'hello' },
        PROMPT_DIR
      )
    ).rejects.toThrow(/requires confirmation/i);
    expect(gated.ran).toEqual([]);
  });

  test('inline route: the gated tool runs once the invocation names it', async () => {
    const tools = loadDemoTools();
    const gated = recordingExecutor();

    await new ScriptReferenceResolver(silentLogger, loaderFor(tools), gated.port).preResolve(
      'x {{script:text_digest}}',
      { text: 'hello', 'tool:text_digest': true },
      PROMPT_DIR
    );

    expect(gated.ran).toEqual(['text_digest']);
  });
});
