// @lifecycle canonical - Type definitions for prompt engine internals.
/**
 * Prompt Engine Core Types
 *
 * Contains all interfaces and types used by the prompt engine system,
 * including chain execution, formatting, and classification types.
 */
/**
 * Step lifecycle state values used when tracking chain execution progress.
 */
export var StepState;
(function (StepState) {
    StepState["PENDING"] = "pending";
    StepState["RENDERED"] = "rendered";
    StepState["RESPONSE_CAPTURED"] = "response_captured";
    StepState["COMPLETED"] = "completed";
})(StepState || (StepState = {}));
//# sourceMappingURL=types.js.map