import { SandboxRuntime } from "../sandbox/sandboxRuntime.js";

const DEFAULT_MAX_STDOUT_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_STDERR_BYTES = 10 * 1024 * 1024;

export interface ShellExecOptions {
  maxStdoutBytes?: number;
  maxStderrBytes?: number;
}

export async function shellExec(
  runtime: SandboxRuntime,
  command: string,
  options: ShellExecOptions = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const result = await runtime.execCommand(command);
  const stdoutCap = options.maxStdoutBytes ?? DEFAULT_MAX_STDOUT_BYTES;
  const stderrCap = options.maxStderrBytes ?? DEFAULT_MAX_STDERR_BYTES;
  let stdout = result.stdout;
  let stderr = result.stderr;
  if (Buffer.byteLength(stdout, "utf8") > stdoutCap) {
    const cutoff = Math.floor(stdoutCap / 2);
    stdout = stdout.slice(0, cutoff) + "\n... [stdout truncated by SkillForge sandbox]";
  }
  if (Buffer.byteLength(stderr, "utf8") > stderrCap) {
    const cutoff = Math.floor(stderrCap / 2);
    stderr = stderr.slice(0, cutoff) + "\n... [stderr truncated by SkillForge sandbox]";
  }
  return { stdout, stderr, exitCode: result.exitCode };
}
