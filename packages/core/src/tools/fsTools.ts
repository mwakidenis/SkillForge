import * as fs from "node:fs/promises";
import { Dirent } from "node:fs";
import * as path from "node:path";
import { SandboxRuntime } from "../sandbox/sandboxRuntime.js";
import { SandboxViolationError } from "../errors/SkillForgeError.js";

export interface ReadOptions {
  startLine?: number;
  endLine?: number;
}

async function loadGitignorePatterns(workspaceRoot: string): Promise<string[]> {
  try {
    const content = await fs.readFile(path.join(workspaceRoot, ".gitignore"), "utf8");
    return content.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  } catch {
    return [];
  }
}

function matchesGitignore(relativePosix: string, patterns: string[]): boolean {
  for (const pat of patterns) {
    const negate = pat.startsWith("!");
    const p = negate ? pat.slice(1) : pat;
    if (p.endsWith("/")) {
      const prefix = p.slice(0, -1);
      if (relativePosix === prefix || relativePosix.startsWith(prefix + "/")) return negate ? false : true;
    } else if (relativePosix === p || relativePosix.startsWith(p + "/") || relativePosix.endsWith("/" + p)) {
      return negate ? false : true;
    }
  }
  return false;
}

export async function fsRead(runtime: SandboxRuntime, requestedPath: string, options: ReadOptions = {}): Promise<string> {
  const content = await runtime.readFile(requestedPath);
  const lines = content.split(/\r?\n/);
  const start = Math.max(1, options.startLine ?? 1) - 1;
  const end = Math.min(lines.length, options.endLine ?? lines.length);
  if (start >= end) return "";
  return lines.slice(start, end).join("\n");
}

export async function fsWrite(runtime: SandboxRuntime, requestedPath: string, content: string): Promise<void> {
  await runtime.writeFile(requestedPath, content);
}

export async function fsList(
  runtime: SandboxRuntime,
  requestedPath: string,
  options: { depth?: number } = {},
): Promise<string[]> {
  const depth = Math.max(1, options.depth ?? 10);
  const safeRoot = runtime.pathGuard.resolveSafePath(requestedPath, "read");
  const gitignore = await loadGitignorePatterns(runtime.policy.workspaceRoot);
  const results: string[] = [];

  async function walk(dir: string, currentDepth: number): Promise<void> {
    if (currentDepth > depth) return;
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(runtime.policy.workspaceRoot, full).replace(/\\/g, "/");
      if (matchesGitignore(rel, gitignore)) continue;
      results.push(rel);
      if (entry.isDirectory() && currentDepth < depth) {
        await walk(full, currentDepth + 1);
      }
    }
  }

  await walk(safeRoot, 1);
  return results;
}

export async function fsDelete(runtime: SandboxRuntime, requestedPath: string): Promise<void> {
  await runtime.deleteFile(requestedPath);
}
