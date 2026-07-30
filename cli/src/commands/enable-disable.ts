import { output } from '../lib/output.js';
import { setConfigValue, readConfig, getConfigValue } from '@cli-shared/config-operations.js';

interface EnableDisableOptions {
  workspace?: string;
  json: boolean;
  action: 'enable' | 'disable';
  subsystem?: string;
}

/**
 * Maps user-friendly subsystem names to their config mode key.
 * Each entry: [configKey, description]
 */
const SUBSYSTEM_MAP: Record<string, [string, string]> = {
  gates: ['gates.mode', 'Quality gates'],
  frameworks: ['frameworks.mode', 'Framework system'],
  resources: ['resources.mode', 'MCP resource registration'],
  'resources.prompts': ['resources.prompts.mode', 'Prompt resources'],
  'resources.gates': ['resources.gates.mode', 'Gate resources'],
  'resources.frameworks': ['resources.frameworks.mode', 'Framework resources'],
  'resources.observability': ['resources.observability.mode', 'Observability resources'],
  'resources.logs': ['resources.logs.mode', 'Log resources'],
  verification: ['verification.isolation.mode', 'Verification isolation'],
  analysis: ['analysis.semanticAnalysis.llmIntegration.mode', 'LLM semantic analysis'],
};

function resolveWorkspace(workspace?: string): string {
  return workspace ?? process.env['MCP_WORKSPACE'] ?? process.cwd();
}

export async function enableDisable(options: EnableDisableOptions): Promise<number> {
  const { action, subsystem, json } = options;

  if (!subsystem) {
    if (json) {
      output({ error: 'Missing subsystem name', subsystems: Object.keys(SUBSYSTEM_MAP) }, { json: true });
    } else {
      console.error(`Usage: cpm ${action} <subsystem>\n`);
      console.error('Available subsystems:');
      for (const [name, [key, desc]] of Object.entries(SUBSYSTEM_MAP)) {
        console.error(`  ${name.padEnd(26)} ${desc} (${key})`);
      }
    }
    return 1;
  }

  const entry = SUBSYSTEM_MAP[subsystem];
  if (!entry) {
    if (json) {
      output({ error: `Unknown subsystem: ${subsystem}`, subsystems: Object.keys(SUBSYSTEM_MAP) }, { json: true });
    } else {
      console.error(`Unknown subsystem: ${subsystem}\n`);
      console.error('Available subsystems:');
      for (const [name, , ] of Object.entries(SUBSYSTEM_MAP)) {
        console.error(`  ${name}`);
      }
    }
    return 1;
  }

  const [configKey, description] = entry;
  const ws = resolveWorkspace(options.workspace);
  const targetValue = action === 'enable' ? 'on' : 'off';

  // Check current value first
  const readResult = readConfig(ws);
  if (readResult.success && readResult.config) {
    const current = getConfigValue(readResult.config, configKey);
    if (current === targetValue) {
      if (json) {
        output({ subsystem, key: configKey, value: targetValue, changed: false, message: `Already ${action}d` }, { json: true });
      } else {
        console.log(`${description} already ${action}d (${configKey} = ${targetValue})`);
      }
      return 0;
    }
  }

  const result = setConfigValue(ws, configKey, targetValue);

  if (!result.success) {
    if (json) {
      output({ error: result.error, subsystem, key: configKey }, { json: true });
    } else {
      console.error(`Failed to ${action} ${subsystem}: ${result.error}`);
    }
    return 1;
  }

  if (json) {
    output({
      subsystem,
      key: configKey,
      value: targetValue,
      previousValue: result.previousValue,
      changed: true,
      restartRequired: result.restartRequired,
    }, { json: true });
  } else {
    console.log(`${action === 'enable' ? 'Enabled' : 'Disabled'} ${description} (${configKey} = ${targetValue})`);
    if (result.restartRequired) {
      console.log('\nNote: This change requires a server restart to take effect.');
    }
  }

  return 0;
}
