import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";

const execFileAsync = promisify(execFile);

export const DEFAULT_POSTGRES_IMAGE = "postgres:17.6-alpine";
export const DEFAULT_REDIS_IMAGE = "redis:7.4.2-alpine";
export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_POSTGRES_STARTUP_TIMEOUT_MS = 30_000;
export const DEFAULT_REDIS_STARTUP_TIMEOUT_MS = 15_000;
export const DEFAULT_POLL_INTERVAL_MS = 200;
export const DEFAULT_COMMAND_TIMEOUT_MS = 120_000;
export const DEFAULT_DOCKER_COMMAND_TIMEOUT_MS = 30_000;

export type CommandResult = {
  stdout: string;
  stderr: string;
};

export type CommandOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeout?: number;
  killSignal?: NodeJS.Signals;
};

export type CommandRunner = (
  command: string,
  args: readonly string[],
  options?: CommandOptions,
) => Promise<CommandResult>;

export type DockerRunner = (
  args: readonly string[],
  options?: CommandOptions,
) => Promise<CommandResult>;

export type DisposableEnvironment = {
  DATABASE_URL: string;
  TEST_DATABASE_URL: string;
  REDIS_URL: string;
  TEST_REDIS_URL: string;
};

export type PostgresConnectionDetails = {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  databaseUrl: string;
  containerName: string;
};

export type RedisConnectionDetails = {
  host: string;
  port: number;
  url: string;
  containerName: string;
};

export type EphemeralPostgresOptions = {
  image?: string;
  host?: string;
  database?: string;
  user?: string;
  password?: string;
  containerName?: string;
  startupTimeoutMs?: number;
  pollIntervalMs?: number;
  dockerBinary?: string;
  runDocker?: DockerRunner;
};

export type EphemeralRedisOptions = {
  image?: string;
  host?: string;
  containerName?: string;
  startupTimeoutMs?: number;
  pollIntervalMs?: number;
  dockerBinary?: string;
  runDocker?: DockerRunner;
};

export type MigrationDeployOptions = {
  databaseUrl: string;
  prismaSchemaPath: string;
  cwd?: string;
  prismaBinary?: string;
  runCommand?: CommandRunner;
};

export type DisposableIntegrationInfrastructureOptions = {
  prismaSchemaPath: string;
  cwd?: string;
  prismaBinary?: string;
  postgres?: EphemeralPostgresOptions;
  redis?: EphemeralRedisOptions;
  runCommand?: CommandRunner;
  deployMigrations?: (options: MigrationDeployOptions) => Promise<void>;
};

export type DisposableIntegrationInfrastructure = {
  postgres: PostgresConnectionDetails;
  redis: RedisConnectionDetails;
  databaseUrl: string;
  redisUrl: string;
  environment: DisposableEnvironment;
};

export type DisposableIntegrationCallback<T> = (
  infrastructure: DisposableIntegrationInfrastructure,
) => Promise<T> | T;

export function createCommandRunner(binary = ""): CommandRunner {
  return async (command, args, options = {}) => {
    const executable = binary || command;
    const commandArgs = binary ? [command, ...args] : args;
    const result = await execFileAsync(executable, commandArgs, {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      timeout: DEFAULT_COMMAND_TIMEOUT_MS,
      ...options,
    });
    return {
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
    };
  };
}

export function createDockerRunner(dockerBinary = "docker"): DockerRunner {
  const runCommand = createCommandRunner();
  return (args, options = {}) =>
    runCommand(dockerBinary, args, {
      ...options,
      timeout: options.timeout ?? DEFAULT_DOCKER_COMMAND_TIMEOUT_MS,
    });
}

function parseMappedPort(output: string, serviceName: string): number {
  const match = output.match(/:(\d+)\s*$/m);
  if (!match) {
    throw new Error(`Docker did not return a mapped ${serviceName} port: ${output}`);
  }
  return Number(match[1]);
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function createSuffix(): string {
  return randomUUID().replaceAll("-", "");
}

function requireStarted<T>(value: T | null, serviceName: string): T {
  if (value === null) {
    throw new Error(`Ephemeral ${serviceName} has not been started`);
  }
  return value;
}

export class EphemeralPostgres {
  private readonly image: string;
  private readonly host: string;
  private readonly database: string;
  private readonly user: string;
  private readonly password: string;
  private readonly containerName: string;
  private readonly startupTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly runDocker: DockerRunner;
  private port: number | null = null;
  private started = false;

  constructor(options: EphemeralPostgresOptions = {}) {
    const suffix = createSuffix();
    this.image = options.image ?? DEFAULT_POSTGRES_IMAGE;
    this.host = options.host ?? DEFAULT_HOST;
    this.database = options.database ?? `moda_test_${suffix.slice(0, 12)}`;
    this.user = options.user ?? `moda_test_${suffix.slice(0, 12)}`;
    this.password = options.password ?? `test_${suffix}`;
    this.containerName = options.containerName ?? `moda-test-postgres-${suffix}`;
    this.startupTimeoutMs = options.startupTimeoutMs ?? DEFAULT_POSTGRES_STARTUP_TIMEOUT_MS;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.runDocker = options.runDocker ?? createDockerRunner(options.dockerBinary);
  }

  get databaseUrl(): string {
    const port = requireStarted(this.port, "PostgreSQL");
    return `postgresql://${this.user}:${this.password}@${this.host}:${port}/${this.database}`;
  }

  get connectionDetails(): PostgresConnectionDetails {
    return {
      host: this.host,
      port: requireStarted(this.port, "PostgreSQL"),
      database: this.database,
      user: this.user,
      password: this.password,
      databaseUrl: this.databaseUrl,
      containerName: this.containerName,
    };
  }

  async start(): Promise<PostgresConnectionDetails> {
    if (this.started) return this.connectionDetails;

    try {
      await this.runDocker([
        "run",
        "--detach",
        "--name",
        this.containerName,
        "--env",
        `POSTGRES_DB=${this.database}`,
        "--env",
        `POSTGRES_USER=${this.user}`,
        "--env",
        `POSTGRES_PASSWORD=${this.password}`,
        "--publish",
        "0:5432",
        this.image,
      ]);
      const portResult = await this.runDocker(["port", this.containerName, "5432/tcp"]);
      this.port = parseMappedPort(portResult.stdout, "PostgreSQL");
      await this.waitForReady();
      this.started = true;
      return this.connectionDetails;
    } catch (error) {
      await this.cleanup();
      throw new Error(
        `Unable to start ephemeral PostgreSQL (${this.image}): ${errorMessage(error)}`,
        { cause: error },
      );
    }
  }

  async waitForReady(): Promise<void> {
    const deadline = Date.now() + this.startupTimeoutMs;
    let lastError: unknown;

    while (Date.now() < deadline) {
      try {
        const result = await this.runDocker([
          "exec",
          this.containerName,
          "pg_isready",
          "--username",
          this.user,
          "--dbname",
          this.database,
        ]);
        if (/accepting connections/i.test(result.stdout)) return;
        lastError = new Error(`Unexpected PostgreSQL readiness response: ${result.stdout}`);
      } catch (error) {
        lastError = error;
      }
      await sleep(Math.min(this.pollIntervalMs, Math.max(0, deadline - Date.now())));
    }

    throw new Error(
      `PostgreSQL readiness timed out after ${this.startupTimeoutMs}ms${lastError ? `: ${errorMessage(lastError)}` : ""}`,
    );
  }

  async cleanup(): Promise<void> {
    this.port = null;
    this.started = false;
    await this.runDocker(["rm", "--force", "--volumes", this.containerName]).catch(() => undefined);
  }
}

export class EphemeralRedis {
  private readonly image: string;
  private readonly host: string;
  private readonly containerName: string;
  private readonly startupTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly runDocker: DockerRunner;
  private port: number | null = null;
  private started = false;

  constructor(options: EphemeralRedisOptions = {}) {
    const suffix = createSuffix();
    this.image = options.image ?? DEFAULT_REDIS_IMAGE;
    this.host = options.host ?? DEFAULT_HOST;
    this.containerName = options.containerName ?? `moda-test-redis-${suffix}`;
    this.startupTimeoutMs = options.startupTimeoutMs ?? DEFAULT_REDIS_STARTUP_TIMEOUT_MS;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.runDocker = options.runDocker ?? createDockerRunner(options.dockerBinary);
  }

  get url(): string {
    const port = requireStarted(this.port, "Redis");
    return `redis://${this.host}:${port}`;
  }

  get connectionDetails(): RedisConnectionDetails {
    return {
      host: this.host,
      port: requireStarted(this.port, "Redis"),
      url: this.url,
      containerName: this.containerName,
    };
  }

  async start(): Promise<RedisConnectionDetails> {
    if (this.started) return this.connectionDetails;

    try {
      await this.runDocker([
        "run",
        "--detach",
        "--name",
        this.containerName,
        "--publish",
        "0:6379",
        this.image,
      ]);
      const portResult = await this.runDocker(["port", this.containerName, "6379/tcp"]);
      this.port = parseMappedPort(portResult.stdout, "Redis");
      await this.waitForReady();
      this.started = true;
      return this.connectionDetails;
    } catch (error) {
      await this.cleanup();
      throw new Error(
        `Unable to start ephemeral Redis (${this.image}): ${errorMessage(error)}`,
        { cause: error },
      );
    }
  }

  async waitForReady(): Promise<void> {
    const deadline = Date.now() + this.startupTimeoutMs;
    let lastError: unknown;

    while (Date.now() < deadline) {
      try {
        const result = await this.runDocker(["exec", this.containerName, "redis-cli", "ping"]);
        if (result.stdout === "PONG") return;
        lastError = new Error(`Unexpected Redis readiness response: ${result.stdout}`);
      } catch (error) {
        lastError = error;
      }
      await sleep(Math.min(this.pollIntervalMs, Math.max(0, deadline - Date.now())));
    }

    throw new Error(
      `Redis readiness timed out after ${this.startupTimeoutMs}ms${lastError ? `: ${errorMessage(lastError)}` : ""}`,
    );
  }

  async cleanup(): Promise<void> {
    this.port = null;
    this.started = false;
    await this.runDocker(["rm", "--force", "--volumes", this.containerName]).catch(() => undefined);
  }
}

export async function deployPrismaMigrations(options: MigrationDeployOptions): Promise<void> {
  const runCommand = options.runCommand ?? createCommandRunner();
  await runCommand(
    options.prismaBinary ?? "prisma",
    ["migrate", "deploy", "--schema", options.prismaSchemaPath],
    {
      cwd: options.cwd,
      env: { ...process.env, DATABASE_URL: options.databaseUrl },
    },
  );
}

export async function withDisposableIntegrationInfrastructure<T>(
  options: DisposableIntegrationInfrastructureOptions,
  callback: DisposableIntegrationCallback<T>,
): Promise<T> {
  const postgres = new EphemeralPostgres(options.postgres);
  const redis = new EphemeralRedis(options.redis);

  try {
    const postgresDetails = await postgres.start();
    const redisDetails = await redis.start();
    const environment: DisposableEnvironment = {
      DATABASE_URL: postgresDetails.databaseUrl,
      TEST_DATABASE_URL: postgresDetails.databaseUrl,
      REDIS_URL: redisDetails.url,
      TEST_REDIS_URL: redisDetails.url,
    };
    const deployMigrations = options.deployMigrations ?? deployPrismaMigrations;
    await deployMigrations({
      databaseUrl: postgresDetails.databaseUrl,
      prismaSchemaPath: options.prismaSchemaPath,
      cwd: options.cwd,
      prismaBinary: options.prismaBinary,
      runCommand: options.runCommand,
    });
    return await callback({
      postgres: postgresDetails,
      redis: redisDetails,
      databaseUrl: postgresDetails.databaseUrl,
      redisUrl: redisDetails.url,
      environment,
    });
  } finally {
    await Promise.all([postgres.cleanup(), redis.cleanup()]);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}