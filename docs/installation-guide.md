# Installation and Setup Guide

This guide will walk you through the process of installing and setting up the Claude Custom Prompts server and admin UI.

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

Once you have the source code, install the dependencies for both the server and admin UI:

```bash
# Install server dependencies
cd server
npm install

# Install admin UI dependencies
cd ../admin-ui
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
    "file": "promptsConfig.json",
    "registrationMode": "name"
  },
  "transports": {
    "default": "stdio",
    "sse": { "enabled": false },
    "stdio": { "enabled": true }
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
- **prompts.registrationMode**: How prompts are registered with the MCP server (options: id, name, both)
- **transports.default**: The default transport to use (options: stdio, sse)
- **transports.stdio.enabled**: Whether the stdio transport is enabled
- **transports.sse.enabled**: Whether the SSE transport is enabled
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

For more details on managing prompts, see the [Prompt Management](prompt-management.md) documentation.

### Admin UI Configuration

The admin UI configuration is stored in environment files:

- `.env.development`: Configuration for development environment
- `.env.production`: Configuration for production environment

The main configuration option is the API URL:

```
REACT_APP_API_URL=http://localhost:9090
```

Update this URL to match your server's address and port.

## Building the Application

### Build the Server

```bash
cd server
npm run build
```

### Build the Admin UI

```bash
cd admin-ui
npm run build
```

## Running the Application

### Start the Server

```bash
cd server
npm start
```

By default, the server will run on port 9090 (or the port specified in your config.json).

### Start the Admin UI (Development Mode)

```bash
cd admin-ui
npm start
```

This will start the admin UI in development mode, typically on port 3000.

### Start the Admin UI (Production Mode)

For production, you'll need to serve the built files using a static file server:

```bash
# Install a static file server if you don't have one
npm install -g serve

# Serve the built files
cd admin-ui/build
serve -s
```

## Verifying the Installation

1. Open a web browser and navigate to `http://localhost:9090/status` to verify that the server is running.
2. Navigate to `http://localhost:3000` (or your configured admin UI URL) to access the admin interface.

## Creating Your First Prompt

1. Log in to the admin UI.
2. Navigate to the "Categories" section and create a new category.
3. Navigate to the "Prompts" section and click "Create".
4. Fill in the prompt details:
   - ID: A unique identifier for the prompt
   - Name: A descriptive name
   - Category: Select the category you created
   - Description: A brief description of what the prompt does
   - System Message: Instructions for Claude's behavior (optional)
   - User Message Template: The template for the user message with placeholders
   - Arguments: Define the arguments used in the template
5. Click "Save" to create the prompt.

## Troubleshooting

### Server Won't Start

- Check if the port is already in use by another application.
- Verify that you have the correct Node.js version installed.
- Check the server logs in the configured logging directory.

### Admin UI Can't Connect to Server

- Verify that the server is running.
- Check that the API URL in the environment file is correct.
- Ensure there are no CORS issues by checking the browser console.

### Prompt Execution Fails

- Verify that the prompt ID is correct.
- Check that all required arguments are provided.
- Look for error messages in the server logs.

## Updating the Application

To update the application to a newer version:

1. Pull the latest changes or download the new source code.
2. Install any new dependencies:
   ```bash
   cd server
   npm install
   cd ../admin-ui
   npm install
   ```
3. Rebuild the application:
   ```bash
   cd server
   npm run build
   cd ../admin-ui
   npm run build
   ```
4. Restart the server and admin UI.

## Backup and Restore

### Backing Up Prompts

The prompts are stored in the `prompts.json` file in the server directory. To back up your prompts, simply copy this file to a safe location.

### Restoring Prompts

To restore prompts from a backup, replace the `prompts.json` file with your backup copy and restart the server.

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

### CORS Configuration

If you're running the admin UI and server on different domains, you may need to configure CORS. This is handled automatically by the server, but you can modify the CORS settings in the server code if needed.

### Running Behind a Proxy

If you're running the application behind a proxy (like Nginx or Apache), ensure that the proxy is configured to forward requests correctly to the server and admin UI.

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

Now that you have the Claude Custom Prompts server and admin UI up and running, you can:

1. Create more prompts and categories.
2. Experiment with chain prompts for complex workflows.
3. Integrate the API with your applications.
4. Contribute to the project by reporting issues or submitting pull requests.

Refer to the other documentation files for more detailed information on specific topics:

- [Prompt Format Guide](prompt-format-guide.md)
- [Chain Execution Guide](chain-execution-guide.md)
- [API Endpoints Reference](api-endpoints-reference.md)
- [Index.ts Reference](index-ts-reference.md)
