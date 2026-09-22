import "dotenv/config";

import app from "./app.js";

import prisma, { postgresPool } from "./config/prisma.js";

import {
  startOrderExpiryWorker,
  stopOrderExpiryWorker,
} from "./services/order-expiry.service.js";

import {
  startMpesaReconciliationWorker,
  stopMpesaReconciliationWorker,
} from "./services/mpesa-reconciliation.service.js";

import { validateRuntimeSecurityConfiguration } from "./config/security.config.js";

import {
  startSecurityCleanupWorker,
  stopSecurityCleanupWorker,
} from "./services/security-cleanup.service.js";

/*
|--------------------------------------------------------------------------
| Runtime security validation
|--------------------------------------------------------------------------
|
| Never begin accepting HTTP traffic until security configuration
| has been validated.
*/

validateRuntimeSecurityConfiguration();

console.log("Runtime security configuration validated.");

/*
|--------------------------------------------------------------------------
| Port validation
|--------------------------------------------------------------------------
*/

const readPort = () => {
  const rawPort = process.env.PORT?.trim() || "5000";

  if (!/^\d+$/.test(rawPort)) {
    throw new Error("PORT must be a whole number.");
  }

  const port = Number(rawPort);

  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be between 1 and 65535.");
  }

  return port;
};

const PORT = readPort();

/*
|--------------------------------------------------------------------------
| Database startup check
|--------------------------------------------------------------------------
|
| Fail before listening for requests when PostgreSQL cannot be reached.
*/

try {
  await prisma.$connect();

  console.log("Database connection established.");
} catch (error) {
  console.error("Database startup connection failed:", {
    name: error?.name,
    code: error?.code,
    message: error?.message,
  });

  process.exit(1);
}

/*
|--------------------------------------------------------------------------
| Start HTTP server
|--------------------------------------------------------------------------
*/

let shutdownStarted = false;

const server = app.listen(PORT, () => {
  console.log(`KOLA API listening on port ${PORT}.`);

  startOrderExpiryWorker();

  startSecurityCleanupWorker();

  startMpesaReconciliationWorker();
});

/*
|--------------------------------------------------------------------------
| HTTP-server limits
|--------------------------------------------------------------------------
*/

server.requestTimeout = 30_000;

server.headersTimeout = 15_000;

server.keepAliveTimeout = 5_000;

server.maxHeadersCount = 100;

server.maxRequestsPerSocket = 1_000;

/*
|--------------------------------------------------------------------------
| Malformed HTTP protection
|--------------------------------------------------------------------------
*/

server.on("clientError", (error, socket) => {
  console.error("Malformed HTTP request rejected:", {
    code: error?.code,
    message: error?.message,
  });

  if (socket.writable) {
    socket.end(
      "HTTP/1.1 400 Bad Request\r\n" +
        "Connection: close\r\n" +
        "Content-Length: 0\r\n" +
        "\r\n",
    );
  }
});

/*
|--------------------------------------------------------------------------
| Graceful shutdown
|--------------------------------------------------------------------------
*/

const shutdown = (signal, exitCode = 0) => {
  if (shutdownStarted) {
    return;
  }

  shutdownStarted = true;

  console.log(`${signal} received. Shutting down safely...`);

  stopOrderExpiryWorker();

  stopSecurityCleanupWorker();

  stopMpesaReconciliationWorker();

  const forcedShutdownTimer = setTimeout(() => {
    console.error("Forced shutdown after waiting for active requests.");

    server.closeAllConnections?.();

    process.exit(1);
  }, 30_000);

  forcedShutdownTimer.unref();

  server.close(async (error) => {
    try {
      await prisma.$disconnect();
      await postgresPool.end();
    } catch (disconnectError) {
      console.error("Prisma disconnect error:", {
        message: disconnectError?.message,
      });
    } finally {
      clearTimeout(forcedShutdownTimer);
    }

    if (error) {
      console.error("HTTP server shutdown error:", {
        message: error?.message,
      });

      process.exit(1);
    }

    console.log("Server stopped safely.");

    process.exit(exitCode);
  });

  /*
   * Stop accepting unused keep-alive connections while
   * allowing currently active requests to finish.
   */
  server.closeIdleConnections?.();
};

/*
|--------------------------------------------------------------------------
| Process lifecycle
|--------------------------------------------------------------------------
*/

process.on("SIGINT", () => {
  shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  shutdown("SIGTERM");
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", {
    message: reason instanceof Error ? reason.message : String(reason),
  });

  shutdown("UNHANDLED_REJECTION", 1);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", {
    name: error?.name,
    message: error?.message,
  });

  shutdown("UNCAUGHT_EXCEPTION", 1);
});
