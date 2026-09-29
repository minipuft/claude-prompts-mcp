// @lifecycle canonical - Appends a selected response style's guidance to a step's system message.
/**
 * `systemMessage` with the selected style's guidance appended as a `**Response Style:**` line, or
 * unchanged when it already carries that guidance. The one spelling of the line: stage 15 writes
 * it into a first call's prompts, and a resume's step render appends it where the rendered step's
 * style decision says inject (R162 amended).
 */
export function withResponseStyle(
  systemMessage: string | undefined,
  styleGuidance: string
): string {
  const base = systemMessage ?? '';
  if (base.includes(styleGuidance)) {
    return base;
  }
  return base !== ''
    ? `${base}\n\n**Response Style:** ${styleGuidance}`
    : `**Response Style:** ${styleGuidance}`;
}
