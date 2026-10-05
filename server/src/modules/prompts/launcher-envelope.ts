// @lifecycle canonical - Renders the launch-mode directive routing native MCP prompts to prompt_engine.
/**
 * Launcher Envelope Builder
 *
 * Pure functions that render the directive returned by a native MCP prompt when
 * its `mcpPromptMode` is `'launch'`. Instead of returning expanded template text,
 * the prompt returns a message instructing the agent to invoke `prompt_engine`,
 * so execution flows through the full pipeline (framework, gates, chains,
 * telemetry). Argument and gate hints are surfaced inline so the agent (and the
 * user) can see what the prompt expects and which quality gates will apply.
 *
 * This is the portable, client-agnostic counterpart to the Claude-only
 * `hooks/prompt-suggest.py` translator: it lives in the protocol-standard layer
 * and requires no knowledge of the client's slash-command prefix.
 */

import type { ConvertedPrompt } from '#engine/execution/types.js';
import type { PromptArgument } from '#shared/types/index.js';

import { isChainPrompt } from '#shared/utils/chainUtils.js';

/** A single MCP prompt message (the shape returned by `prompts/get`). */
export interface LauncherMessage {
  role: 'user';
  content: { type: 'text'; text: string };
}

/** One hint line per declared argument: name, requiredness, and description. */
function renderArgumentHints(args: PromptArgument[]): string[] {
  return args.map((arg) => {
    const requirement = arg.required ? 'required' : 'optional';
    const description = arg.description ? ` — ${arg.description}` : '';
    return `  • ${arg.name} (${requirement})${description}`;
  });
}

/**
 * Hint lines for gates that will be enforced, from the prompt's `gateConfiguration.include`. A
 * chain prompt's own gates are reviewed on the chain's final step (R1), so its list is its include
 * less its exclude; the gates its category activates are not listed, since this layer holds no
 * gate registry to ask.
 */
function renderGateHints(prompt: ConvertedPrompt): string[] {
  const include = prompt.gateConfiguration?.include ?? [];
  const exclude = new Set(prompt.gateConfiguration?.exclude ?? []);
  const own = isChainPrompt(prompt) ? include.filter((gateId) => !exclude.has(gateId)) : include;
  return own.map((gateId) => `  • ${gateId}`);
}

/** The gate list's heading; a chain prompt's names the step that reviews them. */
function gateHeading(prompt: ConvertedPrompt): string {
  return isChainPrompt(prompt)
    ? "Quality gates that will be enforced, reviewed on the chain's final step:"
    : 'Quality gates that will be enforced:';
}

/** Serialize provided slash-command args into the prompt_engine `options` channel. */
function renderOptionsClause(args: Record<string, unknown>): string {
  return Object.keys(args).length > 0 ? `, options: ${JSON.stringify(args)}` : '';
}

/**
 * Build the directive messages that route a native MCP prompt invocation through
 * the prompt_engine pipeline, surfacing argument and gate hints to the agent.
 */
export function buildLauncherMessages(
  prompt: ConvertedPrompt,
  args: Record<string, unknown>
): LauncherMessage[] {
  const lines: string[] = [
    'This prompt runs through the execution pipeline (framework, gates, chains, telemetry).',
    'Invoke the `prompt_engine` tool now — do not answer inline:',
    '',
    `    prompt_engine(command: ">>${prompt.id}"${renderOptionsClause(args)})`,
  ];

  const argumentHints = renderArgumentHints(prompt.arguments ?? []);
  if (argumentHints.length > 0) {
    lines.push('', 'Arguments:', ...argumentHints);
  }

  const gateHints = renderGateHints(prompt);
  if (gateHints.length > 0) {
    lines.push('', gateHeading(prompt), ...gateHints);
  }

  return [{ role: 'user', content: { type: 'text', text: lines.join('\n') } }];
}
