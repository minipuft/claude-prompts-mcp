// Temporary test file to validate pre-commit hook blocks lint errors
// This file should trigger ESLint error (explicit any type)
export const testLintError = (data) => {
    // Explicit 'any' type is banned by ESLint configuration
    const result = data;
    return result;
};
//# sourceMappingURL=test-lint-error.js.map