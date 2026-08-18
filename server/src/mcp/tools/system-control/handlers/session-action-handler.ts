// @lifecycle canonical - Handler for chain session management operations.

import { ActionHandler } from '../core/action-handler-base.js';

import type { ToolResponse } from '#shared/types/index.js';

import { currentOrdinal, totalOf } from '#shared/utils/node-order.js';

export class SessionActionHandler extends ActionHandler {
  async execute(args: any): Promise<ToolResponse> {
    const operation = args.operation || 'list';
    const manager = this.context.chainSessionStore;

    if (!manager) {
      throw new Error('Chain session manager not initialized');
    }

    switch (operation) {
      case 'list':
        return await this.listSessions(args);
      case 'clear':
        return await this.clearSession(args);
      case 'inspect':
        return await this.inspectSession(args);
      case 'cancel':
        // Relocated to `prompt_engine(chain_id, cancel: true)`. Refused with the replacement
        // rather than falling into the generic "unknown operation" branch, because a caller
        // reaching for it here is not confused about the vocabulary — they are using the
        // interface that used to have it.
        throw new Error(
          '`session cancel` moved to prompt_engine: call prompt_engine(chain_id: "<id>", cancel: true). ' +
            'It is keyed on `chain_id` because a chain id is held BECAUSE you are running the ' +
            'chain, and stopping that run is part of running it. `list`, `inspect` and `clear` ' +
            'stay here — they are keyed on a session_id read from a listing.'
        );
      default:
        throw new Error(
          `Unknown session operation: ${operation}. Valid operations: list, clear, inspect`
        );
    }
  }

  private async listSessions(args: any): Promise<ToolResponse> {
    const manager = this.context.chainSessionStore!;
    const sessions = manager.listActiveSessions();

    if (sessions.length === 0) {
      return this.createMinimalSystemResponse(
        '📭 **No Active Sessions**\n\nThere are currently no active chain sessions.',
        'session_list'
      );
    }

    let response = `📋 **Active Sessions** (${sessions.length})\n\n`;

    sessions.forEach((session) => {
      const startTime = new Date(session.startTime).toLocaleString();
      const lastActivity = new Date(session.lastActivity).toLocaleString();
      const promptInfo = session.promptId ? ` (\`${session.promptId}\`)` : '';

      response += `### Session: \`${session.sessionId}\`\n`;
      response += `**Chain**: \`${session.chainId}\`${promptInfo}\n`;
      response += `**Progress**: Step ${session.currentStep}/${session.totalSteps}\n`;
      response += `**Status**: ${session.pendingReview ? '⚠️ Awaiting Review' : '🟢 Active'}\n`;

      if (args.show_details) {
        response += `**Started**: ${startTime}\n`;
        response += `**Last Activity**: ${lastActivity}\n`;
      }
      response += '\n';
    });

    if (!args.show_details) {
      response += `💡 Use 'show_details: true' for more information about each session.\n`;
    }

    response += `\n🔧 Clear sessions using: action="session", operation="clear", session_id="<id>"`;

    return this.createMinimalSystemResponse(response, 'session_list');
  }

  private async clearSession(args: any): Promise<ToolResponse> {
    const manager = this.context.chainSessionStore!;
    const sessionId = args.session_id;

    if (!sessionId) {
      throw new Error('session_id parameter is required for clear operation');
    }

    // Resolve which namespace the id belongs to BEFORE deleting anything.
    //
    // This used to be a try-then-fall-through: clear as a session id, and if that returned false,
    // clear every session for it as a chain id. A session id that was merely stale, mistyped, or
    // out of scope therefore escalated silently from "one session" to "every run of a chain" —
    // `clearSessionsForChain` additionally strips the run number and walks `getRunHistory`, so the
    // blast radius was every run the chain had ever produced. The handler reported success either
    // way, so nothing distinguished a precise clear from a chain-wide sweep after the fact.
    const sessions = manager.listActiveSessions(undefined, this.requestScope);
    const matchesSession = sessions.some((s) => s.sessionId === sessionId);
    const matchingChain = sessions.filter((s) => s.chainId === sessionId);

    if (matchesSession && matchingChain.length > 0) {
      return this.createMinimalSystemResponse(
        `⚠️ **Ambiguous ID**: \`${sessionId}\` names both a session and a chain.\n\n` +
          `Refusing rather than guessing which one you meant. Use \`operation: "list"\` to find ` +
          `the specific session id.`,
        'session_clear'
      );
    }

    if (matchesSession) {
      await manager.clearSession(sessionId, this.requestScope);
      return this.createMinimalSystemResponse(
        `✅ **Session Cleared**: \`${sessionId}\`\n\nAll state and artifacts for this session have been removed.`,
        'session_clear'
      );
    }

    if (matchingChain.length > 0) {
      await manager.clearSessionsForChain(sessionId, this.requestScope);
      return this.createMinimalSystemResponse(
        `✅ **Chain Sessions Cleared**: \`${sessionId}\`\n\n` +
          `${matchingChain.length} session(s) and their history have been removed.`,
        'session_clear'
      );
    }

    // Neither namespace matched. Previously this branch was unreachable — the chain-wide clear
    // absorbed it and reported success for an id that existed nowhere.
    return this.createMinimalSystemResponse(
      `⚠️ **Nothing Cleared**: \`${sessionId}\` matches no active session or chain in this ` +
        `workspace.\n\nUse \`operation: "list"\` to see what is active. Nothing was removed.`,
      'session_clear'
    );
  }

  private async inspectSession(args: any): Promise<ToolResponse> {
    const manager = this.context.chainSessionStore!;
    const sessionId = args.session_id;

    if (!sessionId) {
      throw new Error('session_id parameter is required for inspect operation');
    }

    const session = manager.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const context = manager.getChainContext(sessionId);

    let response = `🔍 **Session Inspection: \`${sessionId}\`**\n\n`;
    response += `**Chain ID**: \`${session.chainId}\`\n`;
    response += `**Prompt**: \`${session.blueprint?.parsedCommand?.promptId || 'unknown'}\`\n`;
    response += `**Step**: ${currentOrdinal(session.state.nodes, session.state.currentNodeId)} / ${totalOf(session.state.nodes)}\n`;
    response += `**Started**: ${new Date(session.startTime).toLocaleString()}\n`;
    response += `**Last Activity**: ${new Date(session.lastActivity).toLocaleString()}\n`;
    response += `**Lifecycle**: \`${session.lifecycle}\`\n\n`;

    if (session.pendingGateReview) {
      response += `### ⚠️ Pending Review\n`;
      response += `**Gates**: ${session.pendingGateReview.gateIds.join(', ')}\n`;
      response += `**Attempts**: ${session.pendingGateReview.attemptCount}/${session.pendingGateReview.maxAttempts}\n\n`;
    }

    response += `### 📄 Context Variables\n`;
    const varNames = Object.keys(context).filter(
      (k) =>
        !['chain_run_id', 'chain_id', 'current_step', 'total_steps', 'execution_order'].includes(k)
    );

    if (varNames.length > 0) {
      varNames.forEach((name) => {
        const val = context[name];
        const displayVal =
          typeof val === 'string'
            ? val.substring(0, 100) + (val.length > 100 ? '...' : '')
            : JSON.stringify(val);
        response += `- \`${name}\`: ${displayVal}\n`;
      });
    } else {
      response += '_No custom variables stored._\n';
    }

    return this.createMinimalSystemResponse(response, 'session_inspect');
  }
}
