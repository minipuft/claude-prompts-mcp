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

/**
 * The persistence clause every `system_control` toggle reply ends with.
 *
 * WHY EVERY REPLY AND NOT ONLY A PERSISTED ONE (P4.114). The note used to appear only when
 * `persist: true` was passed — so the one case an operator needs telling about, a toggle that
 * lives in memory and is gone at the next restart, said nothing at all and read as a settled
 * change. Both branches are stated here, in one place, so a toggle cannot acquire a reply that
 * describes one and not the other.
 *
 * `setting` names the config key the persisted form writes, because "re-send with persist" is not
 * actionable without knowing what would be written where.
 */
export function describeTogglePersistence(args: {
  persist?: boolean | undefined;
  note?: string | undefined;
  setting: string;
  /** `false` when the toggle changed nothing — the state was already the requested one. */
  changed?: boolean | undefined;
}): string {
  if (args.persist === true) {
    return args.note ?? `📁 Persisted ${args.setting}.`;
  }
  const subject = args.changed === false ? 'this state is held' : 'this change is held';
  return (
    `🕔 **Not persisted** — ${subject} in memory for this workspace and ends when the ` +
    `server restarts. Re-send with \`persist: true\` to write ${args.setting} to the ` +
    `configuration file and record a config version.`
  );
}
