// @lifecycle canonical - Base interface for execution pipeline stages.
import type { Logger } from '#infra/logging/index.js';
import type { ExecutionContext } from '../context/index.js';

/**
 * Contract for all pipeline stages.
 */
export interface PipelineStage {
  /**
   * Human readable stage name used for logs/metrics.
   */
  readonly name: string;

  /**
   * Context keys this stage writes, as dotted paths (`state.injection`).
   *
   * Optional and declarative: the key is a label matched against `requires`, not a path
   * anything dereferences. Declaring it does not make the write happen.
   */
  readonly provides?: readonly string[];

  /**
   * Context keys this stage reads that an earlier stage must have written.
   *
   * Checked by `validateStageOrder` when the pipeline is constructed. Omit it for a
   * stage whose inputs no ordering constraint depends on.
   */
  readonly requires?: readonly string[];

  /**
   * Execute the stage using the shared ExecutionContext.
   */
  execute(context: ExecutionContext): Promise<void>;
}

/**
 * Base class that provides consistent logging and error handling.
 */
export abstract class BasePipelineStage implements PipelineStage {
  abstract readonly name: string;

  constructor(protected readonly logger: Logger) {
    if (!logger) {
      throw new Error('BasePipelineStage requires a logger instance');
    }
  }

  abstract execute(context: ExecutionContext): Promise<void>;

  /**
   * Helper to log stage entry with consistent metadata.
   */
  protected logEntry(context: ExecutionContext, metadata: Record<string, unknown> = {}): void {
    const commandLabel = context.mcpRequest.command ?? '<response-only>';
    this.logger.debug(`[${this.name}] Starting`, {
      command: commandLabel,
      sessionId: context.getSessionId(),
      ...metadata,
    });
  }

  /**
   * Helper to log completion metadata.
   */
  protected logExit(metadata: Record<string, unknown> = {}): void {
    this.logger.debug(`[${this.name}] Complete`, metadata);
  }

  /**
   * Helper to log and rethrow errors with consistent structure.
   */
  protected handleError(error: unknown, message?: string): never {
    const details =
      error instanceof Error
        ? { message: error.message, stack: error.stack }
        : { message: String(error) };

    this.logger.error(`[${this.name}] ${message ?? 'Execution failed'}`, details);

    if (error instanceof Error) {
      throw error;
    }

    throw new Error(String(error));
  }
}
