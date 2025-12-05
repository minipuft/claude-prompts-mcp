import { describe, test, expect, beforeEach, jest } from '@jest/globals';

import { createParsingSystem } from '../../../src/execution/parsers/index.js';

import type { ConvertedPrompt } from '../../../src/types/index.js';

const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as any;

describe('Parsing System Factory', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should create parsing system', () => {
    const parsingSystem = createParsingSystem(mockLogger);

    expect(parsingSystem).toBeDefined();
    expect(parsingSystem.commandParser).toBeDefined();
    expect(parsingSystem.argumentParser).toBeDefined();
    expect(parsingSystem.contextResolver).toBeDefined();

    expect(mockLogger.info).toHaveBeenCalledWith('Parsing system initialized successfully');
  });

  test('should log initialization details', () => {
    createParsingSystem(mockLogger);

    expect(mockLogger.info).toHaveBeenCalledWith('Parsing system initialized successfully');
    expect(mockLogger.info).toHaveBeenCalledWith(
      '- Unified command parser with multi-strategy support'
    );
    expect(mockLogger.info).toHaveBeenCalledWith('- Argument parser with validation pipeline');
    expect(mockLogger.info).toHaveBeenCalledWith('- Context resolver with intelligent fallbacks');
  });

  test('should provide functional parsers', async () => {
    const parsingSystem = createParsingSystem(mockLogger);
    const prompts = [
      {
        id: 'test',
        name: 'test',
        description: 'test prompt',
        category: 'test',
        arguments: [],
        userMessageTemplate: 'Test {{input}}',
      },
    ] as ConvertedPrompt[];

    // Test command parser
    const commandResult = await parsingSystem.commandParser.parseCommand('>>test', prompts);
    expect(commandResult).toBeDefined();

    // Test argument parser
    const argResult = await parsingSystem.argumentParser.parseArguments(
      '{"input":"value"}',
      prompts[0],
      {}
    );
    expect(argResult).toBeDefined();

    // Test context resolver
    const contextResult = await parsingSystem.contextResolver.resolveContext([], {}, {});
    expect(contextResult).toBeDefined();
  });

  test('parses multi-line commands while preserving argument payloads', async () => {
    const parsingSystem = createParsingSystem(mockLogger);
    const prompts = [
      {
        id: 'multi',
        name: 'multi',
        description: 'Allow multi-line payloads',
        category: 'test',
        arguments: [{ name: 'content', description: 'Content', required: true }],
        userMessageTemplate: 'Process {{content}}',
      },
    ] as ConvertedPrompt[];

    const command = ['>>multi', 'content="line one"', 'content="line two"'].join('\n');
    const result = await parsingSystem.commandParser.parseCommand(command, prompts);

    expect(result.promptId).toBe('multi');
    expect(result.rawArgs).toContain('line one');
    expect(result.rawArgs).toContain('line two');
  });

  test('supports JSON-wrapped commands for cross-transport parsing', async () => {
    const parsingSystem = createParsingSystem(mockLogger);
    const prompts = [
      {
        id: 'json_prompt',
        name: 'json_prompt',
        description: 'JSON payloads',
        category: 'test',
        arguments: [{ name: 'content', description: 'Content', required: true }],
        userMessageTemplate: 'Process {{content}}',
      },
    ] as ConvertedPrompt[];

    const envelope = JSON.stringify({
      command: '>>json_prompt',
      args: 'content="JSON payload"',
      metadata: { resume: 'session-123' },
    });

    const result = await parsingSystem.commandParser.parseCommand(envelope, prompts);

    expect(result.promptId).toBe('json_prompt');
    expect(result.metadata?.parseStrategy).toContain('json');
    expect(result.rawArgs).toContain('JSON payload');
  });
});
