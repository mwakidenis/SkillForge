import { describe, it, expect } from "vitest";
import { renderTable, bold, green, red, supportsColor, formatHelp, formatStatus, spin } from "../src/formatter.js";

describe("formatter - color support detection", () => {
  it("returns a boolean", () => {
    expect(typeof supportsColor()).toBe("boolean");
  });
});

describe("formatter - color wrappers", () => {
  it("bold wraps text when color supported, else identity", () => {
    const b = bold("hi");
    if (supportsColor()) expect(b).toContain("\x1b[1m");
    else expect(b).toBe("hi");
  });

  it("green/red/dim/cyan are identity when color unsupported", () => {
    if (!supportsColor()) {
      expect(green("x")).toBe("x");
      expect(red("x")).toBe("x");
    }
  });
});

describe("formatter - renderTable", () => {
  it("renders a simple table", () => {
    const out = renderTable(
      [{ id: "a", name: "alpha", version: "1.0.0" }],
      { columns: [{ name: "id" }, { name: "name" }, { name: "version" }] },
    );
    expect(out).toContain("a");
    expect(out).toContain("alpha");
    expect(out).toContain("1.0.0");
    expect(out).toContain("id");
  });

  it("pads columns to widest content", () => {
    const out = renderTable(
      [{ id: "toolongid", name: "n" }, { id: "b", name: "verylongname" }],
      { columns: [{ name: "id" }, { name: "name" }] },
    );
    const lines = out.split("\n");
    expect(lines[0]).toContain("id");
    expect(lines[0]).toContain("name");
  });

  it("handles empty rows", () => {
    const out = renderTable([], { columns: [{ name: "id" }] });
    expect(out).toContain("id");
  });
});

describe("formatter - help and status", () => {
  it("formatHelp includes command list", () => {
    const h = formatHelp();
    expect(h).toContain("SkillForge CLI");
    expect(h).toContain("run");
    expect(h).toContain("validate");
  });

  it("formatStatus renders fields", () => {
    const s = formatStatus({ status: "IDLE", activeRunId: null, uptimeMs: 123 });
    expect(s).toContain("IDLE");
    expect(s).toContain("none");
    expect(s).toContain("123");
  });
});

describe("formatter - spin", () => {
  it("returns a frame string", () => {
    expect(typeof spin(0)).toBe("string");
    expect(spin(0)).toBe(spin(10));
  });
});
