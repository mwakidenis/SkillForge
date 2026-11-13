import * as path from "node:path";
import type { SandboxPolicy } from "../types/sandbox.js";
import { SandboxViolationError } from "../errors/SkillForgeError.js";

const META_CHARS = new Set([";", "&", "|", "`", "$", "(", ")", ">", "<", "\n", "\r"]);

const SENSITIVE_ENV_PREFIXES = [
  "AWS_",
  "OPENAI_",
  "ANTHROPIC_",
  "GITHUB_",
  "GIT_",
  "SKILLFORGE_",
];
const SENSITIVE_ENV_PATTERNS = /(SECRET|TOKEN|PASSWORD|CREDENTIAL|API_KEY|PRIVATE_KEY)/i;

export function tokenizeCommand(command: string): string[] {
  const tokens: string[] = [];
  let cur = "";
  let inSingle = false;
  let inDouble = false;
  for (let k = 0; k < command.length; k++) {
    const ch = command[k];
    if (inSingle) {
      if (ch === "'") inSingle = false;
      else cur += ch;
      continue;
    }
    if (inDouble) {
      if (ch === '"') inDouble = false;
      else cur += ch;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === " " || ch === "\t") {
      if (cur !== "") {
        tokens.push(cur);
        cur = "";
      }
      continue;
    }
    cur += ch;
  }
  if (cur !== "") tokens.push(cur);
  return tokens;
}

export function hasMetacharacterOutsideQuotes(command: string): boolean {
  let inSingle = false;
  let inDouble = false;
  for (let k = 0; k < command.length; k++) {
    const ch = command[k];
    if (inSingle) {
      if (ch === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (ch === '"') inDouble = false;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (META_CHARS.has(ch ?? "")) {
      return true;
    }
  }
  return false;
}

export class CommandGuard {
  public readonly allowedCommands: string[];
  private readonly allowedTokens: string[][];

  constructor(allowedCommands: string[]) {
    this.allowedCommands = allowedCommands;
    this.allowedTokens = allowedCommands.map((c) => tokenizeCommand(c));
  }

  validateCommand(command: string): { executable: string; args: string[] } {
    if (command === null || command === undefined) {
      throw new SandboxViolationError({
        message: "Command is null or undefined",
        code: "SANDBOX_VIOLATION",
        attemptedCommand: String(command),
        policyRule: "null-command",
      });
    }
    if (hasMetacharacterOutsideQuotes(command)) {
      throw new SandboxViolationError({
        message: "Shell metacharacter detected outside quoted arguments",
        code: "SANDBOX_VIOLATION",
        attemptedCommand: command,
        policyRule: "no-metacharacters",
      });
    }
    const tokens = tokenizeCommand(command);
    if (tokens.length === 0) {
      throw new SandboxViolationError({
        message: "Empty command",
        code: "SANDBOX_VIOLATION",
        attemptedCommand: command,
        policyRule: "empty-command",
      });
    }
    const executable = tokens[0];
    const permitted = this.allowedTokens.some((allowed) => {
      if (tokens.length < allowed.length) return false;
      for (let k = 0; k < allowed.length; k++) {
        if (tokens[k] !== allowed[k]) return false;
      }
      return true;
    });
    if (!permitted) {
      throw new SandboxViolationError({
        message: `Command not in allowlist: ${executable}`,
        code: "SANDBOX_VIOLATION",
        attemptedCommand: command,
        policyRule: "allowedCommands",
        context: { executable, args: tokens.slice(1), allowedCommands: this.allowedCommands },
      });
    }
    return { executable: executable ?? "", args: tokens.slice(1) };
  }

  scrubEnvironment(env: Record<string, string> = {}): Record<string, string> {
    const cleaned: Record<string, string> = {};
    for (const [key, value] of Object.entries(env)) {
      if (this.isSensitiveEnv(key)) continue;
      cleaned[key] = value;
    }
    return cleaned;
  }

  private isSensitiveEnv(key: string): boolean {
    const upper = key.toUpperCase();
    for (const prefix of SENSITIVE_ENV_PREFIXES) {
      if (upper.startsWith(prefix)) return true;
    }
    return SENSITIVE_ENV_PATTERNS.test(upper);
  }
}

export function createCommandGuard(allowedCommands: string[]): CommandGuard {
  return new CommandGuard(allowedCommands);
}
