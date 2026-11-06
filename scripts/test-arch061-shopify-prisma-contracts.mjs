import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const sharedRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const workspaceRoot = process.env.MODA_WORKSPACE_ROOT;
assert.ok(workspaceRoot, "canonical MODA_WORKSPACE_ROOT is required");

const backgroundClient = resolve(workspaceRoot, "moda-interact-background/node_modules/@prisma/client/index");
const commerceClient = resolve(workspaceRoot, "moda-interact-commerce/node_modules/@prisma/client/index");
const portTypes = resolve(sharedRoot, "src/shopify/offline-token-provider.js");
const tempDirectory = mkdtempSync(resolve(tmpdir(), "arch061-prisma-contracts-"));
const sourceFile = resolve(tempDirectory, "shopify-prisma-contracts.ts");

try {
  const source = `
import type { PrismaClient as BackgroundPrismaClient } from ${JSON.stringify(backgroundClient)};
import type { PrismaClient as CommercePrismaClient } from ${JSON.stringify(commerceClient)};
import type { ShopifyOfflineDatabase } from ${JSON.stringify(portTypes)};

declare const background: BackgroundPrismaClient;
declare const commerce: CommercePrismaClient;

const adaptBackground = (prisma: BackgroundPrismaClient): ShopifyOfflineDatabase => ({
  shop: prisma.shop,
  $transaction: (work, options) => prisma.$transaction((transaction) => work(transaction), options),
});
const adaptCommerce = (prisma: CommercePrismaClient): ShopifyOfflineDatabase => ({
  shop: prisma.shop,
  $transaction: (work, options) => prisma.$transaction((transaction) => work(transaction), options),
});

void adaptBackground(background);
void adaptCommerce(commerce);
`;
  writeFileSync(sourceFile, source, "utf8");
  execFileSync(resolve(sharedRoot, "node_modules/.bin/tsc"), [
    "--noEmit", "--skipLibCheck", "--strict", "--target", "ES2022",
    "--module", "NodeNext", "--moduleResolution", "NodeNext",
    "--typeRoots", resolve(sharedRoot, "node_modules/@types"), sourceFile,
  ], { cwd: sharedRoot, stdio: "inherit" });
  console.log("PASS ARCH-061 Shared Prisma adapters compile against Background and Commerce generated clients");
} finally {
  rmSync(tempDirectory, { recursive: true, force: true });
}
