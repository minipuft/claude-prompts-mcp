// @lifecycle canonical - Handler for configuration management operations.

import { validateConfigInput } from '../../config-utils.js';
import { ActionHandler } from '../core/action-handler-base.js';
import { createStructuredResponse } from '../core/response-utils.js';

import type { ToolResponse } from '#shared/types/index.js';

import { handleError as utilsHandleError } from '#shared/utils/index.js';

/** The one remaining nested-config shape: a per-key candidate check, never a write. */
interface ConfigValidateRequest {
  key: string;
  value?: string;
  operation: 'validate';
}

/**
 * MCP config surface after this row: `list`, `keys`, `validate`. `get`, `set`, `reset` and
 * `restore` do not reach this handler — `get` is held by owner ruling R41 until a generated
 * config shape resolves most of the 78 schema-declared keys (31 resolve today); writes are
 * `cpm`-only per R27/R35 and are not coming back. Any other operation is refused by name,
 * never answered with a listing — that silent substitution (`if (!configRequest) return list`)
 * is the defect this row removes: it made every malformed or unrecognized call look like a
 * successful config dump.
 */
export class ConfigActionHandler extends ActionHandler {
  async execute(args: any): Promise<ToolResponse> {
    const operation = args.operation;
    const configRequest: unknown = args.config;

    switch (operation) {
      case 'list':
        return await this.handleConfigList();
      case 'keys':
        return await this.handleConfigKeys();
      case 'validate':
        if (configRequest === undefined) {
          return await this.handleSchemaValidate();
        }
        return await this.handleConfigValidate(configRequest as ConfigValidateRequest);
      default:
        return this.refuseOperation(operation);
    }
  }

  private configManagerUnavailable(): ToolResponse {
    return createStructuredResponse(
      '❌ **Configuration Manager Unavailable**',
      { operation: 'config', error: 'config_manager_unavailable' },
      true
    );
  }

  private refuseOperation(operation: unknown): ToolResponse {
    const label = typeof operation === 'string' && operation.length > 0 ? operation : '(missing)';

    return createStructuredResponse(
      [
        `❌ config operation \`${label}\` is not served over MCP.`,
        '',
        'Reads: `list` (whole loaded configuration), `keys` (declared schema keys), `validate`' +
          ' (the load-time schema check, or a per-key candidate check with' +
          ' `config: { operation: "validate", key, value }`).',
        '`get` is held pending a generated config shape (R41) — read one key with' +
          ' `cpm config get <key>` until it returns.',
        'Arbitrary writes (naming a key and value) and restore-from-backup are not served over' +
          ' MCP — use `cpm config set <key> <value>` or `cpm config reset --force`.',
      ].join('\n'),
      true,
      { action: 'config' }
    );
  }

  private async handleConfigList(): Promise<ToolResponse> {
    if (!this.configManager) return this.configManagerUnavailable();

    try {
      const config = this.configManager.getConfig();
      return this.createMinimalSystemResponse(
        `📋 **Current Configuration**\n\`\`\`json\n${JSON.stringify(config, null, 2)}\n\`\`\``,
        'config_list'
      );
    } catch (error) {
      const result = utilsHandleError(error, 'config_management', this.logger);
      return createStructuredResponse(result.message, result.isError, { action: 'config' });
    }
  }

  private async handleConfigKeys(): Promise<ToolResponse> {
    if (!this.configManager) return this.configManagerUnavailable();

    try {
      const keys = await this.configManager.listConfigKeys();
      return this.createMinimalSystemResponse(
        `🔑 **Declared Configuration Keys** (${keys.length})\n\`\`\`\n${keys.join('\n')}\n\`\`\``,
        'config_keys'
      );
    } catch (error) {
      // listConfigKeys() throws when the schema cannot be enumerated — report that as the
      // explicit failure it is; never render an empty list, which would read as "zero keys".
      const result = utilsHandleError(error, 'config_management', this.logger);
      return createStructuredResponse(result.message, result.isError, { action: 'config' });
    }
  }

  private async handleConfigValidate(configRequest: ConfigValidateRequest): Promise<ToolResponse> {
    if (!this.configManager) return this.configManagerUnavailable();

    try {
      const validation = validateConfigInput(configRequest.key, configRequest.value ?? '');
      return this.createMinimalSystemResponse(
        validation.valid
          ? `✅ Configuration valid for **${configRequest.key}**`
          : `❌ Invalid configuration for **${configRequest.key}**: ${validation.error}`,
        'config_validate'
      );
    } catch (error) {
      const result = utilsHandleError(error, 'config_management', this.logger);
      return createStructuredResponse(result.message, result.isError, { action: 'config' });
    }
  }

  /**
   * Reports the schema check the server already ran at config load — never re-validates
   * `getConfig()`: the normalized config always fails the schema, because loading adds a root
   * `transport` key the schema does not declare.
   */
  private async handleSchemaValidate(): Promise<ToolResponse> {
    if (this.configManager === undefined) throw new Error('Config manager unavailable');
    const result = this.configManager.getSchemaValidation();

    if (result === undefined) {
      return this.createMinimalSystemResponse(
        '⚠️ The config has not been checked against a schema in this process.',
        'config_validate'
      );
    }

    if (result.status === 'valid') {
      return this.createMinimalSystemResponse(
        '✅ config.json matches its schema.',
        'config_validate'
      );
    }

    if (result.status === 'unavailable') {
      return this.createMinimalSystemResponse(
        ['⚠️ The schema could not be read, so the config was not checked.', ...result.errors].join(
          '\n'
        ),
        'config_validate'
      );
    }

    return this.createMinimalSystemResponse(
      [
        '❌ config.json does not match its schema. The server keeps running.',
        ...result.errors,
      ].join('\n'),
      'config_validate'
    );
  }
}
