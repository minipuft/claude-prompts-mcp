// @lifecycle canonical - Filters gate guidance content based on frameworks.
/**
 * Framework Guidance Filter - Pure Function Implementation
 *
 * Extracts framework-specific guidance from multi-framework guidance text.
 * This is a pure function with no dependencies for maximum reusability.
 */

function resolveFrameworks(frameworks?: readonly string[]): readonly string[] {
  return frameworks && frameworks.length > 0 ? frameworks : [];
}

function matchesFrameworkLine(line: string, framework: string): boolean {
  const trimmed = line.trimStart().toLowerCase();
  return trimmed.startsWith(`- ${framework.toLowerCase()}:`);
}

function matchesAnyFramework(line: string, frameworks: readonly string[]): boolean {
  return frameworks.some((framework) => matchesFrameworkLine(line, framework));
}

/**
 * Filter guidance text to show only the specified framework's guidance
 */
export function filterFrameworkGuidance(
  guidance: string,
  activeFramework: string,
  frameworkNames?: readonly string[]
): string {
  const frameworks = resolveFrameworks(frameworkNames);
  if (frameworks.length === 0) {
    return guidance;
  }
  const resolvedFrameworkName =
    frameworks.find((framework) => framework.toLowerCase() === activeFramework.toLowerCase()) ??
    activeFramework;

  const lines = guidance.split('\n');
  const filteredLines: string[] = [];
  let foundRelevantSection = false;

  for (const line of lines) {
    if (matchesFrameworkLine(line, resolvedFrameworkName)) {
      foundRelevantSection = true;
      filteredLines.push(line);
      continue;
    }

    if (line.startsWith('- ') && matchesAnyFramework(line, frameworks)) {
      foundRelevantSection = false;
      continue;
    }

    if (!line.startsWith('- ') || foundRelevantSection) {
      filteredLines.push(line);
    }
  }

  if (filteredLines.some((line) => matchesFrameworkLine(line, resolvedFrameworkName))) {
    let result = filteredLines.join('\n');
    result = result.replace(
      `- ${resolvedFrameworkName}: `,
      `**${resolvedFrameworkName} Methodology Guidelines:**\n- `
    );
    return result;
  }

  return guidance;
}

/**
 * Check if guidance text contains framework-specific content
 */
export function hasFrameworkSpecificContent(
  guidance: string,
  frameworkNames?: readonly string[]
): boolean {
  const frameworks = resolveFrameworks(frameworkNames);
  if (frameworks.length === 0) {
    return false;
  }
  return frameworks.some(
    (framework) => guidance.includes(`- ${framework}:`) || guidance.includes(`${framework}:`)
  );
}

/**
 * Get list of frameworks mentioned in guidance text
 */
export function getFrameworksInGuidance(
  guidance: string,
  frameworkNames?: readonly string[]
): string[] {
  const frameworks = resolveFrameworks(frameworkNames);
  if (frameworks.length === 0) {
    return [];
  }
  return frameworks.filter((framework) => guidance.includes(`${framework}:`));
}
