// src/config/database.direct.js
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const directConnectionString = process.env.DIRECT_URL;

if (!directConnectionString) {
  throw new Error('DIRECT_URL is not set in .env');
}

const directPool = new pg.Pool({
  connectionString: directConnectionString,
  max: 5, // 🔥 UPGRADED: Allows up to 14-15 concurrent transactions safely
  // idleTimeoutMillis: 10000, // Close direct connections quickly when idle to save DB memory
  // connectionTimeoutMillis: 5000,
});

const directAdapter = new PrismaPg(directPool);

const globalForDirectPrisma = globalThis;

export const prismaDirect =
  globalForDirectPrisma.__prismaDirect ??
  new PrismaClient({
    adapter: directAdapter,
    log:
      process.env.NODE_ENV === 'production'
        ? ['error']
        : ['query', 'warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForDirectPrisma.__prismaDirect = prismaDirect;
}

const disconnect = async () => {
  await prismaDirect.$disconnect();
  await directPool.end();
};

process.once('beforeExit', disconnect);
process.once('SIGINT', async () => {
  await disconnect();
  process.exit(0);
});
process.once('SIGTERM', async () => {
  await disconnect();
  process.exit(0);
});

export default prismaDirect;