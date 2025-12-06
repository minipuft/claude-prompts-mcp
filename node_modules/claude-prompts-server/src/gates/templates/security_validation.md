# Security Validation Self-Check Template

## Instructions
Evaluate the security aspects of your response, especially for code generation and technical content.

## Security Assessment Criteria

### Code Security (if applicable)
- [ ] **No Hardcoded Secrets**: Code does not contain hardcoded passwords, API keys, or tokens
- [ ] **Input Validation**: All user inputs are properly validated and sanitized
- [ ] **SQL Injection Prevention**: Uses parameterized queries or prepared statements
- [ ] **Authentication**: Proper authentication mechanisms are implemented
- [ ] **Authorization**: Appropriate access controls are in place
- [ ] **HTTPS/TLS**: Secure communication protocols are used
- [ ] **Error Handling**: Errors don't expose sensitive information

### General Security Awareness
- [ ] **OWASP Compliance**: Follows OWASP Top 10 security guidelines
- [ ] **Rate Limiting**: API endpoints include rate limiting considerations
- [ ] **Logging Security**: Security events are logged without exposing sensitive data
- [ ] **Dependency Security**: Discusses keeping dependencies updated
- [ ] **Principle of Least Privilege**: Access is limited to minimum necessary

### Security Education
- [ ] **Vulnerability Awareness**: Addresses potential security vulnerabilities
- [ ] **Best Practices**: Includes security best practices and recommendations
- [ ] **Risk Assessment**: Identifies and discusses security risks
- [ ] **Mitigation Strategies**: Provides concrete security mitigation approaches

## Self-Assessment

**Overall Security Score (0.0-1.0): ___**

**Security Breakdown:**
- Code Security: ___/10
- Awareness: ___/10
- Education: ___/10
- Best Practices: ___/10

**Security Review:**
[Assess how well the response addresses security considerations]

**Identified Security Issues:**
[List any potential security concerns or missing security considerations]

**Security Improvements Needed:**
[Specific improvements if score < 0.85]

## Validation Response

Security assessment criteria:
- **PASS** if score ≥ 0.85 and no critical security issues identified
- **NEEDS_IMPROVEMENT** if score < 0.85 or contains security vulnerabilities

**Final Assessment: [PASS/NEEDS_IMPROVEMENT]**