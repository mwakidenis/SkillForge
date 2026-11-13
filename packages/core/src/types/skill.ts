import { z, ZodError } from "zod";
import { SkillParseError } from "../errors/SkillForgeError.js";

export const ToolPermissionNameSchema = z.enum([
  "fs.read",
  "fs.write",
  "fs.delete",
  "fs.list",
  "shell.exec",
  "git.status",
  "git.diff",
]);

export type ToolPermissionName = z.infer<typeof ToolPermissionNameSchema>;

export const SkillParameterSchemaSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["string", "number", "boolean", "string[]"]),
  required: z.boolean(),
  default: z.unknown().optional(),
  description: z.string().min(1),
  pattern: z.string().optional(),
});

export type SkillParameterSchema = z.infer<typeof SkillParameterSchemaSchema>;

export const SkillManifestSchema = z.object({
  id: z.string().min(1).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: "id must be kebab-case",
  }),
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/, {
    message: "version must be a valid semver string",
  }),
  description: z.string().min(1),
  author: z.string().optional(),
  tags: z.array(z.string()).default([]),
  model: z.object({
    provider: z.string().optional(),
    preferred: z.string().optional(),
    temperature: z.number().min(0).max(2).default(0.7),
    maxTokens: z.number().int().positive().default(4096),
  }),
  permissions: z.object({
    tools: z.array(ToolPermissionNameSchema).default([]),
    allowedCommands: z.array(z.string()).default([]),
    allowNetwork: z.boolean().default(false),
    maxSteps: z.number().int().positive().default(10),
    timeoutMs: z.number().int().positive().default(60000),
  }),
  git: z.object({
    autoCheckpoint: z.boolean().default(false),
    commitOnSuccess: z.boolean().default(false),
    commitPrefix: z.string().default("chore(skill)"),
    rollbackOnFailure: z.boolean().default(false),
  }),
  parameters: z.array(SkillParameterSchemaSchema).default([]),
  sections: z.object({
    systemPrompt: z.string(),
    instructions: z.string(),
    verification: z.string().optional(),
    rawBody: z.string(),
  }),
  sourcePath: z.string().optional(),
  contentHash: z.string(),
});

export type SkillManifest = z.infer<typeof SkillManifestSchema>;

export interface ParsedSkill {
  manifest: SkillManifest;
  rawFrontmatter: string;
  rawBody: string;
  sections: SkillManifest["sections"];
  contentHash: string;
  sourcePath?: string;
}

export const SkillManifestFrontmatterSchema = SkillManifestSchema.omit({
  sections: true,
  contentHash: true,
});

export type SkillManifestFrontmatter = Omit<SkillManifest, "sections" | "contentHash">;

export function validateSkillManifest(unknownManifest: unknown): SkillManifest {
  try {
    return SkillManifestSchema.parse(unknownManifest);
  } catch (cause) {
    if (cause instanceof ZodError) {
      throw new SkillParseError({
        message: "Invalid skill manifest: " + cause.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", "),
        code: "SKILL_PARSE_ERROR",
        syntax: "schema",
        cause: cause as Error,
      });
    }
    throw cause;
  }
}

export function validateSkillManifestFrontmatter(fields: unknown): SkillManifestFrontmatter {
  try {
    return SkillManifestFrontmatterSchema.parse(fields);
  } catch (cause) {
    if (cause instanceof ZodError) {
      throw new SkillParseError({
        message: "Invalid skill manifest: " + cause.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", "),
        code: "SKILL_PARSE_ERROR",
        syntax: "schema",
        cause: cause as Error,
      });
    }
    throw cause;
  }
}

export function isKebabCaseId(id: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id);
}

export function isSemver(version: string): boolean {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version);
}
