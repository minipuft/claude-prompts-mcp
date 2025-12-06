import { BasePipelineStage } from "../stage.js";
/**
 * Stage 6: Gate Validation
 */
export class GateValidationStage extends BasePipelineStage {
    constructor(engineValidator, gateCoordinator, chainSessionManager, logger) {
        super(logger);
        this.engineValidator = engineValidator;
        this.gateCoordinator = gateCoordinator;
        this.chainSessionManager = chainSessionManager;
        this.name = "GateValidation";
    }
    async execute(context) {
        this.logEntry(context);
        if (!context.executionPlan?.gateValidationEnabled || context.response) {
            this.logExit({ skipped: "Validation disabled or response already set" });
            return;
        }
        if (!context.executionPlan.gates.length) {
            this.logExit({ skipped: "No gates" });
            return;
        }
        try {
            const verdict = this.gateCoordinator.extractVerdict(context);
            if (verdict) {
                await this.processVerdict(context, verdict);
                return;
            }
            await this.performValidation(context);
        }
        catch (error) {
            this.handleError(error, "Gate validation failed");
        }
    }
    async processVerdict(context, verdict) {
        const sessionId = context.sessionContext?.sessionId;
        if (!sessionId) {
            this.logger.warn("[GateValidation] Verdict ignored - no session context");
            return;
        }
        if (verdict.decision === "pass") {
            await this.chainSessionManager.clearPendingGateReview(sessionId);
            if (context.sessionContext?.pendingReview) {
                context.sessionContext.pendingReview = undefined;
            }
            // Set gate context to indicate successful validation
            // This ensures ResponseFormattingStage can show gate status
            context.gateContext = {
                enabledGates: context.executionPlan.gates,
                validationResults: undefined, // No detailed results for manual pass
                reviewRequired: false,
                validationStatus: 'passed',
                passedGateIds: context.executionPlan.gates, // All gates passed
                failedGateIds: [],
            };
            this.logExit({ verdictProcessed: "pass" });
            return;
        }
        // Failed review – store failure info in gate context for ResponseFormattingStage to handle
        if (!context.gateContext) {
            context.gateContext = {
                enabledGates: context.executionPlan.gates,
                validationResults: undefined,
                reviewRequired: true,
            };
        }
        context.gateContext.reviewRequired = true;
        context.gateContext.failedVerdict = verdict.rawText;
        context.gateContext.validationStatus = 'failed';
        context.gateContext.failedGateIds = context.executionPlan.gates; // All gates considered failed
        context.gateContext.passedGateIds = [];
        this.logExit({ verdictProcessed: "fail" });
    }
    async performValidation(context) {
        if (!context.executionResults?.content) {
            this.handleError(new Error("Execution results missing before validation"));
        }
        const convertedPrompt = context.parsedCommand?.convertedPrompt;
        if (!convertedPrompt) {
            this.logExit({ skipped: "No converted prompt for validation" });
            return;
        }
        const validationResult = await this.engineValidator.validateWithGates(convertedPrompt, context.getPromptArgs(), context.executionPlan.gates, typeof context.executionResults.content === "string"
            ? context.executionResults.content
            : undefined);
        // Determine passed and failed gate IDs from validation results
        const passedGateIds = [];
        const failedGateIds = [];
        if (validationResult.results) {
            validationResult.results.forEach((result) => {
                if (result.passed) {
                    passedGateIds.push(result.gateId);
                }
                else {
                    failedGateIds.push(result.gateId);
                }
            });
        }
        context.gateContext = {
            enabledGates: context.executionPlan.gates,
            validationResults: validationResult,
            reviewRequired: Boolean(validationResult.reviewRequest),
            validationStatus: validationResult.reviewRequest ? 'pending' : 'passed',
            passedGateIds,
            failedGateIds,
        };
        if (validationResult.reviewRequest) {
            await this.scheduleReview(context, validationResult);
            return;
        }
        this.logExit({ validated: true });
    }
    async scheduleReview(context, validationResult) {
        const pendingReview = {
            combinedPrompt: validationResult.reviewRequest?.prompts
                ?.map((prompt) => prompt.criteriaSummary)
                .join("\n\n") ?? "",
            prompts: validationResult.reviewRequest?.prompts ?? [],
            gateIds: context.executionPlan.gates,
            createdAt: Date.now(),
            attemptCount: 0,
            maxAttempts: 3,
            retryHints: validationResult.reviewRequest?.retryHints,
            previousResponse: validationResult.reviewRequest?.previousResponse,
        };
        // Store review in session if available
        if (context.sessionContext) {
            await this.chainSessionManager.setPendingGateReview(context.sessionContext.sessionId, pendingReview);
            context.sessionContext.pendingReview = pendingReview;
        }
        // Store review info in gate context for ResponseFormattingStage to handle
        // This ensures both prompt content AND gate instructions are returned
        context.gateContext.pendingReview = pendingReview;
        context.gateContext.reviewRequired = true;
        this.logExit({ reviewScheduled: true, gateIds: pendingReview.gateIds });
    }
    buildReviewResponse(reviewPrompt, gateIds) {
        return {
            content: [
                {
                    type: "text",
                    text: [
                        "## ⚠️ QUALITY GATE VALIDATION",
                        "Respond exactly with `GATE_REVIEW: PASS` or `GATE_REVIEW: FAIL`, then explain why.",
                        "",
                        reviewPrompt,
                        "",
                        "Active Gates:",
                        gateIds.map((gate) => `- ${gate}`).join("\n"),
                    ]
                        .filter(Boolean)
                        .join("\n"),
                },
            ],
        };
    }
}
//# sourceMappingURL=validation-stage.js.map