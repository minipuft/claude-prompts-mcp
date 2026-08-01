// @lifecycle canonical - Splits output text into phase sections for guard checks.
/**
 * Section Splitter
 *
 * Parses LLM output into sections by markdown section headers.
 * Used by the phase guard evaluator to isolate phase content.
 */

/**
 * A section extracted from output by its header
 */
export interface OutputSection {
  /** The section header that delimited this section (e.g., "## Context") */
  section_header: string;
  /** The content below the header, trimmed */
  content: string;
}

/**
 * Split output text into sections by markdown section headers.
 *
 * Sections are delimited by the header strings. Content between one header
 * and the next (or end of text) belongs to that section.
 *
 * @param output - Full LLM output text
 * @param sectionHeaders - Ordered list of header strings to search for (e.g., ["## Context", "## Analysis"])
 * @returns Map of section_header → content for each found header
 */
export function splitBySectionHeaders(
  output: string,
  sectionHeaders: string[]
): Map<string, OutputSection> {
  if (!output || sectionHeaders.length === 0) {
    return new Map();
  }

  const result = new Map<string, OutputSection>();
  const lines = output.split('\n');

  // Find the line index where each section header starts. Tolerant match: the line is
  // compared to the configured header after normalizing away heading level (#/##/###),
  // surrounding bold/italic markers, trailing punctuation/colon, case, and whitespace — so
  // `## Dissolve`, `### Dissolve`, `## Dissolve:`, and `## **Dissolve**` all match a
  // configured `## Dissolve`. Exact full-line equality previously missed every such variant,
  // which (paired with a retry hint naming the wrong header) produced an unsatisfiable loop.
  const headerPositions: Array<{ header: string; lineIndex: number }> = [];

  for (const header of sectionHeaders) {
    const target = normalizeHeaderText(header);
    if (!target) continue; // a header that normalizes to empty can't be matched safely
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line !== undefined && normalizeHeaderText(line) === target) {
        headerPositions.push({ header, lineIndex: i });
        break; // First match per header
      }
    }
  }

  // Sort by position in document
  headerPositions.sort((a, b) => a.lineIndex - b.lineIndex);

  // Extract content between consecutive headers
  for (let i = 0; i < headerPositions.length; i++) {
    const current = headerPositions[i]!;
    const startLine = current.lineIndex + 1; // Skip the header line itself
    const next = headerPositions[i + 1];
    const endLine = next !== undefined ? next.lineIndex : lines.length;

    const content = lines.slice(startLine, endLine).join('\n').trim();

    result.set(current.header, {
      section_header: current.header,
      content,
    });
  }

  return result;
}

/**
 * Normalize a markdown header (or a candidate line) for tolerant comparison: strips the ATX
 * heading level (`#`..`######`), surrounding bold/italic asterisks, trailing punctuation/
 * colon, and outer whitespace, then lowercases. So a configured `## Dissolve` matches a line
 * written as `## Dissolve`, `### Dissolve`, `## Dissolve:`, or `## **Dissolve**`. Core text
 * must still match exactly (no substring/prose over-matching: "dissolve the constraints"
 * normalizes to "dissolve the constraints" ≠ "dissolve").
 */
function normalizeHeaderText(s: string): string {
  return s
    .replace(/^\s*#{1,6}\s*/, '') // leading ATX heading markers
    .replace(/\*/g, '') // bold/italic markers (anywhere — headers carry no meaningful '*')
    .replace(/[:：.,;\s–—-]+$/u, '') // trailing colon / punctuation / dashes / ws (after '*' removal)
    .trim()
    .toLowerCase();
}
