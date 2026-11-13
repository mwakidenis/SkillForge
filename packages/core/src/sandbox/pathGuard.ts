import * as fs from "node:fs";
import * as path from "node:path";
import type { SandboxPolicy, SandboxAuditEntry, SandboxOperation } from "../types/sandbox.js";
import { SandboxViolationError } from "../errors/SkillForgeError.js";

const DEFAULT_DENIED_PATTERNS: string[] = [
  ".git/**",
  "**/.env*",
  "**/*.pem",
  "**/*.key",
  "**/id_rsa*",
  "**/secrets.*",
];

function globToRegex(pattern: string): RegExp {
  let regex = "";
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === "*" && pattern[i + 1] === "*") {
      i += 2;
      if (pattern[i] === "/") i++;
      regex += ".*";
    } else if (c === "*") {
      regex += "[^/]*";
      i++;
    } else if (c === "?") {
      regex += "[^/]";
      i++;
    } else if ("^$+().|{}[]\\".includes(c ?? "")) {
      regex += "\\" + (c ?? "");
      i++;
    } else {
      regex += c;
      i++;
    }
  }
  return new RegExp("^" + regex + "$");
}

export class PathGuard {
  public readonly workspaceRoot: string;
  public readonly workspaceReal: string;
  public readonly deniedPatterns: string[];
  private readonly patternRegexes: RegExp[];

  constructor(workspaceRoot: string, deniedPatterns?: string[]) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.workspaceReal = fs.realpathSync(this.workspaceRoot);
    this.deniedPatterns = deniedPatterns ?? DEFAULT_DENIED_PATTERNS;
    this.patternRegexes = this.deniedPatterns.map((p) => globToRegex(p));
  }

  private isWithinWorkspace(realPath: string): boolean {
    return realPath === this.workspaceReal || realPath.startsWith(this.workspaceReal + path.sep);
  }

  private checkDenied(relativePath: string, label: string): void {
    const posix = relativePath.replace(/\\/g, "/");
    for (let k = 0; k < this.patternRegexes.length; k++) {
      const regex = this.patternRegexes[k];
    if (regex && regex.test(posix)) {
        throw new SandboxViolationError({
          message: `Path denied by policy: ${label}`,
          code: "SANDBOX_VIOLATION",
          attemptedPath: label,
          policyRule: `denied pattern: ${this.deniedPatterns[k]}`,
          context: { resolvedPath: relativePath, pattern: this.deniedPatterns[k] },
        });
      }
    }
  }

  resolveSafePath(requestedPath: string, operation: SandboxOperation): string {
    if (requestedPath === null || requestedPath === undefined) {
      throw new SandboxViolationError({
        message: "Requested path is null or undefined",
        code: "SANDBOX_VIOLATION",
        attemptedPath: String(requestedPath),
        policyRule: "null-path",
        context: { operation },
      });
    }
    if (String(requestedPath).includes("\0")) {
      throw new SandboxViolationError({
        message: "Null byte detected in requested path",
        code: "SANDBOX_VIOLATION",
        attemptedPath: String(requestedPath),
        policyRule: "null-byte",
        context: { operation },
      });
    }

    const resolved = path.resolve(this.workspaceRoot, String(requestedPath));

    // Walk existing ancestors (including resolved) and verify each realpath stays inside workspace.
    let current = resolved;
    const checked = new Set<string>();
    for (let depth = 0; depth < 64; depth++) {
      if (checked.has(current)) break;
      checked.add(current);
      let real: string;
      try {
        real = fs.realpathSync(current);
      } catch {
        real = current;
      }
      if (!this.isWithinWorkspace(real)) {
        throw new SandboxViolationError({
          message: `Path escapes workspace root: ${current}`,
          code: "SANDBOX_VIOLATION",
          attemptedPath: String(requestedPath),
          policyRule: "symlink-escape",
          context: { operation, resolvedPath: current, realPath: real, workspaceRoot: this.workspaceReal },
        });
      }
      if (current === this.workspaceRoot || current === this.workspaceReal) break;
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }

    const resolvedReal: string = (() => {
      try {
        return fs.realpathSync(resolved);
      } catch {
        return resolved;
      }
    })();
    if (!this.isWithinWorkspace(resolvedReal)) {
      throw new SandboxViolationError({
        message: `Resolved path escapes workspace root: ${resolved}`,
        code: "SANDBOX_VIOLATION",
        attemptedPath: String(requestedPath),
        policyRule: "path-escape",
        context: { operation, resolvedPath: resolved, realPath: resolvedReal, workspaceRoot: this.workspaceReal },
      });
    }

    const relative = path.relative(this.workspaceRoot, resolvedReal);
    this.checkDenied(relative, String(requestedPath));
    const relativeResolved = path.relative(this.workspaceRoot, resolved);
    this.checkDenied(relativeResolved, String(requestedPath));

    return resolved;
  }
}

export function createPathGuard(workspaceRoot: string, deniedPatterns?: string[]): PathGuard {
  return new PathGuard(workspaceRoot, deniedPatterns);
}

export type { SandboxAuditEntry };
