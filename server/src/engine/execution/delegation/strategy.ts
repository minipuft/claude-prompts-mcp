// @lifecycle canonical - Client-specific delegation rendering strategies.
import type { DelegationProfile } from '#shared/types/core-config.js';
import type { RequestClientProfile } from '#shared/types/request-identity.js';
import type { DelegationPayload } from './types.js';

/** Client-specific rendering strategy for delegation CTAs. */
export interface DelegationStrategy {
  readonly clientId: string;

  /** Map semantic capability hint to a client-specific model name. */
  resolveModel(payload: DelegationPayload): string | undefined;

  /** Format the tool invocation block (tool name + parameters). */
  formatToolCall(agentType: string, model: string | undefined): string;

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

/** Default strategy for Claude Code (Task tool, Claude model names). */
export class ClaudeCodeStrategy implements DelegationStrategy {
  readonly clientId = 'claude-code';

  private static readonly CAPABILITY_MAP: Record<string, string> = {
    heavy: 'opus',
    standard: 'sonnet',
    fast: 'haiku',
  };

  /**
   * @param pluginNamespace Claude Code namespaces plugin agents as
   *   `{plugin}:{agent}`. Bare agent types (without `:`) are prefixed
   *   automatically so the rendered CTA matches the Task tool's registry.
   */
  constructor(private readonly pluginNamespace: string = 'claude-prompts') {}

  resolveModel(payload: DelegationPayload): string | undefined {
    const mapped = ClaudeCodeStrategy.CAPABILITY_MAP[payload.subagentModel ?? ''];
    if (mapped != null) return mapped;
    if (payload.gateCount >= 3) return 'opus';
    return 'sonnet';
  }

  /** Resolve bare agent type to namespaced form for Claude Code's Task tool. */
  private resolveAgentType(agentType: string): string {
    if (agentType.includes(':')) return agentType;
    return `${this.pluginNamespace}:${agentType}`;
  }

  formatToolCall(agentType: string, model: string | undefined): string {
    const resolved = this.resolveAgentType(agentType);
    const lines = [
      '\u2192 Tool: Task',
      '\u2192 Parameters:',
      `  \u2022 subagent_type: "${resolved}"`,
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

  formatToolCall(agentType: string, model: string | undefined): string {
    const lines = [
      '→ Tool: spawn_agent (preferred)',
      '→ Parameters:',
      `  • agent_type: "${agentType}"`,
    ];
    if (model != null) {
      lines.push(`  • model: "${model}"`);
    }
    return lines.join('\n');
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

  formatToolCall(agentType: string, model: string | undefined): string {
    const lines = [
      "→ Handoff: Use Gemini's sub-agent/handoff capability",
      '→ Parameters:',
      `  • agent_type: "${agentType}"`,
    ];
    if (model != null) {
      lines.push(`  • model_hint: "${model}"`);
    }
    return lines.join('\n');
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

  formatToolCall(agentType: string, model: string | undefined): string {
    const lines = [
      "→ Handoff: Use OpenCode's agent/sub-agent capability",
      '→ Parameters:',
      `  • agent_type: "${agentType}"`,
    ];
    if (model != null) {
      lines.push(`  • model_hint: "${model}"`);
    }
    return lines.join('\n');
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

  formatToolCall(agentType: string, model: string | undefined): string {
    const lines = [
      "→ Handoff (experimental/testing): Use Cursor's agent/sub-agent capability",
      '→ Parameters:',
      `  • agent_type: "${agentType}"`,
    ];
    if (model != null) {
      lines.push(`  • model_hint: "${model}"`);
    }
    return lines.join('\n');
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

  formatToolCall(agentType: string, model: string | undefined): string {
    const lines = [
      "→ Handoff: Use your client's sub-agent/handoff capability",
      '→ Parameters:',
      `  • agent_type: "${agentType}"`,
    ];
    if (model != null) {
      lines.push(`  • model_hint: "${model}"`);
    }
    return lines.join('\n');
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
