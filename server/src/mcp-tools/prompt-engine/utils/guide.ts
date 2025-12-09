// @lifecycle canonical - Prompt engine helper that exposes action metadata guide.
import { promptEngineMetadata } from '../../../tooling/action-metadata/definitions/prompt-engine.js';

import type {
  ParameterDescriptor,
  CommandDescriptor,
} from '../../../tooling/action-metadata/definitions/types.js';

export function renderPromptEngineGuide(goal?: string): string {
  const normalizedGoal = typeof goal === 'string' ? goal.trim() : '';

  // Dedicated gates guide with syntax reference
  if (/^gates?$/i.test(normalizedGoal)) {
    return renderGatesGuide();
  }

  const parameterList = selectGuideParameters(normalizedGoal);
  const commandList = promptEngineMetadata.data.commands;
  const usagePatterns = promptEngineMetadata.data.usagePatterns ?? [];
  const fullParameterCatalog = promptEngineMetadata.data.parameters.filter(
    (param) => param.status !== 'deprecated'
  );
  const sections: string[] = [];

  sections.push('🧭 **Prompt Engine Guide**');
  sections.push(
    'Executes prompts, templates, and chains with framework awareness plus advanced gate controls. Metadata-driven output keeps this description synchronized with the tool implementation.'
  );
  sections.push(
    normalizedGoal
      ? `Requested focus: \`${normalizedGoal}\``
      : 'Use `>>guide gates`, `>>guide chain resume`, etc. for targeted help.'
  );

  if (parameterList.length > 0) {
    sections.push('### Key Parameters');
    parameterList.forEach((param) => {
      const issues =
        param.issues && param.issues.length > 0
          ? ` Issues: ${param.issues.map((issue) => issue.summary).join(' • ')}`
          : '';
      sections.push(
        `- \`${param.name}\` (${describePromptEngineStatus(param.status)}) — ${param.description}${issues}`
      );
    });
  }

  if (commandList.length > 0) {
    sections.push('### Built-in Commands');
    commandList.forEach((cmd) => {
      sections.push(
        `- \`${cmd.id}\` (${describePromptEngineStatus(cmd.status)}) — ${cmd.description}`
      );
    });
  }

  if (usagePatterns.length > 0) {
    sections.push('### Usage Patterns');
    usagePatterns.forEach((pattern) => {
      sections.push(formatUsagePattern(pattern));
    });
  }

  if (promptEngineMetadata.issues && promptEngineMetadata.issues.length > 0) {
    sections.push('### Known Limitations');
    promptEngineMetadata.issues.forEach((issue) => {
      sections.push(
        `${issue.severity === 'high' ? '❗' : '⚠️'} ${issue.summary}: ${issue.details}`
      );
    });
  }

  if (fullParameterCatalog.length > 0) {
    sections.push('### Full Parameter Catalog');
    fullParameterCatalog.forEach((param) => {
      sections.push(
        `- \`${param.name}\` (${describePromptEngineStatus(param.status)}) — ${param.description}`
      );
    });
  }

  sections.push(
    '💡 Tip: Use the unified `gates` parameter to specify validation criteria. The response footer will include a `gate_verdict` format reminder when gates are active.'
  );

  return sections.join('\n\n');
}

function selectGuideParameters(goal: string): ParameterDescriptor[] {
  const normalizedGoal = goal.toLowerCase();
  const parameters = promptEngineMetadata.data.parameters.filter(
    (param) => param.status !== 'deprecated'
  );

  if (!normalizedGoal) {
    return parameters.slice(0, Math.min(8, parameters.length));
  }

  const scored = parameters.map((param) => ({
    param,
    score: computeParameterScore(param, normalizedGoal),
  }));

  const filtered = scored
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.param);

  return filtered.length > 0 ? filtered : parameters.slice(0, Math.min(8, parameters.length));
}

function computeParameterScore(param: ParameterDescriptor, goal: string): number {
  let score = param.status === 'working' ? 4 : 1;
  if (goal.length === 0) {
    return score;
  }

  if (param.name.toLowerCase().includes(goal) || param.description.toLowerCase().includes(goal)) {
    score += 3;
  }

  if (/gate|quality|validation/.test(goal) && /gate|quality|validation/.test(param.description)) {
    score += 5;
  }

  if (/chain|resume/.test(goal) && /chain|session/.test(param.description)) {
    score += 4;
  }

  if (/temporary|scope/.test(goal) && /temporary|scope/.test(param.description)) {
    score += 4;
  }

  if (/performance/.test(goal) && /performance/.test(param.description)) {
    score += 2;
  }

  return score;
}

function describePromptEngineStatus(status: string): string {
  switch (status) {
    case 'working':
      return '✅ Working';
    case 'planned':
      return '🗺️ Planned';
    case 'routing_issue':
      return '⚠️ Routing Issue';
    case 'display-gap':
      return '⚠️ Display Gap';
    case 'needs-validation':
    case 'needs-visuals':
    case 'needs-context':
    case 'needs-parameter':
    case 'needs-structure':
      return `⚠️ ${status}`;
    case 'untested':
      return '🧪 Untested';
    case 'deprecated':
      return '🛑 Deprecated';
    default:
      return status;
  }
}

function formatUsagePattern(
  pattern: (typeof promptEngineMetadata.data.usagePatterns)[number]
): string {
  const header = `**${pattern.title}** — ${pattern.summary}`;
  const parameterList = pattern.parameters.length
    ? `Parameters: ${pattern.parameters.map((name) => `\`${name}\``).join(', ')}`
    : '';
  const sampleBlock = ['```json', pattern.sampleCommand, '```'].join('\n');
  const notes =
    pattern.notes && pattern.notes.length > 0
      ? `Notes: ${pattern.notes.map((note) => `- ${note}`).join('\n')}`
      : '';

  return [header, parameterList, sampleBlock, notes]
    .filter((segment) => segment.length > 0)
    .join('\n\n');
}

/**
 * Render comprehensive gates syntax guide
 */
function renderGatesGuide(): string {
  const sections: string[] = [];

  sections.push('🔐 **Gates Syntax Guide**');
  sections.push(
    'Quality gates enforce validation criteria during prompt execution. ' +
      'Use the `::` operator to add gates inline, or the `gates` parameter for registered gates.'
  );

  sections.push('### Syntax Reference');
  sections.push(`\`\`\`
# Canonical gate (registered in gates/ directory)
:: code-quality
:: security-awareness
:: research-quality

# Named inline gate (custom ID for tracking)
:: security:"validate all user inputs"
:: perf:"maintain O(n) complexity"

# Anonymous inline gate (auto-generated ID)
:: "check for edge cases"
:: "ensure proper error handling"

# Multiple gates (comma-separated criteria)
:: validation:"check types, validate ranges, handle nulls"

# Combine in single command
>>prompt :: security:"no secrets" :: perf:"efficient" :: code-quality
\`\`\``);

  sections.push('### Gate Types');
  sections.push(`| Type | Syntax | Description |
|------|--------|-------------|
| **Canonical** | \`:: code-quality\` | Registered gate with full guidance |
| **Named** | \`:: id:"criteria"\` | Inline gate with custom ID |
| **Anonymous** | \`:: "criteria"\` | Inline gate with auto-generated ID |`);

  sections.push('### Discovery Commands');
  sections.push(`- \`>>gates\` — List all available canonical gates
- \`>>gates security\` — Search gates by keyword
- \`>>guide gates\` — This syntax reference`);

  sections.push('### Tips');
  sections.push(`- Named gates (\`:: security:"..."\`) appear with their ID in output
- Use canonical gates for consistent, reusable validation
- Combine multiple criteria: \`:: "check A, verify B"\`
- Gates work with frameworks: \`@CAGEERF >>prompt :: code-quality\``);

  return sections.join('\n\n');
}
