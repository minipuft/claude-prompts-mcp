/**
 * A script tool's `schema.json`, as `resource_manager` writes it, is already in the repository
 * formatter's layout: it ends with a newline and keeps a short `required` array on one line.
 * Written with `JSON.stringify(schema, null, 2)` it was neither, so updating a bundled tool
 * adapter left a file `validate:format` refused.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { FileOperations } from '../../../../../src/mcp/tools/resource-manager/prompt/operations/file-operations.js';

import type { ConfigManager, Logger } from '../../../../../src/shared/types/index.js';

const SCHEMA = {
  type: 'object',
  properties: { id: { type: 'string' }, name: { type: 'string' } },
  required: ['id', 'name'],
};

const EXPECTED_SCHEMA_TEXT = `{
  "type": "object",
  "properties": {
    "id": {
      "type": "string"
    },
    "name": {
      "type": "string"
    }
  },
  "required": ["id", "name"]
}
`;

describe('the schema.json resource_manager writes for a script tool', () => {
  let workspaceDir: string;
  let promptsDir: string;
  let operations: FileOperations;

  beforeEach(() => {
    workspaceDir = mkdtempSync(join(tmpdir(), 'cpm-tool-schema-format-'));
    promptsDir = join(workspaceDir, 'prompts');
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as Logger;
    const configManager = {
      getResolvedPromptsDirectory: () => promptsDir,
    } as unknown as ConfigManager;
    operations = new FileOperations({ logger, configManager });
  });

  afterEach(() => {
    rmSync(workspaceDir, { recursive: true, force: true });
  });

  const promptData = {
    id: 'schema_format_probe',
    name: 'Schema Format Probe',
    category: 'general',
    description: 'd',
    userMessageTemplate: 'Use {{tool}}',
    arguments: [],
    tools: [
      { id: 'lookup', name: 'Lookup', script: "print('hi')", runtime: 'python', schema: SCHEMA },
    ],
  };

  it('is planned in the formatter layout (preview)', async () => {
    const changes = await operations.projectPromptWrite(promptData);
    const planned = changes.find((change) => change.path.endsWith('tools/lookup/schema.json'));
    expect(planned?.after).toBe(EXPECTED_SCHEMA_TEXT);
  });

  it('lands on disk in the formatter layout', async () => {
    await operations.updatePromptImplementation(promptData);
    const written = readFileSync(
      join(promptsDir, 'general', 'schema_format_probe', 'tools', 'lookup', 'schema.json'),
      'utf8'
    );
    expect(written).toBe(EXPECTED_SCHEMA_TEXT);
  });
});
