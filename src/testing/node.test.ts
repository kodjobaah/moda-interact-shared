import assert from "node:assert/strict";
import test from "node:test";
import {
  createCommandRunner,
  deployPrismaMigrations,
  EphemeralPostgres,
  EphemeralRedis,
  withDisposableIntegrationInfrastructure,
  type CommandResult,
  type DockerRunner,
} from "./node.js";

test("command runner applies a bounded default timeout", async () => {
  const command = createCommandRunner("node");
  await assert.rejects(
    command("-e", ["setTimeout(() => {}, 1000)"], { timeout: 1 }),
    /timed out|SIGTERM|killed|Command failed/i,
  );
});

function createDockerDouble(options: {
  postgresPort?: number;
  redisPort?: number;
  failReadiness?: boolean;
} = {}): { runDocker: DockerRunner; calls: string[][] } {
  const calls: string[][] = [];
  let postgresPort = options.postgresPort ?? 25432;
  let redisPort = options.redisPort ?? 26379;
  const runDocker: DockerRunner = async (args): Promise<CommandResult> => {
    calls.push([...args]);
    if (args[0] === "port" && args[2] === "5432/tcp") {
      return { stdout: `0.0.0.0:${postgresPort}`, stderr: "" };
    }
    if (args[0] === "port" && args[2] === "6379/tcp") {
      return { stdout: `0.0.0.0:${redisPort}`, stderr: "" };
    }
    if (args[0] === "exec" && args[2] === "pg_isready") {
      if (options.failReadiness) throw new Error("postgres not ready");
      return { stdout: "127.0.0.1:5432 - accepting connections", stderr: "" };
    }
    if (args[0] === "exec" && args[2] === "redis-cli") {
      if (options.failReadiness) throw new Error("redis not ready");
      return { stdout: "PONG", stderr: "" };
    }
    if (args[0] === "run") {
      if (args.at(-1) === "postgres:17.6-alpine") postgresPort += 1;
      if (args.at(-1) === "redis:7.4.2-alpine") redisPort += 1;
    }
    return { stdout: "", stderr: "" };
  };
  return { runDocker, calls };
}

test("PostgreSQL and Redis use dynamic ports and forced cleanup", async () => {
  const postgresDouble = createDockerDouble({ postgresPort: 25432 });
  const postgres = new EphemeralPostgres({
    runDocker: postgresDouble.runDocker,
    pollIntervalMs: 1,
    startupTimeoutMs: 10,
  });
  const postgresDetails = await postgres.start();
  assert.equal(postgresDetails.port, 25433);
  assert.match(postgresDetails.databaseUrl, /^postgresql:\/\/moda_test_/);
  await postgres.cleanup();
  assert.ok(postgresDouble.calls.some((args) => args[0] === "run" && args.includes("0:5432")));
  assert.ok(postgresDouble.calls.some((args) => args[0] === "rm" && args.includes("--volumes")));

  const redisDouble = createDockerDouble({ redisPort: 26379 });
  const redis = new EphemeralRedis({
    runDocker: redisDouble.runDocker,
    pollIntervalMs: 1,
    startupTimeoutMs: 10,
  });
  const redisDetails = await redis.start();
  assert.equal(redisDetails.port, 26380);
  assert.equal(redisDetails.url, "redis://127.0.0.1:26380");
  await redis.cleanup();
  assert.ok(redisDouble.calls.some((args) => args[0] === "run" && args.includes("0:6379")));
  assert.ok(redisDouble.calls.some((args) => args[0] === "rm" && args.includes("--volumes")));
});

test("migration deployment uses caller-controlled schema path, cwd, and database URL", async () => {
  let received: { command: string; args: readonly string[]; cwd?: string; databaseUrl?: string } | undefined;
  await deployPrismaMigrations({
    databaseUrl: "postgresql://test-db",
    prismaSchemaPath: "database/prisma/schema.prisma",
    cwd: "/consumer",
    prismaBinary: "prisma-test",
    runCommand: async (command, args, options) => {
      received = {
        command,
        args,
        cwd: options?.cwd,
        databaseUrl: options?.env?.DATABASE_URL,
      };
      return { stdout: "", stderr: "" };
    },
  });

  assert.deepEqual(received, {
    command: "prisma-test",
    args: ["migrate", "deploy", "--schema", "database/prisma/schema.prisma"],
    cwd: "/consumer",
    databaseUrl: "postgresql://test-db",
  });
});

test("orchestration exposes aliases and cleans both services when migration fails", async () => {
  const postgresDouble = createDockerDouble({ postgresPort: 25433 });
  const redisDouble = createDockerDouble({ redisPort: 26380 });
  let callbackCalled = false;
  let migrationCalled = false;

  await assert.rejects(
    withDisposableIntegrationInfrastructure(
      {
        prismaSchemaPath: "consumer/schema.prisma",
        cwd: "/consumer",
        postgres: { runDocker: postgresDouble.runDocker, pollIntervalMs: 1, startupTimeoutMs: 10 },
        redis: { runDocker: redisDouble.runDocker, pollIntervalMs: 1, startupTimeoutMs: 10 },
        deployMigrations: async (options) => {
          migrationCalled = options.databaseUrl.startsWith("postgresql://");
          throw new Error("migration failed");
        },
      },
      async () => {
        callbackCalled = true;
      },
    ),
    /migration failed/,
  );

  assert.equal(migrationCalled, true);
  assert.equal(callbackCalled, false);
  assert.ok(postgresDouble.calls.some((args) => args[0] === "rm"));
  assert.ok(redisDouble.calls.some((args) => args[0] === "rm"));
});

test("parallel harness instances have distinct container identities and endpoints", async () => {
  const first = createDockerDouble({ postgresPort: 25001 });
  const second = createDockerDouble({ postgresPort: 25002 });
  const [firstDetails, secondDetails] = await Promise.all([
    new EphemeralPostgres({ runDocker: first.runDocker }).start(),
    new EphemeralPostgres({ runDocker: second.runDocker }).start(),
  ]);

  assert.notEqual(firstDetails.containerName, secondDetails.containerName);
  assert.notEqual(firstDetails.port, secondDetails.port);
});

test("parallel orchestration instances expose distinct endpoints", async () => {
  const firstPostgres = createDockerDouble({ postgresPort: 25101 });
  const secondPostgres = createDockerDouble({ postgresPort: 25102 });
  const firstRedis = createDockerDouble({ redisPort: 26401 });
  const secondRedis = createDockerDouble({ redisPort: 26402 });

  const results = await Promise.all([
    withDisposableIntegrationInfrastructure(
      {
        prismaSchemaPath: "schema.prisma",
        postgres: { runDocker: firstPostgres.runDocker },
        redis: { runDocker: firstRedis.runDocker },
        deployMigrations: async () => undefined,
      },
      async (infrastructure) => infrastructure,
    ),
    withDisposableIntegrationInfrastructure(
      {
        prismaSchemaPath: "schema.prisma",
        postgres: { runDocker: secondPostgres.runDocker },
        redis: { runDocker: secondRedis.runDocker },
        deployMigrations: async () => undefined,
      },
      async (infrastructure) => infrastructure,
    ),
  ]);

  assert.notEqual(results[0].postgres.containerName, results[1].postgres.containerName);
  assert.notEqual(results[0].databaseUrl, results[1].databaseUrl);
  assert.notEqual(results[0].redisUrl, results[1].redisUrl);
});