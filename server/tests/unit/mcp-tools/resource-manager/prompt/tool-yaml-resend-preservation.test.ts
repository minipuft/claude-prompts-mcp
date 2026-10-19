/**
 * Sending a script tool that already exists, through `resource_manager`, edits its `tool.yaml`
 * rather than regenerating it; a tool created without `confirm` asks for approval.
 *
 * WHAT WENT WRONG
 * The writer built every `tool.yaml` from nine fields with fixed defaults and serialized that, so
 * resending an existing tool (an `update` carrying `tools`, or `tool_operation: "add"` of an id
 * already bound) dropped every comment, reordered the keys, deleted every key the input does not
 * model (`env`, `schemaFile`, `confirmMessage`, ...) and turned an authored `confirm: true` into
 * `false` when the caller left `confirm` out. A tool created without `confirm` was written as
 * `confirm: false`, although the loader and `docs/guides/script-tools.md` both default it to true.
 *
 * WHY THE FIXTURE IS HAND-AUTHORED
 * A file the writer seeded already has the writer's shape, so resending over it proves only
 * idempotence. This one carries comments (own-line and trailing), a key order the writer would
 * not produce, and keys the writer has no field for.
 */

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FileOperations } from '../../../../../src/mcp/tools/resource-manager/prompt/operations/file-operations.js';
import { ScriptToolDefinitionLoader } from '../../../../../src/modules/automation/core/script-definition-loader.js';
import { parseYamlOrThrow } from '../../../../../src/shared/utils/yaml/yaml-parser.js';

import type { ToolDefinitionInput } from '../../../../../src/mcp/tools/resource-manager/core/types.js';
import type { ConfigManager, Logger } from '../../../../../src/shared/types/index.js';

const CATEGORY = 'general';
const PROMPT_ID = 'tooled';
const TOOL_ID = 'my_tool';

const AUTHORED_TOOL_YAML = `# Hand-authored: comments, odd key order, keys the writer does not model.
script: run.py
id: my_tool
timeout: 5000 # five seconds
name: My Tool
runtime: python
schemaFile: input.schema.json
env:
  MODE: strict

execution:
  # Ask before running: this tool writes files.
  confirm: true
  confirmMessage: "Run my tool against the workspace?"
  trigger: explicit
description: Does a thing
`;

const PROMPT_YAML = `id: tooled
name: Tooled
description: A prompt with a tool
userMessageTemplateFile: user-message.md
tools:
  - my_tool
`;

/** Every field `AUTHORED_TOOL_YAML` declares that the `tools` input can carry. */
const IDENTICAL_RESEND: ToolDefinitionInput = {
  id: TOOL_ID,
  name: 'My Tool',
  description: 'Does a thing',
  script: "print('hi')\n",
  runtime: 'python',
  timeout: 5000,
  trigger: 'explicit',
  confirm: true,
};

describe('resending an existing script tool keeps its tool.yaml', () => {
  let workspaceDir: string;
  let promptsDir: string;
  let operations: FileOperations;

  const promptDir = (): string => join(promptsDir, CATEGORY, PROMPT_ID);
  const toolDir = (id = TOOL_ID): string => join(promptDir(), 'tools', id);
  const readToolYaml = (id = TOOL_ID): string =>
    readFileSync(join(toolDir(id), 'tool.yaml'), 'utf8');

  beforeEach(() => {
    workspaceDir = mkdtempSync(join(tmpdir(), 'cpm-tool-resend-'));
    promptsDir = join(workspaceDir, 'prompts');
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as Logger;
    operations = new FileOperations({
      logger,
      configManager: { getResolvedPromptsDirectory: () => promptsDir } as unknown as ConfigManager,
    });

    mkdirSync(toolDir(), { recursive: true });
    writeFileSync(join(promptDir(), 'prompt.yaml'), PROMPT_YAML, 'utf8');
    writeFileSync(join(promptDir(), 'user-message.md'), 'Run it.\n', 'utf8');
    writeFileSync(join(toolDir(), 'tool.yaml'), AUTHORED_TOOL_YAML, 'utf8');
    writeFileSync(join(toolDir(), 'run.py'), "print('hi')\n", 'utf8');
  });

  afterEach(() => {
    rmSync(workspaceDir, { recursive: true, force: true, maxRetries: 5 });
  });

  /** `resource_manager update id:tooled tools:[tool]` — `tools` is the only supplied key. */
  function promptDataWith(tools: ToolDefinitionInput[]): Record<string, unknown> {
    return {
      id: PROMPT_ID,
      name: 'Tooled',
      category: CATEGORY,
      description: 'A prompt with a tool',
      userMessageTemplate: 'Run it.\n',
      arguments: [],
      tools,
    };
  }

  async function resend(tool: ToolDefinitionInput): Promise<void> {
    await operations.updatePromptImplementation(promptDataWith([tool]), new Set(['tools']));
  }

  function loadTool(id = TOOL_ID): ReturnType<ScriptToolDefinitionLoader['loadTool']> {
    return new ScriptToolDefinitionLoader({ enableCache: false }).loadTool(
      promptDir(),
      id,
      PROMPT_ID
    );
  }

  it('(a) leaves tool.yaml byte-identical when every supplied field already matches', async () => {
    await resend(IDENTICAL_RESEND);

    expect(readToolYaml()).toBe(AUTHORED_TOOL_YAML);
  });

  it('(b) keeps an authored confirm: true when the resend omits confirm', async () => {
    const { confirm: _omitted, ...withoutConfirm } = IDENTICAL_RESEND;

    await resend(withoutConfirm);

    const execution =
      parseYamlOrThrow<Record<string, Record<string, unknown>>>(readToolYaml())['execution'];
    expect(execution?.['confirm']).toBe(true);
    expect(loadTool()?.execution?.confirm).toBe(true);
  });

  it('(c) changes exactly the timeout line when only timeout changes', async () => {
    await resend({ ...IDENTICAL_RESEND, timeout: 9000 });

    const before = AUTHORED_TOOL_YAML.split('\n');
    const after = readToolYaml().split('\n');
    expect(after).toHaveLength(before.length);
    const changed = after
      .map((line, index) => ({ line, index }))
      .filter(({ line, index }) => line !== before[index]);
    expect(changed).toEqual([{ line: 'timeout: 9000 # five seconds', index: 3 }]);
  });

  it('(d) keeps env, confirmMessage, schemaFile and every comment, and writes the schema where schemaFile points', async () => {
    const schema = { type: 'object', properties: { path: { type: 'string' } } };

    await resend({ ...IDENTICAL_RESEND, timeout: 9000, trigger: 'schema_match', schema });

    const written = readToolYaml();
    const parsed = parseYamlOrThrow<Record<string, unknown>>(written);
    expect(parsed['env']).toEqual({ MODE: 'strict' });
    expect(parsed['schemaFile']).toBe('input.schema.json');
    expect(parsed['execution']).toEqual({
      confirm: true,
      confirmMessage: 'Run my tool against the workspace?',
      trigger: 'schema_match',
    });
    const comments = (text: string): string[] =>
      text.split('\n').filter((line) => line.includes('#'));
    expect(comments(written)).toEqual(
      comments(AUTHORED_TOOL_YAML).map((line) =>
        line.startsWith('timeout:') ? 'timeout: 9000 # five seconds' : line
      )
    );
    // The loader reads `schemaFile`, so the supplied schema has to land there to take effect.
    expect(existsSync(join(toolDir(), 'input.schema.json'))).toBe(true);
    expect(existsSync(join(toolDir(), 'schema.json'))).toBe(false);
    expect(loadTool()?.inputSchema).toEqual(schema);
    // And the script keeps the file name the yaml declares.
    expect(existsSync(join(toolDir(), 'script.py'))).toBe(false);
  });

  it('shows the same tool.yaml in a preview as the write then leaves on disk', async () => {
    const tool = { ...IDENTICAL_RESEND, timeout: 9000 };

    const preview = await operations.projectPromptWrite(promptDataWith([tool]), new Set(['tools']));
    await resend(tool);

    const previewed = preview.find((change) => change.path.endsWith(`${TOOL_ID}/tool.yaml`));
    expect(previewed?.before).toBe(AUTHORED_TOOL_YAML);
    expect(previewed?.after).toBe(readToolYaml());
  });

  it('(e) creates a new tool without confirm that the loader asks approval for', async () => {
    const fresh: ToolDefinitionInput = {
      id: 'fresh_tool',
      name: 'Fresh Tool',
      script: "print('fresh')\n",
      runtime: 'python',
    };

    await operations.updatePromptImplementation(
      promptDataWith([IDENTICAL_RESEND, fresh]),
      new Set(['tools'])
    );

    const written = readToolYaml('fresh_tool');
    // Only what was supplied, plus the keys the loader requires: no restated defaults.
    expect(parseYamlOrThrow<Record<string, unknown>>(written)).toEqual({
      id: 'fresh_tool',
      name: 'Fresh Tool',
      script: 'script.py',
      runtime: 'python',
    });
    const loaded = loadTool('fresh_tool');
    expect(loaded).toBeDefined();
    expect(loaded?.execution?.confirm).toBe(true);
  });
});
