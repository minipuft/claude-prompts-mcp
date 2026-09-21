// @lifecycle canonical - Mirrors a tool result's readable text into structuredContent.message.

import type { ToolResponse } from '#shared/types/index.js';

/**
 * Claude Code 2.1.272 passes a tool result's `structuredContent` to the model in place of
 * `content` whenever both are present (anthropics/claude-code#9962, #55677, #15412, #64316,
 * measured against this server). A result that puts its write receipt, preview notice, or
 * validation outcome only in `content` text is then invisible to the model the moment it also
 * carries `structuredContent` — which `resource_manager`'s `validate`/`create`/`preview`/
 * `update`/`inspect` do.
 *
 * `deriveStructuredMessage` closes that class at the one place every MCP tool result passes
 * through on its way to the transport (`McpToolRouter` in `../index.js`): whenever a response
 * carries both channels, it copies the same readable text — the `content` text parts, joined in
 * order — into `structuredContent.message`, so a client reading only the JSON half still gets it.
 * A `content`-only result is returned unchanged, and an existing `message` key is left alone
 * rather than overwritten, since that would mean some other construction site already owns the
 * name for a different purpose.
 */
export function deriveStructuredMessage(
  response: Pick<ToolResponse, 'content' | 'structuredContent'>
): Record<string, unknown> | undefined {
  const { content, structuredContent } = response;
  if (structuredContent == null) {
    return structuredContent;
  }
  if ('message' in structuredContent) {
    return structuredContent;
  }

  // Every `ToolResponse.content` part is `{ type: 'text'; text: string }` — there is no other
  // member of the union to filter out.
  const message = content.map((part) => part.text).join('\n\n');
  if (message === '') {
    return structuredContent;
  }

  return { ...structuredContent, message };
}
