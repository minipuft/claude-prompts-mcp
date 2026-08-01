// @lifecycle canonical - Shared response utilities for system_control handlers.

import type { ToolResponse } from '#shared/types/index.js';

export function createStructuredResponse(
  content: any,
  second?: boolean | Record<string, any>,
  third?: boolean | Record<string, any>
): ToolResponse {
  let metadata: Record<string, any> | undefined;
  let isError = false;

  if (typeof second === 'boolean') {
    isError = second;
    if (third && typeof third === 'object') {
      metadata = third;
    }
  } else if (second && typeof second === 'object') {
    metadata = second;
    if (typeof third === 'boolean') {
      isError = third;
    }
  }

  const textContent = Array.isArray(content)
    ? content[0]?.text || String(content)
    : String(content);

  const response: ToolResponse = {
    content: [{ type: 'text' as const, text: textContent }],
    isError,
  };

  if (metadata) {
    (response as any).metadata = metadata;
  }

  return response;
}
