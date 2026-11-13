import * as http from "node:http";
import type { HarnessEvent } from "../types/ipc.js";

export interface IpcBroadcasterConfig {
  host: string;
  port: number;
  basePath: string;
}

export class IpcBroadcaster {
  public readonly config: IpcBroadcasterConfig;
  private readonly baseUrl: string;

  constructor(config: Partial<IpcBroadcasterConfig> = {}) {
    this.config = {
      host: config.host ?? "127.0.0.1",
      port: config.port ?? 48921,
      basePath: config.basePath ?? "/events",
    };
    this.baseUrl = `http://${this.config.host}:${this.config.port}${this.config.basePath}`;
  }

  async broadcast(event: HarnessEvent): Promise<void> {
    const body = JSON.stringify(event);
    return new Promise<void>((resolve, reject) => {
      const parsed = new URL(this.baseUrl);
      const options: http.RequestOptions = {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
        timeout: 2000,
      };
      const req = http.request(options, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", (err) => {
        // Silently ignore ECONNREFUSED when no daemon/tray is listening
        resolve();
      });
      req.on("timeout", () => {
        req.destroy(new Error("IPC broadcast timeout"));
      });
      req.on("close", () => {});
      req.write(body);
      req.end();
    });
  }
}

export function createIpcBroadcaster(config?: Partial<IpcBroadcasterConfig>): IpcBroadcaster {
  return new IpcBroadcaster(config);
}

export type { HarnessEvent };
