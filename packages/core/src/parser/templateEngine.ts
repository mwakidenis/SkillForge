import { SkillParseError } from "../errors/SkillForgeError.js";
import type { SkillParameterSchema } from "../types/skill.js";

export interface RenderContext {
  params: SkillParameterSchema[];
  values: Record<string, unknown>;
}

type TemplateNode =
  | { type: "text"; value: string }
  | { type: "var"; expr: string }
  | { type: "if"; condition: string; consequent: TemplateNode[]; alternate: TemplateNode[] }
  | { type: "each"; expression: string; body: TemplateNode[] };

export function compile(template: string): TemplateNode[] {
  return new TemplateCompiler(template).parseSequence(new Set());
}

export function renderTemplate(template: string, context: RenderContext): string {
  const { params, values } = context;
  const resolved = resolveParams(params, values);
  const ast = compile(template);
  validateReferencedVariables(ast, params);
  return renderNodes(ast, resolved, undefined);
}

function resolveParams(
  params: SkillParameterSchema[],
  values: Record<string, unknown>,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const param of params) {
    if (Object.prototype.hasOwnProperty.call(values, param.name)) {
      const coerced = coerceValue(param, values[param.name]);
      validatePattern(param, coerced);
      resolved[param.name] = coerced;
    } else if (param.required) {
      throw new SkillParseError({
        message: `Required parameter "${param.name}" is missing`,
        code: "SKILL_PARSE_ERROR",
        syntax: "parameter",
      });
    } else if (param.default !== undefined) {
      resolved[param.name] = coerceValue(param, param.default);
    } else {
      resolved[param.name] = undefined;
    }
  }
  return resolved;
}

function coerceValue(param: SkillParameterSchema, value: unknown): unknown {
  if (value === undefined || value === null) return value;
  switch (param.type) {
    case "string":
      if (typeof value === "string") return value;
      return String(value);
    case "number": {
      const n = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(n)) {
        throw new SkillParseError({
          message: `Parameter "${param.name}" could not be coerced to number: ${String(value)}`,
          code: "SKILL_PARSE_ERROR",
          syntax: "parameter",
        });
      }
      return n;
    }
    case "boolean": {
      if (typeof value === "boolean") return value;
      if (typeof value === "string") {
        const lower = value.trim().toLowerCase();
        if (lower === "true") return true;
        if (lower === "false") return false;
      }
      return Boolean(value);
    }
    case "string[]": {
      if (Array.isArray(value)) return value.map(String);
      if (typeof value === "string") return [value];
      return [String(value)];
    }
    default:
      return value;
  }
}

function validatePattern(param: SkillParameterSchema, value: unknown): void {
  if (param.pattern === undefined) return;
  if (typeof value !== "string") return;
  const regex = new RegExp(param.pattern);
  if (!regex.test(value)) {
    throw new SkillParseError({
      message: `Parameter "${param.name}" value "${value}" does not match pattern "${param.pattern}"`,
      code: "SKILL_PARSE_ERROR",
      syntax: "parameter",
    });
  }
}

function validateReferencedVariables(
  nodes: TemplateNode[],
  params: SkillParameterSchema[],
): void {
  const declared = new Set(params.map((p) => p.name));
  const visit = (nodeList: TemplateNode[]): void => {
    for (const node of nodeList) {
      switch (node.type) {
        case "text":
          break;
        case "var": {
          const parts = node.expr.split(".");
          const root = parts[0] ?? "";
          if (root !== "this" && !declared.has(root)) {
            throw new SkillParseError({
              message: `Undeclared variable "${root}" referenced in template`,
              code: "SKILL_PARSE_ERROR",
              syntax: "template",
            });
          }
          break;
        }
        case "if": {
          const conditionParts = node.condition.split(".");
          const root = conditionParts[0] ?? "";
          if (root !== "this" && !declared.has(root)) {
            throw new SkillParseError({
              message: `Undeclared variable "${root}" referenced in {{#if}} condition`,
              code: "SKILL_PARSE_ERROR",
              syntax: "template",
            });
          }
          visit(node.consequent);
          visit(node.alternate);
          break;
        }
        case "each": {
          const expressionParts = node.expression.split(".");
          const root = expressionParts[0] ?? "";
          if (root !== "this" && !declared.has(root)) {
            throw new SkillParseError({
              message: `Undeclared variable "${root}" referenced in {{#each}}`,
              code: "SKILL_PARSE_ERROR",
              syntax: "template",
            });
          }
          visit(node.body);
          break;
        }
      }
    }
  };
  visit(nodes);
}

function renderNodes(
  nodes: TemplateNode[],
  resolved: Record<string, unknown>,
  thisValue: unknown,
): string {
  let out = "";
  for (const node of nodes) {
    switch (node.type) {
      case "text":
        out += node.value;
        break;
      case "var":
        out += String(renderVar(node.expr, resolved, thisValue) ?? "");
        break;
      case "if": {
        const cond = isTruthy(renderVar(node.condition, resolved, thisValue));
        out += renderNodes(cond ? node.consequent : node.alternate, resolved, thisValue);
        break;
      }
      case "each": {
        const collection = renderVar(node.expression, resolved, thisValue);
        if (Array.isArray(collection)) {
          for (const item of collection) {
            out += renderNodes(node.body, resolved, item);
          }
        }
        break;
      }
    }
  }
  return out;
}

function renderVar(
  expr: string,
  resolved: Record<string, unknown>,
  thisValue: unknown,
): unknown {
  const segments = expr.split(".");
  let current: unknown;
  if (segments[0] === "this") {
    current = thisValue;
  } else {
    const root = segments[0] ?? "";
    if (!Object.prototype.hasOwnProperty.call(resolved, root)) {
      throw new SkillParseError({
        message: `Undeclared variable "${root}"`,
        code: "SKILL_PARSE_ERROR",
        syntax: "template",
      });
    }
    current = resolved[root];
  }
  for (let k = 1; k < segments.length; k++) {
    if (current === null || current === undefined) return undefined;
    const key = segments[k] ?? "";
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function isTruthy(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

class TemplateCompiler {
  private readonly template: string;
  private i = 0;

  constructor(template: string) {
    this.template = template;
  }

  private length(): number {
    return this.template.length;
  }

  private currentTag(): string | null {
    if (this.i >= this.length()) return null;
    if (!this.template.startsWith("{{", this.i)) return null;
    const tagEnd = this.template.indexOf("}}", this.i + 2);
    if (tagEnd === -1) return null;
    return this.template.slice(this.i + 2, tagEnd).trim();
  }

  private consumeTag(): void {
    const tagEnd = this.template.indexOf("}}", this.i + 2);
    if (tagEnd === -1) {
      throw new SkillParseError({
        message: "Unterminated tag in template",
        code: "SKILL_PARSE_ERROR",
        syntax: "template",
      });
    }
    this.i = tagEnd + 2;
  }

  private expectTag(tag: string): void {
    const actual = this.currentTag();
    if (actual !== tag) {
      throw new SkillParseError({
        message: "Expected {{" + tag + "}} but found " + (actual == null ? "end of template" : "{{" + actual + "}}"),
        code: "SKILL_PARSE_ERROR",
        syntax: "template",
      });
    }
    this.consumeTag();
  }

  parseSequence(stopTags: Set<string>): TemplateNode[] {
    const nodes: TemplateNode[] = [];
    while (this.i < this.length()) {
      const tagStart = this.template.indexOf("{{", this.i);
      if (tagStart === -1) {
        nodes.push({ type: "text", value: this.template.slice(this.i) });
        this.i = this.length();
        break;
      }
      if (tagStart > this.i) {
        nodes.push({ type: "text", value: this.template.slice(this.i, tagStart) });
      }
      const tagEnd = this.template.indexOf("}}", tagStart + 2);
      if (tagEnd === -1) {
        throw new SkillParseError({
          message: "Unterminated tag in template",
          code: "SKILL_PARSE_ERROR",
          syntax: "template",
        });
      }
      const tag = this.template.slice(tagStart + 2, tagEnd).trim();
      this.i = tagEnd + 2;
      if (stopTags.has(tag)) {
        this.i = tagStart;
        break;
      }
      if (tag.startsWith("#if ")) {
        const condition = tag.slice(4).trim();
        const consequent = this.parseSequence(new Set(["/if", "else"]));
        let alternate: TemplateNode[] = [];
        if (this.currentTag() === "else") {
          this.consumeTag();
          alternate = this.parseSequence(new Set(["/if"]));
        }
        this.expectTag("/if");
        nodes.push({ type: "if", condition, consequent, alternate });
      } else if (tag.startsWith("#each ")) {
        const expression = tag.slice(6).trim();
        const body = this.parseSequence(new Set(["/each"]));
        this.expectTag("/each");
        nodes.push({ type: "each", expression, body });
      } else if (tag === "/if" || tag === "/each" || tag === "else") {
        throw new SkillParseError({
          message: "Unexpected closing tag {{" + tag + "}}",
          code: "SKILL_PARSE_ERROR",
          syntax: "template",
        });
      } else {
        nodes.push({ type: "var", expr: tag });
      }
    }
    return nodes;
  }
}
