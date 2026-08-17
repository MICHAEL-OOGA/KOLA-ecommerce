import "dotenv/config";

import app from "./app.js";
import prisma from "./config/prisma.js";
import {
  startOrderExpiryWorker,
  stopOrderExpiryWorker,
} from "./services/order-expiry.service.js";
import { validateRuntimeSecurityConfiguration } from "./config/security.config.js";

/*
|--------------------------------------------------------------------------
| Fail-fast runtime security validation
|--------------------------------------------------------------------------
*/

validateRuntimeSecurityConfiguration();

console.log("Runtime security configuration validated.");

const PORT = Number(process.env.PORT) || 5000;

let shutdownStarted = false;

const server = app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);

  startOrderExpiryWorker();
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
 * Reject malformed HTTP requests without passing them into Express.
 */
server.on("clientError", (error, socket) => {
  console.error("Malformed HTTP request rejected:", {
    code: error.code,
    message: error.message,
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

const shutdown = (signal, exitCode = 0) => {
  if (shutdownStarted) {
    return;
  }

  shutdownStarted = true;

  console.log(`${signal} received. Shutting down safely...`);

  stopOrderExpiryWorker();

  const forcedShutdownTimer = setTimeout(() => {
    console.error("Forced shutdown after waiting for active requests.");

    server.closeAllConnections?.();

    process.exit(1);
  }, 30_000);

  forcedShutdownTimer.unref();

  server.close(async (error) => {
    try {
      await prisma.$disconnect();
    } catch (disconnectError) {
      console.error("Prisma disconnect error:", {
        message: disconnectError.message,
      });
    } finally {
      clearTimeout(forcedShutdownTimer);
    }

    if (error) {
      console.error("HTTP server shutdown error:", {
        message: error.message,
      });

      process.exit(1);
    }

    console.log("Server stopped safely.");

    process.exit(exitCode);
  });

  /*
   * Close idle keep-alive sockets immediately while active requests finish.
   */
  server.closeIdleConnections?.();
};

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
    name: error.name,
    message: error.message,
  });

  shutdown("UNCAUGHT_EXCEPTION", 1);
});
