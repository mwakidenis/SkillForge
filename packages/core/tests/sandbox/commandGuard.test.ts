import { describe, it, expect } from "vitest";
import { CommandGuard } from "../../src/sandbox/commandGuard.js";
import { SandboxViolationError } from "../../src/errors/SkillForgeError.js";

const ALLOWED = ["pnpm test", "npx tsc --noEmit", "npx vitest run"];

describe("commandGuard - allowlist", () => {
  const guard = new CommandGuard(ALLOWED);

  it("permits exact allowed command", () => {
    const r = guard.validateCommand("pnpm test");
    expect(r.executable).toBe("pnpm");
    expect(r.args).toEqual(["test"]);
  });

  it("permits allowed command with extra args", () => {
    const r = guard.validateCommand("npx tsc --noEmit src/foo.ts");
    expect(r.executable).toBe("npx");
    expect(r.args).toEqual(["tsc", "--noEmit", "src/foo.ts"]);
  });

  it("rejects unapproved binary", () => {
    expect(() => guard.validateCommand("curl https://evil.com")).toThrow(SandboxViolationError);
  });

  it("rejects command chaining with ;", () => {
    expect(() => guard.validateCommand("pnpm test; whoami")).toThrow(SandboxViolationError);
  });

  it("rejects command chaining with &&", () => {
    expect(() => guard.validateCommand("pnpm test && rm -rf /")).toThrow(SandboxViolationError);
  });

  it("rejects subshell $(...)", () => {
    expect(() => guard.validateCommand("npx tsc $(cat .env)")).toThrow(SandboxViolationError);
  });

  it("rejects backtick substitution", () => {
    expect(() => guard.validateCommand("npx tsc `cat .env`")).toThrow(SandboxViolationError);
  });

  it("rejects pipe |", () => {
    expect(() => guard.validateCommand("pnpm test | sh")).toThrow(SandboxViolationError);
  });

  it("rejects redirection >", () => {
    expect(() => guard.validateCommand("npx tsc --noEmit > out.txt")).toThrow(SandboxViolationError);
  });

  it("rejects empty command", () => {
    expect(() => guard.validateCommand("")).toThrow(SandboxViolationError);
  });
});

describe("commandGuard - quoted metacharacters allowed", () => {
  const guard = new CommandGuard(ALLOWED);

  it("allows quotes around metacharacters in args", () => {
    const r = guard.validateCommand('npx vitest run "src/a;b.test.ts"');
    expect(r.executable).toBe("npx");
  });
});

describe("commandGuard - environment scrubbing", () => {
  const guard = new CommandGuard(ALLOWED);

  it("strips AWS secret keys", () => {
    const env = guard.scrubEnvironment({ AWS_SECRET_ACCESS_KEY: "s3cr3t", PATH: "/usr/bin" });
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(env.PATH).toBe("/usr/bin");
  });

  it("strips OPENAI_API_KEY", () => {
    const env = guard.scrubEnvironment({ OPENAI_API_KEY: "sk-123" });
    expect(env.OPENAI_API_KEY).toBeUndefined();
  });

  it("strips ANTHROPIC_API_KEY", () => {
    const env = guard.scrubEnvironment({ ANTHROPIC_API_KEY: "sk-ant" });
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("strips GITHUB_TOKEN", () => {
    const env = guard.scrubEnvironment({ GITHUB_TOKEN: "ghp_x" });
    expect(env.GITHUB_TOKEN).toBeUndefined();
  });

  it("strips keys matching SECRET/PATTERN", () => {
    const env = guard.scrubEnvironment({ MY_CUSTOM_SECRET: "x", DATABASE_PASSWORD: "y", NORMAL: "z" });
    expect(env.MY_CUSTOM_SECRET).toBeUndefined();
    expect(env.DATABASE_PASSWORD).toBeUndefined();
    expect(env.NORMAL).toBe("z");
  });
});
