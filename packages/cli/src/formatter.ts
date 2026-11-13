export function supportsColor(): boolean {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR) return true;
  return Boolean(process.stdout && process.stdout.isTTY);
}

const color = supportsColor();

export function wrap(text: string, open: string, close: string): string {
  return color ? `${open}${text}${close}` : text;
}

export const bold = (s: string) => wrap(s, "\x1b[1m", "\x1b[22m");
export const dim = (s: string) => wrap(s, "\x1b[2m", "\x1b[22m");
export const green = (s: string) => wrap(s, "\x1b[32m", "\x1b[39m");
export const red = (s: string) => wrap(s, "\x1b[31m", "\x1b[39m");
export const yellow = (s: string) => wrap(s, "\x1b[33m", "\x1b[39m");
export const cyan = (s: string) => wrap(s, "\x1b[36m", "\x1b[39m");

export interface TableOptions {
  columns: { name: string; width?: number }[];
}

export function renderTable(rows: Record<string, string>[], options: TableOptions): string {
  const { columns } = options;
  const widths: Record<string, number> = {};
  for (const col of columns) {
    widths[col.name] = col.width ?? col.name.length;
  }
  for (const row of rows) {
    for (const col of columns) {
      const val = row[col.name] ?? "";
      widths[col.name] = Math.max(widths[col.name] ?? 0, val.length);
    }
  }

  const header = columns.map((c) => padRight(c.name, widths[c.name] ?? 0)).join("  ");
  const sep = columns.map((c) => "-".repeat(widths[c.name] ?? 0)).join("  ");
  const lines = [header, sep];
  for (const row of rows) {
    lines.push(columns.map((c) => padRight(row[c.name] ?? "", widths[c.name] ?? 0)).join("  "));
  }
  return lines.join("\n");
}

function padRight(s: string, len: number): string {
  return s + " ".repeat(Math.max(0, len - s.length));
}
export function formatHelp(): string {
  return `
SkillForge CLI (sf) v1.0.0
Portable Agent Skill & Harness Runner

Usage: sf <command> [options]

Commands:
  init                          Scaffold .skillforge/ config and starter skill templates
  list [dir]                    List available skills in a skill directory
  validate <skillPath>          Validate a skill file (YAML, Zod, template analysis)
  run <skillPath> [options]     Execute a skill end-to-end with sandbox enforcement
  rollback [options]            List or restore a Git checkpoint atomically
  daemon                        Start the local IPC hub for desktop tray integration

Global options:
  --workspace <dir>             Workspace root directory (default: cwd)
  --provider <name>             LLM provider to use
  --model <name>                Model to use
  --param key=value             Skill parameter (repeatable)
  --dry-run                     Parse and validate without executing
  --json                        Emit JSON output
  --help, -h                    Show this help
`.trim();
}

export function formatStatus(status: { status: string; activeRunId: string | null; uptimeMs: number }): string {
  return [
    `Status: ${bold(status.status)}`,
    `Active run: ${status.activeRunId ?? "none"}`,
    `Uptime: ${status.uptimeMs}ms`,
  ].join("\n");
}

export function spin(frame: number): string {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  const f = frames[frame % frames.length];
  return f ?? "";
}
