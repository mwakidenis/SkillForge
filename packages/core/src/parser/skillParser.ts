import { createHash } from "node:crypto";
import { parseYaml } from "./yamlParser.js";
import { validateSkillManifest, validateSkillManifestFrontmatter, type ParsedSkill, type SkillManifest } from "../types/skill.js";
import { SkillParseError } from "../errors/SkillForgeError.js";

const FRONTMATTER_RE = /^(?:\r?\n)?---\r?\n([\s\S]*?)\r?\n---\r?\n/;

const SECTION_ALIASES: Record<string, keyof Omit<SkillManifest["sections"], "rawBody">> = {
  "system role": "systemPrompt",
  instructions: "instructions",
  "verification criteria": "verification",
};

export function parseSkill(rawContent: string, sourcePath?: string): ParsedSkill {
  let match: RegExpExecArray | null;
  FRONTMATTER_RE.lastIndex = 0;
  match = FRONTMATTER_RE.exec(rawContent);
  if (!match) {
    throw new SkillParseError({
      message: "Skill file is missing YAML frontmatter delimited by ---",
      code: "SKILL_PARSE_ERROR",
      syntax: "frontmatter",
    });
  }

  const frontmatterText = match[1] ?? "";
  const body = rawContent.slice(match[0].length);

  let frontmatter: unknown;
  try {
    frontmatter = parseYaml(frontmatterText);
  } catch (cause) {
    if (cause instanceof SkillParseError) throw cause;
    throw new SkillParseError({
      message: `Failed to parse YAML frontmatter: ${(cause as Error).message}`,
      code: "SKILL_PARSE_ERROR",
      syntax: "yaml",
      cause: cause as Error,
    });
  }

  if (
    frontmatter === null ||
    typeof frontmatter !== "object" ||
    Array.isArray(frontmatter)
  ) {
    throw new SkillParseError({
      message: "YAML frontmatter must be a mapping/object",
      code: "SKILL_PARSE_ERROR",
      syntax: "yaml",
    });
  }

  const manifestBase = validateSkillManifestFrontmatter(frontmatter);

  const sections = extractSections(body);

  const contentHash = createHash("sha256").update(rawContent, "utf8").digest("hex");

  const manifest: SkillManifest = {
    ...manifestBase,
    sections: { ...sections, rawBody: body },
    contentHash,
  };

  return {
    manifest,
    rawFrontmatter: frontmatterText,
    rawBody: body,
    sections: manifest.sections,
    contentHash,
    ...(sourcePath !== undefined ? { sourcePath } : {}),
  };
}

function extractSections(body: string): Pick<
  SkillManifest["sections"],
  "systemPrompt" | "instructions" | "verification"
> {
  const buffers: {
    systemPrompt: string[];
    instructions: string[];
    verification: string[];
  } = {
    systemPrompt: [],
    instructions: [],
    verification: [],
  };
  let current: keyof typeof buffers | null = null;

  const lines = body.replace(/\r\n/g, "\n").split("\n");
  for (const line of lines) {
    const heading = /^##\s+(.*)$/s.exec(line);
    if (heading) {
      const name = (heading[1] ?? "").trim().toLowerCase();
      const mapped = SECTION_ALIASES[name];
      current = mapped ?? null;
      if (current !== null) {
        buffers[current] = [];
      }
      continue;
    }
    if (current !== null) {
      buffers[current].push(line);
    }
  }

  return {
    systemPrompt: buffers.systemPrompt.join("\n").trimEnd(),
    instructions: buffers.instructions.join("\n").trimEnd(),
    verification: buffers.verification.join("\n").trimEnd(),
  };
}

export { parseYaml };
export type { ParsedSkill, SkillManifest };
