// @lifecycle canonical - Handler for configuration management operations.

import { validateConfigInput } from '../../config-utils.js';
import { ActionHandler } from '../core/action-handler-base.js';
import { createStructuredResponse } from '../core/response-utils.js';

import type { ToolResponse } from '#shared/types/index.js';

import { handleError as utilsHandleError } from '#shared/utils/index.js';

export class ConfigActionHandler extends ActionHandler {
  async execute(args: any): Promise<ToolResponse> {
    const operation = args.operation || 'default';

    switch (operation) {
      case 'restore':
        return await this.restoreConfig({
          backup_path: args.backup_path,
          confirm: args.confirm,
        });
      case 'get':
      case 'set':
      case 'list':
      case 'validate':
      case 'default':
      default:
        return await this.manageConfig({
          config: args.config,
        });
    }
  }

  private async restoreConfig(args: {
    backup_path?: string;
    confirm?: boolean;
  }): Promise<ToolResponse> {
    if (!this.configManager) {
      throw new Error('Configuration manager not initialized');
    }

    if (!args.confirm) {
      return this.createMinimalSystemResponse(
        "❌ Restore cancelled. Set 'confirm: true' to restore configuration.",
        'restore_config'
      );
    }

    try {
      if (!this.safeConfigWriter) {
        throw new Error('SafeConfigWriter not available');
      }
      const result = await this.safeConfigWriter.restoreFromBackup(args.backup_path || '');
      if (result.success) {
        return this.createMinimalSystemResponse(
          '✅ Configuration restored successfully.',
          'restore_config'
        );
      } else {
        throw new Error(result.message || 'Failed to restore configuration.');
      }
    } catch (error) {
      const result = utilsHandleError(error, 'restore_config', this.logger);
      return createStructuredResponse(result.message, result.isError, { action: 'restore_config' });
    }
  }

  private async manageConfig(args: {
    config?: {
      key: string;
      value?: string;
      operation: 'get' | 'set' | 'list' | 'validate';
    };
  }): Promise<ToolResponse> {
    const configRequest = args.config;

    if (!this.configManager) {
      return createStructuredResponse(
        '❌ **Configuration Manager Unavailable**',
        { operation: 'config', error: 'config_manager_unavailable' },
        true
      );
    }

    try {
      if (!configRequest) {
        return await this.handleConfigList();
      }

      switch (configRequest.operation) {
        case 'list':
          return await this.handleConfigList();
        case 'get':
          return await this.handleConfigGet(configRequest.key);
        case 'set':
          return await this.handleConfigSet(configRequest.key, configRequest.value || '');
        case 'validate':
          return await this.handleConfigValidate(configRequest.key, configRequest.value || '');
        default:
          throw new Error(`Unknown config operation: ${configRequest.operation}`);
      }
    } catch (error) {
      const result = utilsHandleError(error, 'config_management', this.logger);
      return createStructuredResponse(result.message, result.isError, { action: 'config' });
    }
  }

  private async handleConfigList(): Promise<ToolResponse> {
    const config = this.configManager?.getConfig();
    return this.createMinimalSystemResponse(
      `📋 **Current Configuration**\n\`\`\`json\n${JSON.stringify(config, null, 2)}\n\`\`\``,
      'config_list'
    );
  }

  private async handleConfigGet(key: string): Promise<ToolResponse> {
    const config = this.configManager?.getConfig();
    const value = config
      ? key
          .split('.')
          .reduce((obj: any, k) => (obj?.[k] !== undefined ? obj[k] : undefined), config)
      : undefined;
    return this.createMinimalSystemResponse(`**${key}**: ${JSON.stringify(value)}`, 'config_get');
  }

  private async handleConfigSet(key: string, value: string): Promise<ToolResponse> {
    if (!this.safeConfigWriter) throw new Error('SafeConfigWriter unavailable');
    const result = await this.safeConfigWriter.updateConfigValue(key, value);
    if (!result.success) {
      throw new Error(result.message || result.error);
    }
    return this.createMinimalSystemResponse(`✅ Set **${key}** to \`${value}\``, 'config_set');
  }

  private async handleConfigValidate(key: string, value: string): Promise<ToolResponse> {
    if (!this.configManager) throw new Error('Config manager unavailable');
    const validation = validateConfigInput(key, value);
    return this.createMinimalSystemResponse(
      validation.valid
        ? `✅ Configuration valid for **${key}**`
        : `❌ Invalid configuration for **${key}**: ${validation.error}`,
      'config_validate'
    );
  }
}
