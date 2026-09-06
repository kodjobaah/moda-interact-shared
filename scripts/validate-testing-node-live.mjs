import assert from "node:assert/strict";
import { withDisposableIntegrationInfrastructure } from "@modainteract/moda-interact-shared/testing/node";

const prismaSchemaPath = process.env.MODA_TEST_PRISMA_SCHEMA_PATH;
if (!prismaSchemaPath) {
  console.log("live testing/node validation skipped; set MODA_TEST_PRISMA_SCHEMA_PATH to enable it");
  process.exit(0);
}

await withDisposableIntegrationInfrastructure(
  {
    prismaSchemaPath,
    cwd: process.env.MODA_TEST_PRISMA_CWD || process.cwd(),
  },
  async ({ environment }) => {
    assert.match(environment.DATABASE_URL, /^postgresql:\/\//);
    assert.match(environment.REDIS_URL, /^redis:\/\//);
  },
);

console.log("live testing/node infrastructure validation passed");