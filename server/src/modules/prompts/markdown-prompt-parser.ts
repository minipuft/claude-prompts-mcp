// @lifecycle canonical - Pure parsing functions for markdown-format prompt files.
/**
 * Markdown Prompt Parser
 *
 * Extracts structured prompt data from markdown-format prompt files.
 * All functions are pure (no I/O, no state) — they operate on string content only.
 *
 * Extracted from PromptLoader.loadPromptFile() to reduce loader.ts file size.
 */

import {
  type InlineGateSource,
  type LoadedPromptFile,
  normalizeInlineGateDefinitions,
} from './yaml-prompt-loader.js';

// Re-export for consumer convenience
export type { LoadedPromptFile };

type GateConfiguration = NonNullable<LoadedPromptFile['gateConfiguration']>;
type ChainStep = NonNullable<LoadedPromptFile['chainSteps']>[number];

/**
 * Extract system message and user message template sections from markdown content.
 */
export function extractMarkdownSections(content: string): {
  systemMessage?: string;
  userMessageTemplate: string;
  gateConfigMatch: RegExpMatchArray | null;
  chainMatch: RegExpMatchArray | null;
} {
  const systemMessageMatch = content.match(/## System Message\s*\n([\s\S]*?)(?=\n##|$)/);
  const userMessageMatch = content.match(/## User Message Template\s*\n([\s\S]*)$/);
  const gateConfigMatch = content.match(/## Gate Configuration\s*\n```json\s*\n([\s\S]*?)\n```/);
  const chainMatch = content.match(/## Chain Steps\s*\n([\s\S]*?)(?=\n##|$)/);

  return {
    systemMessage: systemMessageMatch?.[1]?.trim(),
    userMessageTemplate: userMessageMatch?.[1]?.trim() ?? '',
    gateConfigMatch,
    chainMatch,
  };
}

/**
 * Parse gate configuration from a regex match of a JSON code block.
 *
 * Handles both array format (["gate1", "gate2"]) and object format
 * ({ include: [...], exclude: [...], framework_gates: true, inline_gate_definitions: [...] }).
 *
 * Returns undefined if the match is null or parsing fails.
 */
export function parseGateConfiguration(
  gateConfigMatch: RegExpMatchArray | null,
  // No default value: a defaulted parameter counts as a branch, and this function already
  // measures cyclomatic 12 against a limit of 10. The callee defaults it instead.
  origin?: InlineGateSource
): GateConfiguration | undefined {
  if (!gateConfigMatch) return undefined;

  const gateConfigContent = gateConfigMatch[1]?.trim();
  if (!gateConfigContent) return undefined;

  const parsedConfig = JSON.parse(gateConfigContent);

  if (Array.isArray(parsedConfig)) {
    return {
      include: parsedConfig,
      framework_gates: true,
    };
  }

  if (typeof parsedConfig === 'object' && parsedConfig !== null) {
    const normalized: GateConfiguration = {};

    if (Array.isArray(parsedConfig.include)) {
      normalized.include = parsedConfig.include;
    }
    if (Array.isArray(parsedConfig.exclude)) {
      normalized.exclude = parsedConfig.exclude;
    }
    if (typeof parsedConfig.framework_gates === 'boolean') {
      normalized.framework_gates = parsedConfig.framework_gates;
    }

    const inlineGateDefinitions = normalizeInlineGateDefinitions(
      parsedConfig.inline_gate_definitions,
      origin
    );
    if (inlineGateDefinitions) {
      normalized.inline_gate_definitions = inlineGateDefinitions;
    }

    if (Object.keys(normalized).length > 0) {
      return normalized;
    }
  }

  return undefined;
}

/**
 * Strip the Gate Configuration section from user message template text.
 */
export function stripGateConfigSection(userMessageTemplate: string): string {
  const gateConfigSectionRegex = /## Gate Configuration\s*\n```json\s*\n[\s\S]*?\n```\s*/;
  return userMessageTemplate.replace(gateConfigSectionRegex, '').trim();
}

/**
 * Parse chain steps from the content of a ## Chain Steps markdown section.
 *
 * Each step has the format:
 * ```
 * 1. promptId: some_prompt
 *    stepName: Step Name
 *    inputMapping:
 *      key: value
 *    outputMapping:
 *      key: value
 * ```
 */
export function parseChainSteps(chainContent: string): ChainStep[] {
  if (!chainContent) return [];

  const steps: ChainStep[] = [];

  const stepMatches = chainContent.matchAll(
    /(\d+)\.\s*promptId:\s*([^\n]+)\s*\n\s*stepName:\s*([^\n]+)(?:\s*\n\s*inputMapping:\s*([\s\S]*?)(?=\s*\n\s*(?:outputMapping|promptId|\d+\.|$)))?\s*(?:\n\s*outputMapping:\s*([\s\S]*?)(?=\s*\n\s*(?:promptId|\d+\.|$)))?\s*/g
  );

  for (const match of stepMatches) {
    const promptId = match[2];
    const stepName = match[3];

    if (!promptId || !stepName) continue;

    const step: ChainStep = {
      promptId: promptId.trim(),
      stepName: stepName.trim(),
    };

    if (match[4]) {
      step.inputMapping = parseYamlStyleMapping(match[4]);
    }

    if (match[5]) {
      step.outputMapping = parseYamlStyleMapping(match[5]);
    }

    steps.push(step);
  }

  return steps;
}

/**
 * Parse a YAML-style key: value mapping block into a Record.
 */
function parseYamlStyleMapping(mappingStr: string): Record<string, string> | undefined {
  const mapping: Record<string, string> = {};
  const lines = mappingStr.trim().split('\n');

  for (const line of lines) {
    const [key, value] = line
      .trim()
      .split(':')
      .map((s) => s.trim());
    if (key && value) {
      mapping[key] = value;
    }
  }

  return Object.keys(mapping).length > 0 ? mapping : undefined;
}

/**
 * Parse complete markdown prompt file content into a LoadedPromptFile structure.
 *
 * Orchestrates section extraction, gate configuration parsing, chain step parsing,
 * and gate config stripping from user message template.
 *
 * @throws Error if content has no system message, user template, or chain steps
 */
export function parseMarkdownPromptContent(
  content: string,
  filePath: string,
  // Undefined rather than defaulted — see parseGateConfiguration. `{...undefined}` spreads to
  // nothing, so the call below needs no branch either.
  origin?: InlineGateSource
): LoadedPromptFile {
  const sections = extractMarkdownSections(content);

  // Parse gate configuration. The origin carries a logger so a dropped inline gate definition
  // in a markdown prompt is as visible as one in a YAML prompt — ADR 0001's warn-then-arm
  // release is about operator visibility across a whole workspace, and markdown is still loadable.
  const gateConfiguration = parseGateConfiguration(sections.gateConfigMatch, {
    promptId: filePath,
    ...origin,
  });

  // Strip gate config section from user template if present
  let userMessageTemplate = sections.userMessageTemplate;
  if (sections.gateConfigMatch) {
    userMessageTemplate = stripGateConfigSection(userMessageTemplate);
  }

  // Parse chain steps
  const chainSteps = sections.chainMatch
    ? parseChainSteps(sections.chainMatch[1]?.trim() ?? '')
    : [];

  // Validate: at least one section must exist
  const hasNoUserMessage = userMessageTemplate === '';
  const hasNoChainSteps = chainSteps.length === 0;
  const hasNoSystemMessage = !sections.systemMessage;
  if (hasNoUserMessage && hasNoChainSteps && hasNoSystemMessage) {
    throw new Error(
      `Prompt requires user message template, chain steps, or system message: ${filePath}`
    );
  }

  const result: LoadedPromptFile = {
    userMessageTemplate,
    chainSteps,
  };

  if (sections.systemMessage) {
    result.systemMessage = sections.systemMessage;
  }

  if (gateConfiguration) {
    result.gateConfiguration = gateConfiguration;
  }

  return result;
}
