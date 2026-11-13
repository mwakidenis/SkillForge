import { describe, it, expect } from "vitest";
import { parseYaml } from "../../src/parser/yamlParser.js";
import { SkillParseError } from "../../src/errors/SkillForgeError.js";

function parse(input: string): unknown {
  return parseYaml(input);
}

describe("yamlParser - scalars", () => {
  it("parses unquoted strings", () => {
    expect(parse("key: value")).toEqual({ key: "value" });
  });
  it("parses integers", () => {
    expect(parse("key: 42")).toEqual({ key: 42 });
    expect(parse("key: -7")).toEqual({ key: -7 });
  });
  it("parses floats", () => {
    expect(parse("key: 3.14")).toEqual({ key: 3.14 });
    expect(parse("key: -0.5")).toEqual({ key: -0.5 });
    expect(parse("key: .5")).toEqual({ key: 0.5 });
  });
  it("parses booleans", () => {
    expect(parse("a: true")).toEqual({ a: true });
    expect(parse("b: false")).toEqual({ b: false });
  });
  it("parses null and tilde", () => {
    expect(parse("a: null")).toEqual({ a: null });
    expect(parse("b: ~")).toEqual({ b: null });
  });
  it("parses double-quoted strings with escapes", () => {
    expect(parse('key: "a\\nb\\tc"')).toEqual({ key: "a\nb\tc" });
    expect(parse('key: "say \\"hi\\""')).toEqual({ key: 'say "hi"' });
    expect(parse('key: "back\\\\slash"')).toEqual({ key: "back\\slash" });
  });
  it("parses single-quoted strings with escaped quotes", () => {
    expect(parse("key: 'it''s a test'")).toEqual({ key: "it's a test" });
  });
  it("strips inline comments outside quotes", () => {
    expect(parse("key: value # comment")).toEqual({ key: "value" });
    expect(parse('key: "a # b" # trailing')).toEqual({ key: "a # b" });
  });
});

describe("yamlParser - arrays", () => {
  it("parses inline arrays", () => {
    expect(parse("keys: [a, b, c]")).toEqual({ keys: ["a", "b", "c"] });
    expect(parse('keys: [a, "c", b]')).toEqual({ keys: ["a", "c", "b"] });
    expect(parse("empty: []")).toEqual({ empty: [] });
  });
  it("parses nested inline arrays", () => {
    expect(parse("matrix: [[1, 2], [3, 4]]")).toEqual({
      matrix: [[1, 2], [3, 4]],
    });
  });
  it("parses block arrays of scalars", () => {
    const input = "list:\n  - item1\n  - item2\n  - item3";
    expect(parse(input)).toEqual({ list: ["item1", "item2", "item3"] });
  });
  it("parses block arrays of objects", () => {
    const input = "items:\n  - name: a\n    value: 1\n  - name: b\n    value: 2";
    expect(parse(input)).toEqual({
      items: [{ name: "a", value: 1 }, { name: "b", value: 2 }],
    });
  });
  it("parses nested block list under nested map", () => {
    const input = "permissions:\n  tools:\n    - fs.read\n    - fs.write";
    expect(parse(input)).toEqual({
      permissions: { tools: ["fs.read", "fs.write"] },
    });
  });
});

describe("yamlParser - nested mappings", () => {
  it("parses nested mapping with 2-space indent", () => {
    expect(parse("a:\n  b: 1\n  c: 2")).toEqual({ a: { b: 1, c: 2 } });
  });
  it("parses nested mapping with 4-space indent", () => {
    expect(parse("a:\n    b: 1\n    c: 2")).toEqual({ a: { b: 1, c: 2 } });
  });
  it("parses deeply nested mapping", () => {
    const input = "a:\n  b:\n    c:\n      d: value";
    expect(parse(input)).toEqual({ a: { b: { c: { d: "value" } } } });
  });
  it("parses mixed mapping and sequence", () => {
    const input = "name: x\ntools:\n  - fs.read\n  - fs.list\nmode: strict";
    expect(parse(input)).toEqual({
      name: "x",
      tools: ["fs.read", "fs.list"],
      mode: "strict",
    });
  });
});

describe("yamlParser - block scalars", () => {
  it("parses literal block scalar", () => {
    const input = "text: |\n  line1\n  line2\n  line3";
    const result = parse(input);
    expect(result).toEqual({ text: "line1\nline2\nline3" });
  });
  it("parses folded block scalar", () => {
    const input = "text: >\n  line1\n  line2\n\n  line3";
    const result = parse(input);
    expect(typeof result.text).toBe("string");
    expect(result.text).toContain("line1");
    expect(result.text).toContain("line3");
  });
});

describe("yamlParser - errors", () => {
  it("throws on tab indentation", () => {
    expect(() => parse("key:\n\tvalue: 1")).toThrow(SkillParseError);
  });
  it("throws on inconsistent dedentation", () => {
    expect(() => parse("a:\n  b: 1\n   c: 2")).toThrow(SkillParseError);
  });
  it("throws on unterminated double-quoted string", () => {
    expect(() => parse('key: "unterminated')).toThrow(SkillParseError);
  });
  it("throws on unterminated single-quoted string", () => {
    expect(() => parse("key: 'unterminated")).toThrow(SkillParseError);
  });
  it("throws on duplicate keys at same level", () => {
    expect(() => parse("a: 1\n a: 2")).toThrow(SkillParseError);
  });
  it("reports 1-based line numbers in errors", () => {
    try {
      parse("a:\n  b: 1\n\tc: 2");
      throw new Error("should have thrown");
    } catch (e) {
      const err = e as SkillParseError;
      expect(err.line).toBeGreaterThanOrEqual(1);
      expect(err.line).toBe(3);
    }
  });
});
