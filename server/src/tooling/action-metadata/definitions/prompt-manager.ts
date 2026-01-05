// @lifecycle canonical - Prompt manager action metadata definitions.
import {
  prompt_managerCommands,
  prompt_managerParameters,
} from '../../../tooling/contracts/_generated/prompt_manager.generated.js';
import {
  contractToCommandDescriptors,
  contractToParameterDescriptors,
} from '../../contracts/adapter.js';

import type { PromptManagerMetadataData, ToolMetadata, ParameterDescriptor } from './types.js';
import type { prompt_managerParamName } from '../../../tooling/contracts/_generated/prompt_manager.generated.js';

const promptManagerActions = [
  {
    id: 'create',
    displayName: 'Create Prompt',
    category: 'lifecycle',
    status: 'working',
    requiredArgs: ['id', 'name', 'description', 'user_message_template'],
    description: 'Create or overwrite a prompt or chain with gate_configuration inline.',
    issues: [],
  },
  {
    id: 'update',
    displayName: 'Update Prompt',
    category: 'lifecycle',
    status: 'working',
    requiredArgs: ['id'],
    description: 'Full metadata replacement including gate_configuration.',
  },
  {
    id: 'delete',
    displayName: 'Delete Prompt',
    category: 'lifecycle',
    status: 'working',
    requiredArgs: ['id'],
    description: 'Removes prompt and cleans empty categories.',
  },
  {
    id: 'list',
    displayName: 'List Prompts',
    category: 'discovery',
    status: 'working',
    requiredArgs: [],
    description: 'Filter/search interface powered by semantic analyzer.',
  },
  {
    id: 'reload',
    displayName: 'Reload Prompts',
    category: 'operations',
    status: 'working',
    requiredArgs: [],
    description: 'Hot reload or full restart of prompt registry.',
  },
  {
    id: 'inspect',
    displayName: 'Inspect Prompt',
    category: 'discovery',
    status: 'working',
    requiredArgs: ['id'],
    description: 'Display prompt details, arguments, gates, and chain steps for a single prompt.',
    issues: [],
  },
  {
    id: 'analyze_type',
    displayName: 'Analyze Prompt Type',
    category: 'analysis',
    status: 'working',
    requiredArgs: ['id'],
    description:
      'Runs semantic analyzer to recommend single vs chain execution with % modifier hints.',
  },
  {
    id: 'analyze_gates',
    displayName: 'Analyze Gates',
    category: 'analysis',
    status: 'working',
    requiredArgs: ['id'],
    description: 'Suggests gate configurations via GateAnalyzer.',
  },
  {
    id: 'guide',
    displayName: 'Guide',
    category: 'discovery',
    status: 'working',
    requiredArgs: [],
    description:
      'Explains available actions, expected arguments, and known risks using metadata-driven summaries.',
  },
  {
    id: 'history',
    displayName: 'Version History',
    category: 'versioning',
    status: 'working',
    requiredArgs: ['id'],
    description:
      'View version history for a prompt. Shows past versions with timestamps and diffs.',
  },
  {
    id: 'rollback',
    displayName: 'Rollback Version',
    category: 'versioning',
    status: 'working',
    requiredArgs: ['id', 'version'],
    description:
      'Rollback a prompt to a previous version. Requires confirm:true. Current state is saved before rollback.',
  },
  {
    id: 'compare',
    displayName: 'Compare Versions',
    category: 'versioning',
    status: 'working',
    requiredArgs: ['id', 'from_version', 'to_version'],
    description: 'Compare two versions of a prompt showing unified diff between snapshots.',
  },
] as const;

export type PromptManagerActionId = (typeof promptManagerActions)[number]['id'];

const promptManagerContract = {
  tool: 'prompt_manager',
  version: 1,
  summary:
    'Prompt and chain lifecycle management (create, update, list, analyze, reload, delete). One action per call—include `action` plus the fields for that operation.',
  parameters: prompt_managerParameters,
  commands: prompt_managerCommands,
};

const parameterDescriptors: ParameterDescriptor<prompt_managerParamName>[] =
  contractToParameterDescriptors<prompt_managerParamName>(promptManagerContract);

const commandDescriptors = contractToCommandDescriptors(promptManagerContract);

export const promptManagerMetadata: ToolMetadata<PromptManagerMetadataData> = {
  tool: 'prompt_manager',
  version: 1, // Matches contract version
  notes: [
    'Parameters sourced from contracts/_generated.',
    'Actions inventory maintained separately for guide/telemetry.',
  ],
  data: {
    actions: promptManagerActions,
    parameters: parameterDescriptors,
    commands: commandDescriptors,
  },
};
