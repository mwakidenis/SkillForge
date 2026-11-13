export interface ParsedArgs {
  _: string[];
  param: Record<string, string>;
  workspace?: string;
  provider?: string;
  model?: string;
  runId?: string;
  list?: boolean;
  dryRun: boolean;
  json: boolean;
  help: boolean;
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const result: ParsedArgs = {
    _: [],
    param: {},
    dryRun: false,
    json: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (arg === "--help" || arg === "-h") {
      result.help = true;
      continue;
    }
    if (arg === "--json") {
      result.json = true;
      continue;
    }
    if (arg === "--list") {
      result.list = true;
      continue;
    }
    if (arg === "--dry-run") {
      result.dryRun = true;
      continue;
    }
    if (arg === "--workspace" || arg === "-w") {
      result.workspace = argv[i + 1] ?? "";
      i++;
      continue;
    }
    if (arg.startsWith("--workspace=") || arg.startsWith("-w=")) {
      result.workspace = arg.split("=").slice(1).join("=");
      continue;
    }
    if (arg === "--provider" || arg === "-p") {
      result.provider = argv[i + 1] ?? "";
      i++;
      continue;
    }
    if (arg.startsWith("--provider=") || arg.startsWith("-p=")) {
      result.provider = arg.split("=").slice(1).join("=");
      continue;
    }
    if (arg === "--model" || arg === "-m") {
      result.model = argv[i + 1] ?? "";
      i++;
      continue;
    }
    if (arg.startsWith("--model=") || arg.startsWith("-m=")) {
      result.model = arg.split("=").slice(1).join("=");
      continue;
    }
    if (arg === "--run-id") {
      result.runId = argv[i + 1] ?? "";
      i++;
      continue;
    }
    if (arg.startsWith("--run-id=")) {
      result.runId = arg.slice("--run-id=".length);
      continue;
    }
    if (arg === "--param") {
      const kv = argv[i + 1] ?? "";
      i++;
      const eq = kv.indexOf("=");
      if (eq === -1) {
        result.param[kv] = "";
      } else {
        result.param[kv.slice(0, eq)] = kv.slice(eq + 1);
      }
      continue;
    }
    if (arg.startsWith("--param=")) {
      const kv = arg.slice("--param=".length);
      const eq = kv.indexOf("=");
      if (eq === -1) {
        result.param[kv] = "";
      } else {
        result.param[kv.slice(0, eq)] = kv.slice(eq + 1);
      }
      continue;
    }
    result._.push(arg);
  }

  return result;
}
