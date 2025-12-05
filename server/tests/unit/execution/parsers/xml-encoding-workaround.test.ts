/**
 * Tests for XML Encoding Workaround
 *
 * When calling MCP tools via XML-based clients (like Claude Code), the >> prefix
 * gets HTML-decoded, causing >> to become >. This test suite validates that
 * symbolic operators provide a workaround by making the >> prefix optional.
 */

import { describe, expect, test, beforeEach } from '@jest/globals';

import { createUnifiedCommandParser } from '../../../../src/execution/parsers/index.js';
import { MockLogger } from '../../../helpers/test-helpers.js';

import type { ConvertedPrompt } from '../../../../src/types/index.js';

describe('XML Encoding Workaround - Symbolic Operators Without >> Prefix', () => {
  let parser: ReturnType<typeof createUnifiedCommandParser>;
  let mockPrompts: ConvertedPrompt[];

  beforeEach(() => {
    const logger = new MockLogger();
    parser = createUnifiedCommandParser(logger);

    mockPrompts = [
      {
        id: 'test_prompt',
        name: 'Test Prompt',
        userMessageTemplate: 'Test template',
        description: 'Test prompt',
        category: 'test',
        arguments: [],
      },
      {
        id: 'test_simple',
        name: 'Simple Test',
        userMessageTemplate: 'Simple template',
        description: 'Simple test prompt',
        category: 'test',
        arguments: [],
      },
    ];
  });

  describe('Chain Operator (-->) makes >> prefix optional', () => {
    test('parses chain command without >> prefix', async () => {
      const result = await parser.parseCommand(
        'test_prompt input="value1" --> test_simple input="value2"',
        mockPrompts
      );

      expect(result).toBeDefined();
      expect(result.promptId).toBe('test_prompt');
      expect(result.format).toBe('symbolic');
      expect(result.commandType).toBe('chain');
      expect(result.operators?.operatorTypes).toContain('chain');
    });

    test('also accepts chain command WITH >> prefix', async () => {
      const result = await parser.parseCommand(
        '>>test_prompt input="value1" --> test_simple input="value2"',
        mockPrompts
      );

      expect(result).toBeDefined();
      expect(result.promptId).toBe('test_prompt');
      expect(result.commandType).toBe('chain');
    });

    test('parses multi-step chain without >> prefix', async () => {
      const result = await parser.parseCommand(
        'test_prompt --> test_simple --> test_prompt',
        mockPrompts
      );

      expect(result).toBeDefined();
      expect(result.commandType).toBe('chain');
      expect(result.operators?.operatorTypes).toContain('chain');
    });
  });

  describe('Framework Operator (@) makes >> prefix optional', () => {
    test('parses framework command without >> prefix', async () => {
      const result = await parser.parseCommand('@CAGEERF test_prompt input="value"', mockPrompts);

      expect(result).toBeDefined();
      expect(result.promptId).toBe('test_prompt');
      expect(result.format).toBe('symbolic');
      expect(result.operators?.operatorTypes).toContain('framework');
    });

    test('also accepts framework command WITH >> prefix', async () => {
      const result = await parser.parseCommand('@CAGEERF >>test_prompt input="value"', mockPrompts);

      expect(result).toBeDefined();
      expect(result.promptId).toBe('test_prompt');
    });
  });

  describe('Gate Operator (::) makes >> prefix optional', () => {
    test('parses gate command without >> prefix', async () => {
      const result = await parser.parseCommand(
        'test_prompt input="value" :: "quality check"',
        mockPrompts
      );

      expect(result).toBeDefined();
      expect(result.promptId).toBe('test_prompt');
      expect(result.format).toBe('symbolic');
      expect(result.operators?.operatorTypes).toContain('gate');
    });

    test('also accepts gate command WITH >> prefix', async () => {
      const result = await parser.parseCommand(
        '>>test_prompt input="value" :: "quality check"',
        mockPrompts
      );

      expect(result).toBeDefined();
      expect(result.promptId).toBe('test_prompt');
    });
  });

  describe('Combined Operators work without >> prefix', () => {
    test('framework + chain operators', async () => {
      const result = await parser.parseCommand('@CAGEERF test_prompt --> test_simple', mockPrompts);

      expect(result).toBeDefined();
      expect(result.promptId).toBe('test_prompt');
      expect(result.operators?.operatorTypes).toContain('framework');
      expect(result.operators?.operatorTypes).toContain('chain');
    });

    test('chain + gate operators', async () => {
      const result = await parser.parseCommand(
        'test_prompt --> test_simple :: "quality"',
        mockPrompts
      );

      expect(result).toBeDefined();
      expect(result.promptId).toBe('test_prompt');
      expect(result.operators?.operatorTypes).toContain('chain');
      expect(result.operators?.operatorTypes).toContain('gate');
    });
  });

  describe('Error cases', () => {
    test('bare prompt name without >> or operators fails with helpful message', async () => {
      await expect(parser.parseCommand('test_prompt input="value"', mockPrompts)).rejects.toThrow(
        /Bare prompt name detected/
      );
    });

    test('single > prefix (from >> being stripped) provides XML encoding warning', async () => {
      await expect(parser.parseCommand('>test_prompt input="value"', mockPrompts)).rejects.toThrow(
        /single ">" prefix.*partially stripped/
      );
    });
  });
});
