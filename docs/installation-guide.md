# Installation and Setup Guide

This guide will walk you through the process of installing and setting up the Claude Custom Prompts server.

## Prerequisites

Before you begin, ensure you have the following installed:

- [Node.js](https://nodejs.org/) (v14 or later)
- [npm](https://www.npmjs.com/) (v6 or later)
- [Git](https://git-scm.com/) (optional, for cloning the repository)

## System Requirements

- **Operating System**: Windows, macOS, or Linux
- **Memory**: At least 2GB RAM
- **Disk Space**: At least 500MB free space

## Installation

### Option 1: Clone the Repository

If you have Git installed, you can clone the repository:

```bash
git clone https://github.com/minipuft/claude-prompts.git
cd claude-prompts
```

### Option 2: Download the Source Code

Alternatively, you can download the source code as a ZIP file and extract it.

### Install Dependencies

Once you have the source code, install the dependencies for both the server:

```bash
# Install server dependencies
cd server
npm install
```

## Configuration

### Server Configuration

The server configuration is stored in `server/config.json`. You can modify this file to change the server settings:

```json
{
  "server": {
    "name": "Claude Custom Prompts",
    "version": "1.0.0",
    "port": 9090
  },
  "prompts": {
    "file": "promptsConfig.json"
  },
  "transports": {
    "default": "stdio"
  },
  "logging": {
    "directory": "./logs",
    "level": "info"
  }
}
```

Key configuration options:

- **server.port**: The port on which the server will run (default: 9090)
- **prompts.file**: The main prompts configuration file (default: promptsConfig.json)
- **transports.default**: The default transport to use (options: stdio, sse)
- **logging.directory**: The directory where logs will be stored (default: ./logs)
- **logging.level**: The logging level (options: debug, info, warn, error)

### Prompts Configuration

The prompts configuration is distributed across multiple files:

1. **promptsConfig.json**: The main configuration file that defines categories and imports category-specific prompts.json files
2. **Category-specific prompts.json files**: Each category has its own prompts.json file in its directory

#### Main Configuration (promptsConfig.json)

```json
{
  "categories": [
    {
      "id": "general",
      "name": "General",
      "description": "General-purpose prompts for everyday tasks"
    },
    {
      "id": "code",
      "name": "Code",
      "description": "Prompts related to programming and software development"
    }
  ],
  "imports": ["prompts/general/prompts.json", "prompts/code/prompts.json"]
}
```

## Creating Your First Prompt

### Prompt Execution Fails

## Updating the Application

To update the application to a newer version:

1. Pull the latest changes or download the new source code.
2. Install any new dependencies:
   ```bash
   cd server
   npm install
   ```
3. Rebuild the application:
   ```bash
   cd server
   npm run build
   ```
4. Restart the server.

## Backup and Restore

### Backing Up Prompts

The prompts are stored in the `/prompts' folder in the server directory. To back up your prompts, simply copy this folder to a safe location.

### Restoring Prompts

To restore prompts from a backup, drop in your copy of the '/prompts' directory and restart the server.

## Advanced Configuration

### Custom Logging

You can customize the logging behavior by modifying the logging section in `config.json`:

```json
"logging": {
  "directory": "./custom-logs",
  "level": "debug",
  "maxFiles": 10,
  "maxSize": "10m"
}
```

## Security Considerations

- The server does not implement authentication by default. Consider running it in a secure environment or implementing your own authentication layer.
- Regularly back up your prompts to prevent data loss.
- Keep your Node.js and npm packages updated to avoid security vulnerabilities.

## Getting Help

If you encounter issues or have questions:

1. Check the documentation in the `docs` directory.
2. Look for error messages in the server logs.
3. Contact the maintainers or community for support.

## Next Steps

Now that you have the Claude Custom Prompts server up and running, you can:

1. Create more prompts and categories.
2. Experiment with chain prompts for complex processes.
3. Integrate the API with your applications.
4. Contribute to the project by reporting issues or submitting pull requests.
