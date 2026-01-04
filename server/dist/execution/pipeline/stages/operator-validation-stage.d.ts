import { BasePipelineStage } from '../stage.js';
import type { FrameworkValidator } from '../../../frameworks/framework-validator.js';
import type { Logger } from '../../../logging/index.js';
import type { ExecutionContext } from '../../context/execution-context.js';
/**
 * Stage 3: Operator validation/normalization.
 *
 * Ensures symbolic operators are validated after parsing so later stages and
 * executors operate on normalized data (especially framework overrides).
 */
export declare class OperatorValidationStage extends BasePipelineStage {
    private readonly frameworkValidator;
    readonly name = "OperatorValidation";
    constructor(frameworkValidator: FrameworkValidator | null, logger: Logger);
    execute(context: ExecutionContext): Promise<void>;
    private normalizeFrameworkOperators;
}
