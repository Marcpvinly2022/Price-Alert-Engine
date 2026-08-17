// src/config/database.js
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Add it to .env (Supabase transaction pooler)."
  );
}

// 📦 Instantiate a safe native pg pool connection
const pool = new pg.Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

// Create the explicit translation adapter required by Prisma v7
const adapter = new PrismaPg(pool);

const globalForPrisma = globalThis;

// Pass the generated adapter cleanly into the constructor layout
export const prisma =
  globalForPrisma.__prisma ??
  new PrismaClient({
    adapter,
    log:
      process.env.NODE_ENV === "production"
        ? ["error"]
        : ["query", "warn", "error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__prisma = prisma;
}

// Teardown connections written strictly using an arrow function
const disconnect = async () => {
  await prisma.$disconnect();
  await pool.end();
};

process.once("beforeExit", () => disconnect());
process.once("SIGINT", async () => {
  await disconnect();
  process.exit(0);
});
process.once("SIGTERM", async () => {
  await disconnect();
  process.exit(0);
});

export default prisma;