import { describe, it, expect } from "vitest";
import { renderTemplate } from "../../src/parser/templateEngine.js";
import { SkillParseError } from "../../src/errors/SkillForgeError.js";
import type { SkillParameterSchema } from "../../src/types/skill.js";

function render(template: string, values: Record<string, unknown>, params: SkillParameterSchema[] = []): string {
  return renderTemplate(template, { params, values });
}

const baseParams: SkillParameterSchema[] = [
  { name: "targetFile", type: "string", required: true, description: "the file" },
  { name: "goal", type: "string", required: true, description: "the goal" },
  { name: "strictMode", type: "boolean", required: false, default: true, description: "strict" },
  { name: "count", type: "number", required: false, default: 5, description: "count" },
  { name: "tags", type: "string[]", required: false, default: [], description: "tags" },
  { name: "patternField", type: "string", required: false, pattern: "^[A-Z]+$", description: "uppercase" },
];

describe("templateEngine - variable substitution", () => {
  it("replaces simple variable", () => {
    expect(render("hello {{name}}", { name: "world" }, [{ name: "name", type: "string", required: true, description: "n" }])).toBe("hello world");
  });
  it("supports dot-path access", () => {
    expect(render("config={{config.target}}", { config: { target: "src/a.ts" } as unknown }, [{ name: "config", type: "string", required: true, description: "c" }])).toBe("config=");
  });
  it("replaces multiple variables", () => {
    expect(render("{{targetFile}} -> {{goal}}", { targetFile: "a.ts", goal: "clean" }, baseParams)).toBe("a.ts -> clean");
  });
  it("leaves unknown text intact", () => {
    expect(render("no tags here", {}, [])).toBe("no tags here");
  });
});

describe("templateEngine - parameter validation", () => {
  it("throws when required parameter is missing", () => {
    expect(() => render("{{targetFile}}", {}, baseParams)).toThrow(SkillParseError);
  });
  it("injects default values for optional parameters", () => {
    expect(render("strict={{strictMode}} count={{count}}", { targetFile: "x.ts", goal: "g" }, baseParams)).toBe("strict=true count=5");
  });
  it("rejects values violating regex pattern", () => {
    expect(() => render("{{patternField}}", { targetFile: "x.ts", goal: "g", patternField: "lowercase" }, baseParams)).toThrow(SkillParseError);
  });
  it("accepts values matching regex pattern", () => {
    expect(render("{{patternField}}", { targetFile: "x.ts", goal: "g", patternField: "HELLO" }, baseParams)).toBe("HELLO");
  });
  it("coerces boolean from string", () => {
    expect(render("{{strictMode}}", { targetFile: "x.ts", goal: "g", strictMode: "false" }, baseParams)).toBe("false");
  });
  it("coerces number from string", () => {
    expect(render("{{count}}", { targetFile: "x.ts", goal: "g", count: "10" }, baseParams)).toBe("10");
  });
  it("throws on undeclared variable", () => {
    expect(() => render("{{nope}}", {}, [])).toThrow(SkillParseError);
  });
});

describe("templateEngine - conditionals", () => {
  it("renders consequent when condition is true", () => {
    expect(render("{{#if strictMode}}YES{{/if}}", { targetFile: "x.ts", goal: "g", strictMode: true }, baseParams)).toBe("YES");
  });
  it("renders alternate when condition is false with else", () => {
    expect(render("{{#if strictMode}}YES{{else}}NO{{/if}}", { targetFile: "x.ts", goal: "g", strictMode: false }, baseParams)).toBe("NO");
  });
  it("renders empty when condition false and no else", () => {
    expect(render("{{#if strictMode}}YES{{/if}}", { targetFile: "x.ts", goal: "g", strictMode: false }, baseParams)).toBe("");
  });
  it("supports nested #if/#else", () => {
    const t = "{{#if a}}{{#if b}}BOTH{{else}}ONLY_A{{/if}}{{else}}NEITHER{{/if}}";
    expect(render(t, { a: true, b: true }, [{ name: "a", type: "boolean", required: true, description: "x" }, { name: "b", type: "boolean", required: true, description: "y" }])).toBe("BOTH");
    expect(render(t, { a: true, b: false }, [{ name: "a", type: "boolean", required: true, description: "x" }, { name: "b", type: "boolean", required: true, description: "y" }])).toBe("ONLY_A");
    expect(render(t, { a: false, b: true }, [{ name: "a", type: "boolean", required: true, description: "x" }, { name: "b", type: "boolean", required: true, description: "y" }])).toBe("NEITHER");
  });
});

describe("templateEngine - iteration", () => {
  it("iterates over an array", () => {
    const params: SkillParameterSchema[] = [{ name: "items", type: "string[]", required: true, description: "i" }];
    expect(render("{{#each items}}{{this}},{{/each}}", { items: ["x", "y", "z"] }, params)).toBe("x,y,z,");
  });
  it("iterates with text between items", () => {
    const params: SkillParameterSchema[] = [{ name: "items", type: "string[]", required: true, description: "i" }];
    expect(render("{{#each items}}[{{this}}]{{/each}}", { items: ["p", "q"] }, params)).toBe("[p][q]");
  });
  it("renders empty when each over empty array", () => {
    const params: SkillParameterSchema[] = [{ name: "items", type: "string[]", required: true, description: "i" }];
    expect(render("{{#each items}}X{{/each}}", { items: [] }, params)).toBe("");
  });
  it("throws on undeclared variable in #each", () => {
    expect(() => render("{{#each missing}}{{this}}{{/each}}", {}, [])).toThrow(SkillParseError);
  });
});
