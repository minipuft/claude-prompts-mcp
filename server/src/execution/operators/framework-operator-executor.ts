import { Logger } from "../../logging/index.js";
import { FrameworkStateManager } from "../../frameworks/framework-state-manager.js";
import type { FrameworkOperator } from "../parsers/types/operator-types.js";

export class FrameworkOperatorExecutor {
  private originalFramework: string | null = null;
  private overrideActive = false;

  constructor(
    private readonly frameworkStateManager: FrameworkStateManager,
    private readonly logger: Logger,
  ) {}

  async executeWithFramework<T>(
    operator: FrameworkOperator,
    execution: () => Promise<T>,
  ): Promise<T> {
    await this.applyFramework(operator);

    let executionError: unknown = null;

    try {
      return await execution();
    } catch (error) {
      executionError = error;
      throw error;
    } finally {
      try {
        await this.restoreFramework();
      } catch (restoreError) {
        if (executionError) {
          const message = restoreError instanceof Error ? restoreError.message : String(restoreError);
          this.logger.error("[SymbolicFramework] Failed to restore framework after symbolic execution", {
            error: message,
          });
        } else {
          throw restoreError instanceof Error ? restoreError : new Error(String(restoreError));
        }
      }
    }
  }

  private async applyFramework(operator: FrameworkOperator): Promise<void> {
    if (!this.frameworkStateManager.isFrameworkSystemEnabled()) {
      throw new Error(
        `[SymbolicFramework] Framework overrides are disabled. Enable the framework system before using '@${operator.frameworkId}'.`,
      );
    }

    const currentFramework = this.frameworkStateManager.getActiveFramework();
    this.originalFramework = currentFramework?.id ?? null;

    this.logger.info("[SymbolicFramework] Applying temporary framework", {
      framework: operator.normalizedId,
      previous: this.originalFramework,
    });

    try {
      const switched = await this.frameworkStateManager.switchFramework({
        targetFramework: operator.normalizedId,
        reason: "Symbolic command framework override",
      });

      if (!switched) {
        throw new Error(
          `Framework state manager rejected switch to '${operator.normalizedId}'.`,
        );
      }

      this.overrideActive = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error("[SymbolicFramework] Failed to apply framework override", {
        framework: operator.normalizedId,
        error: message,
      });

      this.overrideActive = false;
      this.originalFramework = null;

      throw new Error(
        `[SymbolicFramework] Unable to apply '@${operator.frameworkId}' framework override: ${message}`,
      );
    }
  }

  private async restoreFramework(): Promise<void> {
    if (!this.overrideActive) {
      this.originalFramework = null;
      return;
    }

    if (!this.originalFramework) {
      this.overrideActive = false;
      return;
    }

    const targetFramework = this.originalFramework;

    this.logger.info("[SymbolicFramework] Restoring previous framework", {
      framework: targetFramework,
    });

    try {
      const restored = await this.frameworkStateManager.switchFramework({
        targetFramework: targetFramework,
        reason: "Restoring framework after symbolic execution",
      });

      if (!restored) {
        throw new Error(
          `Framework state manager rejected restoration to '${targetFramework}'.`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error("[SymbolicFramework] Failed to restore framework after override", {
        framework: targetFramework,
        error: message,
      });
      throw new Error(
        `[SymbolicFramework] Unable to restore framework '${targetFramework}': ${message}`,
      );
    } finally {
      this.overrideActive = false;
      this.originalFramework = null;
    }
  }
}
