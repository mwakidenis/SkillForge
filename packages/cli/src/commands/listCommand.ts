import * as fs from "node:fs/promises";
import * as path from "node:path";
import { renderTable } from "../formatter.js";

export interface ListCommandArgs {
  workspace?: string;
  json?: boolean;
  _: string[];
}

export async function listCommand(args: ListCommandArgs): Promise<void> {
  const workspace = args.workspace ?? process.cwd();
  // Default skill dirs: cwd/examples/skills and .skillforge/skills
  const candidates = [
    path.join(workspace, "examples", "skills"),
    path.join(workspace, ".skillforge", "skills"),
  ];
  const skills: { id: string; name: string; version: string; path: string; tools: string[] }[] = [];

  for (const dir of candidates) {
    try {
      const entries = await fs.readdir(dir);
      for (const entry of entries) {
        if (!entry.endsWith(".md")) continue;
        const full = path.join(dir, entry);
        const raw = await fs.readFile(full, "utf8");
        const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
        if (!m) continue;
        let id = entry.replace(/\.md$/, "");
        let name = id;
        let version = "0.0.0";
        const tools: string[] = [];
        for (const line of (m[1] ?? "").split(/\r?\n/)) {
          const kv = /^(\w+):\s*(.*)$/.exec(line);
          if (!kv) continue;
          if (kv[1] === "id") id = (kv[2] ?? "").replace(/"/g, "");
          if (kv[1] === "name") name = (kv[2] ?? "").replace(/"/g, "");
          if (kv[1] === "version") version = (kv[2] ?? "").replace(/"/g, "");
        }
        skills.push({ id, name, version, path: full, tools });
      }
    } catch {
      // directory doesn't exist, skip
    }
  }

  if (args.json) {
    process.stdout.write(JSON.stringify({ skills }, null, 2) + "\n");
    return;
  }

  if (skills.length === 0) {
    process.stdout.write("No skills found.\n");
    return;
  }

  process.stdout.write(
    renderTable(
      skills.map((s) => ({ id: s.id, name: s.name, version: s.version, path: s.path })),
      { columns: [{ name: "id" }, { name: "name" }, { name: "version" }, { name: "path" }] },
    ),
  );
  process.stdout.write("\n");
}
