/**
 * `deriveStructuredMessage` is the one place every `resource_manager`, `prompt_engine`, and
 * `system_control` result passes through before it reaches the MCP transport (`McpToolRouter` in
 * `src/mcp/tools/index.ts`, three call sites). Claude Code 2.1.272 hands the model only
 * `structuredContent` when a result carries both channels (anthropics/claude-code#9962, #55677,
 * #15412, #64316) — so a result with both must mirror its readable text into
 * `structuredContent.message`, or that text never reaches the model.
 */

import { deriveStructuredMessage } from '../../../../src/mcp/tools/shared/structured-message.js';

import type { ToolResponse } from '../../../../src/shared/types/index.js';

describe('deriveStructuredMessage', () => {
  test('copies the content text into structuredContent.message', () => {
    const response: Pick<ToolResponse, 'content' | 'structuredContent'> = {
      content: [{ type: 'text', text: 'Write Receipt\nResource root: /workspace/resources' }],
      structuredContent: { action: 'create', mutated: true },
    };

    expect(deriveStructuredMessage(response)).toEqual({
      action: 'create',
      mutated: true,
      message: 'Write Receipt\nResource root: /workspace/resources',
    });
  });

  test('joins multiple text parts in order, never a separately written string', () => {
    const response: Pick<ToolResponse, 'content' | 'structuredContent'> = {
      content: [
        { type: 'text', text: 'Preview — nothing written' },
        { type: 'text', text: 'has_changes: true' },
      ],
      structuredContent: { action: 'preview' },
    };

    expect(deriveStructuredMessage(response)?.['message']).toBe(
      'Preview — nothing written\n\nhas_changes: true'
    );
  });

  test('leaves a content-only result unchanged (returns the untouched structuredContent)', () => {
    const response: Pick<ToolResponse, 'content' | 'structuredContent'> = {
      content: [{ type: 'text', text: 'System Status: ok' }],
      structuredContent: undefined,
    };

    expect(deriveStructuredMessage(response)).toBeUndefined();
  });

  test('never invents structuredContent for a text-only response', () => {
    const response: Pick<ToolResponse, 'content' | 'structuredContent'> = {
      content: [{ type: 'text', text: 'no structured half at all' }],
    };

    expect(deriveStructuredMessage(response)).toBeUndefined();
  });

  test('does not overwrite an existing message key owned by another construction site', () => {
    const response: Pick<ToolResponse, 'content' | 'structuredContent'> = {
      content: [{ type: 'text', text: 'readable text' }],
      structuredContent: { message: 'a pre-existing, unrelated message' },
    };

    expect(deriveStructuredMessage(response)).toEqual({
      message: 'a pre-existing, unrelated message',
    });
  });

  test('returns structuredContent untouched when content carries no text parts', () => {
    const response: Pick<ToolResponse, 'content' | 'structuredContent'> = {
      content: [],
      structuredContent: { action: 'noop' },
    };

    expect(deriveStructuredMessage(response)).toEqual({ action: 'noop' });
  });

  /**
   * Mutation check: a build that stops attaching `message` (for example, reverting to
   * `structuredContent` returned verbatim) fails this exact case rather than merely producing a
   * differently-shaped object the assertion above would still need to catch.
   */
  test('mutation guard — a build that forgets to attach message fails here', () => {
    const response: Pick<ToolResponse, 'content' | 'structuredContent'> = {
      content: [{ type: 'text', text: '✅ Prompt Created' }],
      structuredContent: { action: 'create', mutated: true },
    };

    const result = deriveStructuredMessage(response);
    expect(result).toHaveProperty('message', '✅ Prompt Created');
  });
});
