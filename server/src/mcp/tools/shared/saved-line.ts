// @lifecycle canonical - The `saved: <path>` line every resource_manager create and update ends with.

import type { ToolResponse } from '#shared/types/index.js';

/**
 * End a create or update reply with where the write landed (ruling R3j): one final line,
 * `saved: <absolute path of the primary file>` (`prompt.yaml`, `gate.yaml`, `framework.yaml`,
 * `category.yaml`), so the caller learns which of several resource folders received the file
 * without a follow-up `inspect`. A structured reply carries the same path as
 * `structuredContent.saved`, for a client that reads only the JSON half.
 *
 * Only for a reply whose write landed: a refusal, a preview or a delete writes no file and must
 * not name one. A landed write whose writer reported no path is a writer defect, so it throws
 * rather than answering without the line.
 */
export function withSavedLine(response: ToolResponse, savedPath: string | undefined): ToolResponse {
  if (savedPath === undefined || savedPath === '') {
    throw new Error('A resource write landed but its writer reported no saved path');
  }
  const line = `saved: ${savedPath}`;
  const lastPart = response.content.at(-1);
  const content: ToolResponse['content'] =
    lastPart === undefined
      ? [{ type: 'text', text: line }]
      : [
          ...response.content.slice(0, -1),
          { ...lastPart, text: `${lastPart.text.trimEnd()}\n\n${line}` },
        ];
  return {
    ...response,
    content,
    ...(response.structuredContent !== undefined
      ? { structuredContent: { ...response.structuredContent, saved: savedPath } }
      : {}),
  };
}
