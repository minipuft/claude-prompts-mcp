/**
 * A script tool's emitted `auto_execute` params meet the same refusal the tool boundary applies.
 *
 * `tests/unit/resources/bundled-script-tool-params.test.ts` pins the three BUNDLED tools against
 * `describeParameterRefusal`. It cannot see the runtime path: a user-authored script tool's stdout
 * went from stage 08 straight into `router.handleAction` (stage 09 line ~130), and whatever the
 * router answered was written into `autoExecuteResults` and reported only through
 * `context.diagnostics.info`. Nothing downstream reads `isError`, so `prompt_engine` answered
 * SUCCESS over a mutation the router had refused — measured on `f711401b`.
 *
 * That matters because a script tool is the one place in this server where non-operator-authored
 * text decides a resource mutation's parameters. A script emitting `dry_run` (rather than
 * `preview_action`) had its flag dropped and the real write performed, with a success reply.
 *
 * This drives a REAL user-authored script on disk through the REAL executor and the REAL stage,
 * with the same refusal the composition root injects. A mock of either would assert the fixture.
 */

import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ExecutionContext } from '../../../src/engine/execution/context/execution-context.js';
import { ScriptAutoExecuteStage } from '../../../src/engine/execution/pipeline/stages/09-script-auto-execute-stage.js';
import { createScriptExecutor } from '../../../src/modules/automation/execution/script-executor.js';
import { describeUndeclaredParameterRefusal } from '../../../src/mcp/tools/shared/undeclared-parameters.js';

import type { Logger } from '../../../src/infra/logging/index.js';
import type {
  LoadedScriptTool,
  ScriptExecutionResult,
} from '../../../src/modules/automation/types.js';
import type { ToolResponse, McpToolRequest } from '../../../src/shared/types/index.js';

const logger = (): Logger =>
  ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) as unknown as Logger;

let toolDir: string;

/**
 * A user-authored script tool, written to disk exactly as an operator would install one:
 * a node script reading JSON on stdin and printing an `auto_execute` envelope.
 */
function writeScript(id: string, emittedParams: Record<string, unknown>): LoadedScriptTool {
  const scriptPath = path.join(toolDir, `${id}.mjs`);
  writeFileSync(
    scriptPath,
    [
      'let raw = "";',
      'process.stdin.on("data", (c) => (raw += c));',
      'process.stdin.on("end", () => {',
      '  process.stdout.write(JSON.stringify({',
      '    valid: true,',
      `    auto_execute: { tool: "resource_manager", params: ${JSON.stringify(emittedParams)} },`,
      '  }));',
      '});',
      '',
    ].join('\n'),
    'utf8'
  );
  chmodSync(scriptPath, 0o755);

  return {
    id,
    name: id,
    description: `user-authored fixture ${id}`,
    scriptPath: `${id}.mjs`,
    absoluteScriptPath: scriptPath,
    toolDir,
    runtime: 'node',
    inputSchema: { type: 'object', properties: {} },
    enabled: true,
  } as unknown as LoadedScriptTool;
}

/** Run the real script, then the real stage, returning what the injected handler received. */
async function driveStage(
  tool: LoadedScriptTool,
  handler: (args: Record<string, unknown>) => Promise<ToolResponse>
): Promise<void> {
  const executed: ScriptExecutionResult = await createScriptExecutor().execute(
    { toolId: tool.id, inputs: {} } as never,
    tool
  );
  expect(executed.success).toBe(true);

  const context = new ExecutionContext(
    { tool: 'prompt_engine', command: `>>${tool.id}`, args: {} } as McpToolRequest,
    logger()
  );
  context.ensureScriptState().results.set(tool.id, executed);

  const stage = new ScriptAutoExecuteStage(
    async (args) => handler(args),
    logger(),
    (params) => describeUndeclaredParameterRefusal('resource_manager', params)
  );
  await stage.execute(context);
}

describe('script auto-execute: emitted params meet the tool refusal', () => {
  beforeAll(() => {
    toolDir = mkdtempSync(path.join(tmpdir(), 'script-auto-exec-refusal-'));
  });

  afterAll(() => {
    rmSync(toolDir, { recursive: true, force: true });
  });

  it('CONTROL: declared params reach the handler and nothing throws', async () => {
    // The positive control this suite's negatives depend on. Without it, a stage that threw on
    // everything — or one whose handler was never wired — would read as a passing refusal.
    const received: Record<string, unknown>[] = [];
    const tool = writeScript('rm_declared_params', {
      resource_type: 'gate',
      action: 'update',
      id: 'probe-gate',
      guidance: 'updated by script',
    });

    await driveStage(tool, async (args) => {
      received.push(args);
      return { content: [{ type: 'text', text: 'ok' }], isError: false };
    });

    expect(received).toHaveLength(1);
    expect(received[0]).toHaveProperty('guidance', 'updated by script');
  }, 30000);

  it('refuses an undeclared key, names the script AND the key, and reaches no handler', async () => {
    let handlerCalls = 0;
    const tool = writeScript('rm_undeclared_key', {
      resource_type: 'gate',
      action: 'update',
      id: 'probe-gate',
      enforcementMode: 'advisory',
    });

    await expect(
      driveStage(tool, async () => {
        handlerCalls += 1;
        return { content: [{ type: 'text', text: 'should never run' }], isError: false };
      })
    ).rejects.toThrow(
      /rm_undeclared_key.*'enforcementMode' is not a parameter of resource_manager/s
    );

    // The refusal stands AHEAD of the mutation, not after it. A guard that ran downstream would
    // leave this at 1 and the write already done.
    expect(handlerCalls).toBe(0);
  }, 30000);

  it('refuses a mistyped safety flag rather than performing the real write', async () => {
    // The motivating shape: `confirmed` looks deliberate next to the real `confirm`, is read by
    // nobody, and used to be dropped — leaving a script that believed it had asked for
    // confirmation to perform the mutation unguarded.
    let handlerCalls = 0;
    const tool = writeScript('rm_confirm_typo', {
      resource_type: 'prompt',
      action: 'delete',
      id: 'probe-prompt',
      confirmed: true,
    });

    await expect(
      driveStage(tool, async () => {
        handlerCalls += 1;
        return { content: [{ type: 'text', text: 'should never run' }], isError: false };
      })
    ).rejects.toThrow(/'confirmed' is not a parameter of resource_manager/);

    expect(handlerCalls).toBe(0);
  }, 30000);
});
