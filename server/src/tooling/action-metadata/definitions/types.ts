// @lifecycle canonical - Type definitions for action metadata.
export type LifecycleStatus =
  | 'working'
  | 'needs-structure'
  | 'needs-parameter'
  | 'needs-context'
  | 'routing_issue'
  | 'display-gap'
  | 'needs-validation'
  | 'needs-visuals'
  | 'planned'
  | 'untested'
  | 'deprecated'
  | 'hidden'
  | 'experimental';

export type IssueSeverity = 'info' | 'warning' | 'high';

export interface IssueDescriptor {
  readonly severity: IssueSeverity;
  readonly summary: string;
  readonly details: string;
}

export interface ActionDescriptor {
  readonly id: string;
  readonly displayName: string;
  readonly category: string;
  readonly status: LifecycleStatus;
  readonly requiredArgs: readonly string[];
  readonly description: string;
  readonly issues?: readonly IssueDescriptor[];
}

export interface ParameterDescriptor<Name extends string = string> {
  readonly name: Name;
  readonly status: LifecycleStatus;
  readonly description: string;
  readonly issues?: readonly IssueDescriptor[];
}

export interface CommandDescriptor {
  readonly id: string;
  readonly status: LifecycleStatus;
  readonly description: string;
  readonly issues?: readonly IssueDescriptor[];
}

export interface UsagePatternDescriptor<ParamName extends string = string> {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly sampleCommand: string;
  readonly parameters: readonly ParamName[];
  readonly notes?: readonly string[];
}

export interface ToolMetadata<T = Record<string, unknown>> {
  readonly tool: string;
  readonly version: number;
  readonly notes?: readonly string[];
  readonly issues?: readonly IssueDescriptor[];
  readonly data: T;
}

export interface PromptManagerMetadataData {
  readonly actions: readonly ActionDescriptor[];
  readonly parameters?: readonly ParameterDescriptor[];
  readonly commands?: readonly CommandDescriptor[];
}

export interface PromptEngineMetadataData {
  readonly parameters: readonly ParameterDescriptor[];
  readonly commands: readonly CommandDescriptor[];
  readonly usagePatterns: readonly UsagePatternDescriptor[];
}

export interface SystemControlMetadataData {
  readonly operations: readonly ActionDescriptor[];
  readonly parameters?: readonly ParameterDescriptor[];
  readonly commands?: readonly CommandDescriptor[];
}
