// @lifecycle canonical - Re-exports the MCP tool error context type.
/**
 * Shared Type Definitions for MCP Tools
 *
 * `ErrorContext` is the only symbol here with a consumer outside this file
 * (`mcp/tools/shared/structured-response-builder.ts`). It is defined in
 * `shared/utils/errorHandling.ts`; the other tool-layer types this file once declared had no
 * reader, and their names collided with live types in `shared/types/metrics.ts` and
 * `shared/utils/errorHandling.ts`.
 */

export type { ErrorContext } from '#shared/utils/errorHandling.js';
