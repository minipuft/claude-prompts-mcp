import { BasePipelineStage } from '../stage.js';
import type { Logger } from '../../../logging/index.js';
import type { ConvertedPrompt } from '../../../types/index.js';
import type { ExecutionContext } from '../../context/execution-context.js';
import type { ArgumentParser } from '../../parsers/argument-parser.js';
import type { UnifiedCommandParser } from '../../parsers/unified-command-parser.js';
/**
 * Stage 1: Command parsing and argument preparation.
 * Wraps the existing parsing system so later stages operate on ExecutionContext only.
 */
export declare class CommandParsingStage extends BasePipelineStage {
    private readonly commandParser;
    private readonly argumentParser;
    readonly name = "CommandParsing";
    private readonly convertedPrompts;
    private readonly promptLookup;
    constructor(commandParser: UnifiedCommandParser, argumentParser: ArgumentParser, convertedPrompts: ConvertedPrompt[], logger: Logger);
    execute(context: ExecutionContext): Promise<void>;
    private createPromptLookup;
    private findConvertedPrompt;
    private buildSymbolicCommand;
    private buildSingleSymbolicPrompt;
    private buildSymbolicChain;
    private createArgumentContext;
    private hasChainOperator;
    private resolveArgumentPayload;
    private parseArgumentsSafely;
    private collectGlobalInlineCriteria;
    private getStepArgumentInput;
}
