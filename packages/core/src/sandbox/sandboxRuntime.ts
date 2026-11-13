import * as fs from "node:fs/promises";
import { Dirent } from "node:fs";
import * as path from "node:path";
import * as child_process from "node:child_process";
import type { SandboxPolicy, SandboxAuditEntry } from "../types/sandbox.js";
import { PathGuard } from "./pathGuard.js";
import { CommandGuard } from "./commandGuard.js";
import { SandboxViolationError } from "../errors/SkillForgeError.js";

const DEFAULT_MAX_FILE_WRITE_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_WRITES = 50 * 1024 * 1024;

export class SandboxRuntime {
  public readonly policy: SandboxPolicy;
  public readonly pathGuard: PathGuard;
  public readonly commandGuard: CommandGuard;
  public readonly auditLedger: SandboxAuditEntry[] = [];
  private totalWrites = 0;

  constructor(policy: Partial<SandboxPolicy> & { workspaceRoot: string }, pathGuard?: PathGuard, commandGuard?: CommandGuard) {
    this.pathGuard = pathGuard ?? new PathGuard(policy.workspaceRoot, policy.deniedPatterns);
    this.commandGuard = commandGuard ?? new CommandGuard(policy.allowedCommands ?? []);
    this.policy = {
      workspaceRoot: this.pathGuard.workspaceRoot,
      deniedPatterns: this.pathGuard.deniedPatterns,
      allowedCommands: this.commandGuard.allowedCommands,
      allowNetwork: policy.allowNetwork ?? false,
      maxSteps: policy.maxSteps ?? 10,
      timeoutMs: policy.timeoutMs ?? 60000,
      maxFileWriteBytes: policy.maxFileWriteBytes ?? DEFAULT_MAX_FILE_WRITE_BYTES,
      maxTotalWrites: policy.maxTotalWrites ?? DEFAULT_MAX_TOTAL_WRITES,
    };
  }

  private audit(
    tool: string,
    operation: "read" | "write" | "delete" | "shell.exec" | "git",
    verdict: "allow" | "deny",
    fields: { path?: string; command?: string; args?: unknown[]; durationMs: number; bytesRead?: number; bytesWritten?: number; reason?: string },
  ): void {
    this.auditLedger.push({
      timestamp: new Date().toISOString(),
      tool,
      operation,
      ...fields,
      verdict,
    });
  }

  async readFile(requestedPath: string): Promise<string> {
    const start = Date.now();
    let safePath: string;
    try {
      safePath = this.pathGuard.resolveSafePath(requestedPath, "read");
    } catch (cause) {
      this.audit("fs.read", "read", "deny", {
        path: requestedPath,
        durationMs: Date.now() - start,
        reason: (cause as Error).message,
      });
      throw cause;
    }
    let content: string;
    try {
      content = await fs.readFile(safePath, "utf8");
    } catch (cause) {
      this.audit("fs.read", "read", "deny", {
        path: safePath,
        durationMs: Date.now() - start,
        reason: (cause as Error).message,
      });
      throw cause;
    }
    this.audit("fs.read", "read", "allow", {
      path: safePath,
      durationMs: Date.now() - start,
      bytesRead: Buffer.byteLength(content, "utf8"),
    });
    return content;
  }

  async writeFile(requestedPath: string, content: string): Promise<void> {
    const start = Date.now();
    const bytes = Buffer.byteLength(content, "utf8");
    if (bytes > this.policy.maxFileWriteBytes) {
      this.audit("fs.write", "write", "deny", {
        path: requestedPath,
        durationMs: Date.now() - start,
        bytesWritten: bytes,
        reason: `exceeds maxFileWriteBytes (${this.policy.maxFileWriteBytes})`,
      });
      throw new SandboxViolationError({
        message: `Write exceeds maxFileWriteBytes: ${bytes} bytes`,
        code: "SANDBOX_VIOLATION",
        attemptedPath: requestedPath,
        policyRule: "max-file-write-bytes",
      });
    }
    if (this.totalWrites + bytes > this.policy.maxTotalWrites) {
      this.audit("fs.write", "write", "deny", {
        path: requestedPath,
        durationMs: Date.now() - start,
        bytesWritten: bytes,
        reason: `exceeds maxTotalWrites (${this.policy.maxTotalWrites})`,
      });
      throw new SandboxViolationError({
        message: "Write exceeds maxTotalWrites",
        code: "SANDBOX_VIOLATION",
        attemptedPath: requestedPath,
        policyRule: "max-total-writes",
      });
    }
    let safePath: string;
    try {
      safePath = this.pathGuard.resolveSafePath(requestedPath, "write");
    } catch (cause) {
      this.audit("fs.write", "write", "deny", {
        path: requestedPath,
        durationMs: Date.now() - start,
        bytesWritten: bytes,
        reason: (cause as Error).message,
      });
      throw cause;
    }
    try {
      await fs.mkdir(path.dirname(safePath), { recursive: true });
      const tmp = safePath + ".tmp." + Date.now() + "." + process.pid;
      await fs.writeFile(tmp, content, "utf8");
      await fs.rename(tmp, safePath);
    } catch (cause) {
      this.audit("fs.write", "write", "deny", {
        path: safePath,
        durationMs: Date.now() - start,
        bytesWritten: bytes,
        reason: (cause as Error).message,
      });
      throw cause;
    }
    this.totalWrites += bytes;
    this.audit("fs.write", "write", "allow", {
      path: safePath,
      durationMs: Date.now() - start,
      bytesWritten: bytes,
    });
  }

  async listDir(requestedPath: string): Promise<string[]> {
    const start = Date.now();
    let safePath: string;
    try {
      safePath = this.pathGuard.resolveSafePath(requestedPath, "read");
    } catch (cause) {
      this.audit("fs.list", "read", "deny", {
        path: requestedPath,
        durationMs: Date.now() - start,
        reason: (cause as Error).message,
      });
      throw cause;
    }
    let entries: Dirent[];
    try {
      entries = await fs.readdir(safePath, { withFileTypes: true });
    } catch (cause) {
      this.audit("fs.list", "read", "deny", {
        path: safePath,
        durationMs: Date.now() - start,
        reason: (cause as Error).message,
      });
      throw cause;
    }
    const results: string[] = [];
    for (const entry of entries) {
      const rel = path.relative(this.policy.workspaceRoot, path.join(safePath, entry.name)).replace(/\\/g, "/");
      let denied = false;
      for (const regex of (this.pathGuard as any).patternRegexes) {
        if (regex.test(rel)) { denied = true; break; }
      }
      if (denied) continue;
      results.push(entry.name);
    }
    this.audit("fs.list", "read", "allow", {
      path: safePath,
      durationMs: Date.now() - start,
    });
    return results;
  }

  async deleteFile(requestedPath: string): Promise<void> {
    const start = Date.now();
    let safePath: string;
    try {
      safePath = this.pathGuard.resolveSafePath(requestedPath, "delete");
    } catch (cause) {
      this.audit("fs.delete", "delete", "deny", {
        path: requestedPath,
        durationMs: Date.now() - start,
        reason: (cause as Error).message,
      });
      throw cause;
    }
    try {
      await fs.unlink(safePath);
    } catch (cause) {
      this.audit("fs.delete", "delete", "deny", {
        path: safePath,
        durationMs: Date.now() - start,
        reason: (cause as Error).message,
      });
      throw cause;
    }
    this.audit("fs.delete", "delete", "allow", {
      path: safePath,
      durationMs: Date.now() - start,
    });
  }

  async execCommand(command: string): Promise<{ stdout: string; stderr: string; exitCode: number; durationMs: number }> {
    const start = Date.now();
    let parsed: { executable: string; args: string[] };
    try {
      parsed = this.commandGuard.validateCommand(command);
    } catch (cause) {
      this.audit("shell.exec", "shell.exec", "deny", {
        command,
        durationMs: Date.now() - start,
        reason: (cause as Error).message,
      });
      throw cause;
    }
    const env = this.commandGuard.scrubEnvironment(process.env as Record<string, string>);
    return new Promise<{ stdout: string; stderr: string; exitCode: number; durationMs: number }>((resolve, reject) => {
      const child = child_process.spawn(parsed.executable, parsed.args, {
        cwd: this.policy.workspaceRoot,
        env,
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        try { child.kill("SIGKILL"); } catch {}
      }, this.policy.timeoutMs);
      child.stdout.on("data", (d) => { stdout += d.toString(); });
      child.stderr.on("data", (d) => { stderr += d.toString(); });
      child.on("error", (cause) => {
        clearTimeout(timer);
        this.audit("shell.exec", "shell.exec", "deny", {
          command,
          durationMs: Date.now() - start,
          reason: (cause as Error).message,
        });
        reject(cause);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        const durationMs = Date.now() - start;
        const exitCode = typeof code === "number" ? code : timedOut ? -1 : 1;
        if (timedOut) {
          this.audit("shell.exec", "shell.exec", "deny", {
            command,
            durationMs,
            reason: `timeout after ${this.policy.timeoutMs}ms`,
          });
          reject(new SandboxViolationError({
            message: `Command timed out after ${this.policy.timeoutMs}ms`,
            code: "SANDBOX_VIOLATION",
            attemptedCommand: command,
            policyRule: "timeout",
          }));
          return;
        }
        this.audit("shell.exec", "shell.exec", "allow", {
          command,
          durationMs,
        });
        resolve({ stdout, stderr: stderr ?? "", exitCode, durationMs });
      });
    });
  }
}

export function createSandboxRuntime(policy: Partial<SandboxPolicy> & { workspaceRoot: string }): SandboxRuntime {
  return new SandboxRuntime(policy);
}

export type { SandboxAuditEntry };
