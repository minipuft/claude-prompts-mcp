# Contributing Guidelines

Thank you for your interest in contributing to the Claude Prompts MCP Server! This document provides guidelines and instructions for contributing to this powerful Model Context Protocol server.

## Code of Conduct

Please be respectful and considerate of others when contributing to this project. We aim to foster an inclusive and welcoming community for developers working with AI prompt engineering and MCP servers.

## Getting Started

1. Fork the repository on GitHub
2. Clone your fork locally
3. Set up the development environment as described below
4. Create a new branch for your changes

## Development Workflow

### Setting Up the Development Environment

```bash
# Clone your fork
git clone https://github.com/your-username/claude-prompts-mcp.git
cd claude-prompts-mcp

# Install server dependencies
cd server
npm install

# Build the server
npm run build

# Start in development mode with hot-reload
npm run dev
```

### Project Structure

```
claude-prompts-mcp/
├── server/                    # Main MCP server
│   ├── src/                   # TypeScript source code
│   │   ├── orchestration/     # Application orchestration and startup
│   │   ├── mcp-tools/         # MCP tool implementations
│   │   ├── prompts/           # Prompt management system
│   │   ├── api/               # REST API endpoints (SSE transport)
│   │   ├── config/            # Configuration management
│   │   ├── logging/           # Logging system
│   │   ├── transport/         # Transport layer (STDIO/SSE)
│   │   ├── types/             # TypeScript type definitions
│   │   └── utils/             # Utility functions
│   ├── prompts/               # Distributed prompt configuration
│   │   └── examples/          # Example prompts
│   ├── dist/                  # Compiled JavaScript output
│   ├── config.json            # Server configuration
│   ├── promptsConfig.json     # Main prompts configuration
│   └── package.json           # Node.js dependencies
├── docs/                      # Documentation
└── README.md                  # Project overview
```

## Making Changes

### Server Development

The server is built with Node.js, Express, and TypeScript, using a sophisticated orchestration system. Key areas for contribution:

**Core Systems:**

- `src/orchestration/index.ts` - Application orchestration and lifecycle management
- `src/mcp-tools/index.ts` - MCP tool registration and implementation
- `src/prompts/index.ts` - Prompt management and template processing
- `src/api/index.ts` - REST API for SSE transport mode

**Configuration System:**

- `config.json` - Server configuration
- `promptsConfig.json` - Main prompts configuration with category imports
- `prompts/*/prompts.json` - Category-specific prompt definitions

When making changes to the server:

1. **Follow TypeScript Best Practices**: Use proper type definitions and interfaces
2. **Maintain the Orchestration Pattern**: Respect the phased startup sequence
3. **Add Comprehensive Error Handling**: Use the existing error handling patterns
4. **Update Tests**: Add or update tests for new functionality
5. **Document Changes**: Update relevant documentation

### Prompt Development

The server uses a distributed prompt configuration system:

**Adding New Prompts:**

1. Choose or create a category in `prompts/`
2. Add your prompt markdown file to the category directory
3. Register the prompt in the category's `prompts.json` file
4. Test the prompt using the MCP tools

**Creating New Categories:**

1. Create a new directory under `prompts/`
2. Create a `prompts.json` file in the directory
3. Add the category to `promptsConfig.json`
4. Add the import path to the imports array

**Prompt Format Guidelines:**

- Use clear, descriptive markdown format
- Define all arguments with proper descriptions
- Include system messages when appropriate
- Test with various input scenarios

### Documentation Updates

Documentation is written in Markdown and stored in the `docs/` directory. When updating documentation:

1. **Keep It Accurate**: Ensure all examples and references match the actual codebase
2. **Use Clear Examples**: Provide practical, working examples
3. **Update Cross-References**: Check for broken internal links
4. **Follow the Style Guide**: Maintain consistency with existing documentation

## Testing

### Server Tests

```bash
cd server
npm test
```

### Manual Testing with Claude Desktop

1. Build the server: `npm run build`
2. Update your `claude_desktop_config.json` to point to your development build
3. Restart Claude Desktop
4. Test your changes using the `>>` or `/` command syntax

### Prompt Testing

Test prompts using the built-in MCP tools:

```bash
# List all available prompts
>>listprompts

# Test a specific prompt
>>your_prompt_id argument="test value"

# Test with JSON arguments
>>complex_prompt {"arg1": "value1", "arg2": "value2"}
```

## Pull Request Process

1. **Create a Feature Branch**: Create a descriptive branch name
2. **Make Focused Changes**: Keep PRs focused on a single feature or bug fix
3. **Write Clear Commit Messages**: Use descriptive commit messages
4. **Test Thoroughly**: Ensure all tests pass and manual testing is complete
5. **Update Documentation**: Update relevant documentation
6. **Submit the PR**: Include a clear description of changes and their purpose

### Pull Request Guidelines

- **Clear Descriptions**: Explain what the PR does and why
- **Link Related Issues**: Reference any related GitHub issues
- **Include Examples**: Show how new features work
- **Breaking Changes**: Clearly mark any breaking changes
- **Performance Impact**: Note any performance implications

## Code Style and Standards

### TypeScript Standards

- **Strict Type Checking**: Use TypeScript's strict mode
- **Interface Definitions**: Create interfaces for complex data structures
- **Proper Error Handling**: Use typed error handling patterns
- **Documentation**: Add JSDoc comments for public APIs

### Code Organization

- **Modular Architecture**: Follow the existing module structure
- **Separation of Concerns**: Keep different functionalities in separate modules
- **Dependency Injection**: Use the orchestration pattern for module dependencies
- **Configuration-Driven**: Make features configurable when appropriate

### Naming Conventions

- **Files**: Use kebab-case for file names (`prompt-manager.ts`)
- **Classes**: Use PascalCase (`ApplicationOrchestrator`)
- **Functions**: Use camelCase (`loadAndConvertPrompts`)
- **Constants**: Use UPPER_SNAKE_CASE (`CONFIG_FILE`)

## Architecture Guidelines

### MCP Server Development

When extending the MCP server:

1. **Use the Orchestration System**: Register new modules through the orchestrator
2. **Implement Health Checks**: Add health monitoring for new components
3. **Support Hot-Reload**: Ensure new features work with the hot-reload system
4. **Handle Multiple Transports**: Consider both STDIO and SSE transport modes

### Prompt System Development

When extending the prompt system:

1. **Maintain Backward Compatibility**: Don't break existing prompt formats
2. **Use Nunjucks Templates**: Leverage the advanced templating features
3. **Support Text References**: Handle long content through the reference system
4. **Validate Input**: Use Zod or similar for input validation

## Performance Considerations

- **Memory Usage**: Be mindful of memory consumption in long-running processes
- **Hot-Reload Efficiency**: Ensure changes don't unnecessarily reload the entire system
- **Template Processing**: Optimize template rendering for frequently-used prompts
- **Error Recovery**: Implement graceful error recovery for robust operation

## Security Guidelines

- **Input Validation**: Validate all user inputs using proper schemas
- **Path Traversal**: Prevent directory traversal attacks in file operations
- **Error Information**: Don't leak sensitive information in error messages
- **Configuration Security**: Handle sensitive configuration data appropriately

## Versioning

We use [Semantic Versioning](https://semver.org/):

- **MAJOR**: Incompatible API changes or breaking prompt format changes
- **MINOR**: New functionality in a backward-compatible manner
- **PATCH**: Backward-compatible bug fixes

## Release Process

1. Update version numbers in `package.json`
2. Update the changelog
3. Create a release branch
4. Test the release thoroughly
5. Create a GitHub release with proper release notes

## Reporting Issues

When reporting issues, please include:

1. **Clear Description**: Describe the issue clearly and concisely
2. **Reproduction Steps**: Provide step-by-step reproduction instructions
3. **Expected vs Actual**: Clearly state expected and actual behavior
4. **Environment Details**: Include OS, Node.js version, and Claude Desktop version
5. **Logs and Screenshots**: Attach relevant logs or screenshots
6. **Minimal Example**: Provide a minimal example that reproduces the issue

## Feature Requests

Feature requests should include:

1. **Use Case Description**: Explain the real-world problem being solved
2. **Proposed Solution**: Describe your proposed approach
3. **Alternatives Considered**: Mention alternative solutions you've considered
4. **Implementation Ideas**: Share any implementation thoughts

## Community

- **GitHub Issues**: For bug reports and feature requests
- **GitHub Discussions**: For general questions and community discussion
- **Pull Requests**: For code contributions and improvements

## Getting Help

If you need help while contributing:

1. Check the documentation in the `docs/` directory
2. Look for similar issues or PRs in the GitHub repository
3. Ask questions in GitHub Discussions
4. Review the codebase for patterns and examples

## Recognition

We appreciate all contributions to the project! Contributors will be:

- Listed in the project contributors
- Acknowledged in release notes for significant contributions
- Invited to help shape the project's future direction

## License

By contributing to this project, you agree that your contributions will be licensed under the project's MIT License.

---

Thank you for contributing to the Claude Prompts MCP Server! Your contributions help make AI prompt engineering more powerful and accessible for developers worldwide. 🚀
