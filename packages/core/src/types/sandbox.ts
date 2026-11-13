export type SandboxOperation = "read" | "write" | "delete";

export interface SandboxPolicy {
  workspaceRoot: string;
  deniedPatterns: string[];
  allowedCommands: string[];
  allowNetwork: boolean;
  maxSteps: number;
  timeoutMs: number;
  maxFileWriteBytes: number;
  maxTotalWrites: number;
}

export interface SandboxAuditEntry {
  timestamp: string;
  tool: string;
  operation: SandboxOperation | "shell.exec" | "git";
  path?: string;
  command?: string;
  args?: unknown[];
  durationMs: number;
  bytesRead?: number;
  bytesWritten?: number;
  verdict: "allow" | "deny";
  reason?: string;
}

export interface SandboxRuntimeConfig extends SandboxPolicy {
  auditLedger: SandboxAuditEntry[];
}
