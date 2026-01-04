import { BasePipelineStage } from '../stage.js';
import type { FrameworkValidator } from '../../../frameworks/framework-validator.js';
import type { Logger } from '../../../logging/index.js';
import type { ExecutionContext } from '../../context/execution-context.js';
/**
 * Pipeline Stage 3: Operator Validation
 *
 * Validates and normalizes symbolic operators from parsed commands,
 * ensuring framework overrides are valid before execution planning.
 *
 * Dependencies: context.parsedCommand, context.parsedCommand.operators
 * Output: Validated operators (framework names normalized)
 * Can Early Exit: No
 */
export declare class OperatorValidationStage extends BasePipelineStage {
    private readonly frameworkValidator;
    readonly name = "OperatorValidation";
    constructor(frameworkValidator: FrameworkValidator | null, logger: Logger);
    execute(context: ExecutionContext): Promise<void>;
    private normalizeFrameworkOperators;
}
