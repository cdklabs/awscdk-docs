import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { jest } from '@jest/globals';

/** What one in-process CLI run printed, and the exit code it set. */
export interface CliRun {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | undefined;
}

export function scratchDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/**
 * Run a CLI module in this process, so coverage sees it and its network modules can be mocked.
 *
 * The module runs `main()` on import, from `cwd` and `argv`. It does not export the promise, so the run waits for
 * the event loop to drain the mocked I/O.
 */
export async function runCli(
  modulePath: string,
  { cwd, args, env = {} }: { cwd: string; args: string[]; env?: Record<string, string | undefined> },
): Promise<CliRun> {
  const saved = { cwd: process.cwd(), argv: process.argv, exitCode: process.exitCode, env: { ...process.env } };
  const stdout: string[] = [];
  const stderr: string[] = [];
  const log = jest.spyOn(console, 'log').mockImplementation((...line) => void stdout.push(line.join(' ')));
  const error = jest.spyOn(console, 'error').mockImplementation((...line) => void stderr.push(line.join(' ')));
  try {
    process.chdir(cwd);
    process.argv = ['node', modulePath, ...args];
    process.exitCode = undefined;
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    jest.resetModules();
    await import(modulePath);
    for (let tick = 0; tick < 50; tick++) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    return { stdout: stdout.join('\n'), stderr: stderr.join('\n'), exitCode: process.exitCode as number | undefined };
  } finally {
    log.mockRestore();
    error.mockRestore();
    process.chdir(saved.cwd);
    process.argv = saved.argv;
    process.exitCode = saved.exitCode;
    process.env = saved.env;
  }
}
