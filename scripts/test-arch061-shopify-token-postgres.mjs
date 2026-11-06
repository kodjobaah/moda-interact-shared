import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const workspace = process.env.MODA_WORKSPACE_ROOT;
assert.ok(workspace, "canonical MODA_WORKSPACE_ROOT is required");
const dbRepo = resolve(workspace, "moda-interact-database");
const prismaClientPath = resolve(dbRepo, "node_modules/@prisma/client");
assert.ok(existsSync(resolve(dbRepo, "package.json")), "canonical moda-interact-database checkout is required");
assert.ok(existsSync(prismaClientPath), "generated database Prisma client is required");
const container = `arch061-shared-${randomUUID()}`;
const dbName = "arch061_shopify_refresh";
let running = false;
const docker = (args, options = {}) => execFileSync("docker", args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024, ...options });
const sql = (statement) => docker(["exec", "-i", container, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", dbName], { input: statement });
const sqlWhenReady = async (statement) => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { return sql(statement); }
    catch (error) {
      const message = String(error);
      if (!message.includes("database system is starting up") && !message.includes("database system is shutting down") && !message.includes("No such file or directory")) throw error;
      await delay(500);
    }
  }
  throw new Error("PostgreSQL remained unavailable while preparing the isolated schema");
};
try {
  docker(["run", "--detach", "--name", container, "--publish", "127.0.0.1::5432", "--env", "POSTGRES_PASSWORD=arch061-disposable", "--env", `POSTGRES_DB=${dbName}`, "postgres:17"]);
  running = true;
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { docker(["exec", container, "pg_isready", "-U", "postgres", "-d", dbName], { stdio: "pipe" }); ready = true; break; }
    catch { await delay(500); }
  }
  assert.ok(ready, "disposable PostgreSQL did not become ready");
  await sqlWhenReady(`CREATE SCHEMA commerce;
CREATE SCHEMA shopify;
CREATE TYPE commerce."ShopPlatform" AS ENUM ('SHOPIFY', 'WOOCOMMERCE');
CREATE TYPE commerce."ShopStatus" AS ENUM ('ACTIVE', 'UNINSTALLED', 'SUSPENDED');
CREATE TABLE commerce."Shop" (
  "id" TEXT PRIMARY KEY,
  "domain" TEXT NOT NULL UNIQUE,
  "platform" commerce."ShopPlatform" NOT NULL DEFAULT 'SHOPIFY',
  "status" commerce."ShopStatus" NOT NULL DEFAULT 'ACTIVE'
);
CREATE TABLE shopify."Session" (
  "id" TEXT PRIMARY KEY,
  "shop" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "isOnline" BOOLEAN NOT NULL DEFAULT FALSE,
  "scope" TEXT,
  "expires" TIMESTAMPTZ,
  "accessToken" TEXT NOT NULL,
  "refreshToken" TEXT,
  "refreshTokenExpires" TIMESTAMPTZ
);
`);
  const port = docker(["port", container, "5432/tcp"]).trim().match(/:(\d+)\s*$/)?.[1];
  assert.ok(port, "could not resolve disposable PostgreSQL port");
  const databaseUrl = `postgresql://postgres:arch061-disposable@127.0.0.1:${port}/${dbName}?schema=public`;
  execFileSync("npx", ["tsx", "--test", "src/shopify/offline-token-provider.postgres.test.ts"], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: databaseUrl, ARCH061_PRISMA_CLIENT_PATH: prismaClientPath, ARCH061_DISPOSABLE_POSTGRES: "1" },
  });
  console.log("PASS ARCH-061 Shared disposable PostgreSQL concurrency and recovery scenarios");
} finally {
  if (running) {
    try { docker(["rm", "--force", container]); console.log(`CLEANUP ${container}`); }
    catch (error) { console.error("CLEANUP FAILED", error); process.exitCode = 1; }
  }
}
