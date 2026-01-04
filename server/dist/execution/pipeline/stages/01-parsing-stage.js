// @lifecycle canonical - Parses incoming commands into structured operators.
import { PromptError } from '../../../utils/index.js';
import { BasePipelineStage } from '../stage.js';
/**
 * Canonical Pipeline Stage 1: Command Parsing
 *
 * Parses incoming commands using UnifiedCommandParser, resolves arguments,
 * and builds symbolic chains for operator-based workflows.
 *
 * Dependencies: None (always runs first)
 * Output: context.parsedCommand, context.symbolicChain (if operators detected)
 * Can Early Exit: Yes (if parsing fails)
 */
export class CommandParsingStage extends BasePipelineStage {
    constructor(commandParser, argumentParser, convertedPrompts, logger, chainSessionManager) {
        super(logger);
        this.commandParser = commandParser;
        this.argumentParser = argumentParser;
        this.chainSessionManager = chainSessionManager;
        this.name = 'CommandParsing';
        this.convertedPrompts = convertedPrompts;
        this.promptLookup = this.createPromptLookup(convertedPrompts);
    }
    async execute(context) {
        this.logEntry(context);
        if (context.isResponseOnlyMode()) {
            this.logger.debug('[ParsingStage] Response-only mode detected - resuming chain without command', {
                chainId: context.mcpRequest.chain_id,
                hasUserResponse: Boolean(context.mcpRequest.user_response),
                hasCommand: Boolean(context.mcpRequest.command),
            });
            this.restoreFromBlueprint(context);
            this.logExit({ skipped: 'Response-only session rehydrated' });
            return;
        }
        const incomingCommand = context.mcpRequest.command;
        if (!incomingCommand) {
            this.handleError(new Error('Command missing for parsing stage'));
        }
        try {
            const parseResult = await this.commandParser.parseCommand(incomingCommand, this.convertedPrompts);
            if (parseResult.format === 'symbolic' &&
                parseResult.executionPlan) {
                const symbolicCommand = await this.buildSymbolicCommand(parseResult);
                // Merge requestOptions into promptArgs for symbolic commands
                // Options values override empty/falsy placeholder values from prompt definitions
                // but inline args (truthy values) still take precedence
                const requestOptions = context.state.normalization.requestOptions;
                if (requestOptions && typeof requestOptions === 'object' && symbolicCommand.promptArgs) {
                    const mergedArgs = symbolicCommand.promptArgs;
                    for (const [key, value] of Object.entries(requestOptions)) {
                        // Merge if key missing OR existing value is falsy (empty placeholder)
                        const existing = mergedArgs[key];
                        const isFalsyOrEmpty = existing === undefined ||
                            existing === null ||
                            existing === '' ||
                            (Array.isArray(existing) && existing.length === 0);
                        if (!(key in mergedArgs) || isFalsyOrEmpty) {
                            mergedArgs[key] = value;
                        }
                    }
                }
                context.parsedCommand = symbolicCommand;
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
            // Merge requestOptions into processedArgs (options parameter from prompt_engine call)
            // Options values override empty/falsy placeholder values from prompt definitions
            // but inline args (truthy values) still take precedence
            const requestOptions = context.state.normalization.requestOptions;
            if (requestOptions && typeof requestOptions === 'object') {
                const mergedArgs = argResult.processedArgs;
                for (const [key, value] of Object.entries(requestOptions)) {
                    // Merge if key missing OR existing value is falsy (empty placeholder)
                    const existing = mergedArgs[key];
                    const isFalsyOrEmpty = existing === undefined ||
                        existing === null ||
                        existing === '' ||
                        (Array.isArray(existing) && existing.length === 0);
                    if (!(key in mergedArgs) || isFalsyOrEmpty) {
                        mergedArgs[key] = value;
                    }
                }
            }
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
                    inputMapping: step.inputMapping,
                    outputMapping: step.outputMapping,
                    retries: step.retries,
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
        const fallbackArgs = baseStep.args && baseStep.args.trim().length > 0
            ? await this.parseArgumentsSafely(baseStep.args, convertedPrompt)
            : undefined;
        const resolvedArgs = await this.resolveArgumentPayload(convertedPrompt, argumentInput, baseStep.inlineGateCriteria, fallbackArgs?.processedArgs);
        // Collect both anonymous and named gates
        const { anonymousCriteria, namedGates } = this.collectGateCriteria(parseResult);
        const inlineCriteria = resolvedArgs.inlineCriteria.length > 0 ? resolvedArgs.inlineCriteria : anonymousCriteria;
        const parsedCommand = {
            ...parseResult,
            convertedPrompt,
            promptArgs: resolvedArgs.processedArgs,
            inlineGateCriteria: inlineCriteria,
        };
        if (namedGates.length > 0) {
            parsedCommand.namedInlineGates = namedGates;
        }
        if (parseResult.executionPlan.styleSelection !== undefined) {
            parsedCommand.styleSelection = parseResult.executionPlan.styleSelection;
        }
        return parsedCommand;
    }
    async buildSymbolicChain(parseResult) {
        const stepPrompts = [];
        let commandArgs = {};
        const argumentInputs = parseResult.executionPlan.argumentInputs ?? [];
        // Collect both anonymous and named gate criteria from gate operator (::)
        const { anonymousCriteria: globalGateCriteria, namedGates } = this.collectGateCriteria(parseResult);
        for (const [index, step] of parseResult.executionPlan.steps.entries()) {
            if (!step.promptId) {
                continue;
            }
            const convertedPrompt = this.findConvertedPrompt(step.promptId);
            if (!convertedPrompt) {
                throw new PromptError(`Converted prompt data not found for chain step: ${step.promptId}`);
            }
            const stepArgumentInput = argumentInputs[index];
            const fallbackArgs = step.args && step.args.trim().length > 0
                ? await this.parseArgumentsSafely(step.args, convertedPrompt)
                : undefined;
            // Merge step-level and global gate criteria
            const combinedGateCriteria = [...(step.inlineGateCriteria ?? []), ...globalGateCriteria];
            const resolvedArgs = await this.resolveArgumentPayload(convertedPrompt, stepArgumentInput, combinedGateCriteria, fallbackArgs?.processedArgs);
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
        const parsedCommand = {
            ...parseResult,
            steps: stepPrompts,
            promptArgs: commandArgs,
        };
        if (namedGates.length > 0) {
            parsedCommand.namedInlineGates = namedGates;
        }
        if (parseResult.executionPlan.styleSelection !== undefined) {
            parsedCommand.styleSelection = parseResult.executionPlan.styleSelection;
        }
        return parsedCommand;
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
    /**
     * Separates gate operators into named and anonymous criteria.
     * Named gates (with gateId) are returned separately for explicit ID registration.
     * Anonymous criteria are merged together for backward-compatible temp gate creation.
     */
    collectGateCriteria(parseResult) {
        const operators = parseResult.operators?.operators;
        if (!Array.isArray(operators)) {
            return { anonymousCriteria: [], namedGates: [] };
        }
        const anonymousCriteria = [];
        const namedGates = [];
        for (const op of operators) {
            if (op.type !== 'gate')
                continue;
            const gate = op;
            const criteria = Array.isArray(gate.parsedCriteria) && gate.parsedCriteria.length
                ? gate.parsedCriteria
                : [gate.criteria];
            const cleanedCriteria = criteria
                .map((item) => item?.trim())
                .filter((item) => Boolean(item));
            if (gate.gateId) {
                // Named gate - keep ID association
                namedGates.push({ gateId: gate.gateId, criteria: cleanedCriteria });
            }
            else {
                // Anonymous gate - merge with others
                anonymousCriteria.push(...cleanedCriteria);
            }
        }
        return {
            anonymousCriteria: Array.from(new Set(anonymousCriteria)),
            namedGates,
        };
    }
    /** @deprecated Use collectGateCriteria for named gate support */
    collectGlobalInlineCriteria(parseResult) {
        const { anonymousCriteria } = this.collectGateCriteria(parseResult);
        return anonymousCriteria;
    }
    restoreFromBlueprint(context) {
        if (!this.chainSessionManager) {
            throw new Error('ChainSessionManager unavailable for response-only execution');
        }
        let sessionId = context.getSessionId();
        let blueprint = sessionId ? this.chainSessionManager.getSessionBlueprint(sessionId) : undefined;
        if (!blueprint) {
            const requestedChainId = context.mcpRequest.chain_id;
            if (requestedChainId) {
                const session = this.chainSessionManager.getSessionByChainIdentifier(requestedChainId, {
                    includeDormant: true,
                });
                if (session) {
                    sessionId = session.sessionId;
                    context.state.session.resumeSessionId = session.sessionId;
                    context.state.session.resumeChainId = session.chainId;
                    blueprint = session.blueprint
                        ? this.cloneBlueprint(session.blueprint)
                        : this.chainSessionManager.getSessionBlueprint(session.sessionId);
                }
            }
        }
        if (!blueprint || !sessionId) {
            throw new Error('No stored execution blueprint found for the requested session or chain. Re-run the original command to continue.');
        }
        context.parsedCommand = this.cloneParsedCommand(blueprint.parsedCommand);
        context.executionPlan = this.cloneExecutionPlan(blueprint.executionPlan);
        if (blueprint.gateInstructions) {
            context.gateInstructions = blueprint.gateInstructions;
        }
        context.state.session.resumeSessionId = sessionId;
        const resolvedResumeChainId = context.state.session.resumeChainId ?? blueprint.parsedCommand.chainId;
        if (resolvedResumeChainId !== undefined) {
            context.state.session.resumeChainId = resolvedResumeChainId;
        }
        context.state.session.isBlueprintRestored = true;
    }
    cloneParsedCommand(parsedCommand) {
        return JSON.parse(JSON.stringify(parsedCommand));
    }
    cloneExecutionPlan(plan) {
        return JSON.parse(JSON.stringify(plan));
    }
    cloneBlueprint(blueprint) {
        const cloned = {
            parsedCommand: this.cloneParsedCommand(blueprint.parsedCommand),
            executionPlan: this.cloneExecutionPlan(blueprint.executionPlan),
        };
        if (blueprint.gateInstructions !== undefined) {
            cloned.gateInstructions = blueprint.gateInstructions;
        }
        return cloned;
    }
    getStepArgumentInput(executionPlan, index) {
        if (!executionPlan.argumentInputs || index < 0) {
            return undefined;
        }
        return executionPlan.argumentInputs[index];
    }
}
//# sourceMappingURL=01-parsing-stage.js.map