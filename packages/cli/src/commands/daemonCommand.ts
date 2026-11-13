import { IpcServer } from "../ipcServer.js";

export interface DaemonCommandArgs {
  workspace?: string;
  json?: boolean;
  _: string[];
}

export async function daemonCommand(args: DaemonCommandArgs): Promise<void> {
  const server = new IpcServer({ port: 48921, host: "127.0.0.1" });
  await server.start();
  if (args.json) {
    process.stdout.write(JSON.stringify({ ok: true, host: "127.0.0.1", port: 48921 }) + "\n");
  } else {
    process.stdout.write("SkillForge IPC daemon listening on http://127.0.0.1:48921\n");
    process.stdout.write("Press Ctrl+C to stop.\n");
  }

  const stopSignals = ["SIGINT", "SIGTERM"];
  for (const sig of stopSignals) {
    process.on(sig as any, async () => {
      await server.stop();
      process.exit(0);
    });
  }
}
