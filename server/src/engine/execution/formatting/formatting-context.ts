// @lifecycle canonical - Type guards and discriminated union for formatting contexts.
import type { FormatterExecutionContext } from '#shared/types/chain-execution.js';
import type { SessionContext } from '../context/index.js';

/**
 * Chain execution formatting context.
 */
export interface ChainFormattingContext extends FormatterExecutionContext {
  readonly executionType: 'chain';
  readonly sessionContext: Required<SessionContext>;
}

/**
 * Single prompt execution formatting context.
 */
export interface SinglePromptFormattingContext extends FormatterExecutionContext {
  readonly executionType: 'single';
}

/**
 * Discriminated union for formatting contexts.
 */
export type VariantFormattingContext = ChainFormattingContext | SinglePromptFormattingContext;

/**
 * Type guard for chain formatting context.
 */
export function isChainFormattingContext(
  context: FormatterExecutionContext
): context is ChainFormattingContext {
  return context.executionType === 'chain';
}

/**
 * Type guard for single prompt formatting context.
 */
export function isSinglePromptFormattingContext(
  context: FormatterExecutionContext
): context is SinglePromptFormattingContext {
  return context.executionType === 'single';
}
