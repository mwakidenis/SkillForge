import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface InitCommandArgs {
  workspace?: string;
  json?: boolean;
}

export async function initCommand(args: InitCommandArgs): Promise<void> {
  const workspace = args.workspace ?? process.cwd();
  const skillforgeDir = path.join(workspace, ".skillforge");
  const skillsDir = path.join(skillforgeDir, "skills");
  await fs.mkdir(skillsDir, { recursive: true });

  await fs.writeFile(
    path.join(skillforgeDir, "config.json"),
    JSON.stringify(
      { version: "1.0.0", skillsDir: "./skills", workspace },
      null,
      2,
    ),
    "utf8",
  );

  const starter = `---
id: example-skill
name: Example Skill
version: 1.0.0
description: A starter skill manifest for SkillForge.
model:
  provider: mock-deterministic
  preferred: mock-model
  temperature: 0.7
  maxTokens: 4096
permissions:
  tools: [fs.read, fs.list]
  allowedCommands: []
  allowNetwork: false
  maxSteps: 5
  timeoutMs: 60000
git:
  autoCheckpoint: false
  commitOnSuccess: false
  commitPrefix: chore(skill)
  rollbackOnFailure: false
parameters:
  - name: targetFile
    type: string
    required: true
    description: The file to operate on.
---

## System Role

You are a helpful SkillForge agent.

## Instructions

Process the file {{targetFile}} according to the skill goal.

## Verification Criteria

- The file was processed without sandbox violations.
`;

  await fs.writeFile(path.join(skillsDir, "example-skill.md"), starter, "utf8");

  if (args.json) {
    process.stdout.write(JSON.stringify({ ok: true, skillforgeDir, skillsDir }) + "\n");
  } else {
    process.stdout.write(`Initialized SkillForge at ${skillforgeDir}\n`);
    process.stdout.write(`Starter skill written to ${path.join(skillsDir, "example-skill.md")}\n`);
  }
}
