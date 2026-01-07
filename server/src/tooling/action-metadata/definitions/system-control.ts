// @lifecycle canonical - System control action metadata definitions.
import {
  system_controlCommands,
  system_controlParameters,
} from '../../../tooling/contracts/_generated/system_control.generated.js';
import {
  contractToCommandDescriptors,
  contractToParameterDescriptors,
} from '../../contracts/adapter.js';

import type {
  ToolMetadata,
  SystemControlMetadataData,
  ActionDescriptor,
  ParameterDescriptor,
} from './types.js';
import type { system_controlParamName } from '../../../tooling/contracts/_generated/system_control.generated.js';

const operations: ActionDescriptor[] = [
  {
    id: 'status',
    displayName: 'System Status',
    category: 'status',
    status: 'working',
    requiredArgs: [],
    description: 'Reports framework enablement, uptime, and execution metrics.',
  },
  {
    id: 'framework:list',
    displayName: 'List Frameworks',
    category: 'framework',
    status: 'working',
    requiredArgs: [],
    description: 'Enumerates available frameworks with optional details.',
  },
  {
    id: 'framework:switch',
    displayName: 'Switch Framework',
    category: 'framework',
    status: 'working',
    requiredArgs: ['framework'],
    description: 'Changes active methodology via framework manager.',
  },
  {
    id: 'framework:enable',
    displayName: 'Enable Framework System',
    category: 'framework',
    status: 'working',
    requiredArgs: [],
    description: 'Turns on methodology injection globally.',
  },
  {
    id: 'framework:disable',
    displayName: 'Disable Framework System',
    category: 'framework',
    status: 'working',
    requiredArgs: [],
    description: 'Turns off methodology injection globally.',
  },
  {
    id: 'gates:list',
    displayName: 'List Gates',
    category: 'gates',
    status: 'working',
    requiredArgs: [],
    description: 'Displays registered quality gates via GateSystemManager.',
  },
  {
    id: 'analytics:view',
    displayName: 'View Analytics',
    category: 'analytics',
    status: 'working',
    requiredArgs: [],
    description: 'Returns execution analytics from MetricsCollector.',
  },
  {
    id: 'analytics:history',
    displayName: 'Analytics History',
    category: 'analytics',
    status: 'working',
    requiredArgs: [],
    description: 'Returns framework switch history.',
  },
  {
    id: 'analytics:reset',
    displayName: 'Reset Analytics',
    category: 'analytics',
    status: 'working',
    requiredArgs: ['confirm'],
    description: 'Clears analytics data (requires confirmation).',
  },
  {
    id: 'config',
    displayName: 'Config Operations',
    category: 'config',
    status: 'working',
    requiredArgs: [],
    description: 'Manage server configuration (get, set, restore).',
  },
  {
    id: 'maintenance',
    displayName: 'Maintenance',
    category: 'maintenance',
    status: 'working',
    requiredArgs: [],
    description: 'Server maintenance tasks (restart). Cleanup and diagnostics planned.',
  },
  {
    id: 'guide',
    displayName: 'Guide',
    category: 'discovery',
    status: 'working',
    requiredArgs: [],
    description:
      'Summarizes available operations (status/framework/gates/analytics/config/maintenance) with lifecycle cues.',
  },
  {
    id: 'injection:status',
    displayName: 'Injection Status',
    category: 'injection',
    status: 'working',
    requiredArgs: [],
    description: 'Shows injection config, active overrides, and session state.',
  },
  {
    id: 'injection:override',
    displayName: 'Injection Override',
    category: 'injection',
    status: 'working',
    requiredArgs: ['type'],
    description:
      'Set temporary session override for injection type (system-prompt, gate-guidance, style-guidance).',
  },
  {
    id: 'injection:reset',
    displayName: 'Injection Reset',
    category: 'injection',
    status: 'working',
    requiredArgs: [],
    description: 'Clear all session overrides for injection control.',
  },
  {
    id: 'session:list',
    displayName: 'List Sessions',
    category: 'session',
    status: 'working',
    requiredArgs: [],
    description: 'List active chain sessions.',
  },
  {
    id: 'session:clear',
    displayName: 'Clear Session',
    category: 'session',
    status: 'working',
    requiredArgs: ['session_id'],
    description: 'Clear a specific session or chain history.',
  },
  {
    id: 'session:inspect',
    displayName: 'Inspect Session',
    category: 'session',
    status: 'working',
    requiredArgs: ['session_id'],
    description: 'Inspect session details.',
  },
];

export const SYSTEM_CONTROL_ACTION_IDS = [
  'status',
  'framework',
  'gates',
  'analytics',
  'config',
  'maintenance',
  'guide',
  'injection',
  'session',
] as const;

export type SystemControlActionId = (typeof SYSTEM_CONTROL_ACTION_IDS)[number];

const systemControlContract = {
  tool: 'system_control',
  version: 1,
  summary:
    'Runtime administration (status, framework, analytics, diagnostics). One action per call—set `action` and required fields; chain admin steps with separate calls.',
  parameters: system_controlParameters,
  commands: system_controlCommands,
};

const parameterDescriptors: ParameterDescriptor<system_controlParamName>[] =
  contractToParameterDescriptors<system_controlParamName>(systemControlContract);

const commandDescriptors = contractToCommandDescriptors(systemControlContract);

export const systemControlMetadata: ToolMetadata<SystemControlMetadataData> = {
  tool: 'system_control',
  version: 1, // Matches contract version
  notes: [
    'Parameters sourced from contracts/_generated.',
    'Operations inventory maintained separately for guide/telemetry.',
  ],
  data: {
    operations,
    parameters: parameterDescriptors,
    commands: commandDescriptors,
  },
};
