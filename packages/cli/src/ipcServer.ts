import * as http from "node:http";
import type { HarnessEvent, IpcStatusPayload } from "@skillforge/core";

export interface IPCServerOptions {
  port?: number;
  host?: string;
  onRollbackLatest?: () => Promise<void> | void;
}

export class IpcServer {
  public readonly port: number;
  public readonly host: string;
  private readonly server: http.Server;
  private status: IpcStatusPayload = {
    status: "IDLE",
    activeRunId: null,
    activeSkillId: null,
    uptimeMs: 0,
    latestCheckpointId: null,
    recentEvents: [],
  };
  private startedAt = Date.now();

  constructor(options: IPCServerOptions = {}, onRollbackLatest?: () => Promise<void> | void) {
    this.port = options.port ?? 48921;
    this.host = options.host ?? "127.0.0.1";
    this.server = http.createServer((req, res) => {
      void this.handleRequest(req, res, onRollbackLatest);
    });
  }

  setStatus(status: IpcStatusPayload): void {
    this.status = status;
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.listen(this.port, this.host, (err?: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    onRollbackLatest?: () => Promise<void> | void,
  ): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${this.host}:${this.port}`);
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Access-Control-Allow-Origin", "*");

    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200);
      res.end(JSON.stringify({ status: "ok", port: this.port, uptimeMs: Date.now() - this.startedAt }));
      return;
    }

    if (req.method === "GET" && url.pathname === "/status") {
      res.writeHead(200);
      res.end(JSON.stringify(this.status));
      return;
    }

    if (req.method === "POST" && url.pathname === "/events") {
      const body = await readBody(req);
      try {
        const event = JSON.parse(body) as HarnessEvent;
        this.status.recentEvents = [...this.status.recentEvents.slice(-99), event];
        if (event.type === "run:started") {
          this.status.status = "RUNNING";
          this.status.activeRunId = event.runId;
          this.status.activeSkillId = event.skillId ?? null;
        } else if (event.type === "run:completed" || event.type === "run:failed") {
          this.status.status = event.type === "run:failed" ? "ERROR" : "IDLE";
        }
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true }));
      } catch {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "invalid event" }));
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/rollback/latest") {
      try {
        if (onRollbackLatest) {
          const result = onRollbackLatest();
          if (result && typeof result.then === "function") await result;
        }
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: (err as Error).message }));
      }
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: "not found" }));
  }
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export function createIpcServer(options: IPCServerOptions = {}, onRollbackLatest?: () => Promise<void> | void): IpcServer {
  return new IpcServer(options, onRollbackLatest);
}

export type { IpcStatusPayload, HarnessEvent };
