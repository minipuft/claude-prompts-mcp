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

/**
 * Where `<prefix><framework>:` first occurs in `text`, or -1. The one comparison every site in
 * this filter makes, and it ignores case: identifiers arrive upper-cased (`REACT`, from
 * `PromptExecutor`'s identifier provider) while guidance authors its own casing (`- ReACT:`).
 * A site that compared case-sensitively saw ReACT's line as absent (P6.267, P6.290).
 */
function findFrameworkLabel(text: string, framework: string, prefix = ''): number {
  return text.toLowerCase().indexOf(`${prefix}${framework}:`.toLowerCase());
}

function matchesFrameworkLine(line: string, framework: string): boolean {
  return findFrameworkLabel(line.trimStart(), framework, '- ') === 0;
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
  // Only another framework's own line is dropped. A line naming no framework is guidance for
  // every framework, which a framework's line adds to rather than replaces (R179). It used to be
  // kept only after the active framework's line, so the generic lines authored after the
  // last-listed framework reached that framework alone, and the order of the list decided who
  // got them (P6.291).
  const filteredLines = guidance
    .split('\n')
    .filter(
      (line) =>
        matchesFrameworkLine(line, activeFramework) ||
        !line.startsWith('- ') ||
        !matchesAnyFramework(line, frameworks)
    );

  const headed = filteredLines.findIndex((line) => matchesFrameworkLine(line, activeFramework));
  if (headed < 0) {
    return guidance;
  }
  // The heading keeps the name as the guidance authors it, whatever casing the id arrived in.
  const line = filteredLines[headed] ?? '';
  const item = line.trimStart();
  const authoredName = item.slice(2, item.indexOf(':'));
  const rest = item.slice(item.indexOf(':') + 1).trimStart();
  filteredLines[headed] =
    `${line.slice(0, line.length - item.length)}**${authoredName} Framework Guidelines:**\n- ${rest}`;
  return filteredLines.join('\n');
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
  return frameworks.some((framework) => findFrameworkLabel(guidance, framework) >= 0);
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
  return frameworks.filter((framework) => findFrameworkLabel(guidance, framework) >= 0);
}
