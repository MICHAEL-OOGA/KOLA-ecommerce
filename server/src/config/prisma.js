import "dotenv/config";

import PrismaPackage from "@prisma/client";

import { PrismaPg } from "@prisma/adapter-pg";

import { Pool } from "pg";

const { PrismaClient } = PrismaPackage;

const IS_PRODUCTION = process.env.NODE_ENV === "production";

const connectionString = process.env.DATABASE_URL?.trim();

if (!connectionString) {
  throw new Error("DATABASE_URL is required.");
}

/*
|--------------------------------------------------------------------------
| Database URL validation
|--------------------------------------------------------------------------
*/

let parsedDatabaseUrl;

try {
  parsedDatabaseUrl = new URL(connectionString);
} catch {
  throw new Error("DATABASE_URL is not a valid database URL.");
}

if (
  parsedDatabaseUrl.protocol !== "postgres:" &&
  parsedDatabaseUrl.protocol !== "postgresql:"
) {
  throw new Error("DATABASE_URL must use the PostgreSQL protocol.");
}

if (IS_PRODUCTION) {
  const sslMode = parsedDatabaseUrl.searchParams.get("sslmode")?.toLowerCase();

  const secureSslModes = new Set(["require", "verify-ca", "verify-full"]);

  if (!sslMode || !secureSslModes.has(sslMode)) {
    throw new Error(
      "Production DATABASE_URL must require PostgreSQL TLS using sslmode=require, verify-ca, or verify-full.",
    );
  }
}

/*
|--------------------------------------------------------------------------
| PostgreSQL connection pool
|--------------------------------------------------------------------------
|
| Prisma 7 uses the native pg driver pool.
|
| We create the pool ourselves so we can:
| - control connection lifetime
| - rotate stale connections
| - handle idle connection errors
| - avoid holding old network sockets indefinitely
*/

export const postgresPool = new Pool({
  connectionString,

  /*
   * Allow Neon enough time to wake/reconnect.
   */
  connectionTimeoutMillis: 30_000,

  /*
   * Keep connection usage bounded.
   */
  max: 10,

  /*
   * Do not hold unused TCP connections for five minutes.
   *
   * An idle connection is discarded after 30 seconds.
   */
  idleTimeoutMillis: 300_000,

  /*
   * Even a heavily reused connection is replaced after
   * five minutes.
   *
   * This protects a long-running KOLA process from keeping
   * the same stale connection indefinitely.
   */
  maxLifetimeSeconds: 1_000,

  keepAlive: true,

  keepAliveInitialDelayMillis: 10_000,

  application_name: "KOLA-api",
});

/*
|--------------------------------------------------------------------------
| Idle connection error handling
|--------------------------------------------------------------------------
|
| pg can emit errors from connections sitting inside the pool when:
| - the network changes
| - the database closes a connection
| - a backend restart/failover occurs
|
| pg removes the failed client automatically.
|
| We log the event without crashing KOLA.
*/

postgresPool.on("error", (error) => {
  console.error("PostgreSQL idle connection error:", {
    name: error?.name,
    code: error?.code,
    message: error?.message,
  });
});

/*
|--------------------------------------------------------------------------
| Prisma adapter
|--------------------------------------------------------------------------
*/

const adapter = new PrismaPg(postgresPool);

const prisma = new PrismaClient({
  adapter,

  transactionOptions: {
    maxWait: 30_000,

    timeout: 30_000,
  },
});

export default prisma;
