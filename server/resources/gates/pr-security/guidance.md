# PR Security Audit Gate

## Purpose

This gate ensures code changes do not introduce security vulnerabilities before merge approval.

## What to Check

### Injection Vulnerabilities

- SQL injection: Look for string concatenation in queries
- Command injection: Check for unsanitized input in exec/spawn calls
- XSS: Verify innerHTML, dangerouslySetInnerHTML usage is sanitized

### Authentication & Authorization

- Verify auth checks exist on protected routes
- Check for hardcoded credentials or secrets
- Ensure tokens are validated before use

### Input Validation

- All user input must be validated/sanitized
- File uploads should be type-checked
- URL parameters should be escaped

## Pass Criteria

- No hardcoded secrets or credentials
- All user input is validated before use
- Parameterized queries for database operations
- Proper escaping for rendered content

## Fail Response Format

When this gate fails, provide:

1. **Vulnerability type** (injection, XSS, auth bypass, etc.)
2. **Location** (file:line)
3. **Risk level** (Critical/High/Medium)
4. **Remediation** (specific fix)

Example:

```
GATE FAIL - Security vulnerability detected

Vulnerability: SQL Injection
Location: src/api/users.ts:47
Risk: Critical
Issue: User input passed directly to query string
Remediation: Use parameterized query: db.query('SELECT * FROM users WHERE id = ?', [userId])
```
