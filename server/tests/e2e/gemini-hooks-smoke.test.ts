import { describe, it, expect } from '@jest/globals';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../../..');

function runHook(cmd: string, input: object): Promise<{ code: number; stdout: string; stderr: string }>{
  return new Promise((resolve) => {
    const [executable, ...args] = cmd.split(' ');
    const proc = spawn(executable, args, { cwd: PROJECT_ROOT });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => (stdout += d.toString()));
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
    proc.stdin.write(JSON.stringify(input));
    proc.stdin.end();
  });
}

describe('Gemini Hooks Smoke', () => {
  it('BeforeAgent wrapper emits additionalContext', async () => {
    const script = path.join(PROJECT_ROOT, '.gemini', 'hooks', 'prompt-suggest.py');
    const input = {
      session_id: 'test-session',
      hook_event_name: 'BeforeAgent',
      prompt: '>>diagnose'
    };
    const { code, stdout } = await runHook(`python3 ${script}`, input);
    expect(code).toBe(0);
    // Allow empty cache case; just validate JSON shape if any output
    if (stdout.trim()) {
      const parsed = JSON.parse(stdout);
      expect(parsed.hookSpecificOutput.hookEventName).toBe('BeforeAgent');
      expect(typeof parsed.hookSpecificOutput.additionalContext).toBe('string');
    }
  });

  it('AfterTool wrapper accepts prompt_engine response and emits additionalContext', async () => {
    const script = path.join(PROJECT_ROOT, '.gemini', 'hooks', 'post-prompt-engine.py');
    const input = {
      session_id: 'test-session',
      hook_event_name: 'AfterTool',
      tool_name: 'prompt_engine',
      tool_response: {
        content: [
          { text: 'Step 1 of 2' },
          { text: '## Inline Gates\n### code-quality\n- checklist item' }
        ]
      }
    };
    const { code, stdout } = await runHook(`python3 ${script}`, input);
    expect(code).toBe(0);
    if (stdout.trim()) {
      const parsed = JSON.parse(stdout);
      expect(parsed.hookSpecificOutput.hookEventName).toBe('AfterTool');
      expect(typeof parsed.hookSpecificOutput.additionalContext).toBe('string');
    }
  });
});

