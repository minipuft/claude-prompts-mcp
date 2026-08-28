// @lifecycle canonical - Client-specific delegation rendering strategies.
import type { DelegationProfile } from '#shared/types/core-config.js';
import type { RequestClientProfile } from '#shared/types/request-identity.js';
import type { DelegationPayload } from './types.js';

/** Client-specific rendering strategy for delegation CTAs. */
export interface DelegationStrategy {
  readonly clientId: string;

  /** Map semantic capability hint to a client-specific model name. */
  resolveModel(payload: DelegationPayload): string | undefined;

  /**
   * Format the tool invocation block (tool name + parameters). `agentType` is undefined when
   * the author declared none; the strategy substitutes its host's default agent or omits the
   * line so the client's own default applies.
   */
  formatToolCall(agentType: string | undefined, model: string | undefined): string;

  /** Format enforcement constraints shown after instructions. */
  formatConstraints(): string;
}

export type DelegationStrategyStatus = 'canonical' | 'experimental';

interface DelegationProfileDescriptor {
  readonly status: DelegationStrategyStatus;
  readonly footerPrefix: string;
}

const DEFAULT_DELEGATION_PROFILE: DelegationProfile = 'task_tool_v1';

const DELEGATION_PROFILE_DESCRIPTORS: Record<DelegationProfile, DelegationProfileDescriptor> = {
  task_tool_v1: {
    status: 'canonical',
    footerPrefix: 'Handoff via Task tool',
  },
  spawn_agent_v1: {
    status: 'canonical',
    footerPrefix: 'Handoff via Codex agent capability (spawn_agent preferred)',
  },
  gemini_subagent_v1: {
    status: 'canonical',
    footerPrefix: 'Handoff via Gemini sub-agent capability',
  },
  opencode_agent_v1: {
    status: 'canonical',
    footerPrefix: 'Handoff via OpenCode agent capability',
  },
  cursor_agent_v1: {
    status: 'experimental',
    footerPrefix: 'Handoff via Cursor agent capability',
  },
  neutral_v1: {
    status: 'canonical',
    footerPrefix: 'Handoff via your client sub-agent mechanism',
  },
};

function resolveProfile(clientProfile?: RequestClientProfile): DelegationProfile {
  return clientProfile?.delegationProfile ?? DEFAULT_DELEGATION_PROFILE;
}

export function getHandoffFooterPrefix(delegationProfile?: DelegationProfile): string {
  const profile = delegationProfile ?? DEFAULT_DELEGATION_PROFILE;
  return DELEGATION_PROFILE_DESCRIPTORS[profile].footerPrefix;
}

export function getHandoffFooterInstruction(delegationProfile?: DelegationProfile): string {
  const prefix = getHandoffFooterPrefix(delegationProfile);
  const status = getHandoffProfileStatus(delegationProfile);
  return status === 'experimental' ? `${prefix} (experimental/testing)` : prefix;
}

export function getHandoffProfileStatus(
  delegationProfile?: DelegationProfile
): DelegationStrategyStatus {
  const profile = delegationProfile ?? DEFAULT_DELEGATION_PROFILE;
  return DELEGATION_PROFILE_DESCRIPTORS[profile].status;
}

/**
 * Default agent for Claude Code handoffs. The `Task` tool requires a `subagent_type`, and
 * `general-purpose` is the host's built-in executor: the EXECUTION BRIEF is self-contained
 * (template, gates, history, Result Contract), so the worker needs no plugin-specific prompt.
 * The plugin shipped its own `chain-executor` agent until 2026-08-27; it restated the brief
 * and contradicted it on the verdict shape, and the bare-name namespacing that pointed at it
 * made every host-catalog agent (`Explore`, `~/.claude/agents/*`) unreachable from a brief.
 */
export const CLAUDE_CODE_DEFAULT_AGENT_TYPE = 'general-purpose';

/**
 * Handoff block for hosts whose spawn call has a default agent of its own. The `agent_type`
 * line renders only when the author named one, so an undeclared agent leaves the choice to the
 * client; with no parameters at all the `Parameters:` header is dropped rather than left empty.
 */
function formatHandoffBlock(
  header: string,
  agentType: string | undefined,
  model: string | undefined,
  modelKey: 'model' | 'model_hint'
): string {
  const params = [
    ...(agentType === undefined ? [] : [`  • agent_type: "${agentType}"`]),
    ...(model === undefined ? [] : [`  • ${modelKey}: "${model}"`]),
  ];
  return [header, ...(params.length === 0 ? [] : ['→ Parameters:', ...params])].join('\n');
}

/** Default strategy for Claude Code (Task tool, Claude model names). */
export class ClaudeCodeStrategy implements DelegationStrategy {
  readonly clientId = 'claude-code';

  private static readonly CAPABILITY_MAP: Record<string, string> = {
    heavy: 'opus',
    standard: 'sonnet',
    fast: 'haiku',
  };

  resolveModel(payload: DelegationPayload): string | undefined {
    const mapped = ClaudeCodeStrategy.CAPABILITY_MAP[payload.subagentModel ?? ''];
    if (mapped != null) return mapped;
    if (payload.gateCount >= 3) return 'opus';
    return 'sonnet';
  }

  /**
   * Agent names pass through as written. A bare name is the host catalog (built-ins and
   * user-level agents carry no namespace); a plugin agent is written `plugin:agent` by its
   * author. The server cannot see the host registry, so it never rewrites the name.
   */
  formatToolCall(agentType: string | undefined, model: string | undefined): string {
    const lines = [
      '\u2192 Tool: Task',
      '\u2192 Parameters:',
      `  \u2022 subagent_type: "${agentType ?? CLAUDE_CODE_DEFAULT_AGENT_TYPE}"`,
    ];
    if (model != null) lines.push(`  \u2022 model: "${model}"`);
    return lines.join('\n');
  }

  formatConstraints(): string {
    return [
      '\u26A0\uFE0F CONSTRAINT: DO NOT respond directly or use Edit/Write/Bash tools.',
      '\u26A0\uFE0F BLOCKED: Action tools are disabled until Task tool is invoked.',
    ].join('\n');
  }
}

/** Strategy for Codex-compatible delegation instructions. */
export class CodexStrategy implements DelegationStrategy {
  readonly clientId = 'codex';

  resolveModel(payload: DelegationPayload): string | undefined {
    if (payload.subagentModel === 'heavy') {
      return 'codex-high';
    }
    if (payload.subagentModel === 'fast') {
      return 'codex-fast';
    }
    return 'codex-standard';
  }

  formatToolCall(agentType: string | undefined, model: string | undefined): string {
    return formatHandoffBlock('→ Tool: spawn_agent (preferred)', agentType, model, 'model');
  }

  formatConstraints(): string {
    return [
      '⚠️ CONSTRAINT: Handoff first; do not complete handed-off work inline.',
      '⚠️ FALLBACK: If spawn_agent is unavailable in this runtime, use your client handoff mechanism and keep agent_type + result contract.',
      '⚠️ RESULT CONTRACT: Return the spawned agent output in user_response before resuming.',
    ].join('\n');
  }
}

/** Strategy for Gemini-compatible delegation instructions. */
export class GeminiStrategy implements DelegationStrategy {
  readonly clientId = 'gemini';

  resolveModel(_payload: DelegationPayload): string | undefined {
    return undefined;
  }

  formatToolCall(agentType: string | undefined, model: string | undefined): string {
    return formatHandoffBlock(
      "→ Handoff: Use Gemini's sub-agent/handoff capability",
      agentType,
      model,
      'model_hint'
    );
  }

  formatConstraints(): string {
    return [
      '⚠️ CONSTRAINT: Handoff this step through Gemini sub-agent flow; do not complete it inline.',
      '⚠️ RESULT CONTRACT: Return handed-off output in user_response before resuming.',
    ].join('\n');
  }
}

/** Strategy for OpenCode-compatible delegation instructions. */
export class OpenCodeStrategy implements DelegationStrategy {
  readonly clientId = 'opencode';

  resolveModel(_payload: DelegationPayload): string | undefined {
    return undefined;
  }

  formatToolCall(agentType: string | undefined, model: string | undefined): string {
    return formatHandoffBlock(
      "→ Handoff: Use OpenCode's agent/sub-agent capability",
      agentType,
      model,
      'model_hint'
    );
  }

  formatConstraints(): string {
    return [
      '⚠️ CONSTRAINT: Route handed-off work through OpenCode agent capability; do not execute inline.',
      '⚠️ RESULT CONTRACT: Return handed-off output in user_response before resuming.',
    ].join('\n');
  }
}

/** Strategy for Cursor-compatible delegation instructions. */
export class CursorStrategy implements DelegationStrategy {
  readonly clientId = 'cursor';

  resolveModel(_payload: DelegationPayload): string | undefined {
    return undefined;
  }

  formatToolCall(agentType: string | undefined, model: string | undefined): string {
    return formatHandoffBlock(
      "→ Handoff (experimental/testing): Use Cursor's agent/sub-agent capability",
      agentType,
      model,
      'model_hint'
    );
  }

  formatConstraints(): string {
    return [
      '⚠️ CONSTRAINT: Use Cursor agent handoff for this step; do not perform inline edits.',
      '⚠️ EXPERIMENTAL: Cursor handoff behavior is in testing; if unavailable, use your runtime handoff mechanism.',
      '⚠️ RESULT CONTRACT: Return handed-off output in user_response before resuming.',
    ].join('\n');
  }
}

/** Neutral fallback for unknown client families. */
export class NeutralStrategy implements DelegationStrategy {
  readonly clientId = 'unknown';

  resolveModel(_payload: DelegationPayload): string | undefined {
    return undefined;
  }

  formatToolCall(agentType: string | undefined, model: string | undefined): string {
    return formatHandoffBlock(
      "→ Handoff: Use your client's sub-agent/handoff capability",
      agentType,
      model,
      'model_hint'
    );
  }

  formatConstraints(): string {
    return [
      '⚠️ CONSTRAINT: Use handed-off execution when available; do not answer inline if handoff exists.',
      '⚠️ RESULT CONTRACT: Include handed-off output in user_response and then resume the chain.',
    ].join('\n');
  }
}

const STRATEGY_FACTORIES: Record<DelegationProfile, () => DelegationStrategy> = {
  task_tool_v1: () => new ClaudeCodeStrategy(),
  spawn_agent_v1: () => new CodexStrategy(),
  gemini_subagent_v1: () => new GeminiStrategy(),
  opencode_agent_v1: () => new OpenCodeStrategy(),
  cursor_agent_v1: () => new CursorStrategy(),
  neutral_v1: () => new NeutralStrategy(),
};

/**
 * Select strategy from resolved client profile.
 *
 * Fallback defaults to Claude strategy for backward compatibility when no
 * profile is available.
 */
export function resolveDelegationStrategy(
  clientProfile?: RequestClientProfile
): DelegationStrategy {
  return STRATEGY_FACTORIES[resolveProfile(clientProfile)]();
}
