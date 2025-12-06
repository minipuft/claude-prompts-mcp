# Code Quality Self-Check Template

## Instructions
Evaluate the code you've generated against industry best practices and quality standards.

## Code Quality Criteria

### Error Handling & Robustness
- [ ] **Error Handling**: Includes appropriate try-catch blocks or error handling
- [ ] **Input Validation**: Validates inputs and handles edge cases
- [ ] **Boundary Conditions**: Considers boundary conditions and null/undefined cases
- [ ] **Graceful Degradation**: Fails gracefully with meaningful error messages

### Code Structure & Readability
- [ ] **Clear Naming**: Uses descriptive, consistent naming conventions
- [ ] **Comments**: Includes inline comments for complex logic
- [ ] **Function Size**: Functions are focused and reasonably sized
- [ ] **Code Organization**: Well-structured and logically organized

### Best Practices
- [ ] **Security**: Follows security best practices (no hardcoded secrets, input sanitization)
- [ ] **Performance**: Considers performance implications
- [ ] **Maintainability**: Easy to understand and modify
- [ ] **Documentation**: Includes basic function documentation/docstrings

### Code Quality Indicators
- [ ] **No TODO/FIXME**: No placeholder comments or incomplete code
- [ ] **Consistent Style**: Follows consistent coding style
- [ ] **Modern Patterns**: Uses appropriate modern language features
- [ ] **Testing Ready**: Code structure supports testing

## Self-Assessment

**Overall Code Quality Score (0.0-1.0): ___**

**Quality Breakdown:**
- Error Handling: ___/10
- Readability: ___/10
- Security: ___/10
- Maintainability: ___/10

**Code Review Notes:**
[Describe the strengths and weaknesses of the generated code]

**Specific Improvements Needed:**
[List concrete improvements if score < 0.8]

## Validation Response

Based on your assessment:
- **PASS** if score ≥ 0.8 and no critical security/error handling issues
- **NEEDS_IMPROVEMENT** if score < 0.8 or has critical flaws

**Final Assessment: [PASS/NEEDS_IMPROVEMENT]**