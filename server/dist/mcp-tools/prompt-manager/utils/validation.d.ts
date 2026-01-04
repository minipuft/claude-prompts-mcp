/**
 * Field validation and error handling utilities
 */
import { ValidationContext } from '../core/types.js';
import type { ToolDefinitionInput } from '../../resource-manager/core/types.js';
/**
 * Validate required fields in operation arguments with contextual error messages
 */
export declare function validateRequiredFields(args: any, required: string[]): void;
/**
 * Validate operation arguments with context
 */
export declare function validateOperationArgs(args: any, operation: string, required: string[]): ValidationContext;
/**
 * Validate prompt ID format
 */
export declare function validatePromptId(id: string): void;
/**
 * Validate category name format
 */
export declare function validateCategoryName(category: string): void;
/**
 * Validate execution mode
 */
/**
 * Validate prompt content structure
 */
export declare function validatePromptContent(content: any): void;
/**
 * Validate prompt arguments structure
 */
export declare function validatePromptArguments(args: any[]): void;
/**
 * Validate tool definitions for inline tool creation
 * Returns array of error messages (empty if valid)
 */
export declare function validateToolDefinitions(tools: ToolDefinitionInput[]): string[];
/**
 * Sanitize user input for safe processing
 */
export declare function sanitizeInput(input: string): string;
/**
 * Validate filter syntax
 */
export declare function validateFilterSyntax(filter: string): void;
