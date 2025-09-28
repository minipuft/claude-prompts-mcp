/**
 * Enhanced Validation System with Contextual Suggestions
 *
 * Provides comprehensive validation with helpful error messages,
 * suggestions for fixes, and examples of correct usage.
 */

import { ValidationResult } from '../types/shared-types.js';
import { ValidationHelpers } from '../error-handler.js';
import {
  VALIDATION_PATTERNS,
  LIMITS,
  CATEGORIES,
  FRAMEWORKS,
  ERROR_MESSAGES
} from '../constants.js';

/**
 * Enhanced validator with contextual suggestions and examples
 */
export class EnhancedValidator {
  /**
   * Validate prompt creation data
   */
  static validatePromptCreation(data: Record<string, unknown>): ValidationResult {
    const errors: ValidationResult['errors'] = [];
    const warnings: ValidationResult['warnings'] = [];

    // Required fields validation
    this.validateRequiredFields(data, ['id', 'name', 'description'], errors);

    // ID validation
    this.validatePromptId(data.id, errors);

    // Name validation
    this.validateName(data.name, errors);

    // Description validation
    this.validateDescription(data.description, errors);

    // Category validation
    this.validateCategory(data.category, errors, warnings);

    // User message template validation
    this.validateUserMessageTemplate(data.user_message_template, data, errors, warnings);

    // Arguments validation
    this.validateArguments(data.arguments, errors, warnings);

    // Chain steps validation (if applicable)
    this.validateChainSteps(data.chain_steps, errors, warnings);

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
      warnings: warnings.length > 0 ? warnings : undefined
    };
  }

  /**
   * Validate prompt update data
   */
  static validatePromptUpdate(data: Record<string, unknown>): ValidationResult {
    const errors: ValidationResult['errors'] = [];
    const warnings: ValidationResult['warnings'] = [];

    // ID is required for updates
    this.validateRequiredFields(data, ['id'], errors);

    // Validate provided fields (but don't require all fields for updates)
    if (data.name !== undefined) {
      this.validateName(data.name, errors);
    }

    if (data.description !== undefined) {
      this.validateDescription(data.description, errors);
    }

    if (data.category !== undefined) {
      this.validateCategory(data.category, errors, warnings);
    }

    if (data.user_message_template !== undefined) {
      this.validateUserMessageTemplate(data.user_message_template, data, errors, warnings);
    }

    if (data.arguments !== undefined) {
      this.validateArguments(data.arguments, errors, warnings);
    }

    if (data.chain_steps !== undefined) {
      this.validateChainSteps(data.chain_steps, errors, warnings);
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
      warnings: warnings.length > 0 ? warnings : undefined
    };
  }

  /**
   * Validate system control operations
   */
  static validateSystemControlOperation(data: Record<string, unknown>): ValidationResult {
    const errors: ValidationResult['errors'] = [];
    const warnings: ValidationResult['warnings'] = [];

    // Action is required
    this.validateRequiredFields(data, ['action'], errors);

    // Validate action and operation combination
    this.validateActionOperation(data.action, data.operation, errors);

    // Framework validation (if applicable)
    if (data.framework !== undefined) {
      this.validateFramework(data.framework, errors);
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
      warnings: warnings.length > 0 ? warnings : undefined
    };
  }

  /**
   * Validate required fields with enhanced messages
   */
  private static validateRequiredFields(
    data: Record<string, unknown>,
    requiredFields: string[],
    errors: NonNullable<ValidationResult['errors']>
  ): void {
    requiredFields.forEach(field => {
      if (!(field in data) || data[field] === undefined || data[field] === null || data[field] === '') {
        errors.push({
          field,
          message: ERROR_MESSAGES.REQUIRED_FIELD(field),
          code: 'REQUIRED_FIELD_MISSING',
          suggestion: this.getFieldSuggestion(field),
          example: this.getFieldExample(field)
        });
      }
    });
  }

  /**
   * Validate prompt ID
   */
  private static validatePromptId(
    id: unknown,
    errors: NonNullable<ValidationResult['errors']>
  ): void {
    if (typeof id !== 'string') {
      errors.push({
        field: 'id',
        message: 'Prompt ID must be a string',
        code: 'INVALID_TYPE',
        suggestion: 'Use a string identifier for the prompt',
        example: '"my_prompt_id"'
      });
      return;
    }

    if (!VALIDATION_PATTERNS.PROMPT_ID.test(id)) {
      errors.push({
        field: 'id',
        message: 'Prompt ID must contain only alphanumeric characters, underscores, and hyphens',
        code: 'INVALID_FORMAT',
        suggestion: 'Use only letters, numbers, underscores, and hyphens',
        example: '"error_handling_prompt" or "data-analysis-chain"'
      });
    }

    if (id.length < LIMITS.MIN_NAME_LENGTH || id.length > LIMITS.MAX_NAME_LENGTH) {
      errors.push({
        field: 'id',
        message: ERROR_MESSAGES.LENGTH_CONSTRAINT('id', LIMITS.MIN_NAME_LENGTH, LIMITS.MAX_NAME_LENGTH),
        code: 'LENGTH_CONSTRAINT',
        suggestion: `Keep ID between ${LIMITS.MIN_NAME_LENGTH} and ${LIMITS.MAX_NAME_LENGTH} characters`,
        example: '"analysis_prompt" (14 characters)'
      });
    }
  }

  /**
   * Validate name field
   */
  private static validateName(
    name: unknown,
    errors: NonNullable<ValidationResult['errors']>
  ): void {
    if (typeof name !== 'string') {
      errors.push({
        field: 'name',
        message: 'Name must be a string',
        code: 'INVALID_TYPE',
        suggestion: 'Provide a descriptive name for the prompt',
        example: '"Error Analysis Prompt"'
      });
      return;
    }

    if (name.length < LIMITS.MIN_NAME_LENGTH || name.length > LIMITS.MAX_NAME_LENGTH) {
      errors.push({
        field: 'name',
        message: ERROR_MESSAGES.LENGTH_CONSTRAINT('name', LIMITS.MIN_NAME_LENGTH, LIMITS.MAX_NAME_LENGTH),
        code: 'LENGTH_CONSTRAINT',
        suggestion: 'Use a clear, concise name that describes the prompt\'s purpose',
        example: '"Debug Code Issues" (18 characters)'
      });
    }
  }

  /**
   * Validate description field
   */
  private static validateDescription(
    description: unknown,
    errors: NonNullable<ValidationResult['errors']>
  ): void {
    if (typeof description !== 'string') {
      errors.push({
        field: 'description',
        message: 'Description must be a string',
        code: 'INVALID_TYPE',
        suggestion: 'Provide a clear description of what the prompt does',
        example: '"Analyzes code errors and suggests fixes"'
      });
      return;
    }

    if (description.length < LIMITS.MIN_DESCRIPTION_LENGTH || description.length > LIMITS.MAX_DESCRIPTION_LENGTH) {
      errors.push({
        field: 'description',
        message: ERROR_MESSAGES.LENGTH_CONSTRAINT('description', LIMITS.MIN_DESCRIPTION_LENGTH, LIMITS.MAX_DESCRIPTION_LENGTH),
        code: 'LENGTH_CONSTRAINT',
        suggestion: 'Write a detailed but concise description of the prompt\'s purpose and usage',
        example: '"This prompt helps analyze error messages and provides step-by-step debugging suggestions" (95 characters)'
      });
    }
  }

  /**
   * Validate category field
   */
  private static validateCategory(
    category: unknown,
    errors: NonNullable<ValidationResult['errors']>,
    warnings: NonNullable<ValidationResult['warnings']>
  ): void {
    if (category === undefined) {
      warnings.push({
        field: 'category',
        message: 'No category specified, will default to "general"',
        suggestion: 'Consider specifying a category for better organization'
      });
      return;
    }

    if (typeof category !== 'string') {
      errors.push({
        field: 'category',
        message: 'Category must be a string',
        code: 'INVALID_TYPE',
        suggestion: 'Choose from existing categories or create a new one',
        example: '"analysis", "development", or "debugging"'
      });
      return;
    }

    const validCategories = Object.values(CATEGORIES);
    if (!validCategories.includes(category as any)) {
      warnings.push({
        field: 'category',
        message: `Category "${category}" is not a standard category`,
        suggestion: `Consider using one of: ${validCategories.join(', ')}`
      });
    }
  }

  /**
   * Validate user message template
   */
  private static validateUserMessageTemplate(
    template: unknown,
    data: Record<string, unknown>,
    errors: NonNullable<ValidationResult['errors']>,
    warnings: NonNullable<ValidationResult['warnings']>
  ): void {
    // For chains, user message template is not required
    const isChain = Array.isArray(data.chain_steps) && data.chain_steps.length > 0;

    if (!isChain && (template === undefined || template === null || template === '')) {
      errors.push({
        field: 'user_message_template',
        message: 'User message template is required for prompts and templates',
        code: 'REQUIRED_FIELD_MISSING',
        suggestion: 'Provide the main template content using Nunjucks syntax',
        example: '"Analyze this {{input_type}}: {{content}}"'
      });
      return;
    }

    if (template === undefined) return; // Skip validation if not provided

    if (typeof template !== 'string') {
      errors.push({
        field: 'user_message_template',
        message: 'User message template must be a string',
        code: 'INVALID_TYPE',
        suggestion: 'Use a string with Nunjucks template syntax',
        example: '"Please analyze {{code}} and suggest improvements"'
      });
      return;
    }

    // Check for template variables and corresponding arguments
    const templateVars = this.extractTemplateVariables(template);
    const providedArgs = Array.isArray(data.arguments)
      ? (data.arguments as any[]).map(arg => arg.name)
      : [];

    const missingArgs = templateVars.filter(varName => !providedArgs.includes(varName));
    const unusedArgs = providedArgs.filter(argName => !templateVars.includes(argName));

    if (missingArgs.length > 0) {
      warnings.push({
        field: 'arguments',
        message: `Template uses variables not defined in arguments: ${missingArgs.join(', ')}`,
        suggestion: `Add arguments for: ${missingArgs.map(name => `{name: "${name}", required: true}`).join(', ')}`
      });
    }

    if (unusedArgs.length > 0) {
      warnings.push({
        field: 'arguments',
        message: `Arguments defined but not used in template: ${unusedArgs.join(', ')}`,
        suggestion: 'Either use these arguments in the template or remove them'
      });
    }
  }

  /**
   * Validate arguments array
   */
  private static validateArguments(
    args: unknown,
    errors: NonNullable<ValidationResult['errors']>,
    warnings: NonNullable<ValidationResult['warnings']>
  ): void {
    if (args === undefined) return; // Arguments are optional

    if (!Array.isArray(args)) {
      errors.push({
        field: 'arguments',
        message: 'Arguments must be an array',
        code: 'INVALID_TYPE',
        suggestion: 'Provide an array of argument objects',
        example: '[{"name": "input", "required": true, "description": "Input to analyze"}]'
      });
      return;
    }

    args.forEach((arg, index) => {
      if (typeof arg !== 'object' || arg === null) {
        errors.push({
          field: `arguments[${index}]`,
          message: 'Each argument must be an object',
          code: 'INVALID_TYPE',
          suggestion: 'Use object with name, required, and optional description',
          example: '{"name": "variable_name", "required": true, "description": "What this variable represents"}'
        });
        return;
      }

      const argObj = arg as Record<string, unknown>;

      // Validate argument name
      if (!argObj.name || typeof argObj.name !== 'string') {
        errors.push({
          field: `arguments[${index}].name`,
          message: 'Argument name is required and must be a string',
          code: 'REQUIRED_FIELD_MISSING',
          suggestion: 'Provide a valid variable name',
          example: '"input_text", "file_path", or "user_query"'
        });
      } else if (!VALIDATION_PATTERNS.ARGUMENT_NAME.test(argObj.name)) {
        errors.push({
          field: `arguments[${index}].name`,
          message: 'Argument name must be a valid identifier',
          code: 'INVALID_FORMAT',
          suggestion: 'Use letters, numbers, and underscores. Start with a letter or underscore.',
          example: '"user_input", "file_content", or "_private_var"'
        });
      }

      // Validate required field
      if (typeof argObj.required !== 'boolean') {
        errors.push({
          field: `arguments[${index}].required`,
          message: 'Argument required field must be a boolean',
          code: 'INVALID_TYPE',
          suggestion: 'Set to true if the argument is required, false if optional',
          example: 'true or false'
        });
      }

      // Description is optional but should be meaningful if provided
      if (argObj.description !== undefined && (typeof argObj.description !== 'string' || argObj.description.length === 0)) {
        warnings.push({
          field: `arguments[${index}].description`,
          message: 'Argument description should be a non-empty string if provided',
          suggestion: 'Provide a clear description of what this argument represents'
        });
      }
    });
  }

  /**
   * Validate chain steps
   */
  private static validateChainSteps(
    steps: unknown,
    errors: NonNullable<ValidationResult['errors']>,
    warnings: NonNullable<ValidationResult['warnings']>
  ): void {
    if (steps === undefined) return; // Chain steps are optional

    if (!Array.isArray(steps)) {
      errors.push({
        field: 'chain_steps',
        message: 'Chain steps must be an array',
        code: 'INVALID_TYPE',
        suggestion: 'Provide an array of step objects for chain execution',
        example: '[{"promptId": "analyze_step", "stepName": "Analysis Phase"}]'
      });
      return;
    }

    if (steps.length === 0) {
      errors.push({
        field: 'chain_steps',
        message: 'Chain must have at least one step',
        code: 'VALIDATION_ERROR',
        suggestion: 'Add at least one step to the chain',
        example: '[{"promptId": "first_step", "stepName": "Initial Processing"}]'
      });
      return;
    }

    steps.forEach((step, index) => {
      if (typeof step !== 'object' || step === null) {
        errors.push({
          field: `chain_steps[${index}]`,
          message: 'Each chain step must be an object',
          code: 'INVALID_TYPE',
          suggestion: 'Use object with promptId and stepName',
          example: '{"promptId": "analysis_prompt", "stepName": "Data Analysis"}'
        });
        return;
      }

      const stepObj = step as Record<string, unknown>;

      // Validate promptId
      if (!stepObj.promptId || typeof stepObj.promptId !== 'string') {
        errors.push({
          field: `chain_steps[${index}].promptId`,
          message: 'Step promptId is required and must be a string',
          code: 'REQUIRED_FIELD_MISSING',
          suggestion: 'Reference an existing prompt by its ID',
          example: '"error_analysis_prompt"'
        });
      }

      // Validate stepName
      if (!stepObj.stepName || typeof stepObj.stepName !== 'string') {
        errors.push({
          field: `chain_steps[${index}].stepName`,
          message: 'Step name is required and must be a string',
          code: 'REQUIRED_FIELD_MISSING',
          suggestion: 'Provide a descriptive name for this step',
          example: '"Initial Analysis", "Data Processing", or "Result Summary"'
        });
      } else if (stepObj.stepName.length > LIMITS.MAX_STEP_NAME_LENGTH) {
        warnings.push({
          field: `chain_steps[${index}].stepName`,
          message: `Step name is longer than ${LIMITS.MAX_STEP_NAME_LENGTH} characters`,
          suggestion: 'Use a shorter, more concise step name'
        });
      }
    });
  }

  /**
   * Validate action and operation combination for system control
   */
  private static validateActionOperation(
    action: unknown,
    operation: unknown,
    errors: NonNullable<ValidationResult['errors']>
  ): void {
    if (typeof action !== 'string') {
      errors.push({
        field: 'action',
        message: 'Action must be a string',
        code: 'INVALID_TYPE',
        suggestion: 'Use one of the valid action types',
        example: '"status", "framework", "analytics", "config", or "maintenance"'
      });
      return;
    }

    const validActions = ['status', 'framework', 'analytics', 'config', 'maintenance'];
    if (!validActions.includes(action)) {
      const suggestion = ValidationHelpers.createDidYouMeanSuggestion(action, validActions);
      errors.push({
        field: 'action',
        message: ERROR_MESSAGES.UNKNOWN_ACTION(action, validActions),
        code: 'INVALID_VALUE',
        suggestion: suggestion || 'Use one of the valid actions',
        example: '"status" for system overview'
      });
      return;
    }

    // Validate operation based on action
    if (operation !== undefined && typeof operation === 'string') {
      const validOperations = this.getValidOperationsForAction(action);
      if (validOperations.length > 0 && !validOperations.includes(operation)) {
        const suggestion = ValidationHelpers.createDidYouMeanSuggestion(operation, validOperations);
        errors.push({
          field: 'operation',
          message: ERROR_MESSAGES.UNKNOWN_OPERATION(operation, validOperations),
          code: 'INVALID_VALUE',
          suggestion: suggestion || `Use one of the valid operations for ${action}`,
          example: validOperations[0]
        });
      }
    }
  }

  /**
   * Validate framework name
   */
  private static validateFramework(
    framework: unknown,
    errors: NonNullable<ValidationResult['errors']>
  ): void {
    if (typeof framework !== 'string') {
      errors.push({
        field: 'framework',
        message: 'Framework must be a string',
        code: 'INVALID_TYPE',
        suggestion: 'Use one of the available framework names',
        example: '"CAGEERF", "ReACT", "5W1H", or "SCAMPER"'
      });
      return;
    }

    const validFrameworks = Object.values(FRAMEWORKS);
    if (!validFrameworks.includes(framework as any)) {
      const suggestion = ValidationHelpers.createDidYouMeanSuggestion(framework, validFrameworks);
      errors.push({
        field: 'framework',
        message: `Invalid framework: ${framework}`,
        code: 'INVALID_VALUE',
        suggestion: suggestion || 'Use one of the available frameworks',
        example: 'CAGEERF'
      });
    }
  }

  /**
   * Get field suggestion for common fields
   */
  private static getFieldSuggestion(field: string): string {
    const suggestions: Record<string, string> = {
      id: 'Use a unique identifier with letters, numbers, underscores, and hyphens only',
      name: 'Provide a clear, descriptive name for the prompt',
      description: 'Explain what the prompt does and when to use it',
      action: 'Choose from: status, framework, analytics, config, maintenance',
      operation: 'Specify the sub-operation within the chosen action'
    };

    return suggestions[field] || `Please provide a valid value for ${field}`;
  }

  /**
   * Get example for common fields
   */
  private static getFieldExample(field: string): string {
    const examples: Record<string, string> = {
      id: '"error_analysis_prompt"',
      name: '"Error Analysis Assistant"',
      description: '"Analyzes error messages and provides debugging suggestions"',
      action: '"status"',
      operation: '"overview"'
    };

    return examples[field] || '';
  }

  /**
   * Extract template variables from Nunjucks template
   */
  private static extractTemplateVariables(template: string): string[] {
    const variablePattern = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;
    const variables: string[] = [];
    let match;

    while ((match = variablePattern.exec(template)) !== null) {
      const varName = match[1];
      if (!variables.includes(varName)) {
        variables.push(varName);
      }
    }

    return variables;
  }

  /**
   * Get valid operations for a given action
   */
  private static getValidOperationsForAction(action: string): string[] {
    const operationMap: Record<string, string[]> = {
      status: ['overview', 'health', 'diagnostics', 'framework_status'],
      framework: ['switch', 'list', 'enable', 'disable'],
      analytics: ['view', 'reset', 'history'],
      config: ['get', 'set', 'list', 'validate', 'restore'],
      maintenance: ['restart']
    };

    return operationMap[action] || [];
  }
}