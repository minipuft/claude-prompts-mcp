/**
 * Interface Contract Validation System (JavaScript version)
 *
 * Validates that mock objects fully implement expected interfaces to prevent
 * runtime method missing errors like the registerTool issue.
 */

/**
 * MCP SDK Interface Contract Validator
 *
 * Prevents interface mismatches by validating mock objects against real SDK interfaces
 */
export class McpSdkInterfaceValidator {
  constructor(logger) {
    this.logger = logger;
  }

  /**
   * Validate tool registration interface compatibility
   * Specifically addresses the registerTool method mismatch issue
   */
  async validateToolRegistrationInterface(mockServer) {
    const requiredMethods = [
      'tool',           // Existing method in MockMcpServer
      'registerTool'    // Missing method that caused CI failure
    ];

    const missingMethods = [];
    const incompatibleSignatures = [];

    // Check for missing methods
    for (const method of requiredMethods) {
      if (typeof mockServer[method] !== 'function') {
        missingMethods.push(method);
      }
    }

    // Validate method signatures if they exist
    if (typeof mockServer.tool === 'function') {
      const toolMethod = mockServer.tool;
      if (toolMethod.length < 3) {
        incompatibleSignatures.push({
          method: 'tool',
          expected: 'tool(name: string, description: string, schema: any)',
          actual: `tool with ${toolMethod.length} parameters`
        });
      }
    }

    if (typeof mockServer.registerTool === 'function') {
      const registerToolMethod = mockServer.registerTool;
      if (registerToolMethod.length < 3) {
        incompatibleSignatures.push({
          method: 'registerTool',
          expected: 'registerTool(name: string, config: any, handler: Function)',
          actual: `registerTool with ${registerToolMethod.length} parameters`
        });
      }
    }

    // Generate recommendations
    const recommendations = [];
    if (missingMethods.includes('registerTool')) {
      recommendations.push('Add registerTool method that delegates to existing tool method');
      recommendations.push('Ensure registerTool accepts (name, config, handler) parameters');
    }

    const isValid = missingMethods.length === 0 && incompatibleSignatures.length === 0;

    return {
      isValid,
      missingMethods,
      incompatibleSignatures,
      recommendations
    };
  }

  /**
   * Comprehensive method signature validation
   */
  validateMethodSignatures(mockObject, expectedMethods) {
    const missingMethods = [];
    const incompatibleSignatures = [];

    for (const [methodName, expectedParamCount] of Object.entries(expectedMethods)) {
      if (typeof mockObject[methodName] !== 'function') {
        missingMethods.push(methodName);
      } else {
        const actualParamCount = mockObject[methodName].length;
        if (actualParamCount !== expectedParamCount) {
          incompatibleSignatures.push({
            method: methodName,
            expected: `${expectedParamCount} parameters`,
            actual: `${actualParamCount} parameters`
          });
        }
      }
    }

    return {
      isValid: missingMethods.length === 0 && incompatibleSignatures.length === 0,
      missingMethods,
      incompatibleSignatures,
      recommendations: []
    };
  }

  /**
   * Generate comprehensive validation report
   */
  async generateContractReport(mockServer, mockObjectName = 'MockMcpServer') {
    this.logger.debug(`[CONTRACT VALIDATOR] Generating report for ${mockObjectName}`);

    const validationResult = await this.validateToolRegistrationInterface(mockServer);
    const validatedMethods = ['tool', 'registerTool'].filter(method =>
      typeof mockServer[method] === 'function'
    );

    return {
      mockObjectName,
      referenceInterface: 'MCP SDK Server Interface',
      validationResult,
      timestamp: new Date(),
      validatedMethods
    };
  }

  /**
   * Quick validation check for CI/testing
   */
  async quickValidation(mockServer) {
    const result = await this.validateToolRegistrationInterface(mockServer);

    if (!result.isValid) {
      this.logger.error('[CONTRACT VALIDATOR] Interface validation failed:', {
        missingMethods: result.missingMethods,
        incompatibleSignatures: result.incompatibleSignatures,
        recommendations: result.recommendations
      });
    }

    return result.isValid;
  }
}

/**
 * Factory function for creating validator instance
 */
export function createMcpSdkInterfaceValidator(logger) {
  return new McpSdkInterfaceValidator(logger);
}