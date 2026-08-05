/**
 * Config Input Validator — Pure validation for config.json keys and values.
 *
 * Extracted from mcp/tools/config-utils.ts to satisfy cli-shared isolation
 * (no runtime dependencies). SafeConfigWriter re-imports from here.
 *
 * WHY THERE ARE NO on/off `mode` KEYS FOR SUBSYSTEM TOGGLES
 * This list used to carry both `gates.mode` and `gates.enabled`, and nine such pairs. Only the
 * `enabled` half was ever read: the write path assigns dot-keys verbatim, so `cpm enable gates`
 * wrote `gates.mode: "on"`, reported success, and changed nothing. The inert half is gone; every
 * dropped key has its canonical twin below, and `ConfigManager` folds configs already written
 * with the old spelling. `telemetry.mode`, `phaseGuards.mode` and `identity.mode` remain because
 * a reader consults each of them — the first two are `off`/`warn`/`enforce`, the third is
 * `permissive`/`strict`/`locked`. None is an on/off toggle.
 */

export const CONFIG_VALID_KEYS = [
  'server.name',
  'server.port',
  'server.transport',
  'logging.level',
  'logging.directory',
  'gates.frameworkGates',
  /** @deprecated Pre-rename spelling of `gates.frameworkGates`; ConfigManager folds it forward. */
  'gates.methodologyGates',
  'execution.judge',
  'frameworks.dynamicToolDescriptions',
  'frameworks.systemPromptFrequency',
  'frameworks.styleGuidance',
  'resources.prompts.defaultRegistration',
  'resources.observability.sessions',
  'resources.observability.metrics',
  'resources.logs.maxEntries',
  'resources.logs.defaultLevel',
  'identity.mode',
  'identity.launchDefaults.organizationId',
  'identity.launchDefaults.workspaceId',
  'identity.launchDefaults.clientFamily',
  'identity.launchDefaults.clientId',
  'identity.launchDefaults.clientVersion',
  'identity.launchDefaults.delegationProfile',
  'identity.allowPerRequestOverride',
  'verification.inContextAttempts',
  'verification.isolation.timeout',
  'analysis.semanticAnalysis.llmIntegration.enabled',
  'analysis.semanticAnalysis.llmIntegration.endpoint',
  'analysis.semanticAnalysis.llmIntegration.model',
  'analysis.semanticAnalysis.llmIntegration.maxTokens',
  'analysis.semanticAnalysis.llmIntegration.temperature',
  'prompts.directory',
  'gates.directory',
  'gates.enforcePendingVerdict',
  'hooks.expandedOutput',
  'phaseGuards.mode',
  'phaseGuards.maxRetries',
  'advanced.sessions.timeoutMinutes',
  'advanced.sessions.reviewTimeoutMinutes',
  'advanced.sessions.cleanupIntervalMinutes',
  'gates.enabled',
  'frameworks.enabled',
  'prompts.registerWithMcp',
  'resources.registerWithMcp',
  'resources.prompts.enabled',
  'resources.gates.enabled',
  'resources.frameworks.enabled',
  'resources.observability.enabled',
  'resources.logs.enabled',
  'verification.isolation.enabled',
  'verification.isolation.maxBudget',
  'verification.isolation.permissionMode',
  'versioning.enabled',
  // snake_case because that is what `VersioningConfig` declares and what the runtime reads. The
  // camelCase spellings this list used to carry reached no reader.
  'versioning.max_versions',
  'versioning.auto_version',
  'telemetry.enabled',
  'telemetry.mode',
  'telemetry.exporterEndpoint',
  'telemetry.samplingRate',
  'telemetry.attributePolicy.businessContext',
  'telemetry.attributePolicy.rawCommands',
  'telemetry.attributePolicy.rawResponses',
] as const;

export type ConfigKey = (typeof CONFIG_VALID_KEYS)[number];

export const CONFIG_RESTART_REQUIRED_KEYS: ConfigKey[] = [
  'server.port',
  'server.transport',
  'analysis.semanticAnalysis.llmIntegration.enabled',
  'telemetry.mode',
  'telemetry.exporterEndpoint',
];

export interface ConfigInputValidationResult {
  valid: boolean;
  error?: string;
  convertedValue?: any;
  valueType?: 'string' | 'number' | 'boolean';
}

export function validateConfigInput(key: string, value: string): ConfigInputValidationResult {
  switch (key) {
    case 'server.port': {
      const port = parseInt(value, 10);
      if (isNaN(port) || port < 1024 || port > 65535) {
        return {
          valid: false,
          error: 'Port must be a number between 1024-65535',
        };
      }
      return { valid: true, convertedValue: port, valueType: 'number' };
    }

    case 'server.name':
    case 'server.version':
    case 'logging.directory': {
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        return {
          valid: false,
          error: 'Value cannot be empty',
        };
      }
      return { valid: true, convertedValue: trimmed, valueType: 'string' };
    }

    case 'server.transport': {
      const normalized = value.trim().toLowerCase();
      if (!['stdio', 'streamable-http', 'both'].includes(normalized)) {
        return {
          valid: false,
          error: "Transport mode must be 'stdio', 'streamable-http', or 'both'",
        };
      }
      return { valid: true, convertedValue: normalized, valueType: 'string' };
    }

    case 'identity.mode': {
      const normalized = value.trim().toLowerCase();
      if (!['permissive', 'strict', 'locked'].includes(normalized)) {
        return {
          valid: false,
          error: "Identity mode must be 'permissive', 'strict', or 'locked'",
        };
      }
      return { valid: true, convertedValue: normalized, valueType: 'string' };
    }

    case 'gates.frameworkGates':
    case 'gates.methodologyGates':
    case 'gates.enabled':
    case 'gates.enforcePendingVerdict':
    case 'execution.judge':
    case 'frameworks.enabled':
    case 'frameworks.dynamicToolDescriptions':
    case 'frameworks.styleGuidance':
    case 'prompts.registerWithMcp':
    case 'resources.registerWithMcp':
    case 'resources.prompts.defaultRegistration':
    case 'resources.prompts.enabled':
    case 'resources.gates.enabled':
    case 'resources.frameworks.enabled':
    case 'resources.observability.enabled':
    case 'resources.observability.sessions':
    case 'resources.observability.metrics':
    case 'resources.logs.enabled':
    case 'identity.allowPerRequestOverride':
    case 'hooks.expandedOutput':
    case 'verification.isolation.enabled':
    case 'versioning.enabled':
    case 'versioning.auto_version':
    case 'analysis.semanticAnalysis.llmIntegration.enabled': {
      const boolValue = value.trim().toLowerCase();
      if (!['true', 'false'].includes(boolValue)) {
        return {
          valid: false,
          error: "Value must be 'true' or 'false'",
        };
      }
      return {
        valid: true,
        convertedValue: boolValue === 'true',
        valueType: 'boolean',
      };
    }

    case 'identity.launchDefaults.organizationId':
    case 'identity.launchDefaults.workspaceId':
    case 'identity.launchDefaults.clientId':
    case 'identity.launchDefaults.clientVersion': {
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        return {
          valid: false,
          error: 'Value cannot be empty',
        };
      }
      return { valid: true, convertedValue: trimmed, valueType: 'string' };
    }

    case 'identity.launchDefaults.clientFamily': {
      const normalized = value.trim().toLowerCase();
      if (
        !['claude-code', 'codex', 'gemini', 'opencode', 'cursor', 'unknown'].includes(normalized)
      ) {
        return {
          valid: false,
          error:
            "Client family must be 'claude-code', 'codex', 'gemini', 'opencode', 'cursor', or 'unknown'",
        };
      }
      return { valid: true, convertedValue: normalized, valueType: 'string' };
    }

    case 'identity.launchDefaults.delegationProfile': {
      const normalized = value.trim().toLowerCase();
      if (
        ![
          'task_tool_v1',
          'spawn_agent_v1',
          'gemini_subagent_v1',
          'opencode_agent_v1',
          'cursor_agent_v1',
          'neutral_v1',
        ].includes(normalized)
      ) {
        return {
          valid: false,
          error:
            "Delegation profile must be 'task_tool_v1', 'spawn_agent_v1', 'gemini_subagent_v1', 'opencode_agent_v1', 'cursor_agent_v1', or 'neutral_v1'",
        };
      }
      return { valid: true, convertedValue: normalized, valueType: 'string' };
    }

    case 'frameworks.systemPromptFrequency': {
      const freq = parseInt(value, 10);
      if (isNaN(freq) || freq < 1 || freq > 100) {
        return {
          valid: false,
          error: 'Frequency must be a number between 1-100',
        };
      }
      return { valid: true, convertedValue: freq, valueType: 'number' };
    }

    case 'verification.inContextAttempts': {
      const attempts = parseInt(value, 10);
      if (isNaN(attempts) || attempts < 1 || attempts > 10) {
        return {
          valid: false,
          error: 'In-context attempts must be a number between 1-10',
        };
      }
      return { valid: true, convertedValue: attempts, valueType: 'number' };
    }

    case 'verification.isolation.timeout': {
      const timeout = parseInt(value, 10);
      if (isNaN(timeout) || timeout < 30 || timeout > 3600) {
        return {
          valid: false,
          error: 'Timeout must be a number between 30-3600 seconds',
        };
      }
      return { valid: true, convertedValue: timeout, valueType: 'number' };
    }

    case 'verification.isolation.maxBudget': {
      const budget = parseFloat(value);
      if (isNaN(budget) || budget < 0.01) {
        return {
          valid: false,
          error: 'maxBudget must be a number >= 0.01 (USD)',
        };
      }
      return { valid: true, convertedValue: budget, valueType: 'number' };
    }

    case 'verification.isolation.permissionMode': {
      const normalized = value.trim().toLowerCase();
      if (!['delegate', 'ask', 'deny'].includes(normalized)) {
        return {
          valid: false,
          error: "Permission mode must be 'delegate', 'ask', or 'deny'",
        };
      }
      return { valid: true, convertedValue: normalized, valueType: 'string' };
    }

    case 'versioning.max_versions': {
      const maxVersions = parseInt(value, 10);
      if (isNaN(maxVersions) || maxVersions < 1 || maxVersions > 500) {
        return {
          valid: false,
          error: 'max_versions must be a number between 1-500',
        };
      }
      return { valid: true, convertedValue: maxVersions, valueType: 'number' };
    }

    case 'resources.logs.maxEntries': {
      const maxEntries = parseInt(value, 10);
      if (isNaN(maxEntries) || maxEntries < 50 || maxEntries > 5000) {
        return {
          valid: false,
          error: 'maxEntries must be a number between 50-5000',
        };
      }
      return { valid: true, convertedValue: maxEntries, valueType: 'number' };
    }

    case 'resources.logs.defaultLevel': {
      const normalized = value.trim().toLowerCase();
      if (!['debug', 'info', 'warn', 'error'].includes(normalized)) {
        return {
          valid: false,
          error: "Default log level must be 'debug', 'info', 'warn', or 'error'",
        };
      }
      return { valid: true, convertedValue: normalized, valueType: 'string' };
    }

    case 'logging.level': {
      const normalized = value.trim();
      if (!['debug', 'info', 'warn', 'error'].includes(normalized)) {
        return {
          valid: false,
          error: 'Log level must be: debug, info, warn, or error',
        };
      }
      return { valid: true, convertedValue: normalized, valueType: 'string' };
    }

    case 'analysis.semanticAnalysis.llmIntegration.model': {
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        return {
          valid: false,
          error: 'Model name cannot be empty',
        };
      }
      return { valid: true, convertedValue: trimmed, valueType: 'string' };
    }

    case 'analysis.semanticAnalysis.llmIntegration.endpoint': {
      const trimmed = value.trim();
      return {
        valid: true,
        convertedValue: trimmed.length > 0 ? trimmed : null,
        valueType: 'string',
      };
    }

    case 'analysis.semanticAnalysis.llmIntegration.maxTokens': {
      const tokens = parseInt(value, 10);
      if (isNaN(tokens) || tokens < 1 || tokens > 4000) {
        return {
          valid: false,
          error: 'Max tokens must be a number between 1-4000',
        };
      }
      return { valid: true, convertedValue: tokens, valueType: 'number' };
    }

    case 'analysis.semanticAnalysis.llmIntegration.temperature': {
      const temp = parseFloat(value);
      if (isNaN(temp) || temp < 0 || temp > 2) {
        return {
          valid: false,
          error: 'Temperature must be a number between 0-2',
        };
      }
      return { valid: true, convertedValue: temp, valueType: 'number' };
    }

    case 'prompts.directory':
    case 'gates.directory': {
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        return {
          valid: false,
          error: 'Directory path cannot be empty',
        };
      }
      return { valid: true, convertedValue: trimmed, valueType: 'string' };
    }

    case 'phaseGuards.mode': {
      const normalized = value.trim().toLowerCase();
      if (!['enforce', 'warn', 'off'].includes(normalized)) {
        return {
          valid: false,
          error: "Phase guards mode must be 'enforce', 'warn', or 'off'",
        };
      }
      return { valid: true, convertedValue: normalized, valueType: 'string' };
    }

    case 'phaseGuards.maxRetries': {
      const retries = parseInt(value, 10);
      if (isNaN(retries) || retries < 0 || retries > 5) {
        return {
          valid: false,
          error: 'maxRetries must be a number between 0-5',
        };
      }
      return { valid: true, convertedValue: retries, valueType: 'number' };
    }

    case 'telemetry.enabled':
    case 'telemetry.attributePolicy.businessContext':
    case 'telemetry.attributePolicy.rawCommands':
    case 'telemetry.attributePolicy.rawResponses': {
      const telBoolValue = value.trim().toLowerCase();
      if (!['true', 'false'].includes(telBoolValue)) {
        return {
          valid: false,
          error: "Value must be 'true' or 'false'",
        };
      }
      return {
        valid: true,
        convertedValue: telBoolValue === 'true',
        valueType: 'boolean',
      };
    }

    case 'telemetry.mode': {
      const telMode = value.trim().toLowerCase();
      if (!['off', 'traces', 'full'].includes(telMode)) {
        return {
          valid: false,
          error: "Telemetry mode must be 'off', 'traces', or 'full'",
        };
      }
      return { valid: true, convertedValue: telMode, valueType: 'string' };
    }

    case 'telemetry.exporterEndpoint': {
      const endpoint = value.trim();
      if (endpoint.length === 0) {
        return {
          valid: false,
          error: 'Exporter endpoint cannot be empty',
        };
      }
      return { valid: true, convertedValue: endpoint, valueType: 'string' };
    }

    case 'telemetry.samplingRate': {
      const rate = parseFloat(value);
      if (isNaN(rate) || rate < 0.0 || rate > 1.0) {
        return {
          valid: false,
          error: 'Sampling rate must be a number between 0.0 and 1.0',
        };
      }
      return { valid: true, convertedValue: rate, valueType: 'number' };
    }

    case 'advanced.sessions.timeoutMinutes':
    case 'advanced.sessions.reviewTimeoutMinutes':
    case 'advanced.sessions.cleanupIntervalMinutes': {
      const minutes = parseInt(value, 10);
      if (isNaN(minutes) || minutes < 1 || minutes > 10080) {
        return {
          valid: false,
          error: 'Session timeout must be a number between 1-10080 minutes',
        };
      }
      return { valid: true, convertedValue: minutes, valueType: 'number' };
    }

    default:
      return {
        valid: false,
        error: `Unknown configuration key: ${key}`,
      };
  }
}
