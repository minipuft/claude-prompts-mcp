// @lifecycle canonical - Pre-emission contract rendering for methodology phase guards.
/**
 * Output Contract Rendering
 *
 * Pure-function counterpart to phase-guard-evaluator.ts:
 *  - phase-guard-evaluator.ts validates output POST-emission against phase guards.
 *  - output-contract.ts renders the same contract as a skeleton PRE-emission so
 *    the model sees the required structure before writing.
 *
 * Both consume the same ProcessingStep[] SSOT from phases.yaml.
 */

import type { ProcessingStep } from '../types/methodology-types.js';

/**
 * The structural contract a model must satisfy when emitting output under a
 * methodology. Derived from a methodology's processingSteps where each step
 * declares both a section_header and guards.
 */
export interface OutputContract {
  headers: ContractHeader[];
}

export interface ContractHeader {
  header: string;
  required: boolean;
  minLength?: number;
  maxLength?: number;
  forbiddenTerms?: string[];
  containsAny?: string[];
  containsAll?: string[];
}

/**
 * Extract the structural contract from a methodology's processing steps.
 * Phases without both a section_header AND guards are excluded — they have
 * no enforceable contract and shouldn't be rendered as requirements.
 *
 * Returns null when no enforceable contract exists (e.g., methodology has no
 * guarded phases, or the methodology argument is undefined).
 */
export function getOutputContract(phases: ProcessingStep[] | undefined): OutputContract | null {
  if (phases === undefined || phases.length === 0) {
    return null;
  }

  const headers = phases
    .map(phaseToContractHeader)
    .filter((header): header is ContractHeader => header !== null);

  return headers.length === 0 ? null : { headers };
}

function phaseToContractHeader(phase: ProcessingStep): ContractHeader | null {
  if (phase.section_header === undefined || phase.guards === undefined) {
    return null;
  }
  const { guards } = phase;
  return {
    header: phase.section_header,
    required: guards.required === true,
    ...(guards.min_length !== undefined && { minLength: guards.min_length }),
    ...(guards.max_length !== undefined && { maxLength: guards.max_length }),
    ...nonEmptyCopy('forbiddenTerms', guards.forbidden_terms),
    ...nonEmptyCopy('containsAny', guards.contains_any),
    ...nonEmptyCopy('containsAll', guards.contains_all),
  };
}

function nonEmptyCopy<K extends string>(
  key: K,
  value: readonly string[] | undefined
): { [P in K]?: string[] } {
  if (value === undefined || value.length === 0) {
    return {};
  }
  return { [key]: [...value] } as { [P in K]: string[] };
}

/**
 * Render an OutputContract as a markdown skeleton suitable for direct
 * concatenation into a step prompt. Caller decides placement and surrounding
 * separators.
 *
 * The skeleton tells the model:
 *  - Exact section headers to emit (verbatim)
 *  - Whether each section is required or optional
 *  - Length expectations
 *  - Forbidden terms (so it doesn't use placeholders)
 *  - Keyword hints when defined
 */
export function renderOutputContractSkeleton(contract: OutputContract): string {
  if (contract.headers.length === 0) {
    return '';
  }

  const lines: string[] = [
    '## Required Output Structure',
    '',
    'Your response must include the following sections, in order:',
    '',
  ];

  for (const header of contract.headers) {
    lines.push(renderHeaderLine(header));
  }

  lines.push('');
  lines.push(
    'Use these section headers verbatim (e.g. `## Context`). Sections marked required must be present; optional sections may be omitted if not applicable.'
  );

  return lines.join('\n');
}

function renderHeaderLine(header: ContractHeader): string {
  const tags = buildHeaderTags(header);
  const constraints = buildHeaderConstraints(header);

  const parts: string[] = [`- **${header.header}**`, `(${tags.join(', ')})`];
  if (constraints.length > 0) {
    parts.push(`— ${constraints.join('; ')}`);
  }
  return parts.join(' ');
}

function buildHeaderTags(header: ContractHeader): string[] {
  const tags: string[] = [header.required ? 'required' : 'optional'];
  if (header.minLength !== undefined) {
    tags.push(`min ${header.minLength} chars`);
  }
  if (header.maxLength !== undefined) {
    tags.push(`max ${header.maxLength} chars`);
  }
  return tags;
}

function buildHeaderConstraints(header: ContractHeader): string[] {
  const constraints: string[] = [];
  if (header.containsAny !== undefined && header.containsAny.length > 0) {
    constraints.push(`must mention at least one of: ${quoteList(header.containsAny)}`);
  }
  if (header.containsAll !== undefined && header.containsAll.length > 0) {
    constraints.push(`must include all of: ${quoteList(header.containsAll)}`);
  }
  if (header.forbiddenTerms !== undefined && header.forbiddenTerms.length > 0) {
    constraints.push(`do not use: ${quoteList(header.forbiddenTerms)}`);
  }
  return constraints;
}

function quoteList(items: string[]): string {
  return items.map((item) => `\`${item}\``).join(', ');
}
