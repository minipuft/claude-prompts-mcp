import { Logger } from "../../logging/index.js";
import { FrameworkStateManager } from "../../frameworks/framework-state-manager.js";
import type { FrameworkOperator } from "../parsers/types/operator-types.js";

export class FrameworkOperatorExecutor {
  private originalFramework: string | null = null;

  constructor(
    private readonly frameworkStateManager: FrameworkStateManager,
    private readonly logger: Logger,
  ) {}

  async executeWithFramework<T>(
    operator: FrameworkOperator,
    execution: () => Promise<T>,
  ): Promise<T> {
    await this.applyFramework(operator);

    try {
      return await execution();
    } finally {
      await this.restoreFramework();
    }
  }

  private async applyFramework(operator: FrameworkOperator): Promise<void> {
    const currentFramework = this.frameworkStateManager.getActiveFramework();
    this.originalFramework = currentFramework?.frameworkId ?? null;

    this.logger.info("[SymbolicFramework] Applying temporary framework", {
      framework: operator.normalizedId,
      previous: this.originalFramework,
    });

    await this.frameworkStateManager.switchFramework(
      operator.normalizedId,
      "Symbolic command framework override",
    );
  }

  private async restoreFramework(): Promise<void> {
    if (!this.originalFramework) {
      return;
    }

    this.logger.info("[SymbolicFramework] Restoring previous framework", {
      framework: this.originalFramework,
    });

    await this.frameworkStateManager.switchFramework(
      this.originalFramework,
      "Restoring framework after symbolic execution",
    );

    this.originalFramework = null;
  }
}
