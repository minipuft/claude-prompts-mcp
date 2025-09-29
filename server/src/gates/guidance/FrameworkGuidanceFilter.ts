/**
 * Framework Guidance Filter - Pure Function Implementation
 *
 * Extracts framework-specific guidance from multi-framework guidance text.
 * This is a pure function with no dependencies for maximum reusability.
 */

/**
 * Filter guidance text to show only the specified framework's guidance
 *
 * @param guidance - Original guidance text (may contain multiple frameworks)
 * @param activeFramework - Framework to filter for (e.g., 'ReACT', 'CAGEERF')
 * @returns Filtered guidance showing only the active framework's content
 */
export function filterFrameworkGuidance(guidance: string, activeFramework: string): string {
  // Parse the guidance to extract only the relevant framework section
  const lines = guidance.split('\n');
  const filteredLines: string[] = [];
  let foundRelevantSection = false;

  for (const line of lines) {
    // Check if this line contains framework-specific guidance
    if (line.includes(`- ${activeFramework}:`)) {
      foundRelevantSection = true;
      filteredLines.push(line);
    } else if (line.startsWith('- ') && (line.includes('CAGEERF:') || line.includes('ReACT:') || line.includes('5W1H:') || line.includes('SCAMPER:'))) {
      // Skip other framework-specific lines
      foundRelevantSection = false;
      continue;
    } else if (!line.startsWith('- ') || foundRelevantSection) {
      // Include general guidance lines and continuation lines
      filteredLines.push(line);
    }
  }

  // If we found framework-specific guidance, use filtered version
  if (filteredLines.some(line => line.includes(`- ${activeFramework}:`))) {
    let result = filteredLines.join('\n');

    // Clean up the framework-specific line to be more concise
    result = result.replace(`- ${activeFramework}: `, `**${activeFramework} Methodology Guidelines:**\n- `);

    return result;
  }

  // Fallback to original guidance if no framework-specific section found
  return guidance;
}

/**
 * Check if guidance text contains framework-specific content
 *
 * @param guidance - Guidance text to analyze
 * @returns true if guidance contains framework-specific sections
 */
export function hasFrameworkSpecificContent(guidance: string): boolean {
  const frameworkPatterns = ['CAGEERF:', 'ReACT:', '5W1H:', 'SCAMPER:'];
  return frameworkPatterns.some(pattern => guidance.includes(pattern));
}

/**
 * Get list of frameworks mentioned in guidance text
 *
 * @param guidance - Guidance text to analyze
 * @returns Array of framework names found in the guidance
 */
export function getFrameworksInGuidance(guidance: string): string[] {
  const frameworkPatterns = [
    { name: 'CAGEERF', pattern: 'CAGEERF:' },
    { name: 'ReACT', pattern: 'ReACT:' },
    { name: '5W1H', pattern: '5W1H:' },
    { name: 'SCAMPER', pattern: 'SCAMPER:' }
  ];

  return frameworkPatterns
    .filter(fw => guidance.includes(fw.pattern))
    .map(fw => fw.name);
}