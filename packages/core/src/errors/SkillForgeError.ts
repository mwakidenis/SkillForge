export type ErrorContext = Record<string, unknown>;

export interface SkillForgeErrorOptions {
  message: string;
  code: string;
  context?: ErrorContext;
  recoverable?: boolean;
  cause?: Error;
}

export class SkillForgeError extends Error {
  public readonly code: string;
  public readonly context: ErrorContext;
  public readonly recoverable: boolean;

  constructor(options: SkillForgeErrorOptions) {
    super(options.message, { cause: options.cause });
    this.name = "SkillForgeError";
    this.code = options.code;
    this.context = options.context ?? {};
    this.recoverable = options.recoverable ?? false;
  }

  public toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      context: this.context,
      recoverable: this.recoverable,
      stack: this.stack,
    };
  }

  protected static superOptions(options: SkillForgeErrorOptions): SkillForgeErrorOptions {
    const result: SkillForgeErrorOptions = {
      message: options.message,
      code: options.code,
      recoverable: options.recoverable ?? false,
    };
    if (options.context !== undefined) {
      result.context = options.context;
    }
    if (options.cause !== undefined) {
      result.cause = options.cause;
    }
    return result;
  }
}

export class SkillParseError extends SkillForgeError {
  public readonly line: number | undefined;
  public readonly column: number | undefined;
  public readonly syntax: string | undefined;

  constructor(options: SkillForgeErrorOptions & { line?: number; column?: number; syntax?: string }) {
    super(SkillForgeError.superOptions(options));
    this.name = "SkillParseError";
    this.line = options.line;
    this.column = options.column;
    this.syntax = options.syntax;
  }

  public override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      line: this.line,
      column: this.column,
      syntax: this.syntax,
    };
  }
}

export class SandboxViolationError extends SkillForgeError {
  public readonly attemptedPath: string | undefined;
  public readonly attemptedCommand: string | undefined;
  public readonly policyRule: string | undefined;

  constructor(
    options: SkillForgeErrorOptions & {
      attemptedPath?: string;
      attemptedCommand?: string;
      policyRule?: string;
    },
  ) {
    super(SkillForgeError.superOptions(options));
    this.name = "SandboxViolationError";
    this.attemptedPath = options.attemptedPath;
    this.attemptedCommand = options.attemptedCommand;
    this.policyRule = options.policyRule;
  }

  public override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      attemptedPath: this.attemptedPath,
      attemptedCommand: this.attemptedCommand,
      policyRule: this.policyRule,
    };
  }
}

export class ProviderExecutionError extends SkillForgeError {
  public readonly providerName: string;
  public readonly httpStatus: number | undefined;
  public readonly retryable: boolean;

  constructor(
    options: SkillForgeErrorOptions & {
      providerName: string;
      httpStatus?: number;
      retryable?: boolean;
    },
  ) {
    super(SkillForgeError.superOptions(options));
    this.name = "ProviderExecutionError";
    this.providerName = options.providerName;
    this.httpStatus = options.httpStatus;
    this.retryable = options.retryable ?? true;
  }

  public override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      providerName: this.providerName,
      httpStatus: this.httpStatus,
      retryable: this.retryable,
    };
  }
}

export class GitCheckpointError extends SkillForgeError {
  public readonly gitCommand: string[];
  public readonly exitCode: number;
  public readonly stderr: string;
  public readonly recoveryInstructions: string | undefined;

  constructor(
    options: SkillForgeErrorOptions & {
      gitCommand: string[];
      exitCode: number;
      stderr: string;
      recoveryInstructions?: string;
    },
  ) {
    super(SkillForgeError.superOptions(options));
    this.name = "GitCheckpointError";
    this.gitCommand = options.gitCommand;
    this.exitCode = options.exitCode;
    this.stderr = options.stderr;
    this.recoveryInstructions = options.recoveryInstructions;
  }

  public override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      gitCommand: this.gitCommand,
      exitCode: this.exitCode,
      stderr: this.stderr,
      recoveryInstructions: this.recoveryInstructions,
    };
  }
}

export class HarnessTimeoutError extends SkillForgeError {
  public readonly stepCount: number;
  public readonly elapsedMs: number;

  constructor(
    options: SkillForgeErrorOptions & { stepCount: number; elapsedMs: number },
  ) {
    super(SkillForgeError.superOptions(options));
    this.name = "HarnessTimeoutError";
    this.stepCount = options.stepCount;
    this.elapsedMs = options.elapsedMs;
  }

  public override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      stepCount: this.stepCount,
      elapsedMs: this.elapsedMs,
    };
  }
}
