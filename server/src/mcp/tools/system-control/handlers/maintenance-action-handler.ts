// @lifecycle canonical - Handler for maintenance operations (restart).

import { ActionHandler } from '../core/action-handler-base.js';

import type { ToolResponse } from '#shared/types/index.js';

export class MaintenanceActionHandler extends ActionHandler {
  async execute(args: any): Promise<ToolResponse> {
    const operation = args.operation || 'default';

    switch (operation) {
      case 'restart':
      case 'default':
      default:
        return await this.restartServer({
          reason: args.reason,
          confirm: args.confirm,
        });
    }
  }

  private async restartServer(args: { reason?: string; confirm?: boolean }): Promise<ToolResponse> {
    if (!args.confirm) {
      return this.createMinimalSystemResponse(
        "❌ Restart cancelled. Set 'confirm: true' to perform a full system restart.",
        'restart_server'
      );
    }

    const reason = args.reason || 'User requested restart via system_control';
    this.logger.info(`🔄 System restart requested: ${reason}`);

    if (this.onRestart) {
      setTimeout(() => {
        this.onRestart?.(reason).catch((err: unknown) => {
          this.logger.error('Failed to execute restart callback:', err);
        });
      }, 1000);

      return this.createMinimalSystemResponse(
        `🔄 Server restart initiated.\n\n**Reason**: ${reason}\n**Status**: Restarting in 1 second...`,
        'restart_server'
      );
    } else {
      return this.createMinimalSystemResponse(
        '⚠️ Restart callback not configured. Server cannot be restarted automatically.',
        'restart_server'
      );
    }
  }
}
