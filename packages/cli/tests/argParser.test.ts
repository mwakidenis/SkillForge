import { describe, it, expect } from "vitest";
import { parseArgs } from "../src/argParser.js";

describe("argParser - subcommands and positionals", () => {
  it("parses a subcommand and positional arg", () => {
    const a = parseArgs(["run", "examples/skills/a.md"]);
    expect(a._).toEqual(["run", "examples/skills/a.md"]);
  });

  it("parses init with no args", () => {
    expect(parseArgs(["init"])._).toEqual(["init"]);
  });

  it("parses list with directory", () => {
    expect(parseArgs(["list", "examples/skills"])._).toEqual(["list", "examples/skills"]);
  });
});

describe("argParser - boolean flags", () => {
  it("parses --json", () => {
    expect(parseArgs(["--json"]).json).toBe(true);
    expect(parseArgs(["run", "x.md", "--json"]).json).toBe(true);
  });

  it("parses --list", () => {
    expect(parseArgs(["rollback", "--list"]).list).toBe(true);
  });

  it("parses --dry-run", () => {
    expect(parseArgs(["--dry-run"]).dryRun).toBe(true);
  });

  it("parses --help", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(parseArgs(["-h"]).help).toBe(true);
  });

  it("defaults booleans to false", () => {
    const a = parseArgs(["run", "x.md"]);
    expect(a.json).toBe(false);
    expect(a.dryRun).toBe(false);
    expect(a.help).toBe(false);
  });
});

describe("argParser - key-value options", () => {
  it("parses --workspace with space separator", () => {
    expect(parseArgs(["--workspace", "/tmp/ws"]).workspace).toBe("/tmp/ws");
    expect(parseArgs(["-w", "/tmp/ws"]).workspace).toBe("/tmp/ws");
  });

  it("parses --workspace with equals", () => {
    expect(parseArgs(["--workspace=/tmp/ws"]).workspace).toBe("/tmp/ws");
    expect(parseArgs(["-w=/tmp/ws"]).workspace).toBe("/tmp/ws");
  });

  it("parses --provider", () => {
    expect(parseArgs(["--provider", "ollama"]).provider).toBe("ollama");
    expect(parseArgs(["--provider=ollama"]).provider).toBe("ollama");
  });

  it("parses --model", () => {
    expect(parseArgs(["--model", "qwen"]).model).toBe("qwen");
    expect(parseArgs(["--model=qwen"]).model).toBe("qwen");
  });
});

describe("argParser - repeatable --param", () => {
  it("parses --param key=value", () => {
    const a = parseArgs(["--param", "targetFile=src/a.ts", "--param", "goal=clean"]);
    expect(a.param).toEqual({ targetFile: "src/a.ts", goal: "clean" });
  });

  it("parses --param=key=value", () => {
    const a = parseArgs(["--param=targetFile=src/a.ts"]);
    expect(a.param).toEqual({ targetFile: "src/a.ts" });
  });

  it("parses --param with no value (empty)", () => {
    const a = parseArgs(["--param", "flag"]);
    expect(a.param).toEqual({ flag: "" });
  });

  it("accumulates multiple params", () => {
    const a = parseArgs([
      "run", "x.md",
      "--param", "a=1",
      "--param", "b=2",
      "--param", "c=3",
    ]);
    expect(a.param).toEqual({ a: "1", b: "2", c: "3" });
  });
});

describe("argParser - mixed options and positionals", () => {
  it("keeps positionals after options", () => {
    const a = parseArgs(["--workspace", "/tmp", "run", "skill.md", "--json"]);
    expect(a._).toEqual(["run", "skill.md"]);
    expect(a.workspace).toBe("/tmp");
    expect(a.json).toBe(true);
  });
});
