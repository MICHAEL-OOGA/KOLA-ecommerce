import "dotenv/config";

import PrismaPackage from "@prisma/client";

import { PrismaPg } from "@prisma/adapter-pg";

const { PrismaClient } = PrismaPackage;

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is missing. Check your server/.env file.");
}

const adapter = new PrismaPg({
  connectionString,

  /*
   * Do not wait forever when PostgreSQL cannot be reached.
   */
  connectionTimeoutMillis: 5_000,

  /*
   * Limit the local pg pool.
   */
  max: 10,

  /*
   * Release idle connections.
   */
  idleTimeoutMillis: 30_000,

  application_name: "mini-ecommerce-api",
});

const prisma = new PrismaClient({
  adapter,

  transactionOptions: {
    maxWait: 10_000,

    timeout: 15_000,
  },
});

export default prisma;
