// @lifecycle canonical - Unit tests for WorkspaceScriptLoader's output-schema loading.
/**
 * P4.99 — a workspace script's declared output shape reaches the loaded tool.
 *
 * `WorkspaceScriptLoader` assigned `outputSchema: undefined` outright, with the comment "Not
 * part of the YAML schema". That was true and was the reason no workspace tool's output could
 * ever be checked against a shape: the field existed on `LoadedScriptTool`, the executor was
 * ready to enforce it, and nothing could ever populate it.
 *
 * These cases sit at the LOADER. An executor test can hand-build a tool carrying an
 * `outputSchema` and stay green while the file on disk is never read, which is exactly the state
 * this row found.
 *
 * Classification: Unit. Real loader, real temp directories, no mocks — the subject is what the
 * loader reads off disk.
 */

import { describe, expect, it, beforeEach, afterEach } from '@jest/globals';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { WorkspaceScriptLoader } from '../../../../src/modules/automation/core/workspace-script-loader.js';

const SHAPE = {
  type: 'object',
  properties: { words: { type: 'number' } },
  required: ['words'],
};

describe('WorkspaceScriptLoader output schema', () => {
  let workspaceScriptsPath: string;
  let loader: WorkspaceScriptLoader;

  function writeScript(id: string, extraYaml = '', files: Record<string, string> = {}): void {
    const dir = join(workspaceScriptsPath, id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'tool.yaml'),
      `id: ${id}\nname: ${id}\nscript: script.py\nruntime: python\n${extraYaml}`
    );
    writeFileSync(join(dir, 'script.py'), 'print("ok")');
    for (const [name, body] of Object.entries(files)) {
      writeFileSync(join(dir, name), body);
    }
  }

  beforeEach(() => {
    workspaceScriptsPath = mkdtempSync(join(tmpdir(), 'ws-scripts-'));
    loader = new WorkspaceScriptLoader({ workspaceScriptsPath, debug: false });
  });

  afterEach(() => {
    rmSync(workspaceScriptsPath, { recursive: true, force: true });
  });

  it('reads output-schema.json from the workspace script directory', () => {
    writeScript('shaped', '', { 'output-schema.json': JSON.stringify(SHAPE) });

    const tool = loader.loadScript('shaped');

    expect(tool?.outputSchema).toEqual(SHAPE);
  });

  it('reads the path outputSchemaFile names instead of the default', () => {
    writeScript('renamed', 'outputSchemaFile: result.json\n', {
      'result.json': JSON.stringify(SHAPE),
    });

    const tool = loader.loadScript('renamed');

    expect(tool?.outputSchema).toEqual(SHAPE);
  });

  it('positive control: a script with no output schema file loads with none', () => {
    // Without this, both cases above could be satisfied by a loader attaching some constant
    // schema to every tool, and "declared" would mean nothing.
    writeScript('unshaped');

    const tool = loader.loadScript('unshaped');

    expect(tool).toBeDefined();
    expect(tool?.outputSchema).toBeUndefined();
  });
});
