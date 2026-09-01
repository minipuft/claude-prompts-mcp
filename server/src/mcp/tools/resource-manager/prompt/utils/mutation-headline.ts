// @lifecycle canonical - Chooses the opening claim of a prompt mutation response.

import type { PromptMutationVerification } from '../services/prompt-mutation-receipt-service.js';

/**
 * The first line of a mutation response states the outcome that `isError` carries.
 *
 * Both create and update used to open with `✅ **Prompt Created/Updated**` unconditionally and
 * append the failure underneath the headline, the analysis and the receipt. Measured 2026-08-30: a
 * response carrying `isError: true` had `❌ **Post-write verification failed**` at LINE 14, so
 * anything reading the opening line — a client summarising the result, a log excerpt, a truncated
 * transcript — saw a success. The flag was right and the prose contradicted it.
 *
 * The write itself did happen, so the headline still says the prompt was written; what failed is
 * the verification that the registry now serves it, and that is what leads. Composing the headline
 * AFTER verification rather than appending a correction to it is the point: there is no ordering in
 * which an appended qualifier outranks the line above it.
 *
 * A free function rather than a private method on the processor: choosing which claim a response
 * leads with is a decision, and it is testable without constructing the orchestrator's context.
 */
export function mutationHeadline(
  action: 'Created' | 'Updated',
  displayName: string,
  id: string,
  verification: Pick<PromptMutationVerification, 'verified' | 'error'>
): string {
  if (verification.verified) {
    return `✅ **Prompt ${action}**: ${displayName} (${id})\n\n`;
  }
  return (
    `❌ **Prompt ${action}, but post-write verification FAILED**: ${displayName} (${id})\n` +
    `${verification.error ?? 'No reason reported.'}\n\n`
  );
}
