import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { parseSkill } from "../../src/parser/skillParser.js";
import { SkillParseError } from "../../src/errors/SkillForgeError.js";

describe("skillParser - valid skill files", () => {
  it("parses refactor-module skill manifest", async () => {
    const raw = await readFile(new URL("../../../../examples/skills/refactor-module.md", import.meta.url), "utf8");
    const parsed = parseSkill(raw, "examples/skills/refactor-module.md");
    expect(parsed.manifest.id).toBe("refactor-module");
    expect(parsed.manifest.name).toBe("Deterministic Module Refactorer");
    expect(parsed.manifest.version).toBe("1.0.0");
    expect(parsed.manifest.model.preferred).toBe("qwen2.5-coder:14b");
    expect(parsed.manifest.permissions.tools).toContain("fs.write");
    expect(parsed.sections.systemPrompt.length).toBeGreaterThan(0);
    expect(parsed.sections.instructions.length).toBeGreaterThan(0);
    expect(parsed.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(parsed.sourcePath).toBe("examples/skills/refactor-module.md");
  });

  it("parses security-audit read-only skill", async () => {
    const raw = await readFile(new URL("../../../../examples/skills/security-audit.md", import.meta.url), "utf8");
    const parsed = parseSkill(raw, "examples/skills/security-audit.md");
    expect(parsed.manifest.id).toBe("security-audit");
    expect(parsed.manifest.permissions.tools).toEqual(["fs.read", "fs.list"]);
    expect(parsed.sections.systemPrompt).toContain("read-only");
  });

  it("computes deterministic content hash", async () => {
    const raw = await readFile(new URL("../../../../examples/skills/generate-unit-tests.md", import.meta.url), "utf8");
    const a = parseSkill(raw);
    const b = parseSkill(raw);
    expect(a.contentHash).toBe(b.contentHash);
    expect(a.contentHash).toHaveLength(64);
  });
});

describe("skillParser - CRLF line endings", () => {
  it("parses Windows CRLF frontmatter and body", () => {
    const raw = "---\r\nid: crlf-test\r\nname: CRLF\r\nversion: 1.0.0\r\ndescription: test\r\nmodel:\r\n  provider: ollama\r\n  preferred: qwen\r\n  temperature: 0.7\r\n  maxTokens: 4096\r\npermissions:\r\n  tools: [fs.read]\r\n  allowedCommands: []\r\n  allowNetwork: false\r\n  maxSteps: 1\r\n  timeoutMs: 1000\r\ngit:\r\n  autoCheckpoint: false\r\n  commitOnSuccess: false\r\n  commitPrefix: chore\r\n  rollbackOnFailure: false\r\nparameters: []\r\n---\r\n## System Role\r\nyou are an agent\r\n\r\n## Instructions\r\ndo something\r\n\r\n## Verification Criteria\r\nit works\r\n";
    const parsed = parseSkill(raw);
    expect(parsed.manifest.id).toBe("crlf-test");
    expect(parsed.sections.systemPrompt).toBe("you are an agent");
    expect(parsed.sections.instructions).toBe("do something");
    expect(parsed.sections.verification).toBe("it works");
  });
});

describe("skillParser - errors", () => {
  it("throws when missing frontmatter fences", () => {
    expect(() => parseSkill("just a markdown file\n## Instructions\ndo it")).toThrow(SkillParseError);
  });
  it("throws on invalid semver version", () => {
    const raw = "---\nid: bad-ver\nname: Bad\nversion: not-semver\ndescription: d\npermissions: {tools: [], allowedCommands: [], allowNetwork: false, maxSteps: 1, timeoutMs: 1000}\ngit: {autoCheckpoint: false, commitOnSuccess: false, commitPrefix: c, rollbackOnFailure: false}\nparameters: []\n---\n## Instructions\ndo\n";
    expect(() => parseSkill(raw)).toThrow(SkillParseError);
  });
  it("throws on non-kebab-case id", () => {
    const raw = "---\nid: Bad_Id\nname: Bad\nversion: 1.0.0\ndescription: d\npermissions: {tools: [], allowedCommands: [], allowNetwork: false, maxSteps: 1, timeoutMs: 1000}\ngit: {autoCheckpoint: false, commitOnSuccess: false, commitPrefix: c, rollbackOnFailure: false}\nparameters: []\n---\n## Instructions\ndo\n";
    expect(() => parseSkill(raw)).toThrow(SkillParseError);
  });
  it("does not throw at parse time for an undeclared template variable", () => {
    const raw = "---\nid: tmpl-test\nname: T\nversion: 1.0.0\ndescription: d\nmodel: {provider: ollama, preferred: qwen, temperature: 0.7, maxTokens: 4096}\npermissions: {tools: [], allowedCommands: [], allowNetwork: false, maxSteps: 1, timeoutMs: 1000}\ngit: {autoCheckpoint: false, commitOnSuccess: false, commitPrefix: c, rollbackOnFailure: false}\nparameters: []\n---\n## Instructions\nuse {{undeclaredVar}}\n";
    expect(() => parseSkill(raw)).not.toThrow();
  });
});
