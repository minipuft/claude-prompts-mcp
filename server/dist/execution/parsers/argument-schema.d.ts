import { type ZodTypeAny } from 'zod';
import type { ConvertedPrompt } from '../../types/index.js';
export interface SchemaValidationIssue {
    argument: string;
    message: string;
    code?: string;
}
export interface SchemaValidationResult {
    success: boolean;
    issues: SchemaValidationIssue[];
}
export type PromptSchemaOverrides = Record<string, ZodTypeAny>;
export declare class ArgumentSchemaValidator {
    private readonly overrides;
    private readonly cache;
    constructor(overrides?: PromptSchemaOverrides);
    validate(prompt: ConvertedPrompt, args: Record<string, any>): SchemaValidationResult;
    private getSchema;
    private buildSchema;
    private createArgumentSchema;
    private createArraySchema;
    private createObjectSchema;
    /**
     * Apply common constraints to any schema type.
     * Note: allowedValues was removed in v3.0.0 - LLM handles semantic variation better
     * than strict enum enforcement.
     */
    private applyCommonConstraints;
    private applyStringConstraints;
}
