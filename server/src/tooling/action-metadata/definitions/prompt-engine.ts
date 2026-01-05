// @lifecycle canonical - Prompt engine action metadata definitions.
import {
  prompt_engineCommands,
  prompt_engineParameters,
} from '../../../tooling/contracts/_generated/prompt_engine.generated.js';
import {
  contractToCommandDescriptors,
  contractToParameterDescriptors,
} from '../../contracts/adapter.js';

import type {
  PromptEngineMetadataData,
  ToolMetadata,
  ParameterDescriptor,
  CommandDescriptor,
  UsagePatternDescriptor,
} from './types.js';
import type { McpToolRequest } from '../../../types/execution.js';

type RequestField = keyof McpToolRequest;

const promptEngineContract = {
  tool: 'prompt_engine',
  version: 1,
  summary:
    'Execute prompts/chains with inline operators. Steps must start with `>>prompt_id` (or `/prompt_id`); place modifiers first: `%judge @Framework #style :: gates`.',
  parameters: prompt_engineParameters,
  commands: prompt_engineCommands,
};

// Parameter-specific issues (only track actual problems, not documentation)
const issuesByParam: Partial<Record<RequestField, ParameterDescriptor<RequestField>['issues']>> = {
  // No active issues - parameters are working as designed
};

const generatedParameters = contractToParameterDescriptors<RequestField>(promptEngineContract).map(
  (param) => {
    const issues = issuesByParam[param.name];
    if (!issues) {
      return param;
    }

    return {
      ...param,
      issues,
    };
  }
) satisfies ParameterDescriptor<RequestField>[];

// Parameters from contracts plus any manually tracked deprecated params
const parameterDescriptors: ParameterDescriptor<RequestField>[] = [...generatedParameters];

const commandDescriptors: CommandDescriptor[] = [
  ...contractToCommandDescriptors(promptEngineContract),
  {
    id: '>>listprompts',
    status: 'working',
    description: 'Routes to prompt_manager list action. Accepts optional search terms.',
    issues: [],
  },
];

const usagePatterns: UsagePatternDescriptor<RequestField>[] = [
  {
    id: 'combined-operators',
    title: 'Combined Modifiers Chain',
    summary:
      'Show correct operator order: modifiers first, prompt ids on every step, quoted free text after the prompt id.',
    sampleCommand: [
      'prompt_engine({',
      '  "command": "%judge @CAGEERF #analytical >>analytical \\"overview\\" --> >>procedural \\"edge cases\\" --> >>creative \\"JSON summary\\" :: framework-compliance :: technical-accuracy"',
      '})',
    ].join('\n'),
    parameters: ['command'],
    notes: [
      'Modifiers (%judge/@/#style/::) apply to the whole chain—keep them at the front.',
      'Each step must start with `>>prompt_id` (or `/prompt_id`); avoid plain-text step labels.',
      'Execution shape: command (+optional gates/options); resume shape: chain_id plus user_response and/or gate_verdict/gate_action.',
    ],
  },
  {
    id: 'inline-criteria',
    title: 'Inline Quality Criteria (Simplest)',
    summary:
      'Use the `::` operator to add validation criteria directly in commands as natural language. Simple, flexible, and requires no setup.',
    sampleCommand: [
      '// Simple single prompt with criteria',
      'prompt_engine({',
      '  "command": ">>audit_plan topic:\\"security\\" :: \\"cite two examples, list mitigations, flag open questions\\""',
      '})',
      '',
      '// Chain with criteria applied to steps',
      'prompt_engine({',
      '  "command": ">>analysis --> summary :: \\"include sources, note confidence levels\\""',
      '})',
      '',
      '// Multiple criteria',
      'prompt_engine({',
      '  "command": ">>code_review :: \\"check naming conventions, verify error handling, confirm tests\\" -->"',
      '})',
    ].join('\n'),
    parameters: ['command'],
    notes: [
      'Provide clear, actionable criteria as natural language text - the system automatically creates validation guidance.',
      'Works with single prompts and chains - criteria apply to all steps in a chain.',
      'Most flexible approach - adjust criteria per execution without configuration.',
      'For reusable validation with complex configurations, use the `gates` parameter instead.',
    ],
  },
  {
    id: 'unified-gates',
    title: 'Unified Gates Parameter (Recommended)',
    summary:
      'Use the new `gates` parameter to specify all types of validation in a single array. Accepts gate IDs, simple checks, and full gate definitions.',
    sampleCommand: [
      '// Mix gate IDs, simple checks, and full definitions',
      'prompt_engine({',
      '  "command": ">>prompt security-review",',
      '  "gates": [',
      '    "toxicity",                                    // Gate ID reference',
      '    "traceability",                                // Gate ID reference',
      '    { "name": "red-team", "description": "Confirm exfil path" },  // Simple check',
      '    { "id": "gdpr-check", "criteria": ["no PII"], "severity": "high" }  // Full definition',
      '  ]',
      '})',
      '',
      '// Chain with step-specific gates',
      'prompt_engine({',
      '  "command": ">>analysis --> review --> summary",',
      '  "gates": [',
      '    "research-quality",                            // Applies to all steps',
      '    { "id": "step2-only", "criteria": ["cite sources"], "target_step_number": 2 },',
      '    { "id": "final-steps", "criteria": ["verify conclusions"], "apply_to_steps": [2, 3] }',
      '  ]',
      '})',
    ].join('\n'),
    parameters: ['command', 'gates'],
    notes: [
      'Canonical parameter for all gate specification (v3.0.0+).',
      'Accepts mixed array: gate ID strings, simple name/description objects, or full gate definitions.',
      'In chain executions, use target_step_number or apply_to_steps to control which steps gates apply to.',
      'Without step targeting, gates default to current step (step 1 for new chains, resume step for resumed chains).',
    ],
  },
  {
    id: 'chain-resume',
    title: 'Chain Resume & Restart',
    summary:
      'Resume an interrupted chain with chain_id, feed a user response, or force a restart from the first step.',
    sampleCommand: [
      'prompt_engine({',
      '  "chain_id": "chain-threat-model#3",',
      '  "user_response": "Proceed with mitigations A and B."',
      '})',
    ].join('\n'),
    parameters: ['command', 'chain_id', 'user_response', 'force_restart'],
    notes: [
      'Use gate_verdict when resuming after manual reviews.',
      'Setting force_restart:true ignores previously cached steps even if chain_id is present.',
    ],
  },
  {
    id: 'prompt-catalog',
    title: 'Prompt Catalog Discovery',
    summary:
      'Route list commands back to the prompt manager for semantic filtering, even when invoked from prompt engine.',
    sampleCommand: ['prompt_engine({', '  "command": ">>listprompts security audits"', '})'].join(
      '\n'
    ),
    parameters: ['command'],
    notes: [
      'Routing pattern handled before prompt execution; falls back to in-memory catalog if prompt_manager is offline.',
      'Use search terms after >>listprompts to limit results (e.g., `>>listprompts security`).',
    ],
  },
];

export const promptEngineMetadata: ToolMetadata<PromptEngineMetadataData> = {
  tool: 'prompt_engine',
  version: 1, // Matches contract version
  notes: [
    'Parameters sourced from contracts/_generated and McpToolRequest interface.',
    'Use this data to seed telemetry and guide flows.',
    'Unified gates parameter is canonical for all gate specification.',
  ],
  issues: [
    // No active issues - system is stable
  ],
  data: {
    parameters: parameterDescriptors,
    commands: commandDescriptors,
    usagePatterns,
  },
};
