import { output } from '../lib/output.js';
import { setConfigValue, readConfig, getConfigValue } from '@cli-shared/config-operations.js';

interface EnableDisableOptions {
  workspace?: string;
  json: boolean;
  action: 'enable' | 'disable';
  subsystem?: string;
}

/**
 * Maps user-friendly subsystem names to the config key the runtime actually reads.
 * Each entry: [configKey, description]
 *
 * Every entry here used to name a `*.mode` key holding `"on"`/`"off"`. No reader consulted any of
 * them — the runtime reads the boolean below — and the write path assigns dot-keys verbatim, so
 * this command reported success and changed nothing for all ten subsystems. `resources` maps to
 * `registerWithMcp` rather than `enabled` because `ResourcesConfig` has no top-level `enabled`;
 * `registerWithMcp` is that section's master switch.
 */
const SUBSYSTEM_MAP: Record<string, [string, string]> = {
  gates: ['gates.enabled', 'Quality gates'],
  frameworks: ['frameworks.enabled', 'Framework system'],
  resources: ['resources.registerWithMcp', 'MCP resource registration'],
  'resources.prompts': ['resources.prompts.enabled', 'Prompt resources'],
  'resources.gates': ['resources.gates.enabled', 'Gate resources'],
  'resources.frameworks': ['resources.frameworks.enabled', 'Framework resources'],
  'resources.observability': ['resources.observability.enabled', 'Observability resources'],
  'resources.logs': ['resources.logs.enabled', 'Log resources'],
  verification: ['verification.isolation.enabled', 'Verification isolation'],
  analysis: ['analysis.semanticAnalysis.llmIntegration.enabled', 'LLM semantic analysis'],
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
  // These keys are booleans in config.json. `setConfigValue` takes the raw string a user would
  // type and parses it, so 'true'/'false' is what goes in; `targetState` is what comes back out.
  const targetState = action === 'enable';
  const targetValue = String(targetState);

  // Check current value first
  const readResult = readConfig(ws);
  if (readResult.success && readResult.config) {
    const current = getConfigValue(readResult.config, configKey);
    if (current === targetState) {
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
