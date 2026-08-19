// @lifecycle canonical - Parses explicitly-requested tool ids from invocation arguments.
/**
 * Explicit tool request parsing.
 *
 * A caller names a script tool explicitly by putting it in the invocation
 * arguments — `tool:<id>`, or a `tool` / `tool_id` / `toolId` value. That is the
 * one signal in this system meaning "the invoking user asked for this tool",
 * as distinct from "a prompt author's template mentions it", and both the
 * declarative and the inline execution paths decide confirmation from it.
 *
 * It lives in `shared/` (L0) because those two consumers sit in different
 * layers — `modules/automation/detection` and `engine/execution/reference` —
 * and an activation rule with two encodings is the failure ADR 0001 exists for.
 * Extracted from `ToolDetectionService`, where it was `private` and therefore
 * invisible to a capability search: the second consumer would have had no way
 * to find it and would have written the rule again.
 */

/**
 * Collect the tool ids an invocation explicitly asked for.
 *
 * Recognises three forms, all lowercased:
 * - a `tool:<id>` key, whatever its value
 * - a `tool`, `tool_id`, or `toolId` argument naming one id
 * - that same argument holding a comma-separated list
 *
 * @param args - Parsed invocation arguments
 * @returns Set of explicitly requested tool ids, lowercased
 */
export function extractExplicitToolRequests(args: Record<string, unknown>): Set<string> {
  const requested = new Set<string>();

  // Check for tool:<id> keys
  for (const key of Object.keys(args)) {
    if (key.toLowerCase().startsWith('tool:')) {
      const toolId = key.slice(5).toLowerCase();
      if (toolId !== '') {
        requested.add(toolId);
      }
    }
  }

  // Check for explicit 'tool' or 'tool_id' arg
  const explicitTool = args['tool'] ?? args['tool_id'] ?? args['toolId'];
  if (typeof explicitTool === 'string') {
    requested.add(explicitTool.toLowerCase());
  }

  // Check for comma-separated tool list.
  //
  // Behaviour preserved verbatim from the original private method, including
  // that a value of `"a,b"` also leaves the unsplit string `"a,b"` in the set
  // from the branch above. That entry matches no real tool id, so it is inert
  // rather than wrong, and changing it here would alter detection behaviour
  // inside a move that is meant to be behaviour-preserving.
  if (typeof explicitTool === 'string' && explicitTool.includes(',')) {
    for (const part of explicitTool.split(',')) {
      const trimmed = part.trim().toLowerCase();
      if (trimmed !== '') {
        requested.add(trimmed);
      }
    }
  }

  return requested;
}
