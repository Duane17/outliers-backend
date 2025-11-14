// src/db/prisma.ts
import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __PRISMA__: PrismaClient | undefined;
}

function makeClient() {
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    errorFormat: process.env.NODE_ENV === "development" ? "pretty" : "minimal",
  });
}

// Reuse a single client in dev to avoid connection storms on hot reload
export const prisma = global.__PRISMA__ ?? makeClient();

// In dev, cache on global to preserve a single instance across reloads
if (process.env.NODE_ENV !== "production") {
  global.__PRISMA__ = prisma;
}

// Optional: pre-connect in dev to fail fast on bad DATABASE_URL
if (process.env.NODE_ENV === "development") {
  prisma.$connect().catch((e) => {
    // eslint-disable-next-line no-console
    console.error("Failed to connect to database:", e);
    process.exit(1);
  });
}

// Optional: expose a shutdown helper for your server’s shutdown routine
export async function closePrisma() {
  await prisma.$disconnect();
}
