import { buildReviewInstructions, parseLLMReview } from "../core/review-utils.js";
/**
 * Coordinates gate-specific workflows such as verdict parsing, feedback extraction,
 * and validation messaging. Extracted from ConsolidatedPromptEngine so gate logic
 * can evolve independently of the engine orchestration.
 */
export class GateCoordinator {
    constructor(gateSystem, logger) {
        this.gateSystem = gateSystem;
        this.logger = logger;
    }
    extractVerdict(context) {
        const verdictStr = context.getGateVerdict();
        if (!verdictStr) {
            this.logger.debug("[GateCoordinator] No verdict found in execution context");
            return null;
        }
        const parsed = parseLLMReview(verdictStr);
        this.logger.info("[GateCoordinator] Parsed gate verdict", {
            decision: parsed.decision,
            confidence: parsed.confidence,
        });
        return {
            decision: parsed.decision,
            reasoning: parsed.reasoning,
            confidence: parsed.confidence,
            matchType: parsed.matchType,
            rawText: verdictStr,
        };
    }
    extractFeedback(payload) {
        if (!payload || typeof payload !== "object") {
            return null;
        }
        const sourcePayload = payload.gate_validation_feedback ??
            payload.gateValidationFeedback ??
            payload.gate_feedback ??
            payload.gateFeedback;
        if (!sourcePayload) {
            return null;
        }
        if (typeof sourcePayload === "string") {
            const trimmed = sourcePayload.trim();
            return trimmed ? { text: trimmed, source: "request_extra" } : null;
        }
        if (Array.isArray(sourcePayload)) {
            const flattened = sourcePayload
                .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
                .filter(Boolean)
                .join("\n");
            return flattened ? { text: flattened, source: "request_extra" } : null;
        }
        if (typeof sourcePayload === "object") {
            const candidate = sourcePayload.text ??
                sourcePayload.summary ??
                sourcePayload.feedback;
            if (typeof candidate === "string" && candidate.trim().length > 0) {
                return { text: candidate.trim(), source: "request_extra" };
            }
        }
        return null;
    }
    async buildValidationInstructions(gateIds, fallbackCriteria = []) {
        if (gateIds.length === 0) {
            return this.buildInlineInstructions(fallbackCriteria);
        }
        try {
            const gates = await this.gateSystem.gateLoader.loadGates(gateIds);
            if (!gates.length) {
                return this.buildInlineInstructions(fallbackCriteria);
            }
            const prompts = gates.map((gate) => ({
                gateId: gate.id,
                criteriaSummary: gate.description || gate.guidance || gate.name,
                promptTemplate: gate.guidance,
                previousResponse: "",
                explicitInstructions: gate.guidance
                    ? gate.guidance
                        .split("\n")
                        .map((line) => line.trim())
                        .filter(Boolean)
                    : [],
            }));
            const instructions = buildReviewInstructions(prompts);
            return instructions.join("\n");
        }
        catch (error) {
            this.logger.warn("[GateCoordinator] Failed to build gate instructions", {
                error: error instanceof Error ? error.message : String(error),
            });
            return this.buildInlineInstructions(fallbackCriteria);
        }
    }
    formatStatus(validation) {
        if (!validation) {
            return "";
        }
        const total = validation.results?.length ?? 0;
        if (total === 0) {
            return validation.passed
                ? "\n\n---\n✅ **Quality Gates**: No issues detected\n"
                : "\n\n---\n⚠️ **Quality Gates**: Validation failed\n";
        }
        if (validation.passed) {
            return `\n\n---\n✅ **Quality Gates**: All checks passed (${total} gate${total === 1 ? "" : "s"})\n`;
        }
        const failed = (validation.results || []).filter((result) => !result.passed);
        let message = `\n\n---\n⚠️ **Quality Gates**: ${failed.length} of ${total} failed\n\n`;
        for (const result of failed) {
            message += `❌ **${result.gate}**: ${result.message}\n`;
        }
        return message;
    }
    buildInlineInstructions(criteria) {
        const instructions = [
            "Inline Validation Reminder",
            "Review the inline quality criteria before finalizing your response.",
        ];
        if (criteria.length) {
            instructions.push(`Criteria: ${criteria.join("; ")}`);
        }
        return instructions.join("\n");
    }
}
//# sourceMappingURL=gate-coordinator.js.map