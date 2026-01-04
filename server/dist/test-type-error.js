// Temporary test file to validate pre-commit hook blocks type errors
// This file should trigger typecheck failure
export const testTypeError = () => {
    const numberValue = 'this is a string'; // Type error: string assigned to number
    return numberValue;
};
//# sourceMappingURL=test-type-error.js.map