/**
 * Field validation and error handling utilities
 */

import { ValidationError } from "../../../utils/index.js";
import { ValidationContext } from "../core/types.js";

/**
 * Validate required fields in operation arguments
 */
export function validateRequiredFields(args: any, required: string[]): void {
  const missing: string[] = [];

  for (const field of required) {
    if (!args[field]) {
      missing.push(field);
    }
  }

  if (missing.length > 0) {
    throw new ValidationError(`Missing required fields: ${missing.join(', ')}`);
  }
}

/**
 * Validate operation arguments with context
 */
export function validateOperationArgs(
  args: any,
  operation: string,
  required: string[]
): ValidationContext {
  const providedFields = Object.keys(args);

  validateRequiredFields(args, required);

  return {
    operation,
    requiredFields: required,
    providedFields
  };
}

/**
 * Validate prompt ID format
 */
export function validatePromptId(id: string): void {
  if (!id || typeof id !== 'string') {
    throw new ValidationError('Prompt ID must be a non-empty string');
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new ValidationError('Prompt ID must contain only alphanumeric characters, underscores, and hyphens');
  }

  if (id.length > 100) {
    throw new ValidationError('Prompt ID must be 100 characters or less');
  }
}

/**
 * Validate category name format
 */
export function validateCategoryName(category: string): void {
  if (!category || typeof category !== 'string') {
    throw new ValidationError('Category must be a non-empty string');
  }

  if (category.length > 50) {
    throw new ValidationError('Category name must be 50 characters or less');
  }
}

/**
 * Validate execution mode
 */
export function validateExecutionMode(mode: string): void {
  const validModes = ['prompt', 'template', 'chain'];

  if (!validModes.includes(mode)) {
    throw new ValidationError(`Invalid execution mode: ${mode}. Must be one of: ${validModes.join(', ')}`);
  }
}

/**
 * Validate target type for migration
 */
export function validateMigrationType(targetType: string): void {
  const validTypes = ['prompt', 'template', 'chain'];

  if (!validTypes.includes(targetType)) {
    throw new ValidationError(`Invalid target type: ${targetType}. Must be one of: ${validTypes.join(', ')}`);
  }
}

/**
 * Validate prompt content structure
 */
export function validatePromptContent(content: any): void {
  if (!content) {
    throw new ValidationError('Prompt content cannot be empty');
  }

  if (typeof content !== 'object') {
    throw new ValidationError('Prompt content must be an object');
  }

  if (!content.user_message_template && !content.userMessageTemplate) {
    throw new ValidationError('Prompt must have a user message template');
  }
}

/**
 * Validate prompt arguments structure
 */
export function validatePromptArguments(args: any[]): void {
  if (!Array.isArray(args)) {
    throw new ValidationError('Arguments must be an array');
  }

  for (const arg of args) {
    if (!arg.name || typeof arg.name !== 'string') {
      throw new ValidationError('Each argument must have a name');
    }

    if (!arg.type || typeof arg.type !== 'string') {
      throw new ValidationError('Each argument must have a type');
    }

    if (!arg.description || typeof arg.description !== 'string') {
      throw new ValidationError('Each argument must have a description');
    }
  }
}

/**
 * Sanitize user input for safe processing
 */
export function sanitizeInput(input: string): string {
  if (typeof input !== 'string') {
    return '';
  }

  // Remove potentially dangerous characters
  return input
    .replace(/[<>]/g, '') // Remove angle brackets
    .replace(/javascript:/gi, '') // Remove javascript: protocol
    .replace(/on\w+=/gi, '') // Remove event handlers
    .trim();
}

/**
 * Validate filter syntax
 */
export function validateFilterSyntax(filter: string): void {
  if (!filter || typeof filter !== 'string') {
    return; // Empty filter is valid
  }

  // Check for balanced quotes
  const quotes = filter.match(/"/g);
  if (quotes && quotes.length % 2 !== 0) {
    throw new ValidationError('Unbalanced quotes in filter expression');
  }

  // Validate filter patterns
  const validFilterPatterns = [
    /^type:\w+$/,
    /^category:[a-z-_]+$/,
    /^intent:[a-z-_\s]+$/i,
    /^confidence:[<>]?\d+(?:-\d+)?$/,
    /^execution:(required|optional)$/,
    /^gates:(yes|no)$/
  ];

  const filterParts = filter.split(/\s+/);
  for (const part of filterParts) {
    if (part.includes(':')) {
      const isValid = validFilterPatterns.some(pattern => pattern.test(part));
      if (!isValid) {
        throw new ValidationError(`Invalid filter syntax: ${part}`);
      }
    }
  }
}