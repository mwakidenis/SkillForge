import type { ToolDefinition } from "../types/provider.js";
import { SandboxRuntime } from "../sandbox/sandboxRuntime.js";

export interface RegisteredTool {
  name: string;
  definition: ToolDefinition;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();

  register(tool: RegisteredTool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  list(): string[] {
    return Array.from(this.tools.keys());
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }
}

export function createToolRegistry(): ToolRegistry {
  return new ToolRegistry();
}

export function builtinToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: "fs.read",
      description: "Read a UTF-8 file within the workspace, with optional line slicing.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path relative to workspace root" },
          startLine: { type: "number", description: "1-based start line" },
          endLine: { type: "number", description: "1-based end line (inclusive)" },
        },
        required: ["path"],
      },
    },
    {
      name: "fs.write",
      description: "Atomically write a UTF-8 file within the workspace.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path relative to workspace root" },
          content: { type: "string", description: "File content" },
        },
        required: ["path", "content"],
      },
    },
    {
      name: "fs.list",
      description: "Recursively list a directory within the workspace.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Directory path relative to workspace root" },
          depth: { type: "number", description: "Maximum recursion depth" },
        },
        required: ["path"],
      },
    },
    {
      name: "fs.delete",
      description: "Delete a file within the workspace.",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string", description: "Path relative to workspace root" } },
        required: ["path"],
      },
    },
    {
      name: "shell.exec",
      description: "Execute an allowlisted command within the workspace.",
      inputSchema: {
        type: "object",
        properties: { command: { type: "string", description: "Allowlisted command to execute" } },
        required: ["command"],
      },
    },
  ];
}
