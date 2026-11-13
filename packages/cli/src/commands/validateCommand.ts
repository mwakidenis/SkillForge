import * as fs from "node:fs/promises";
import { parseSkill } from "@skillforge/core";

export interface ValidateCommandArgs {
  workspace?: string;
  json?: boolean;
  _: string[];
}

export async function validateCommand(args: ValidateCommandArgs): Promise<void> {
  const skillPath = args._[1];
  if (!skillPath) {
    throw new Error("validate requires a skill path: sf validate <skillPath>");
  }

  const raw = await fs.readFile(skillPath, "utf8");
  const parsed = parseSkill(raw, skillPath);

  const manifest = parsed.manifest;
  const result = {
    ok: true,
    skill: {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      model: manifest.model,
      permissions: manifest.permissions,
      git: manifest.git,
      parameters: manifest.parameters.length,
      sections: Object.keys(parsed.sections),
    },
    contentHash: parsed.contentHash,
    sourcePath: parsed.sourcePath,
  };

  if (args.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    process.stdout.write(`Valid: ${manifest.id} v${manifest.version}\n`);
    process.stdout.write(`  tools: ${manifest.permissions.tools.join(", ") || "none"}\n`);
    process.stdout.write(`  parameters: ${manifest.parameters.length}\n`);
    process.stdout.write(`  contentHash: ${parsed.contentHash}\n`);
  }
}
