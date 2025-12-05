// @lifecycle canonical - Renders structured prompt data back into markdown files.
/**
 * Shared helpers for rendering prompt markdown files from structured data.
 */

export interface PromptMarkdownData {
  id: string;
  name: string;
  description: string;
  systemMessage?: string;
  userMessageTemplate: string;
  gateConfiguration?: Record<string, unknown>;
  chainSteps?: Array<{
    stepName?: string;
    promptId: string;
    inputMapping?: Record<string, unknown>;
    outputMapping?: Record<string, unknown>;
  }>;
}

export function buildGateConfigurationSection(
  gateConfiguration: Record<string, unknown> | undefined
): string {
  if (!gateConfiguration) {
    return '';
  }

  const gateConfigJson = JSON.stringify(gateConfiguration, null, 2);
  return ['', '## Gate Configuration', '', '```json', gateConfigJson, '```', ''].join('\n');
}

export function buildChainStepsSection(chainSteps: PromptMarkdownData['chainSteps']): string {
  if (!chainSteps?.length) {
    return '';
  }

  const lines: string[] = ['', '## Chain Steps', ''];

  chainSteps.forEach((step, index) => {
    const name = step.stepName ?? `Step ${index + 1}`;
    lines.push(`${index + 1}. **${name}** (${step.promptId})`);

    if (step.inputMapping) {
      lines.push(`   - Input Mapping: ${JSON.stringify(step.inputMapping)}`);
    }

    if (step.outputMapping) {
      lines.push(`   - Output Mapping: ${JSON.stringify(step.outputMapping)}`);
    }

    lines.push('');
  });

  return lines.join('\n');
}

export function buildPromptBaseContent(data: PromptMarkdownData): string {
  const lines: string[] = [`# ${data.name}`, '', '## Description', data.description, ''];

  if (data.systemMessage) {
    lines.push('## System Message', data.systemMessage, '');
  }

  lines.push('## User Message Template', data.userMessageTemplate);

  return lines.join('\n');
}

/**
 * Convert prompt metadata into canonical markdown content.
 */
export function buildPromptMarkdownContent(data: PromptMarkdownData): string {
  const gateSection = buildGateConfigurationSection(data.gateConfiguration);
  const chainSection = buildChainStepsSection(data.chainSteps);
  return `${buildPromptBaseContent(data)}${gateSection}${chainSection}`;
}
