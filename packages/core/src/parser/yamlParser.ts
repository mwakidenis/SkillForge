import { SkillParseError } from "../errors/SkillForgeError.js";

export function parseYaml(text: string): unknown {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  return new FrontmatterParser(lines).parseDocument();
}

class FrontmatterParser {
  private readonly lines: string[];
  private i = 0;

  constructor(lines: string[]) {
    this.lines = lines;
  }

  private lineNo(): number {
    return this.i + 1;
  }

  private peek(): string | null {
    return this.lines[this.i] ?? null;
  }

  private advance(): void {
    this.i++;
  }

  private indentCount(line: string): number {
    let n = 0;
    while (n < line.length && line.charAt(n) === " ") n++;
    if (n < line.length && line.charAt(n) === "\t") {
      throw new SkillParseError({
        message: "Tab indentation is not allowed; use spaces for indentation",
        code: "SKILL_PARSE_ERROR",
        line: this.lineNo(),
        syntax: "indentation",
      });
    }
    return n;
  }

  private currentIndent(): number {
    const line = this.peek();
    if (line === null) return -1;
    return this.indentCount(line);
  }

  private peekIndent(): number | null {
    const line = this.peek();
    if (line === null) return null;
    return this.indentCount(line);
  }

  private isBlank(line: string): boolean {
    return line.trim() === "";
  }

  private isComment(line: string): boolean {
    return line.trimStart().startsWith("#");
  }

  private skipBlanksAndComments(): void {
    while (true) {
      const line = this.peek();
      if (line === null) return;
      if (this.isBlank(line) || this.isComment(line)) {
        this.advance();
        continue;
      }
      return;
    }
  }

  parseDocument(): unknown {
    this.skipBlanksAndComments();
    const line = this.peek();
    if (line === null) return {};
    const indent = this.currentIndent();
    if (line.startsWith("- ")) {
      return this.parseSequence(indent);
    }
    return this.parseMapping(indent);
  }

  private parseBlock(indent: number): unknown {
    this.skipBlanksAndComments();
    const line = this.peek();
    if (line === null) return null;
    const lineIndent = this.currentIndent();
    if (lineIndent < indent) return null;
    if (lineIndent > indent) {
      throw new SkillParseError({
        message: `Inconsistent dedentation: line indented ${lineIndent} spaces but ${indent} expected`,
        code: "SKILL_PARSE_ERROR",
        line: this.lineNo(),
        syntax: "indentation",
      });
    }
    const lineContent = line.slice(indent);
    if (lineContent.startsWith("- ")) {
      return this.parseSequence(indent);
    }
    return this.parseMapping(indent);
  }

  private parseMapping(indent: number): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const seen = new Set<string>();
    while (true) {
      this.skipBlanksAndComments();
      const line = this.peek();
      if (line === null) break;
      const lineIndent = this.currentIndent();
      if (lineIndent < indent) break;
      if (lineIndent > indent) {
        throw new SkillParseError({
          message: `Inconsistent dedentation: line indented ${lineIndent} spaces but ${indent} expected`,
          code: "SKILL_PARSE_ERROR",
          line: this.lineNo(),
          syntax: "indentation",
        });
      }
      const lineContent = line.slice(indent);
      if (lineContent.startsWith("- ")) break;
      const match = /^(?:"([^"]*)"|'([^']*)'|([^\s:][^:]*)):\s*(.*)$/s.exec(lineContent);
      if (!match) {
        throw new SkillParseError({
          message: `Invalid mapping entry: ${line}`,
          code: "SKILL_PARSE_ERROR",
          line: this.lineNo(),
          syntax: "mapping",
        });
      }
      const key = (match[1] ?? match[2] ?? match[3] ?? "").trim();
      const rest = match[4];
      if (seen.has(key)) {
        throw new SkillParseError({
          message: `Duplicate key "${key}" at the same object level`,
          code: "SKILL_PARSE_ERROR",
          line: this.lineNo(),
          syntax: "mapping",
        });
      }
      seen.add(key);
      this.advance();
      const trimmed = (rest ?? "").trim();
      if ((rest ?? "") === "") {
        const childIndent = this.peekIndent();
        if (childIndent !== null && childIndent > indent) {
          result[key] = this.parseBlock(childIndent);
        } else {
          result[key] = null;
        }
      } else if (trimmed === "|" || trimmed === ">") {
        result[key] = this.parseBlockScalar(trimmed, indent);
      } else {
        result[key] = this.parseInlineValue(rest ?? "");
      }
    }
    return result;
  }

  private parseMappingInto(
    item: Record<string, unknown>,
    indent: number,
  ): void {
    const seen = new Set<string>();
    while (true) {
      this.skipBlanksAndComments();
      const line = this.peek();
      if (line === null) break;
      const lineIndent = this.currentIndent();
      if (lineIndent < indent) break;
      if (lineIndent > indent) {
        throw new SkillParseError({
          message: `Inconsistent dedentation: line indented ${lineIndent} spaces but ${indent} expected`,
          code: "SKILL_PARSE_ERROR",
          line: this.lineNo(),
          syntax: "indentation",
        });
      }
      const lineContent = line.slice(indent);
      if (lineContent.startsWith("- ")) break;
      const match = /^(?:"([^"]*)"|'([^']*)'|([^\s:][^:]*)):\s*(.*)$/s.exec(lineContent);
      if (!match) {
        throw new SkillParseError({
          message: `Invalid mapping entry: ${line}`,
          code: "SKILL_PARSE_ERROR",
          line: this.lineNo(),
          syntax: "mapping",
        });
      }
      const key = (match[1] ?? match[2] ?? match[3] ?? "").trim();
      const rest = match[4];
      if (seen.has(key)) {
        throw new SkillParseError({
          message: `Duplicate key "${key}" at the same object level`,
          code: "SKILL_PARSE_ERROR",
          line: this.lineNo(),
          syntax: "mapping",
        });
      }
      seen.add(key);
      this.advance();
      const trimmed = (rest ?? "").trim();
      if ((rest ?? "") === "") {
        const childIndent = this.peekIndent();
        if (childIndent !== null && childIndent > indent) {
          item[key] = this.parseBlock(childIndent);
        } else {
          item[key] = null;
        }
      } else if (trimmed === "|" || trimmed === ">") {
        item[key] = this.parseBlockScalar(trimmed, indent);
      } else {
        item[key] = this.parseInlineValue(rest ?? "");
      }
    }
  }

  private parseSequence(indent: number): unknown[] {
    const items: unknown[] = [];
    while (true) {
      this.skipBlanksAndComments();
      const line = this.peek();
      if (line === null) break;
      const lineIndent = this.currentIndent();
      if (lineIndent < indent) break;
      if (lineIndent > indent) {
        throw new SkillParseError({
          message: `Inconsistent dedentation: line indented ${lineIndent} spaces but ${indent} expected`,
          code: "SKILL_PARSE_ERROR",
          line: this.lineNo(),
          syntax: "indentation",
        });
      }
      const lineContent = line.slice(indent);
      if (!lineContent.startsWith("- ")) {
        throw new SkillParseError({
          message: `Expected sequence item starting with "- ": ${line}`,
          code: "SKILL_PARSE_ERROR",
          line: this.lineNo(),
          syntax: "sequence",
        });
      }
      const content = lineContent.slice(2);
      this.advance();
      if (content.trim() === "") {
        const childIndent = this.peekIndent();
        if (childIndent !== null && childIndent > indent) {
          items.push(this.parseBlock(childIndent));
        } else {
          items.push(null);
        }
        continue;
      }
      const match = /^(?:"([^"]*)"|'([^']*)'|([^\s:][^:]*)):\s*(.*)$/s.exec(content);
      if (match) {
        const key = (match[1] ?? match[2] ?? match[3] ?? "").trim();
        const rest = match[4];
        const item: Record<string, unknown> = {};
        const trimmed = (rest ?? "").trim();
        if ((rest ?? "") === "") {
          const childIndent = this.peekIndent();
          if (childIndent !== null && childIndent > indent) {
            item[key] = this.parseBlock(childIndent);
          } else {
            item[key] = null;
          }
        } else if (trimmed === "|" || trimmed === ">") {
          item[key] = this.parseBlockScalar(trimmed, indent);
        } else {
          item[key] = this.parseInlineValue(rest ?? "");
        }
        const childIndent = this.peekIndent();
        if (childIndent !== null && childIndent > indent) {
          this.parseMappingInto(item, childIndent);
        }
        items.push(item);
      } else {
        items.push(this.parseInlineValue(content));
      }
    }
    return items;
  }

  private parseBlockScalar(indicator: string, parentIndent: number): string {
    this.skipBlanksAndComments();
    const first = this.peek();
    if (first === null) return "";
    let blockIndent = 0;
    while (blockIndent < first.length && first.charAt(blockIndent) === " ") {
      blockIndent++;
    }
    if (blockIndent <= parentIndent) {
      throw new SkillParseError({
        message: `Block scalar must be indented more than the parent (${parentIndent})`,
        code: "SKILL_PARSE_ERROR",
        line: this.lineNo(),
        syntax: "block-scalar",
      });
    }
    const contentLines: string[] = [];
    while (true) {
      const line = this.peek();
      if (line === null) break;
      if (this.isBlank(line)) {
        contentLines.push("");
        this.advance();
        continue;
      }
      const li = this.indentCount(line);
      if (li < blockIndent) break;
      contentLines.push(line.slice(blockIndent));
      this.advance();
    }
    if (indicator === "|") {
      return contentLines.join("\n");
    }
    const paragraphs: string[] = [];
    const cur: string[] = [];
    for (const line of contentLines) {
      if (line === "") {
        if (cur.length > 0) {
          paragraphs.push(cur.join(" "));
          cur.length = 0;
        }
      } else {
        cur.push(line);
      }
    }
    if (cur.length > 0) paragraphs.push(cur.join(" "));
    return paragraphs.join("\n\n").trim();
  }

  private parseInlineValue(str: string): unknown {
    const trimmed = str.trim();
    if (trimmed === "") return null;
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      return this.parseInlineArray(trimmed.slice(1, -1).trim());
    }
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      return this.parseInlineObject(trimmed.slice(1, -1).trim());
    }
    if (trimmed.startsWith('"')) {
      return this.scanDoubleQuoted(trimmed).value;
    }
    if (trimmed.startsWith("'")) {
      return this.scanSingleQuoted(trimmed).value;
    }
    const lower = trimmed.toLowerCase();
    if (lower === "true") return true;
    if (lower === "false") return false;
    if (lower === "null" || lower === "~") return null;
    if (/^-?\d+$/.test(trimmed)) return parseInt(trimmed, 10);
    if (/^-?\d+\.\d+$/.test(trimmed)) return parseFloat(trimmed);
    if (/^-?\.\d+$/.test(trimmed)) return parseFloat(trimmed);
    return this.stripInlineCommentUnquoted(trimmed);
  }

  private parseInlineArray(inner: string): unknown[] {
    if (inner === "") return [];
    const elements: unknown[] = [];
    let current = "";
    let depth = 0;
    let inSingle = false;
    let inDouble = false;
    for (let k = 0; k < inner.length; k++) {
      const ch = inner.charAt(k);
      if (inSingle) {
        current += ch;
        if (ch === "'") inSingle = false;
        continue;
      }
      if (inDouble) {
        current += ch;
        if (ch === '"') inDouble = false;
        continue;
      }
      if (ch === "'") {
        inSingle = true;
        current += ch;
        continue;
      }
      if (ch === '"') {
        inDouble = true;
        current += ch;
        continue;
      }
      if (ch === "[" || ch === "{") {
        depth++;
        current += ch;
        continue;
      }
      if (ch === "]" || ch === "}") {
        depth--;
        current += ch;
        continue;
      }
      if (ch === "," && depth === 0) {
        elements.push(this.parseInlineValue(current.trim()));
        current = "";
        continue;
      }
      current += ch;
    }
    if (current.trim() !== "") {
      elements.push(this.parseInlineValue(current.trim()));
    }
    return elements;
  }

  private parseInlineObject(inner: string): Record<string, unknown> {
    const obj: Record<string, unknown> = {};
    if (inner === "") return obj;
    let current = "";
    let depth = 0;
    let inSingle = false;
    let inDouble = false;
    const segments: string[] = [];
    for (let k = 0; k < inner.length; k++) {
      const ch = inner.charAt(k);
      if (inSingle) {
        current += ch;
        if (ch === "'") inSingle = false;
        continue;
      }
      if (inDouble) {
        current += ch;
        if (ch === '"') inDouble = false;
        continue;
      }
      if (ch === "'") {
        inSingle = true;
        current += ch;
        continue;
      }
      if (ch === '"') {
        inDouble = true;
        current += ch;
        continue;
      }
      if (ch === "[" || ch === "{") {
        depth++;
        current += ch;
        continue;
      }
      if (ch === "]" || ch === "}") {
        depth--;
        current += ch;
        continue;
      }
      if (ch === "," && depth === 0) {
        segments.push(current);
        current = "";
        continue;
      }
      current += ch;
    }
    if (current.trim() !== "") segments.push(current);
    for (const segment of segments) {
      const match = /^(?:"([^"]*)"|'([^']*)'|([^\s:][^:]*)):\s*(.*)$/s.exec(segment.trim());
      if (!match) continue;
      const key = (match[1] ?? match[2] ?? match[3] ?? "").trim();
      obj[key] = this.parseInlineValue(match[4] ?? "");
    }
    return obj;
  }

  private scanDoubleQuoted(str: string): { value: string; endIndex: number } {
    let i = 1;
    const out: string[] = [];
    while (i < str.length) {
      const ch = str.charAt(i);
      if (ch === "\\") {
        i++;
        if (i >= str.length) {
          throw new SkillParseError({
            message: "Unterminated escape sequence in double-quoted string",
            code: "SKILL_PARSE_ERROR",
            line: this.lineNo(),
            syntax: "string",
          });
        }
        const esc = str.charAt(i);
        switch (esc) {
          case "n": out.push("\n"); break;
          case '"': out.push('"'); break;
          case "\\": out.push("\\"); break;
          case "t": out.push("\t"); break;
          case "r": out.push("\r"); break;
          default: out.push(esc); break;
        }
        i++;
        continue;
      }
      if (ch === '"') {
        return { value: out.join(""), endIndex: i + 1 };
      }
      out.push(ch);
      i++;
    }
    throw new SkillParseError({
      message: "Unterminated double-quoted string",
      code: "SKILL_PARSE_ERROR",
      line: this.lineNo(),
      syntax: "string",
    });
  }

  private scanSingleQuoted(str: string): { value: string; endIndex: number } {
    let i = 1;
    const out: string[] = [];
    while (i < str.length) {
      const ch = str.charAt(i);
      if (ch === "'") {
        if (i + 1 < str.length && str.charAt(i + 1) === "'") {
          out.push("'");
          i += 2;
          continue;
        }
        return { value: out.join(""), endIndex: i + 1 };
      }
      out.push(ch);
      i++;
    }
    throw new SkillParseError({
      message: "Unterminated single-quoted string",
      code: "SKILL_PARSE_ERROR",
      line: this.lineNo(),
      syntax: "string",
    });
  }

  private stripInlineCommentUnquoted(str: string): string {
    let inSingle = false;
    let inDouble = false;
    for (let k = 0; k < str.length; k++) {
      const ch = str.charAt(k);
      if (inSingle) {
        if (ch === "'") inSingle = false;
        continue;
      }
      if (inDouble) {
        if (ch === '"') inDouble = false;
        continue;
      }
      if (ch === "'") {
        inSingle = true;
        continue;
      }
      if (ch === '"') {
        inDouble = true;
        continue;
      }
      if (ch === "#") {
        return str.slice(0, k).trimEnd();
      }
    }
    return str.trim();
  }
}
