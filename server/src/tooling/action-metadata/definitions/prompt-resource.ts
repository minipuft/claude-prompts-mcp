// @lifecycle canonical - Prompt resource action metadata for resource_manager.

import {
  resource_managerCommands,
  resource_managerParameters,
} from '../../../tooling/contracts/_generated/resource_manager.generated.js';
import {
  contractToCommandDescriptors,
  contractToParameterDescriptors,
} from '../../contracts/adapter.js';

import type {
  PromptResourceMetadataData,
  ToolMetadata,
  ParameterDescriptor,
  CommandDescriptor,
} from './types.js';
import type { resource_managerParamName } from '../../../tooling/contracts/_generated/resource_manager.generated.js';

const promptResourceActions = [
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

export type PromptResourceActionId = (typeof promptResourceActions)[number]['id'];

const promptResourceContract = {
  tool: 'resource_manager',
  version: 1,
  summary:
    'Prompt lifecycle management via resource_manager (create, update, list, analyze, reload, delete). One action per call—include resource_type:"prompt" plus the fields for that operation.',
  parameters: resource_managerParameters,
  commands: resource_managerCommands,
};

const PROMPT_RESOURCE_PARAMETER_NAMES: resource_managerParamName[] = [
  'resource_type',
  'action',
  'id',
  'name',
  'description',
  'category',
  'user_message_template',
  'system_message',
  'arguments',
  'chain_steps',
  'tools',
  'gate_configuration',
  'execution_hint',
  'section',
  'section_content',
  'filter',
  'format',
  'detail',
  'search_query',
  'confirm',
  'reason',
  'version',
  'from_version',
  'to_version',
  'skip_version',
  'limit',
];

const parameterDescriptors: ParameterDescriptor<resource_managerParamName>[] =
  contractToParameterDescriptors<resource_managerParamName>(promptResourceContract).filter(
    (param) => PROMPT_RESOURCE_PARAMETER_NAMES.includes(param.name)
  );

const commandDescriptors: CommandDescriptor[] = contractToCommandDescriptors(
  promptResourceContract
).filter((command) => command.id.startsWith('prompt:'));

export const promptResourceMetadata: ToolMetadata<PromptResourceMetadataData> = {
  tool: 'resource_manager',
  version: 1,
  notes: [
    'Parameters sourced from contracts/_generated/resource_manager.generated.ts.',
    'Actions inventory maintained for prompt-specific guide and telemetry.',
    'Requires resource_type:"prompt" on all calls.',
  ],
  data: {
    actions: promptResourceActions,
    parameters: parameterDescriptors,
    commands: commandDescriptors,
  },
};
