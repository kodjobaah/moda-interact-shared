import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const dbRepo = resolve(root, "../moda-interact-database");
const migrations = resolve(dbRepo, "prisma/migrations");
assert.ok(existsSync(resolve(dbRepo, "package.json")), "sibling moda-interact-database is required");
assert.ok(existsSync(resolve(dbRepo, "node_modules/@prisma/client")), "run npm ci in sibling database repository");
const container = `arch033-shared-${randomUUID()}`;
const dbName = "arch033_shared_fixture";
let running = false;
const docker = (args, opts = {}) => execFileSync("docker", args, {
  encoding: "utf8", maxBuffer: 32 * 1024 * 1024, ...opts,
});
const sql = (statement) => docker(["exec", "-i", container, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", dbName], { input: statement });
const sqlWhenReady = async (statement) => {
  for (let attempt = 0; attempt < 60; attempt++) {
    try { return sql(statement); }
    catch (error) {
      const message = String(error);
      if (!message.includes("database system is starting up") && !message.includes("database system is shutting down") && !message.includes("No such file or directory")) throw error;
      await delay(500);
    }
  }
  throw new Error("PostgreSQL remained unavailable while applying the migration");
};
try {
  docker(["run", "--detach", "--name", container, "--publish", "127.0.0.1::5432",
    "--env", "POSTGRES_PASSWORD=arch033-disposable", "--env", `POSTGRES_DB=${dbName}`,
    "pgvector/pgvector:pg17"]);
  running = true;
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { docker(["exec", container, "pg_isready", "-U", "postgres", "-d", dbName], { stdio: "pipe" }); ready = true; break; }
    catch { await delay(500); }
  }
  assert.ok(ready, "PostgreSQL did not become ready");
  const names = readdirSync(migrations).filter(x => /^\d{14}_/.test(x)).sort();
  assert.ok(names.includes("20261011160000_arch033_generic_operational_incidents"), "ARCH-033 database patch required");
  for (const name of names) {
    await sqlWhenReady(readFileSync(resolve(migrations, name, "migration.sql"), "utf8"));
  }
  await sqlWhenReady(`INSERT INTO commerce."Shop" ("id","domain","platform","updatedAt") VALUES
    ('arch033-shop','arch033-shared.example.invalid','SHOPIFY',now());
    INSERT INTO public."PlatformAdmin" ("id","email","updatedAt") VALUES
    ('arch033-admin','arch033-fixture@example.invalid',now());
    INSERT INTO support."MerchantSupportThread" ("id","shopId","updatedAt") VALUES
    ('arch033-support-thread','arch033-shop',now());`);
  const mappings = docker(["port", container, "5432/tcp"]).trim();
  const port = mappings.match(/:(\d+)\s*$/)?.[1];
  assert.ok(port, `Could not determine mapped port: ${mappings}`);
  // The local fixture is the only database reachable by the test; never consult ambient DATABASE_URL.
  const fixtureUrl = `postgresql://postgres:arch033-disposable@127.0.0.1:${port}/${dbName}?schema=public`;
  execFileSync("npm", ["run", "prisma:generate"], { cwd: dbRepo, stdio: "inherit", env: { ...process.env, DATABASE_URL: fixtureUrl } });
  execFileSync(resolve(root, "node_modules/.bin/tsx"), ["src/incidents/postgres.integration.ts"], {
    cwd: root, stdio: "inherit",
    env: { ...process.env, DATABASE_URL: fixtureUrl, ARCH033_DISPOSABLE_POSTGRES: "1" },
  });
  console.log("PASS ARCH-033 Shared disposable PostgreSQL integration");
} finally {
  if (running) {
    try { docker(["rm", "--force", container]); console.log(`CLEANUP ${container}`); }
    catch (error) { console.error("CLEANUP FAILED", error); process.exitCode = 1; }
  }
}
