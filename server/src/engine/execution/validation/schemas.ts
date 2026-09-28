// @lifecycle canonical - The command-source exclusivity sentence both request refusals share.
/**
 * The request schema is the `prompt_engine` tool schema (`mcp/tools/schemas/`); the engine checks
 * the individual fields it needs through `McpToolRequestValidator.validatePartial` (stage 01).
 */

/**
 * The command-source exclusivity rule, in the one sentence both refusals use: the `prompt_engine`
 * tool schema's refinement and stage 04's refusal for callers that skip that schema (P6.119).
 * Kept in `engine/` because `engine/` may not value-import `mcp/`.
 */
export const COMMAND_SOURCE_EXCLUSIVITY_MESSAGE =
  "Provide exactly one of 'command', 'chain_id', 'workflow' or 'claim_token'. A workflow submission is a complete run description and cannot be combined with a command string or a resume token; a claim token names the run it resumes. The ONE exception is an append: 'chain_id' plus a 'command' whose first token is '-->' extends the running chain.";
