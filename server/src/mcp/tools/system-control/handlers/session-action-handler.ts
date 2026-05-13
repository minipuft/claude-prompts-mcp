// @lifecycle canonical - Handler for chain session management operations.

import { ActionHandler } from '../core/action-handler-base.js';

import type { ToolResponse } from '../../../../shared/types/index.js';

export class SessionActionHandler extends ActionHandler {
  async execute(args: any): Promise<ToolResponse> {
    const operation = args.operation || 'list';
    const manager = this.context.chainSessionManager;

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
        return await this.cancelSession(args);
      default:
        throw new Error(
          `Unknown session operation: ${operation}. Valid operations: list, clear, inspect, cancel`
        );
    }
  }

  private async listSessions(args: any): Promise<ToolResponse> {
    const manager = this.context.chainSessionManager!;
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
    const manager = this.context.chainSessionManager!;
    const sessionId = args.session_id;

    if (!sessionId) {
      throw new Error('session_id parameter is required for clear operation');
    }

    // Try clearing as a session ID first, then as a chain ID
    const wasSessionCleared = await manager.clearSession(sessionId);
    if (wasSessionCleared) {
      return this.createMinimalSystemResponse(
        `✅ **Session Cleared**: \`${sessionId}\`\n\nAll state and artifacts for this session have been removed.`,
        'session_clear'
      );
    }

    // Try clearing all sessions for this chain
    await manager.clearSessionsForChain(sessionId);
    return this.createMinimalSystemResponse(
      `✅ **Chain Sessions Cleared**: \`${sessionId}\`\n\nAll sessions and history associated with chain ID \`${sessionId}\` have been removed.`,
      'session_clear'
    );
  }

  private async inspectSession(args: any): Promise<ToolResponse> {
    const manager = this.context.chainSessionManager!;
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
    response += `**Step**: ${session.state.currentStep} / ${session.state.totalSteps}\n`;
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

  private async cancelSession(args: { session_id?: string }): Promise<ToolResponse> {
    const manager = this.context.chainSessionManager;
    if (manager === undefined) {
      throw new Error('Chain session manager not initialized');
    }

    const sessionId = args.session_id;
    if (sessionId === undefined || sessionId.length === 0) {
      throw new Error('session_id parameter is required for cancel operation');
    }

    const cancelled = await manager.cancelChain(sessionId);
    if (!cancelled) {
      return this.createMinimalSystemResponse(
        `⚠️ **Cancel Not Applied**: \`${sessionId}\`\n\nSession is in a terminal state (completed/failed) or does not exist. Use \`operation: "inspect"\` to view current status.`,
        'session_cancel'
      );
    }

    return this.createMinimalSystemResponse(
      `🛑 **Session Cancelled**: \`${sessionId}\`\n\nThe session has been transitioned to \`cancelled\` runStatus. Subsequent progression is blocked. Use \`operation: "clear"\` to remove session state entirely.`,
      'session_cancel'
    );
  }
}
