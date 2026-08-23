// @lifecycle canonical - Normalizes prompt data for catalog consumers.
import { createHash } from 'node:crypto';

import type { ConvertedPrompt } from '#engine/execution/types.js';
import type { PromptArgument } from '#shared/types/index.js';

interface PromptCatalogArgument {
  name: string;
  description: string | null;
  required: boolean;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  defaultValue?: unknown;
}

export interface PromptCatalogSummary {
  id: string;
  name: string;
  category: string;
  description: string;
  arguments: PromptCatalogArgument[];
  composerInputArgument: string | null;
  executionType: 'single' | 'chain';
  revision: string;
}

export interface PromptCatalogDetail {
  summary: PromptCatalogSummary;
  userMessageTemplate: string;
  systemMessage: string | null;
}

function normalizeCatalogArgument(argument: PromptArgument): PromptCatalogArgument {
  const normalized: PromptCatalogArgument = {
    name: argument.name,
    description: argument.description ?? null,
    required: argument.required,
    type: argument.type ?? 'string',
  };
  if (argument.defaultValue !== undefined) normalized.defaultValue = argument.defaultValue;
  return normalized;
}

function promptRevision(prompt: ConvertedPrompt): string {
  const content = JSON.stringify({
    id: prompt.id,
    name: prompt.name,
    category: prompt.category,
    description: prompt.description,
    systemMessage: prompt.systemMessage ?? null,
    userMessageTemplate: prompt.userMessageTemplate,
    arguments: prompt.arguments,
    composer: prompt.composer ?? null,
    chainSteps: prompt.chainSteps ?? [],
  });
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

/** Build the transport-independent prompt metadata consumed by catalog adapters. */
export function buildPromptCatalogSummary(prompt: ConvertedPrompt): PromptCatalogSummary {
  return {
    id: prompt.id,
    name: prompt.name,
    category: prompt.category,
    description: prompt.description,
    arguments: prompt.arguments.map(normalizeCatalogArgument),
    composerInputArgument: prompt.composer?.inputArgument ?? null,
    executionType: (prompt.chainSteps?.length ?? 0) > 0 ? 'chain' : 'single',
    revision: promptRevision(prompt),
  };
}

/** Build the detail payload while keeping executable content out of list results. */
export function buildPromptCatalogDetail(prompt: ConvertedPrompt): PromptCatalogDetail {
  return {
    summary: buildPromptCatalogSummary(prompt),
    userMessageTemplate: prompt.userMessageTemplate,
    systemMessage: prompt.systemMessage ?? null,
  };
}
