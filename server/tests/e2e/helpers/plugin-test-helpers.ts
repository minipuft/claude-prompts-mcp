/**
 * Plugin Test Helpers
 *
 * Shared utilities for E2E plugin validation tests.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';

/**
 * Check if a file exists
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a file is executable
 */
export async function isExecutable(filePath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(filePath);
    return (stats.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

/**
 * Load and parse a JSON file
 */
export async function loadJson<T>(filePath: string): Promise<T> {
  const content = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(content) as T;
}

/**
 * Extract script paths from hook commands
 * Handles both Claude Code (${CLAUDE_PLUGIN_ROOT}) and Gemini (${extensionPath}) variables
 */
export function extractScriptPaths(command: string, projectRoot: string): string[] {
  const matches = command.match(/\$\{[^}]+\}\/[^\s"']+/g) || [];
  return matches.map((m) =>
    m
      .replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, projectRoot)
      .replace(/\$\{extensionPath\}/g, projectRoot)
      .replace(/\$\{\/\}/g, path.sep)
  );
}

/**
 * Spawn MCP server and wait for it to be ready
 */
export async function spawnMcpServer(
  serverPath: string,
  projectRoot: string,
  options: { timeout?: number } = {}
): Promise<{ process: ChildProcess; kill: () => void }> {
  const timeout = options.timeout || 5000;

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      serverProcess.kill();
      reject(new Error('Server startup timeout'));
    }, timeout);

    const serverProcess = spawn('node', [serverPath, '--transport=stdio'], {
      cwd: path.join(projectRoot, 'server'),
      env: {
        ...process.env,
        MCP_WORKSPACE: projectRoot,
        MCP_RESOURCES_PATH: path.join(projectRoot, 'server', 'resources'),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    serverProcess.on('error', (err) => {
      clearTimeout(timeoutId);
      reject(err);
    });

    // Give server time to start
    setTimeout(() => {
      clearTimeout(timeoutId);
      resolve({
        process: serverProcess,
        kill: () => serverProcess.kill(),
      });
    }, 1000);
  });
}

/**
 * Send JSON-RPC request to MCP server and get response
 */
export async function sendMcpRequest(
  serverProcess: ChildProcess,
  method: string,
  params: Record<string, unknown> = {},
  id: number = 1
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timeout waiting for response to ${method}`));
    }, 5000);

    const request = JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      params,
    });

    let response = '';

    const onData = (data: Buffer) => {
      response += data.toString();

      try {
        const lines = response.split('\n').filter((l) => l.trim());
        for (const line of lines) {
          const parsed = JSON.parse(line);
          if (parsed.id === id) {
            clearTimeout(timeout);
            serverProcess.stdout?.off('data', onData);

            if (parsed.error) {
              reject(new Error(parsed.error.message));
            } else {
              resolve(parsed.result);
            }
            return;
          }
        }
      } catch {
        // Keep collecting
      }
    };

    serverProcess.stdout?.on('data', onData);
    serverProcess.stdin?.write(request + '\n');
  });
}

/**
 * Validate that all files in a list exist
 */
export async function validateFilesExist(files: string[]): Promise<{ missing: string[] }> {
  const missing: string[] = [];

  for (const file of files) {
    if (!(await fileExists(file))) {
      missing.push(file);
    }
  }

  return { missing };
}

/**
 * Get all files matching a pattern in a directory
 */
export async function getFilesWithExtension(dir: string, extension: string): Promise<string[]> {
  try {
    const files = await fs.readdir(dir);
    return files.filter((f) => f.endsWith(extension)).map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}
