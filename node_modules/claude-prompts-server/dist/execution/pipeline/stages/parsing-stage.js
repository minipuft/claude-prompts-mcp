import { PromptError } from '../../../utils/index.js';
import { BasePipelineStage } from '../stage.js';
/**
 * Stage 1: Command parsing and argument preparation.
 * Wraps the existing parsing system so later stages operate on ExecutionContext only.
 */
export class CommandParsingStage extends BasePipelineStage {
    constructor(commandParser, argumentParser, convertedPrompts, logger) {
        super(logger);
        this.commandParser = commandParser;
        this.argumentParser = argumentParser;
        this.name = 'CommandParsing';
        this.convertedPrompts = convertedPrompts;
        this.promptLookup = this.createPromptLookup(convertedPrompts);
    }
    async execute(context) {
        this.logEntry(context);
        try {
            const parseResult = await this.commandParser.parseCommand(context.mcpRequest.command, this.convertedPrompts);
            if (parseResult.format === 'symbolic' &&
                parseResult.executionPlan) {
                context.parsedCommand = await this.buildSymbolicCommand(parseResult);
                this.logExit({
                    promptId: parseResult.promptId,
                    format: parseResult.format,
                    type: 'symbolic',
                });
                return;
            }
            const convertedPrompt = this.findConvertedPrompt(parseResult.promptId);
            if (!convertedPrompt) {
                throw new PromptError(`Converted prompt data not found for: ${parseResult.promptId}`);
            }
            const argResult = await this.argumentParser.parseArguments(parseResult.rawArgs, convertedPrompt, this.createArgumentContext());
            const parsedCommand = {
                ...parseResult,
                convertedPrompt,
                promptArgs: argResult.processedArgs,
            };
            // Update commandType to 'chain' if prompt definition has chainSteps
            // (Parser defaults to 'single' because it can't see the prompt definition)
            if (convertedPrompt.chainSteps?.length) {
                parsedCommand.commandType = 'chain';
                parsedCommand.steps = convertedPrompt.chainSteps.map((step, index) => ({
                    stepNumber: index + 1,
                    promptId: step.promptId,
                    args: argResult.processedArgs, // Use parsed arguments from command
                    variableName: step.stepName ?? `step_${index + 1}`,
                    convertedPrompt,
                }));
            }
            context.parsedCommand = parsedCommand;
            this.logExit({
                promptId: parsedCommand.promptId,
                format: parsedCommand.format,
                operatorTypes: parsedCommand.operators?.operatorTypes,
            });
        }
        catch (error) {
            this.handleError(error, 'Command parsing failed');
        }
    }
    createPromptLookup(prompts) {
        const map = new Map();
        for (const prompt of prompts) {
            map.set(prompt.id.toLowerCase(), prompt);
            if (prompt.name) {
                map.set(prompt.name.toLowerCase(), prompt);
            }
        }
        return map;
    }
    findConvertedPrompt(idOrName) {
        return this.promptLookup.get(idOrName.toLowerCase());
    }
    async buildSymbolicCommand(parseResult) {
        const hasChainOperator = this.hasChainOperator(parseResult);
        if (!hasChainOperator) {
            return this.buildSingleSymbolicPrompt(parseResult);
        }
        return this.buildSymbolicChain(parseResult);
    }
    async buildSingleSymbolicPrompt(parseResult) {
        const baseStep = parseResult.executionPlan.steps[0];
        if (!baseStep?.promptId) {
            throw new PromptError('Symbolic command requires a valid prompt identifier.');
        }
        const convertedPrompt = this.findConvertedPrompt(baseStep.promptId);
        if (!convertedPrompt) {
            throw new PromptError(`Converted prompt data not found for: ${baseStep.promptId}`);
        }
        const argumentInput = this.getStepArgumentInput(parseResult.executionPlan, 0);
        const resolvedArgs = await this.resolveArgumentPayload(convertedPrompt, argumentInput, baseStep.inlineGateCriteria, baseStep.args);
        const inlineCriteria = resolvedArgs.inlineCriteria.length > 0
            ? resolvedArgs.inlineCriteria
            : this.collectGlobalInlineCriteria(parseResult);
        return {
            ...parseResult,
            convertedPrompt,
            promptArgs: resolvedArgs.processedArgs,
            inlineGateCriteria: inlineCriteria,
            steps: undefined,
        };
    }
    async buildSymbolicChain(parseResult) {
        const stepPrompts = [];
        let commandArgs = {};
        const argumentInputs = parseResult.executionPlan.argumentInputs ?? [];
        for (const [index, step] of parseResult.executionPlan.steps.entries()) {
            if (!step.promptId) {
                continue;
            }
            const convertedPrompt = this.findConvertedPrompt(step.promptId);
            if (!convertedPrompt) {
                throw new PromptError(`Converted prompt data not found for chain step: ${step.promptId}`);
            }
            const stepArgumentInput = argumentInputs[index];
            const resolvedArgs = await this.resolveArgumentPayload(convertedPrompt, stepArgumentInput, step.inlineGateCriteria, step.args);
            if (stepPrompts.length === 0) {
                commandArgs = resolvedArgs.processedArgs;
            }
            stepPrompts.push({
                stepNumber: step.stepNumber ?? stepPrompts.length + 1,
                promptId: convertedPrompt.id,
                convertedPrompt,
                args: resolvedArgs.processedArgs,
                inlineGateCriteria: resolvedArgs.inlineCriteria,
            });
        }
        return {
            ...parseResult,
            convertedPrompt: undefined,
            steps: stepPrompts,
            promptArgs: commandArgs,
        };
    }
    createArgumentContext() {
        return {
            conversationHistory: [],
            environmentVars: process.env,
            promptDefaults: {},
            systemContext: {},
        };
    }
    hasChainOperator(parseResult) {
        const operators = parseResult.operators?.operators;
        if (!Array.isArray(operators)) {
            return false;
        }
        return operators.some((operator) => operator.type === 'chain');
    }
    async resolveArgumentPayload(prompt, sanitizedArgs, inlineCriteriaSeed = [], fallbackArgs) {
        const seed = Array.isArray(inlineCriteriaSeed)
            ? inlineCriteriaSeed.filter((item) => Boolean(item && item.trim()))
            : [];
        const normalizedSeed = Array.from(new Set(seed));
        if (!sanitizedArgs?.trim()) {
            if (fallbackArgs && Object.keys(fallbackArgs).length > 0) {
                return {
                    processedArgs: { ...fallbackArgs },
                    resolvedPlaceholders: {},
                    inlineCriteria: normalizedSeed,
                };
            }
            return {
                processedArgs: {},
                resolvedPlaceholders: {},
                inlineCriteria: normalizedSeed,
            };
        }
        const parsed = await this.parseArgumentsSafely(sanitizedArgs, prompt);
        const processedArgs = parsed.processedArgs && Object.keys(parsed.processedArgs).length > 0
            ? parsed.processedArgs
            : fallbackArgs
                ? { ...fallbackArgs }
                : {};
        return {
            processedArgs,
            resolvedPlaceholders: parsed.resolvedPlaceholders,
            inlineCriteria: normalizedSeed,
        };
    }
    async parseArgumentsSafely(argsString, prompt) {
        if (!argsString?.trim()) {
            return {
                processedArgs: {},
                resolvedPlaceholders: {},
            };
        }
        try {
            const argResult = await this.argumentParser.parseArguments(argsString, prompt, this.createArgumentContext());
            return {
                processedArgs: argResult.processedArgs ?? {},
                resolvedPlaceholders: argResult.resolvedPlaceholders ?? {},
            };
        }
        catch (error) {
            this.logger.warn('[ParsingStage] Failed to parse symbolic command arguments', {
                error,
                promptId: prompt.id,
            });
            return {
                processedArgs: {},
                resolvedPlaceholders: {},
            };
        }
    }
    collectGlobalInlineCriteria(parseResult) {
        const operators = parseResult.operators?.operators;
        if (!Array.isArray(operators)) {
            return [];
        }
        const criteria = operators
            .filter((op) => op.type === 'gate')
            .flatMap((gate) => Array.isArray(gate.parsedCriteria) && gate.parsedCriteria.length
            ? gate.parsedCriteria
            : [gate.criteria])
            .map((item) => item?.trim())
            .filter((item) => Boolean(item));
        return Array.from(new Set(criteria));
    }
    getStepArgumentInput(executionPlan, index) {
        if (!executionPlan.argumentInputs || index < 0) {
            return undefined;
        }
        return executionPlan.argumentInputs[index];
    }
}
//# sourceMappingURL=parsing-stage.js.map