/**
 * Field validation and error handling utilities
 */

import { ValidationError } from "../../../utils/index.js";
import { ValidationContext } from "../core/types.js";

/**
 * Action-specific parameter requirements and examples
 */
const ACTION_REQUIREMENTS: Record<string, { required: string[], example: string }> = {
  create: {
    required: ['id', 'name', 'description', 'user_message_template'],
    example: `{action:'create', id:'my_prompt', name:'My Prompt', description:'What it does', user_message_template:'Process {{input}}'}`
  },
  create_prompt: {
    required: ['id', 'name', 'description', 'user_message_template'],
    example: `{action:'create_prompt', id:'simple_prompt', name:'Simple', description:'Basic prompt', user_message_template:'{{text}}'}`
  },
  create_template: {
    required: ['id', 'name', 'description', 'user_message_template'],
    example: `{action:'create_template', id:'smart_template', name:'Template', description:'Advanced', user_message_template:'{{input}}'}`
  },
  create_with_gates: {
    required: ['id', 'name', 'description', 'user_message_template'],
    example: `{action:'create_with_gates', id:'gated', name:'Gated', description:'With gates', user_message_template:'{{x}}', gate_configuration:{include:['validation']}}`
  },
  update: {
    required: ['id'],
    example: `{action:'update', id:'existing_prompt', description:'Updated description'}`
  },
  delete: {
    required: ['id'],
    example: `{action:'delete', id:'prompt_to_remove'}`
  },
  modify: {
    required: ['id', 'section_name', 'new_content'],
    example: `{action:'modify', id:'my_prompt', section_name:'description', new_content:'New text'}`
  },
  analyze_type: {
    required: ['id'],
    example: `{action:'analyze_type', id:'my_prompt'}`
  },
  migrate_type: {
    required: ['id', 'target_type'],
    example: `{action:'migrate_type', id:'my_prompt', target_type:'template'}`
  },
  analyze_gates: {
    required: ['id'],
    example: `{action:'analyze_gates', id:'my_prompt'}`
  },
  update_gates: {
    required: ['id', 'gate_configuration'],
    example: `{action:'update_gates', id:'my_prompt', gate_configuration:{include:['validation', 'quality']}}`
  },
  add_temporary_gates: {
    required: ['id', 'temporary_gates'],
    example: `{action:'add_temporary_gates', id:'my_prompt', temporary_gates:[{type:'validation', name:'custom', description:'...'}]}`
  },
  suggest_temporary_gates: {
    required: ['execution_context'],
    example: `{action:'suggest_temporary_gates', execution_context:{executionType:'chain', category:'analysis'}}`
  }
};

/**
 * Validate required fields in operation arguments with contextual error messages
 */
export function validateRequiredFields(args: any, required: string[]): void {
  const missing: string[] = [];

  for (const field of required) {
    if (!args[field]) {
      missing.push(field);
    }
  }

  if (missing.length > 0) {
    const action = args.action || 'unknown';
    const actionInfo = ACTION_REQUIREMENTS[action];

    let errorMessage = `❌ Missing required fields for action '${action}': ${missing.join(', ')}\n\n`;

    if (actionInfo) {
      errorMessage += `📋 Required parameters: ${actionInfo.required.join(', ')}\n`;
      errorMessage += `📚 Example: ${actionInfo.example}\n\n`;
    }

    errorMessage += `💡 TIP: Check the 'action' parameter description for complete requirements.\n`;
    errorMessage += `📖 See: docs/mcp-tool-usage-guide.md for detailed examples`;

    throw new ValidationError(errorMessage);
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