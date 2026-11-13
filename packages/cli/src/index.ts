#!/usr/bin/env node
import { runCommand } from "./commands/runCommand.js";
import { listCommand } from "./commands/listCommand.js";
import { validateCommand } from "./commands/validateCommand.js";
import { initCommand } from "./commands/initCommand.js";
import { rollbackCommand } from "./commands/rollbackCommand.js";
import { daemonCommand } from "./commands/daemonCommand.js";
import { parseArgs } from "./argParser.js";
import { formatHelp } from "./formatter.js";

const args = parseArgs(process.argv.slice(2));

async function main(): Promise<void> {
  if (args.help || args._.length === 0) {
    process.stdout.write(formatHelp());
    process.exit(args.help ? 0 : 1);
  }

  const command = args._[0];

  try {
    switch (command) {
      case "init":
        await initCommand(args);
        break;
      case "list":
        await listCommand(args);
        break;
      case "validate":
        await validateCommand(args);
        break;
      case "run":
        await runCommand(args);
        break;
      case "rollback":
        await rollbackCommand(args);
        break;
      case "daemon":
        await daemonCommand(args);
        break;
      default:
        process.stderr.write(`Unknown command: ${command}\n`);
        process.stdout.write(formatHelp());
        process.exit(1);
    }
  } catch (err) {
    if (args.json) {
      process.stdout.write(JSON.stringify({ error: (err as Error).message }) + "\n");
    } else {
      process.stderr.write(`Error: ${(err as Error).message}\n`);
    }
    process.exit(1);
  }
}

main();
